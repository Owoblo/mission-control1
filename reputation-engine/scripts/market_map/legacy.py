"""Read-only replay of historical Windsor directory evidence, never CRM exports.

These snapshots add source coverage outside the old V2 ledger. Replaying them is
not a fresh source fetch, current business verification or outreach permission.
"""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from .store import domain, dumps, normalise, stable_id, stamp


UTILITY_DOMAINS = {
    "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "youtube.com",
    "youtu.be", "google.com", "google.ca", "googleapis.com", "gstatic.com", "googletagmanager.com",
    "doubleclick.net", "googleadservices.com", "adobe.com", "wordpress.org", "wix.com",
    "squarespace.com", "cloudflare.com", "apple.com", "microsoft.com", "mailto", "tel",
}


def _load_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def _load_csv(path):
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def _provider_date(value):
    if not value:
        return None
    try:
        if str(value).isdigit():
            return datetime.fromtimestamp(float(value) / 1000, timezone.utc).isoformat().replace("+00:00", "Z")
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).isoformat()
    except (ValueError, OverflowError, OSError):
        return None


def _city_from_published_address(store, address):
    """Only an explicit address suffix can identify a locality; membership cannot."""
    if not address:
        return None
    prefix = re.split(r",?\s+(?:ON|Ontario)\b", address, maxsplit=1, flags=re.I)[0].strip(" ,")
    aliases = store.db.execute("SELECT a.alias FROM geography_aliases a JOIN geographies g ON g.id=a.geography_id WHERE g.kind IN ('municipality','community','neighbourhood','district') ORDER BY LENGTH(a.alias) DESC").fetchall()
    for record in aliases:
        alias = record[0]
        if re.search(r"(?:^|[\s,])" + re.escape(alias) + r"$", prefix, re.I):
            return alias
    return None


def _municipality(store, names):
    from .geography import resolve_geography, municipality_for
    names = [names] if isinstance(names, str) else names or []
    found = set()
    for name in names:
        identifier = resolve_geography(store, name)
        parent = municipality_for(store, identifier) if identifier else None
        if parent:
            found.add(parent)
    return next(iter(found)) if len(found) == 1 else None


def _source(store, identifier, name, url, family, scope, date, note):
    existing = store.db.execute("SELECT id FROM sources WHERE id=?", (identifier,)).fetchone()
    if not existing:
        store.upsert_source({
            "id": identifier, "name": name, "publisher": name, "source_url": url,
            "source_type": family, "geography_scope": scope, "sector_scope": ["*"],
            "access_method": "legacy_snapshot", "rights_status": "legacy_unreviewed",
            "retrieval_status": "historical_snapshot", "source_date": None,
            "last_checked_at": date,
            "adapter_name": "legacy_windsor_snapshot", "notes": note + " Original local capture: " + str(date) + "; publisher publication date unknown.",
        })
    return identifier


def _link_parents(store, source_id, observations, observed_at):
    links = 0
    for child_key, parent_name in observations:
        child = store.db.execute("SELECT i.*,o.trading_name FROM source_identities i JOIN organisations o ON o.id=i.organisation_id WHERE i.source_id=? AND i.source_record_id=?", (source_id, child_key)).fetchone()
        if not child or normalise(parent_name) == normalise(child["trading_name"]):
            continue
        parent_key = "parent-assertion:" + child_key
        store.ingest(source_id, [{"source_record_id": parent_key, "name": parent_name, "country": "unknown", "province": None, "source_url": store.db.execute("SELECT source_url FROM evidence WHERE id=?", (child["last_evidence_id"],)).fetchone()[0], "observed_at": observed_at, "published_context": "Explicit demographics.parentName in historical directory profile; parent identity unverified"}], run_metadata={"adapter_name": "legacy_parent_assertion", "parser_version": "1", "observed_at": observed_at, "batch_id": parent_key, "coverage_complete": False})
        parent = store.db.execute("SELECT organisation_id FROM source_identities WHERE source_id=? AND source_record_id=?", (source_id, parent_key)).fetchone()
        with store.transaction():
            relation_id = stable_id("legacy-explicit-parent", source_id, child_key, parent_name)
            prior = store.db.execute("SELECT 1 FROM relationships WHERE id=?", (relation_id,)).fetchone()
            store.db.execute("INSERT OR IGNORE INTO relationships(id,subject_id,subject_type,predicate,object_id,object_type,asserted_by_source_id,evidence_id,confidence,observed_at,review_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)", (relation_id, parent[0], "organisation", "parent_of", child["organisation_id"], "organisation", source_id, child["last_evidence_id"], None, observed_at, "unverified"))
            store.add_review("parent_identity_unverified", [parent[0], child["organisation_id"]], [child["last_evidence_id"]], "Directory explicitly publishes a parent name; verify legal/brand relationship before account consolidation")
            links += int(prior is None)
    return links


def backfill_windsor_snapshots(store, repo_root, output=None):
    """Import 691 directory + 341 chamber observations when present, and frontier.

    Counts come from the actual files; no fixed volume is promised. Missing files
    are reported. Source API geometry is retained without guessing CRS/axis order.
    Historical related links enter a review frontier, never proved commercial edges.
    """
    before_organisations = store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0]
    base = Path(repo_root) / "partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15"
    report = {"snapshot_directory": str(base), "historical_observation_date": "2026-09-15", "runs": [], "missing_files": [], "parent_links_added": 0, "related_candidates": 0, "related_tasks_added": 0, "utility_links_excluded": 0, "network_requests": 0, "historical_collection_cost": "unknown", "notice": "Historical evidence replay; not fresh validation, a market census, or contact permission."}
    path = base / "accounts-and-locations.csv"
    profiles = _load_json(base / "public-profiles.json", {})
    raw_directory = _load_json(base / "source-companies.json", {}).get("Data", [])
    raw_by_id = {str(row.get("_id")): row for row in raw_directory}
    if path.exists():
        source_id = _source(store, "legacy-windsor-source-directory", "SourceWindsorEssex historical directory", "https://sourcewindsoressex.com/", "economic_development", ["Windsor", "Essex County"], "2026-09-15", "Historical local capture. Current access and reuse remain unreviewed; no fresh requests made.")
        rows, parents = [], []
        for entry in _load_csv(path):
            key = entry.get("source_id") or entry.get("account_id") or entry.get("source_url")
            raw = raw_by_id.get(key, {})
            profile = profiles.get(key, {})
            demographics = profile.get("demographics") or raw.get("demographics") or {}
            contacts = profile.get("contactDetails") or raw.get("contactDetails") or {}
            categories = demographics.get("sector") or [item.strip() for item in (entry.get("source_categories") or "").split(";") if item.strip()]
            emails = [contacts.get(field) for field in ("email", "executiveEmail", "salesEmail") if contacts.get(field)]
            location_types = str(demographics.get("headQuarterOrBranch") or "").casefold()
            location_type = "headquarters" if "headquarters" in location_types else "branch_office" if "branch" in location_types else "unknown"
            original_geometry = raw.get("location")
            row = {"name": entry.get("name") or demographics.get("companyTitle"), "source_record_id": key, "source_url": entry.get("source_url") or "https://sourcewindsoressex.com/company-details/" + str(key), "website": entry.get("website") or contacts.get("website"), "address": entry.get("address") or demographics.get("address"), "city": entry.get("city") or demographics.get("city"), "province": "ON" if entry.get("province") in ("ON", "Ontario") else entry.get("province") or None, "country": "CA", "postal_code": entry.get("postal_code") or demographics.get("postalCode"), "phone": entry.get("phone") or contacts.get("phoneNumber"), "published_emails": emails, "categories": categories, "description": demographics.get("description"), "municipality_id": _municipality(store, demographics.get("municipality")), "location_type": location_type, "observed_at": entry.get("retrieved_at") or profile.get("retrieved_at") or "2026-09-15", "source_published_at": _provider_date(profile.get("updatedAt") or entry.get("provider_updated_at")), "published_context": "Published historical SourceWindsorEssex profile contactDetails fields; generic/executive/sales roles are source labels, not verified people or permission", "raw_payload": {"cleaned_snapshot": entry, "directory_record": raw, "public_profile": profile}, "coordinates_observation": {"geometry": original_geometry, "spatial_reference": "unspecified", "axis_order": "unverified"} if original_geometry else None}
            rows.append(row)
            if demographics.get("parentName"):
                parents.append((str(key), str(demographics["parentName"]).strip()))
        result = store.ingest(source_id, rows, run_metadata={"adapter_name": "legacy_windsor_snapshot", "parser_version": "1", "observed_at": "2026-09-15", "batch_id": "sourcewindsoressex-directory-and-profiles", "requests": 0, "coverage_complete": False, "historical_source_count": len(rows)})
        report["runs"].append(result)
        report["parent_links_added"] += _link_parents(store, source_id, parents, "2026-09-15T00:00:00Z")
        with store.transaction():
            store.add_review("source_coordinate_reference_unknown", [], [], "SourceWindsorEssex historical Point arrays lack a verified CRS/axis-order declaration. Retain original geometry; do not silently relabel as WGS84 coordinates.")
    else:
        report["missing_files"].append(str(path))
    chamber_path = base / "expansion/chamber-profiles.jsonl"
    if chamber_path.exists():
        grouped = defaultdict(list)
        for line in chamber_path.read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                grouped[row.get("source") or "unknown_chamber"].append(row)
        for publisher, entries in sorted(grouped.items()):
            url = entries[0].get("source_url") or "urn:legacy-chamber:" + publisher
            source_id = _source(store, "legacy-windsor:" + publisher, publisher.replace("_", " ").title() + " historical profiles", "https://" + (urlsplit(url).hostname or "invalid.example") + "/", "chamber", ["Amherstburg"] if publisher == "amherstburg_chamber" else ["Leamington"], "2026-09-15", "Historical membership profiles. Chamber membership is not evidence of a local physical location. Current reuse unreviewed.")
            rows = []
            for entry in entries:
                address = entry.get("address") or ""
                row = {"name": entry.get("name"), "source_record_id": entry.get("source_url"), "source_url": entry.get("source_url"), "website": entry.get("website"), "address": address, "city": entry.get("city") or _city_from_published_address(store, address), "province": "ON" if re.search(r"\b(?:ON|Ontario)\b", address) else None, "country": "CA" if re.search(r"\b(?:ON|Ontario)\b", address) else "unknown", "phone": entry.get("phone"), "published_emails": entry.get("emails") or [], "categories": entry.get("category") or [], "observed_at": entry.get("checked_at") or "2026-09-15", "status": entry.get("status"), "published_context": "Published historical chamber profile; membership and contact publication do not establish local premises or outreach eligibility", "raw_payload": entry}
                rows.append(row)
            report["runs"].append(store.ingest(source_id, rows, run_metadata={"adapter_name": "legacy_chamber_snapshot", "parser_version": "1", "observed_at": "2026-09-15", "batch_id": publisher + "-raw-profiles", "coverage_complete": False, "historical_source_count": len(rows)}))
    else:
        report["missing_files"].append(str(chamber_path))
    related_path = base / "expansion/related-organization-candidates.csv"
    if related_path.exists():
        source_id = _source(store, "legacy-windsor-related-links", "Historical Windsor website external-link candidates", "https://sourcewindsoressex.com/", "official_website", ["Windsor", "Essex County"], "2026-09-15", "Previously extracted external links. Link presence is not proof of any client/partner/tenant relation; review required.")
        with store.transaction():
            for candidate in _load_csv(related_path):
                report["related_candidates"] += 1
                target = candidate.get("candidate_url") or ""
                parsed = urlsplit(target)
                host = domain(target)
                if parsed.scheme not in ("http", "https") or parsed.username or parsed.password or not host or any(host == blocked or host.endswith("." + blocked) for blocked in UTILITY_DOMAINS):
                    report["utility_links_excluded"] += 1
                    continue
                source_domain = domain(candidate.get("source_domain"))
                matches = store.db.execute("SELECT id FROM organisations WHERE primary_domain=? AND name_normalized=?", (source_domain, normalise(candidate.get("source_organization")))).fetchall()
                owner = matches[0][0] if len(matches) == 1 else None
                key = stable_id("historical-link-candidate", source_domain, target, candidate.get("evidence_url"))
                evidence_id = store.record_evidence(source_id, candidate, candidate.get("evidence_url") or target, "2026-09-15T00:00:00Z", source_record_id=key, excerpt="Observed an external website link. Commercial relationship and Ontario relevance remain unknown.")
                exists = store.db.execute("SELECT 1 FROM discovery_queue WHERE dedupe_key=?", (key,)).fetchone()
                now = stamp()
                payload = {**candidate, "auto_execute": False, "ontario_relevance": "unknown", "relationship_status": "unclassified_external_link", "historical_snapshot": True}
                store.db.execute("INSERT OR IGNORE INTO discovery_queue(id,target_url_or_query,task_type,discovered_from_entity_id,discovered_from_evidence_id,traversal_depth,priority,status,dedupe_key,domain,metadata_json,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (key, target, "relationship_candidate_review", owner, evidence_id, 1, 20, "review", key, host, dumps(payload), dumps(payload), now, now))
                report["related_tasks_added"] += int(exists is None)
    else:
        report["missing_files"].append(str(related_path))
    report["net_new_organisations"] = store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0] - before_organisations
    report["replayed_runs"] = sum(bool(r.get("replayed")) for r in report["runs"])
    if output:
        destination = Path(output)
        destination.mkdir(parents=True, exist_ok=True)
        (destination / "historical-windsor-replay.json").write_text(json.dumps(report, indent=2))
    return report
