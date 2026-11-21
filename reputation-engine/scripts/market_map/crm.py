"""Pure local CRM mapping preview; no API clients, writes, or send capability."""
import csv
import json
from pathlib import Path

from .store import domain, normalise


def _safe(value):
    value = "" if value is None else str(value)
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


def dry_run(store, snapshot_path, output_path):
    snapshot = json.loads(Path(snapshot_path).read_text())
    if isinstance(snapshot, list):
        contacts, companies = snapshot, []
    elif isinstance(snapshot, dict):
        contacts = snapshot.get("market_contacts", snapshot.get("contacts", []))
        companies = snapshot.get("partner_companies", snapshot.get("companies", []))
    else:
        raise ValueError("CRM snapshot must contain a list or contacts/company lists")
    candidates = []
    for row in companies:
        candidates.append({"crm_type": "partner_company", "crm_id": row.get("id"),
            "name": row.get("company_name", row.get("company")), "city": row.get("city"),
            "domain": domain(row.get("website")), "row": row})
    for row in contacts:
        if row.get("company"):
            candidates.append({"crm_type": "market_contact", "crm_id": row.get("id"),
                "name": row["company"], "city": row.get("city"), "domain": domain(row.get("website")), "row": row})
    index = {}
    for row in candidates:
        index.setdefault(normalise(row["name"]), []).append(row)
    results = []
    for org in store.db.execute("SELECT * FROM organisations ORDER BY id"):
        cities = {normalise(row[0]) for row in store.db.execute("SELECT city_raw FROM locations WHERE organisation_id=?", (org["id"],)) if row[0]}
        matches = []
        for candidate in index.get(normalise(org["trading_name"]), []):
            # Similar name or a common domain is never an automatic CRM link.
            if not org["primary_domain"] or org["primary_domain"] != candidate["domain"]:
                continue
            if not normalise(candidate["city"]) or normalise(candidate["city"]) not in cities:
                continue
            matches.append(candidate)
        company_ids = {row["crm_id"] for row in matches if row["crm_type"] == "partner_company"}
        status = "review_suggested_link" if len(company_ids) <= 1 and matches else "ambiguous_review" if matches else "no_supported_match"
        for candidate in matches or [{}]:
            row = candidate.get("row", {})
            results.append({"organisation_id": org["id"], "external_id": "ssm-market-map:" + org["id"],
                "organisation_name": org["trading_name"], "crm_type": candidate.get("crm_type"),
                "crm_id": candidate.get("crm_id"), "match_status": status,
                "match_basis": "exact name + domain + locality; review still required" if matches else "insufficient corroboration",
                "crm_suppressed": bool(row.get("do_not_contact") or row.get("cross_channel_suppressed_at") or row.get("email_unsubscribed_at") or row.get("email_last_bounced_at") or row.get("stage") in ("declined", "lost", "do_not_contact")),
                "action": "review_only", "write_fields": [], "auto_enrol": False})
    output = Path(output_path)
    output.mkdir(parents=True, exist_ok=True)
    (output / "crm-mapping.json").write_text(json.dumps(results, indent=2) + "\n")
    columns = ["organisation_id", "external_id", "organisation_name", "crm_type", "crm_id", "match_status", "match_basis", "crm_suppressed", "action", "auto_enrol"]
    with (output / "crm-mapping.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in results:
            writer.writerow({key: _safe(row.get(key)) for key in columns})
    summary = {"snapshot": str(snapshot_path), "rows": len(results),
        "suggested_links": sum(row["match_status"] == "review_suggested_link" for row in results),
        "ambiguous": sum(row["match_status"] == "ambiguous_review" for row in results),
        "crm_mutations": 0, "output": str(output), "manual_verified_fields_overwritten": 0}
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary
