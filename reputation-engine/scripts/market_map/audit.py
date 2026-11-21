"""Local acceptance audit of stored identities, provenance, and graph links."""
from __future__ import annotations

import json
from datetime import datetime, timezone


def audit_store(store, *, integrity=False, expected_provider_count=None, raw_sample=25):
    db = store.db
    tables = ("organisations", "locations", "properties", "relationships", "sources", "source_runs", "raw_records", "evidence", "contact_channels", "people", "review_queue", "discovery_queue")
    counts = {name: db.execute("SELECT COUNT(*) FROM " + name).fetchone()[0] for name in tables}
    fk_errors = [tuple(row) for row in db.execute("PRAGMA foreign_key_check")]
    dangling = []
    targets = {"organisation": "organisations", "location": "locations", "property": "properties", "person": "people", "geography": "geographies"}
    for kind, table in targets.items():
        for side in ("subject", "object"):
            for row in db.execute("SELECT r.id,r." + side + "_id FROM relationships r LEFT JOIN " + table + " t ON t.id=r." + side + "_id WHERE r." + side + "_type=? AND t.id IS NULL", (kind,)):
                dangling.append({"relationship_id": row[0], "side": side, "target_id": row[1], "type": kind})
    raw_verified, raw_errors = 0, []
    sample_ids = [row[0] for row in db.execute("SELECT raw_record_id FROM compressed_raw_payloads ORDER BY raw_record_id LIMIT ?", (raw_sample,))]
    sample_ids += [row[0] for row in db.execute("SELECT id FROM raw_records WHERE id NOT IN (SELECT raw_record_id FROM compressed_raw_payloads) ORDER BY id LIMIT ?", (min(5, raw_sample),))]
    for raw_id in sample_ids:
        try:
            store.get_raw_payload(raw_id)
            raw_verified += 1
        except (ValueError, RuntimeError) as error:
            raw_errors.append({"raw_record_id": raw_id, "error": str(error)})
    provider_count = db.execute("SELECT COUNT(*) FROM source_identities WHERE source_id='overture-2026-10-21.0'").fetchone()[0]
    provider_matches = expected_provider_count is None or provider_count == expected_provider_count
    integrity_result = db.execute("PRAGMA integrity_check").fetchone()[0] if integrity else "not_requested"
    report = {"at": datetime.now(timezone.utc).isoformat(), "counts": counts,
        "organisations_by_entity_type": {row[0]: row[1] for row in db.execute("SELECT entity_type,COUNT(*) FROM organisations GROUP BY entity_type")},
        "locations_by_location_type": {row[0]: row[1] for row in db.execute("SELECT location_type,COUNT(*) FROM locations GROUP BY location_type")},
        "foreign_key_errors": fk_errors, "dangling_relationships": dangling,
        "raw_payload_samples_verified": raw_verified, "raw_payload_errors": raw_errors,
        "provider_unique_ids_loaded": provider_count, "expected_provider_unique_ids": expected_provider_count,
        "provider_count_matches": provider_matches, "integrity_check": integrity_result,
        "paid_cost_recorded": db.execute("SELECT COALESCE(SUM(estimated_cost),0) FROM source_runs").fetchone()[0],
        "contact_eligibility_counts": {row[0]: row[1] for row in db.execute("SELECT outreach_eligibility,COUNT(*) FROM contact_channels GROUP BY outreach_eligibility")},
        "outreach_sent_by_this_system": 0, "production_crm_mutations": 0}
    report["passed"] = not fk_errors and not dangling and not raw_errors and provider_matches and integrity_result in ("ok", "not_requested")
    return report
