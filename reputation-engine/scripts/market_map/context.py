"""Apply explicit official geographic context and review-only quality evidence."""
from __future__ import annotations

import json
from pathlib import Path

from .geography import geography_id, normalise_locality, resolve_geography, ambiguous_locality
from .store import stable_id, stamp, dumps, normalise


def apply_community_context(store, payload):
    assertion = payload["assertion"]
    if assertion.get("subject_type") != "community" or assertion.get("object_type") != "municipality":
        raise ValueError("Community context requires an explicit community-to-municipality assertion")
    parent = resolve_geography(store, assertion["object_name"])
    parent_row = store.db.execute("SELECT * FROM geographies WHERE id=?", (parent,)).fetchone() if parent else None
    if parent_row is None or parent_row["kind"] != "municipality":
        raise ValueError("Official context parent must resolve unambiguously to an existing municipality")
    source = payload["source"]
    source_id = store.upsert_source({"id": stable_id("official-community-source", source["source_url"]),
        "name": source["publisher"] + " community context", "publisher": source["publisher"],
        "source_url": source["source_url"], "source_type": "administrative_geography",
        "geography_scope": [assertion["subject_name"], assertion["object_name"]], "sector_scope": [],
        "rights_status": source.get("rights_status", "limited_excerpt_review"),
        "access_method": source.get("access_method", "manual_official_context"), "retrieval_status": "accessible",
        "last_checked_at": payload["observed_at"], "cost_model": "free",
        "notes": "Short official geographic context only; no new commercial census or service capability inferred."})
    child = geography_id(assertion["subject_name"], "community")
    updated = 0
    with store.transaction():
        evidence = store.record_evidence(source_id, payload, source["source_url"], payload["observed_at"],
            source_record_id="community:" + assertion["subject_name"], excerpt=assertion["supporting_excerpt"])
        existing = store.db.execute("SELECT * FROM geographies WHERE id=?", (child,)).fetchone()
        if existing and existing["parent_id"] and existing["parent_id"] != parent:
            review = store.add_review("community_parent_conflict", [child, parent, existing["parent_id"]], [evidence],
                "Official community context conflicts with the existing parent. Preserve both assertions for review.")
            return {"status": "review", "review_id": review, "evidence_id": evidence}
        store.db.execute("""INSERT INTO geographies(id,name,kind,parent_id,province,country,discovery_status,notes)
            VALUES(?,?,'community',?,?,?,'not_searched',?) ON CONFLICT(id) DO UPDATE SET parent_id=COALESCE(geographies.parent_id,excluded.parent_id)""",
            (child, assertion["subject_name"], parent, parent_row["province"], parent_row["country"],
             dumps({"mapping_status": "official_source_supported", "source_url": source["source_url"], "evidence_id": evidence})))
        qualified_names = [f'{assertion["subject_name"]} {assertion["object_name"]}',
                           f'{assertion["object_name"]} {assertion["subject_name"]}']
        aliases = qualified_names if ambiguous_locality(assertion["subject_name"]) else [assertion["subject_name"], *qualified_names]
        for alias in aliases:
            store.db.execute("INSERT OR IGNORE INTO geography_aliases VALUES(?,?,?,?,?)",
                (stable_id("official-community-alias", child, alias), child, alias,
                 normalise_locality(alias), "official_community_context:" + source_id))
        store.assert_field(child, "geography", "parent_id", parent, evidence, payload["observed_at"],
                           method="official_community_context", review_status="source_supported")
        store.db.execute("""INSERT OR IGNORE INTO relationships
            (id,subject_id,subject_type,predicate,object_id,object_type,asserted_by_source_id,evidence_id,confidence,observed_at,review_status)
            VALUES(?,?,'geography','community_in_municipality',?,'geography',?,?,NULL,?,'source_supported')""",
            (stable_id("community-parent", child, parent, evidence), child, parent, source_id, evidence, payload["observed_at"]))
        fill_names = qualified_names if ambiguous_locality(assertion["subject_name"]) else [assertion["subject_name"], *qualified_names]
        locations = store.db.execute("SELECT * FROM locations WHERE city_normalized IN (" + ",".join("?" for _ in fill_names) + ")",
            [normalise(name) for name in fill_names]).fetchall()
        for location in locations:
            if location["manually_verified"] or location["province"] not in (None, "ON") or location["country"] not in (None, "CA", "Canada"):
                continue
            if resolve_geography(store, location["city_raw"], location["region"]) != child:
                store.add_review("location_community_parent_conflict", [location["id"], parent], [evidence],
                    "Published locality/region does not resolve to this community; municipality left unchanged.")
                continue
            if location["municipality_id"] and location["municipality_id"] != parent:
                store.add_review("location_community_parent_conflict", [location["id"], parent, location["municipality_id"]], [evidence],
                    "Published community context differs from the current municipality; address-level review required.")
                continue
            if location["municipality_id"] is None:
                store.db.execute("UPDATE locations SET municipality_id=? WHERE id=?", (parent, location["id"]))
                store.assert_field(location["id"], "location", "municipality_id", parent, evidence, payload["observed_at"],
                    method="derived_from_official_community_context", review_status="source_mapped")
                store.db.execute("""INSERT OR IGNORE INTO identity_audit(id,action,entity_id,evidence_id,reason,before_json,after_json,observed_at)
                    VALUES(?,?,?,?,?,?,?,?)""", (stable_id("municipality-context-fill", location["id"], parent),
                    "municipality_unknown_filled", location["id"], evidence,
                    "Published locality matched official community-to-municipality context. Raw city and coordinates unchanged.",
                    dumps({"municipality_id": None}), dumps({"municipality_id": parent}), stamp()))
                updated += 1
    return {"status": "source_supported", "community_id": child, "parent_municipality_id": parent,
            "locations_with_unknown_municipality_filled": updated, "evidence_id": evidence,
            "runtime_service_labels_added": 0}


def apply_locality_ambiguity(store, payload):
    """Review named-place homonyms; retract only exactly proven context fills.

    Original source/assertion records and official community-parent proof stay
    intact. No point-to-municipality inference is made, including for Essex.
    """
    label = payload["publisher_locality"]
    if not ambiguous_locality(label):
        raise ValueError("Locality needs an evidence-backed explicit ambiguity guard before applying reviews")
    provider = payload["provider_source_id"]
    url = payload["official_names_source_url"]
    names = payload.get("official_names", [])
    if len({item.get("id") for item in names if item.get("name") == label}) < 2:
        raise ValueError("Ambiguity review requires distinct official named-place identifiers")
    observed = payload["observed_at"]
    source = store.upsert_source({"id": stable_id("official-locality-ambiguity", url),
        "name": "Official named-place ambiguity: " + label, "publisher": "Natural Resources Canada",
        "source_url": url, "source_type": "administrative_geography", "geography_scope": [label],
        "sector_scope": [], "rights_status": "licensed_open", "cost_model": "free",
        "access_method": "saved_official_named_place_reference",
        "notes": "Official named-place homonyms retained; no business coordinate or municipal polygon inferred."})
    stats = {"new_reviews": 0, "matched_provider_ids": 0, "unmatched_provider_ids": 0,
        "unsupported_context_fills_retracted": 0, "protected_assignments": 0,
        "city_or_coordinates_overwritten": 0, "assertions_deleted": 0}
    outcomes = []
    with store.transaction():
        evidence = store.record_evidence(source, payload, url, observed,
            source_record_id="locality-ambiguity:" + normalise_locality(label),
            excerpt="Official Oakland named places exist in Brant and Essex; bare locality requires qualified context.")
        for item in payload.get("provider_records", []):
            gers = item["provider_gers_id"]
            identity = store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?", (provider, gers)).fetchone()
            if identity is None:
                stats["unmatched_provider_ids"] += 1
                continue
            stats["matched_provider_ids"] += 1
            rid = stable_id("ambiguous-locality-review", provider, gers, normalise_locality(label))
            existed = store.db.execute("SELECT 1 FROM review_queue WHERE id=?", (rid,)).fetchone()
            store.add_review("ambiguous_published_locality", [v for v in (identity["organisation_id"], identity["location_id"]) if v],
                [identity["last_evidence_id"], evidence],
                "Bare Oakland can identify official named places in Brant or Essex. Preserve published fields; require qualified/address-supported context.", review_id=rid)
            stats["new_reviews"] += int(existed is None)
            location = store.db.execute("SELECT * FROM locations WHERE id=?", (identity["location_id"],)).fetchone() if identity["location_id"] else None
            outcome = {"provider_gers_id": gers, "location_id": identity["location_id"], "action": "review_only"}
            outcomes.append(outcome)
            if location is None or not location["municipality_id"]:
                continue
            parent = location["municipality_id"]
            fill_id = stable_id("municipality-context-fill", location["id"], parent)
            fill = store.db.execute("SELECT * FROM identity_audit WHERE id=? AND action='municipality_unknown_filled' AND entity_id=?",
                (fill_id, location["id"])).fetchone()
            exact_fill = False
            if fill and fill["reversed_at"] is None:
                try:
                    exact_fill = json.loads(fill["before_json"]) == {"municipality_id": None} and json.loads(fill["after_json"]) == {"municipality_id": parent}
                except (ValueError, TypeError):
                    pass
            assertions = store.db.execute("""SELECT * FROM field_assertions WHERE entity_id=? AND entity_type='location'
                AND field_name IN ('municipality_id','municipality_name')""", (location["id"],)).fetchall()
            matching = [row for row in assertions if row["field_name"] == "municipality_id" and
                row["method"] == "derived_from_official_community_context" and fill and row["evidence_id"] == fill["evidence_id"] and
                row["review_status"] == "source_mapped" and json.loads(row["value_json"]) == parent]
            protected = [row for row in assertions if row not in matching and json.loads(row["value_json"]) not in (None, "")]
            if location["manually_verified"] or normalise_locality(location["city_raw"]) != normalise_locality(label) or not exact_fill or not matching or protected:
                stats["protected_assignments"] += 1
                outcome["action"] = "protected_assignment_review_only"
                continue
            store.db.execute("UPDATE locations SET municipality_id=NULL WHERE id=? AND municipality_id=? AND manually_verified=0", (location["id"], parent))
            reason = "Retract only unsupported unverified municipality-context-fill for ambiguous bare locality. Original assertions, source city and coordinates preserved."
            now = stamp()
            store.db.execute("UPDATE identity_audit SET reversed_at=?,reversal_reason=? WHERE id=? AND reversed_at IS NULL", (now, reason, fill_id))
            store.db.execute("""INSERT OR IGNORE INTO identity_audit
                (id,action,entity_id,evidence_id,reason,before_json,after_json,observed_at) VALUES(?,?,?,?,?,?,?,?)""",
                (stable_id("municipality-context-fill-retraction", fill_id, evidence), "municipality_context_fill_retracted", location["id"], evidence, reason,
                 dumps({"municipality_id": parent, "fill_audit_id": fill_id}), dumps({"municipality_id": None, "review_required": True}), now))
            store.assert_field(location["id"], "location", "municipality_assignment_review",
                {"status": "unsupported_context_fill_retracted", "previous_municipality_id": parent, "fill_audit_id": fill_id},
                evidence, observed, method="official_locality_ambiguity_review", review_status="needs_review")
            stats["unsupported_context_fills_retracted"] += 1
            outcome["action"] = "unsupported_context_fill_retracted"
    return {**stats, "evidence_id": evidence, "outcomes": outcomes, "runtime_service_labels_added": 0}


def apply_community_batch(store, payload):
    if "assertion" in payload:
        return apply_community_context(store, payload)
    results = []
    for assertion in payload.get("assertions", []):
        for name in assertion["communities"]:
            results.append({"community": name, **apply_community_context(store, {
                "observed_at": payload["observed_at"], "source": {
                    "publisher": assertion["municipality"] + " official municipality",
                    "source_url": assertion["source_url"],
                    "rights_status": payload.get("rights_status", "limited_excerpt_review")},
                "assertion": {"subject_name": name, "subject_type": "community",
                    "object_name": assertion["municipality"], "object_type": "municipality",
                    "supporting_excerpt": assertion["supporting_excerpt"]}})})
    return {"community_contexts": len(results), "results": results,
            "runtime_service_labels_added": 0}


def import_coordinate_reviews(store, payload):
    new = unmatched = 0
    with store.transaction():
        for item in payload.get("reviews", []):
            source_id = item.get("provider_source_id") or payload["provider_source_id"]
            identity = store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?",
                (source_id, item["provider_gers_id"])).fetchone()
            if identity is None:
                unmatched += 1
                continue
            reference_id = store.upsert_source({"id": stable_id("official-place-anchor", item["reference_source_url"]),
                "name": "Official named-place anchor: " + item["reference_name"],
                "publisher": "Natural Resources Canada", "source_url": item["reference_source_url"],
                "source_type": "administrative_geography", "geography_scope": [item["reference_name"]],
                "sector_scope": [], "rights_status": "licensed_open", "cost_model": "free",
                "access_method": "saved_official_named_place_reference",
                "notes": "Representative official named-place point, not a municipal boundary. Comparison is internal research requiring review."})
            evidence = store.record_evidence(reference_id, {"reference_name": item["reference_name"],
                "latitude": item["reference_latitude"], "longitude": item["reference_longitude"],
                "reference_source_url": item["reference_source_url"]}, item["reference_source_url"],
                item.get("reference_observed_at") or payload["observed_at"],
                source_record_id="coordinate-review:" + item["provider_gers_id"], excerpt=item["reason"])
            rid = stable_id("coordinate-locality-review", source_id, item["provider_gers_id"], item["reference_source_url"])
            existed = store.db.execute("SELECT 1 FROM review_queue WHERE id=?", (rid,)).fetchone()
            store.add_review(item["issue_type"], [value for value in (identity["organisation_id"], identity["location_id"]) if value],
                [identity["last_evidence_id"], evidence], item["reason"], review_id=rid)
            if identity["location_id"]:
                store.assert_field(identity["location_id"], "location", "coordinate_locality_review", item,
                    evidence, payload["observed_at"], method="official_named_place_anchor_comparison", review_status="needs_review")
            new += int(existed is None)
    return {"new_reviews": new, "unmatched_provider_ids": unmatched,
            "city_or_coordinates_overwritten": 0, "named_place_anchor_is_municipal_boundary": False}
