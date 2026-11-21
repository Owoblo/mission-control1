"""Audited repairs for explicitly identified early local import defects.

These operations preserve raw payloads, publisher IDs, and original run receipts.
They require an operator-selected local store and do not make network/CRM calls.
"""
from __future__ import annotations

import json
import re

from .store import dumps, stable_id, stamp


def repair_legacy_source_dates(store):
    """Separate known September capture dates from publisher release dates."""
    changes = []
    with store.transaction():
        for row in store.db.execute("SELECT * FROM sources WHERE adapter_name IN ('legacy_v2','legacy_windsor_snapshot')").fetchall():
            old = row["source_date"]
            if not old or not old.startswith("2026-09-15"):
                continue
            release = re.fullmatch(r"legacy-v2:overture:(20\d{2}-\d{2}-\d{2})\.\d+", row["id"])
            corrected = release[1] if release else None
            note = ("Metadata repair: original source_date=" + old +
                " was a local capture timestamp. Capture receipts remain unchanged; " +
                ("publisher date follows the explicit release ID." if release else "publisher date is unknown."))
            store.db.execute("UPDATE sources SET source_date=?,notes=?,updated_at=? WHERE id=?",
                (corrected, (row["notes"] or "") + " " + note, stamp(), row["id"]))
            store.db.execute("""INSERT OR IGNORE INTO identity_audit
                (id,action,entity_id,reason,before_json,after_json,observed_at)
                VALUES(?,?,?,?,?,?,?)""", (stable_id("source-date-repair", row["id"], old, corrected),
                "source_publication_date_corrected", row["id"], note,
                dumps({"source_date": old}), dumps({"source_date": corrected}), stamp()))
            changes.append({"source_id": row["id"], "before": old, "after": corrected})
    return {"sources_corrected": len(changes), "changes": changes,
        "raw_payloads_and_observation_timestamps_changed": 0}


def _repair_fields(store, table, entity_type, row, updates, evidence_id, reason):
    updates = {key: value for key, value in updates.items() if row[key] != value}
    if not updates:
        return 0
    before = {key: row[key] for key in updates}
    now = stamp()
    store.db.execute("UPDATE " + table + " SET " + ",".join(key + "=?" for key in updates) + " WHERE id=?",
        [*updates.values(), row["id"]])
    for key, value in updates.items():
        store.assert_field(row["id"], entity_type, key, value, evidence_id, now,
            method="reviewed_import_parser_correction", review_status="source_repaired")
    store.db.execute("""INSERT OR IGNORE INTO identity_audit
        (id,action,entity_id,evidence_id,reason,before_json,after_json,observed_at)
        VALUES(?,?,?,?,?,?,?,?)""", (stable_id("import-parser-repair", row["id"], before, updates, evidence_id),
        "import_parser_corrected", row["id"], evidence_id, reason, dumps(before), dumps(updates), now))
    return 1


def repair_toronto_licence_import(store, batch):
    """Remove unsupported defaults and quarantine a literal-null placeholder.

    Only exclusive, unverified source-owned entities are eligible. Country claims
    supported by any retained field assertion are left for review. Four malformed
    publisher objects previously shared one literal 'None' identifier; that
    provisional identity is retained, flagged, and excluded from business views.
    """
    source_id = batch.get("metadata", {}).get("source_id")
    if source_id != "toronto-business-licences":
        raise ValueError("Repair requires the original Toronto licence batch")
    result = {"entities_with_country_default_removed": 0, "placeholder_entities_quarantined": 0,
        "protected_entities": 0, "contact_channels_held": 0, "unmatched_source_ids": [], "raw_records_deleted": 0}
    keys = {str(row["source_record_id"]) for row in batch["rows"]
        if "country" in row and row["country"] in (None, "")}
    with store.transaction():
        for key in sorted(keys):
            identity = store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?", (source_id, key)).fetchone()
            if identity is None:
                result["unmatched_source_ids"].append(key)
                continue
            evidence_id = identity["last_evidence_id"]
            evidence = store.db.execute("SELECT * FROM evidence WHERE id=?", (evidence_id,)).fetchone()
            payload = store.get_raw_payload(evidence["raw_record_id"])
            if "country" not in payload or payload["country"] not in (None, ""):
                store.add_review("country_repair_evidence_conflict", [identity["organisation_id"]], [evidence_id],
                    "Saved batch and original retained payload do not both explicitly assert unknown country; preserve canonical values.")
                continue
            for table, kind, entity_id in (("organisations", "organisation", identity["organisation_id"]),
                    ("locations", "location", identity["location_id"])):
                if entity_id is None:
                    continue
                entity = store.db.execute("SELECT * FROM " + table + " WHERE id=?", (entity_id,)).fetchone()
                scope_column = "organisation_id" if table == "organisations" else "location_id"
                shared = store.db.execute("SELECT 1 FROM source_identities WHERE " + scope_column + "=? AND source_id<>? LIMIT 1", (entity_id, source_id)).fetchone()
                if entity["manually_verified"] or shared:
                    result["protected_entities"] += 1
                    continue
                supported_country = store.db.execute("""SELECT 1 FROM field_assertions
                    WHERE entity_id=? AND field_name='country'
                    AND value_json NOT IN ('null','""','"unknown"')
                    AND review_status<>'quarantined' LIMIT 1""", (entity_id,)).fetchone()
                if entity["country"] == "CA" and not supported_country:
                    result["entities_with_country_default_removed"] += _repair_fields(store, table, kind, entity,
                        {"country": None}, evidence_id,
                        "Original source row explicitly had unknown country; an early parser default supplied CA without evidence.")
                if key.casefold() not in {"none", "null", ""} or str(payload.get("name") or "").strip().casefold() not in {"none", "null", ""}:
                    continue
                updates = {"status": "quarantined", "entity_type": "invalid_source_record"} if kind == "organisation" else {
                    "status": "quarantined_source_placeholder", "location_type": "invalid_source_placeholder"}
                if kind == "location":
                    for field in ("street", "postal_code"):
                        if str(entity[field] or "").strip().casefold() in {"none", "null"}:
                            updates[field] = None
                result["placeholder_entities_quarantined"] += _repair_fields(store, table, kind, entity,
                    updates, evidence_id, "Publisher supplied literal-null licence and organisation fields. Preserve source evidence; this is not a business identity.")
                if kind == "organisation":
                    for category in ("non_organisation_place_candidate", "invalid_source_placeholder"):
                        store.db.execute("""INSERT OR IGNORE INTO classifications
                            (id,entity_id,entity_type,taxonomy,category,classification_method,evidence_id,review_status)
                            VALUES(?,?,'organisation','ssm_discovery_context',?,'reviewed_import_parser_correction',?,'source_repaired')""",
                            (stable_id("invalid-source-placeholder", entity_id, category), entity_id, category, evidence_id))
                    for channel in store.db.execute("SELECT * FROM contact_channels WHERE organisation_id=?", (entity_id,)).fetchall():
                        result["contact_channels_held"] += _repair_fields(store, "contact_channels", "contact_channel", channel,
                            {"verification_status": "invalid_source_placeholder", "outreach_eligibility": "ineligible"}, evidence_id,
                            "Published contact belongs to a literal-null source placeholder, not an established organisation.")
                    store.add_review("invalid_source_placeholder", [entity_id], [evidence_id],
                        "Literal None licence/name fields previously shared a provisional source identity. Raw observations are preserved; exclude this identity from business candidate views.",
                        review_id=stable_id("invalid-source-placeholder-review", source_id, key))
    return result
