"""Import school rosters and explicit school-to-board relationships.

Directory programme records are not automatically distinct physical buildings.
The source's school number and board number remain source identifiers, never
invented legal-registration or municipality identifiers.
"""
from __future__ import annotations

import json
from collections import Counter

from .geography import resolve_geography
from .store import stable_id, stamp, dumps


def ingest_school_batch(store, batch, source=None):
    """Ingest a normalized publisher batch, derive boards and retain evidence.

    `source` is the reviewed source-registry dict. With no source argument the
    batch's metadata.source_id must already exist in the store. School rows need
    raw_payload['Board Number'] and ['Board Name']; normalised school and board
    keys are accepted for fixture/import interoperability.
    """
    metadata = dict(batch.get("metadata") or {})
    rows = [dict(row) for row in batch.get("rows") or []]
    for row in rows:
        condition = str(row.get("school_special_conditions") or (row.get("raw_payload") or {}).get("School Special Conditions") or "").strip()
        if condition:
            row["location_type"] = ("virtual" if any(word in condition.casefold() for word in ("remote", "online"))
                                    else "school" if condition == "Not applicable" else "programme")
    if source:
        source_id = store.upsert_source(source)
        metadata["source_id"] = source_id
    source_id = metadata.get("source_id")
    registered = store.db.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone()
    if registered is None:
        raise ValueError("School source must be registered with reviewed metadata")
    school_result = store.ingest(source_id, rows, run_metadata=metadata)
    boards = {}
    board_variants = {}
    relations = []
    for school in rows:
        raw = school.get("raw_payload") or {}
        number = str(school.get("board_number") or raw.get("Board Number") or "").strip()
        name = str(school.get("board_name") or raw.get("Board Name") or "").strip()
        if not number or not name:
            continue
        board_variants.setdefault(number, set()).add(name)
        boards.setdefault(number, {"source_record_id": number, "name": name,
            "entity_type": "institution", "website": school.get("board_website") or raw.get("Board Website") or "",
            "province": "ON", "country": "CA", "categories": ["education_research"], "taxonomy": "ssm_industry_family",
            "source_url": school.get("source_url") or registered["source_url"],
            "observed_at": school.get("observed_at") or metadata.get("observed_at") or metadata.get("captured_at") or stamp(),
            "raw_payload": {"Board Number": number, "Board Name": name,
                            "Board Website": school.get("board_website") or raw.get("Board Website"),
                            "Board Type": raw.get("Board Type"), "Board Language": raw.get("Board Language"),
                            "derivation": "Board identity explicitly listed on publisher school records; no headquarters location inferred"}})
        relations.append((school, number, name))
    board_source = {k: registered[k] for k in registered.keys() if k not in {"created_at", "updated_at", "reported_count", "count_definition", "last_success_at"}}
    board_source.update({"id": str(source_id) + ":boards", "name": registered["name"] + " — board identities",
                         "source_type": "school_board_portfolio", "adapter_name": "school_board_derivation",
                         "reported_count": len(boards), "count_definition": "Distinct board identifiers explicitly appearing in the downloaded school roster; not an independent board census",
                         "notes": "Derived from explicit board fields in the same publisher file; not an independent source family for corroboration. No board headquarters location inferred."})
    board_source_id = store.upsert_source(board_source)
    board_metadata = {"source_id": board_source_id, "adapter_name": "school_board_derivation", "parser_version": "school-board-fields/1",
                      "expected_count": len(boards), "coverage_complete": bool(metadata.get("coverage_complete")),
                      "status": metadata.get("status") or "completed", "requests": 0, "bytes_fetched": 0,
                      "estimated_cost": 0, "batch_id": "boards-from-" + str(school_result["run_id"])}
    board_result = store.ingest(board_source_id, list(boards.values()), run_metadata=board_metadata)
    before = store.db.execute("SELECT COUNT(*) FROM relationships WHERE predicate='operated_by'").fetchone()[0]
    within = outside = unresolved = 0
    condition_counts = Counter()
    with store.transaction():
        for school, number, name in relations:
            raw = school.get("raw_payload") or {}
            sid = str(school.get("source_record_id") or raw.get("School Number") or "")
            school_identity = store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?", (source_id, sid)).fetchone()
            board_identity = store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?", (board_source_id, number)).fetchone()
            if not school_identity or not board_identity:
                unresolved += 1
                continue
            evidence = school_identity["last_evidence_id"]
            observed = school.get("observed_at") or stamp()
            store.assert_field(school_identity["organisation_id"], "organisation", "publisher_school_number", sid, evidence, observed)
            store.assert_field(board_identity["organisation_id"], "organisation", "publisher_board_number", number, evidence, observed)
            condition = school.get("school_special_conditions") or raw.get("School Special Conditions") or "unknown"
            condition_counts[condition] += 1
            if school_identity["location_id"]:
                store.assert_field(school_identity["location_id"], "location", "school_special_conditions", condition, evidence, observed)
                store.assert_field(school_identity["location_id"], "location", "physical_building_verified", False, evidence, observed)
            relation_id = stable_id("school-operated-by", school_identity["organisation_id"], board_identity["organisation_id"], evidence)
            store.db.execute("""INSERT OR IGNORE INTO relationships(id,subject_id,subject_type,predicate,object_id,object_type,asserted_by_source_id,evidence_id,confidence,observed_at,review_status)
                VALUES(?,?,'organisation','operated_by',?,'organisation',?,?,1.0,?,'source_asserted')""",
                (relation_id, school_identity["organisation_id"], board_identity["organisation_id"], source_id, evidence, observed))
            locality = resolve_geography(store, school.get("city"))
            if locality and store.db.execute("SELECT 1 FROM geography_service_areas WHERE geography_id=?", (locality,)).fetchone():
                within += 1
            else:
                outside += 1
        for number, names in board_variants.items():
            if len(names) > 1:
                identity = store.db.execute("SELECT organisation_id FROM source_identities WHERE source_id=? AND source_record_id=?", (board_source_id, number)).fetchone()
                store.add_review("board_name_conflict", [identity[0]] if identity else [], reason=f"Publisher board identifier {number} has competing names: {sorted(names)}")
    after = store.db.execute("SELECT COUNT(*) FROM relationships WHERE predicate='operated_by'").fetchone()[0]
    return {"school_ingestion": school_result, "board_ingestion": board_result,
            "school_rows": len(rows), "board_identities": len(boards), "new_operated_by_relationships": after - before,
            "ordinary_school_records": sum(row.get("location_type") == "school" for row in rows),
            "programme_records": sum(row.get("location_type") == "programme" for row in rows),
            "virtual_records": sum(row.get("location_type") == "virtual" for row in rows),
            "rows_in_configured_localities": within, "rows_outside_or_unresolved_configured_localities": outside,
            "unresolved_relationships": unresolved, "school_special_condition_counts": dict(condition_counts),
            "scope_note": "Programme and remote-site records are retained. Source school records do not equal unique school buildings; board records are derived from the same roster."}
