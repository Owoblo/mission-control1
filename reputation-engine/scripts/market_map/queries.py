"""Queries over physical locations and evidence, with no fabricated market totals."""


def query_landscape(store, *, name=None, city=None, street=None, category=None, limit=50):
    if not 1 <= limit <= 10000:
        raise ValueError("Query limit must be 1–10000")
    clauses, values = [], []
    for value, field in ((name, "o.trading_name"), (street, "l.address_raw")):
        if value:
            clauses.append(field + " LIKE ? ESCAPE '\\'")
            escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            values.append("%" + escaped + "%")
    if city:
        from .geography import resolve_geography
        locality = resolve_geography(store, city)
        geography = store.db.execute("SELECT kind FROM geographies WHERE id=?", (locality,)).fetchone() if locality else None
        escaped = city.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        if geography and geography[0] == "municipality":
            clauses.append("(l.city_raw LIKE ? ESCAPE '\\' OR l.municipality_id=?)")
            values.extend(["%" + escaped + "%", locality])
        else:
            # A neighbourhood query stays at neighbourhood scope. Searching
            # Toronto, however, includes source labels such as North York.
            clauses.append("l.city_raw LIKE ? ESCAPE '\\'")
            values.append("%" + escaped + "%")
    if category:
        clauses.append("EXISTS(SELECT 1 FROM classifications c WHERE c.entity_id=o.id AND c.category LIKE ?)")
        values.append("%" + category + "%")
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    base = " FROM organisations o LEFT JOIN locations l ON l.organisation_id=o.id"
    total = store.db.execute("SELECT COUNT(*)" + base + where, values).fetchone()[0]
    rows = [dict(row) for row in store.db.execute("""SELECT o.id organisation_id,o.trading_name,o.entity_type,o.status organisation_status,
        o.primary_domain,l.id location_id,l.location_type,l.address_raw,l.city_raw,l.province,l.postal_code,
        l.municipality_id,l.latitude,l.longitude,o.last_seen_at""" + base + where + " ORDER BY o.trading_name,l.city_raw,l.address_raw LIMIT ?", [*values, limit])]
    for row in rows:
        row["classifications"] = [dict(r) for r in store.db.execute("SELECT taxonomy,category,review_status,evidence_id FROM classifications WHERE entity_id=?", (row["organisation_id"],))]
        row["relationships"] = [dict(r) for r in store.db.execute("SELECT predicate,subject_id,subject_type,object_id,object_type,review_status,evidence_id FROM relationships WHERE subject_id=? OR object_id=?", (row["organisation_id"], row["organisation_id"]))]
        row["sources"] = [dict(r) for r in store.db.execute("""SELECT s.id source_id,s.name,s.source_url,si.source_record_id,
            si.last_evidence_id FROM source_identities si JOIN sources s ON s.id=si.source_id WHERE si.organisation_id=?""", (row["organisation_id"],))]
    return {"matched_location_or_account_rows": total, "returned": len(rows), "rows": rows,
            "note": "Observed provisional records only. Missing results are discovery gaps, not evidence a business does not exist."}
