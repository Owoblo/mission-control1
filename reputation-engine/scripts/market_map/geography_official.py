"""Attach source-backed Ontario LIO municipal IDs without fuzzy identity merges.

MUNID is an Ontario LIO municipal identifier, not a Statistics Canada CSDUID.
The namespace is preserved explicitly. Polygon islands are grouped by MUNID;
they are not additional municipalities. Existing conflicting IDs/parents remain
unchanged and produce a review with the competing source evidence.
"""
from __future__ import annotations

import json
import hashlib
from collections import defaultdict
from pathlib import Path

from .geography import geography_id, normalise_locality
from .store import stable_id, stamp, dumps, digest


def apply_reviewed_hamilton_id(store, decision, attribute_file, source):
    """Apply one explicit, source-backed City Hamilton decision, never a rematch.

    The saved review and original attribute receipt must agree byte for byte.
    Existing competing IDs are retained for review. This does not alter parents,
    locality labels, service configuration, or any business/location records.
    """
    if source.get("rights_status") not in {"permitted", "licensed_open", "open_licence", "open_license"}:
        raise ValueError("Reviewed official source permission is required")
    expected_url = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open03/MapServer/14"
    if source.get("source_url") != expected_url or decision.get("source_url") != expected_url:
        raise ValueError("Hamilton review source does not match official boundary layer")
    original = Path(attribute_file).read_bytes()
    if hashlib.sha256(original).hexdigest() != decision.get("evidence_sha256"):
        raise ValueError("Hamilton review attribute checksum mismatch")
    if decision.get("proposed_official_id") != "ontario:lio:munid:25005" or decision.get("publisher_full_name") != "CITY OF HAMILTON":
        raise ValueError("Review is not the explicit City Hamilton 25005 decision")
    excluded = decision.get("excluded_different_municipality") or {}
    if excluded != {"official_id": "ontario:lio:munid:14019", "full_name": "TOWNSHIP OF HAMILTON"}:
        raise ValueError("Review must distinguish Township Hamilton 14019")
    payload = json.loads(original)
    if payload.get("exceededTransferLimit"):
        raise ValueError("Hamilton attribute receipt was truncated")
    rows = [f["attributes"] for f in payload["features"]]
    city = [r for r in rows if str(r.get("MUNID")) == "25005"]
    township = [r for r in rows if str(r.get("MUNID")) == "14019"]
    if not city or not township or not all(r.get("MUNICIPAL_NAME") == "CITY OF HAMILTON" and r.get("MUNICIPAL_NAME_SHORTFORM") == "HAMILTON" and r.get("MUNICIPAL_TYPE") == "Single Tier Municipality" and not r.get("UPPER_TIER_MUNICIPALITY") for r in city):
        raise ValueError("Official City Hamilton full name/type/parent did not reconcile")
    if not all(r.get("MUNICIPAL_NAME") == "TOWNSHIP OF HAMILTON" for r in township):
        raise ValueError("Official Township Hamilton distinction did not reconcile")
    ident = decision.get("geography_id")
    target = store.db.execute("SELECT g.*,p.name AS parent_name FROM geographies g LEFT JOIN geographies p ON p.id=g.parent_id WHERE g.id=?", (ident,)).fetchone()
    configured = store.db.execute("""SELECT 1 FROM geography_service_areas m JOIN geographies a ON a.id=m.service_area_id
        WHERE m.geography_id=? AND a.name LIKE '%GTA%'""", (ident,)).fetchone()
    if not target or target["name"] != "Hamilton" or target["kind"] != "municipality" or target["parent_name"] != "Ontario" or not configured:
        raise ValueError("Reviewed configured City Hamilton identity/parent/service context changed")
    observed = source.get("last_checked_at") or stamp()
    with store.transaction():
        source_id = store.upsert_source(source)
        evidence = store.record_evidence(source_id, {"review_decision": decision, "city_polygon_attributes": city,
            "different_township_polygon_attributes": township, "original_attribute_sha256": decision["evidence_sha256"]},
            source_url=expected_url, observed_at=observed, source_record_id="25005-reviewed-city-hamilton",
            excerpt="Reviewed City Hamilton MUNID25005: configured GTA city, single-tier Ontario parent; distinct Township Hamilton MUNID14019 retained separately.")
        proposed = decision["proposed_official_id"]
        if target["official_id"] and target["official_id"] != proposed:
            review_id = store.add_review("official_geography_identifier_conflict", [ident], [evidence],
                f"Reviewed City Hamilton proposes {proposed}; existing {target['official_id']} retained")
            return {"status": "conflict_review_required", "geography_id": ident, "evidence_id": evidence, "review_id": review_id, "official_ids_attached": 0}
        store.db.execute("UPDATE geographies SET official_id=? WHERE id=?", (proposed, ident))
        for field, value in [("official_municipal_id", "25005"), ("official_full_name", "CITY OF HAMILTON"),
                ("official_municipal_type", "Single Tier Municipality"), ("official_upper_tier_name", None),
                ("boundary_effective_datetime", city[0].get("EFFECTIVE_DATETIME")), ("official_identifier_review_decision", decision)]:
            store.assert_field(ident, "geography", field, value, evidence, observed,
                method="explicit_review_of_official_name_type_parent_and_service_context", review_status="source_supported")
        return {"status": "already_attached" if target["official_id"] == proposed else "attached", "geography_id": ident,
            "official_id": proposed, "source_id": source_id, "evidence_id": evidence,
            "official_ids_attached": int(target["official_id"] != proposed), "parent_or_business_records_changed": False}


def apply_official_geographies(store, payload, source, *, create_missing=False):
    if source.get("rights_status") not in {"permitted", "licensed_open", "open_licence", "open_license"}:
        raise ValueError("Official geography source needs reviewed reuse permission")
    if payload.get("exceededTransferLimit"):
        raise ValueError("Official geography response was truncated")
    features = payload.get("features")
    if not isinstance(features, list):
        raise ValueError("Official geography payload needs ArcGIS features")
    expected = (source.get("config") or {}).get("expected_polygon_count")
    if expected is not None and len(features) != int(expected):
        raise ValueError("Official geographic feature count does not reconcile")
    grouped = defaultdict(list)
    for feature in features:
        row = feature.get("attributes") or {}
        if not row.get("MUNID") or not row.get("MUNICIPAL_NAME_SHORTFORM"):
            raise ValueError("Official MUNID/name fields missing; refusing guessed identifiers")
        grouped[str(row["MUNID"])].append(row)
    source_id = store.upsert_source(source)
    observed = payload.get("observed_at") or source.get("last_checked_at") or stamp()
    index = defaultdict(set)
    for row in store.db.execute("""SELECT g.id,g.name,a.alias_normalized FROM geographies g
        LEFT JOIN geography_aliases a ON a.geography_id=g.id WHERE g.kind='municipality'"""):
        index[normalise_locality(row["name"])].add(row["id"])
        if row["alias_normalized"]:
            index[row["alias_normalized"]].add(row["id"])
    official_names = defaultdict(set)
    for code, rows in grouped.items():
        for row in rows:
            for field in ("MUNICIPAL_NAME", "MUNICIPAL_NAME_SHORTFORM"):
                official_names[normalise_locality(row.get(field))].add(code)
    counts = {"polygon_features": len(features), "distinct_municipal_ids": len(grouped),
              "official_ids_attached": 0, "already_attached": 0, "new_municipality_geographies": 0,
              "unmatched_official_names": 0, "reviews": 0, "namespace": "ontario:lio:munid",
              "csduids_loaded": 0}
    with store.transaction():
        for code, rows in sorted(grouped.items()):
            names = {str(row["MUNICIPAL_NAME_SHORTFORM"]) for row in rows}
            fullnames = {str(row["MUNICIPAL_NAME"]) for row in rows}
            parents = {str(row["UPPER_TIER_MUNICIPALITY"]) for row in rows if row.get("UPPER_TIER_MUNICIPALITY")}
            evidence = store.record_evidence(source_id, {"MUNID": code, "polygon_attributes": rows,
                "unit": "one municipality identifier, possibly multiple mainland/island polygon features"},
                source_url=source["source_url"], observed_at=observed, source_record_id=code,
                excerpt=f"Official Ontario LIO municipality MUNID {code}: {sorted(names)}; parent {sorted(parents)}")
            if len(names) != 1 or len(fullnames) != 1 or len(parents) > 1:
                store.add_review("official_geography_conflict", evidence_ids=[evidence], reason=f"MUNID {code} has competing publisher names/parents")
                counts["reviews"] += 1
                continue
            short = next(iter(names))
            keys = {normalise_locality(n) for n in names | fullnames}
            if any(len(official_names[k]) > 1 for k in keys):
                store.add_review("ambiguous_official_geography", evidence_ids=[evidence], reason=f"Official municipality name {short} occurs under multiple identifiers")
                counts["reviews"] += 1
                continue
            candidates = set().union(*(index.get(k, set()) for k in keys))
            if len(candidates) > 1:
                store.add_review("ambiguous_official_geography", candidates, [evidence], f"Multiple local geography identities exactly match official municipality {short}")
                counts["reviews"] += 1
                continue
            if not candidates:
                if not create_missing:
                    counts["unmatched_official_names"] += 1
                    continue
                ident = geography_id(short, "municipality")
                ontario = store.db.execute("SELECT id FROM geographies WHERE kind='province' AND province='ON'").fetchone()
                store.db.execute("""INSERT INTO geographies(id,name,kind,parent_id,province,country,discovery_status,notes)
                    VALUES(?,?,'municipality',?,'ON','CA','not_searched',?)""", (ident, short, ontario[0] if ontario else None,
                    dumps({"geography_origin": "official_Ontario_LIO_municipality_source", "official_parent_name": next(iter(parents), None),
                           "official_source_evidence_id": evidence, "business_discovery_status": "not_searched"})))
                candidates = {ident}
                counts["new_municipality_geographies"] += 1
                for key in keys:
                    index[key].add(ident)
            ident = next(iter(candidates))
            row = store.db.execute("SELECT * FROM geographies WHERE id=?", (ident,)).fetchone()
            official_id = "ontario:lio:munid:" + code
            if row["official_id"] and row["official_id"] != official_id:
                store.add_review("official_geography_identifier_conflict", [ident], [evidence],
                                 f"Existing identifier {row['official_id']} differs from source-backed {official_id}; neither overwritten")
                counts["reviews"] += 1
            elif row["official_id"] == official_id:
                counts["already_attached"] += 1
            else:
                store.db.execute("UPDATE geographies SET official_id=? WHERE id=?", (official_id, ident))
                counts["official_ids_attached"] += 1
            for field, value in [("official_municipal_id", code), ("official_full_name", next(iter(fullnames))),
                                 ("official_municipal_type", rows[0].get("MUNICIPAL_TYPE")),
                                 ("official_upper_tier_name", next(iter(parents), None)),
                                 ("official_mah_code", rows[0].get("MAH_CODE")),
                                 ("boundary_effective_datetime", rows[0].get("EFFECTIVE_DATETIME"))]:
                store.assert_field(ident, "geography", field, value, evidence, observed,
                                   method="official_publisher_exact_name", review_status="source_supported")
            for name in names | fullnames:
                store.db.execute("""INSERT OR IGNORE INTO geography_aliases(id,geography_id,alias,alias_normalized,source)
                    VALUES(?,?,?,?,?)""", (stable_id("official-geography-alias", ident, normalise_locality(name)), ident,
                    name, normalise_locality(name), source_id))
            if parents and row["parent_id"]:
                existing_parent = store.db.execute("SELECT * FROM geographies WHERE id=?", (row["parent_id"],)).fetchone()
                parent = next(iter(parents))
                equivalents = {normalise_locality(parent)}
                for prefix, suffix in [("COUNTY OF ", " County"), ("REGIONAL MUNICIPALITY OF ", " Region")]:
                    if parent.upper().startswith(prefix):
                        equivalents.add(normalise_locality(parent[len(prefix):] + suffix))
                if existing_parent and normalise_locality(existing_parent["name"]) not in equivalents:
                    store.add_review("official_geography_parent_assertion", [ident, row["parent_id"]], [evidence],
                        f"Official upper-tier parent {parent} differs from internal hierarchy {existing_parent['name']}; review before replacing the parent")
                    counts["reviews"] += 1
        run_id = stable_id("official-geography-source-run", source_id, digest(payload), observed)
        config = source.get("config") or {}
        store.db.execute("""INSERT OR IGNORE INTO source_runs(id,source_id,started_at,completed_at,status,fetched_count,parsed_count,coverage_complete,expected_count,requests,bytes_fetched,estimated_cost,adapter_name,metadata_json,result_json)
            VALUES(?,?,?,?,'completed',?,?,1,?,?,?,0,'official_geography_attributes',?,?)""",
            (run_id, source_id, observed, stamp(), len(features), len(grouped), len(features),
             int(config.get("acquisition_requests") or 0), int(config.get("acquisition_bytes") or 0),
             dumps({"unit": "geographic features/municipality IDs; not commercial organisations", "official_identifier_namespace": "ontario:lio:munid"}), dumps(counts)))
    counts["source_id"] = source_id
    counts["source_run_id"] = run_id
    return counts
