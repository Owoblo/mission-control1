"""Read-only inventory breakdown. Output aggregate evidence, never a send list."""
from __future__ import annotations
import argparse
import csv
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

def audit(database, output):
    output = Path(output); output.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA temp_store=FILE")
    db.execute("PRAGMA cache_size=-65536")
    db.execute("BEGIN")
    report = {"at": datetime.now(timezone.utc).isoformat(), "database": str(database), "read_only": True, "paid_model_calls": 0}
    queries = {
        "organization_status": "SELECT coalesce(status,'unknown') label,count(*) organization_rows FROM organisations GROUP BY 1 ORDER BY 2 DESC",
        "entity_types": "SELECT coalesce(entity_type,'unknown') label,count(*) organization_rows FROM organisations GROUP BY 1 ORDER BY 2 DESC",
        "size_bands": "SELECT coalesce(nullif(organisation_size_band,''),'unknown') label,count(*) organization_rows FROM organisations GROUP BY 1 ORDER BY 2 DESC",
        "organization_countries": "SELECT coalesce(nullif(country,''),'unknown') label,count(*) organization_rows FROM organisations GROUP BY 1 ORDER BY 2 DESC",
        "industry_families": "SELECT c.category label,count(distinct c.entity_id) organization_rows FROM classifications c JOIN organisations o ON o.id=c.entity_id WHERE c.entity_type='organisation' AND c.taxonomy='ssm_industry_family' GROUP BY 1 ORDER BY 2 DESC",
        "family_partition": "WITH f AS (SELECT c.entity_id,count(distinct c.category) n FROM classifications c JOIN organisations o ON o.id=c.entity_id WHERE c.entity_type='organisation' AND c.taxonomy='ssm_industry_family' GROUP BY c.entity_id) SELECT case when f.n IS NULL then 'unmapped' when f.n=1 then 'one_family' else 'multiple_families' end label,count(*) organization_rows FROM organisations o LEFT JOIN f ON f.entity_id=o.id GROUP BY 1",
        "source_membership": "SELECT s.id source_id,s.name source_name,s.source_type,count(distinct i.organisation_id) organization_rows,count(distinct i.location_id) location_rows FROM source_identities i NOT INDEXED JOIN organisations o ON o.id=i.organisation_id LEFT JOIN sources s ON s.id=i.source_id GROUP BY i.source_id ORDER BY organization_rows DESC",
        "location_geographies": "SELECT coalesce(nullif(l.municipality_id,''),'unresolved:'||coalesce(nullif(l.city_raw,''),'missing')) geography_key,coalesce(g.name,nullif(l.city_raw,''),'Unknown') geography,count(*) location_rows,count(distinct l.organisation_id) organization_rows,case when g.id IS NULL then 'unresolved' else 'linked_geography' end resolution FROM locations l LEFT JOIN geographies g ON g.id=l.municipality_id GROUP BY 1,2,5 ORDER BY location_rows DESC",
        "location_provinces": "SELECT coalesce(nullif(province,''),'unknown') label,count(*) location_rows FROM locations GROUP BY 1 ORDER BY 2 DESC",
        "channel_status": "SELECT channel_type,coalesce(verification_status,'unknown') verification_status,coalesce(outreach_eligibility,'unknown') outreach_eligibility,coalesce(suppression_status,'unknown') suppression_status,count(*) channel_rows,count(distinct organisation_id) organization_rows FROM contact_channels GROUP BY 1,2,3,4 ORDER BY channel_rows DESC",
        "source_categories": "SELECT taxonomy,category,count(distinct entity_id) organization_rows FROM classifications WHERE entity_type='organisation' AND taxonomy NOT IN ('ssm_industry_family','ssm_discovery_context') GROUP BY 1,2 ORDER BY organization_rows DESC",
    }
    report["totals"] = {table: db.execute("SELECT count(*) FROM " + table).fetchone()[0] for table in ["organisations", "locations", "people", "classifications", "source_identities", "contact_channels", "coverage_cells", "review_queue"]}
    for name, sql in queries.items():
        rows = [dict(row) for row in db.execute(sql)]
        report[name] = rows
        if rows:
            with (output / (name + ".csv")).open("w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(rows[0])); writer.writeheader()
                writer.writerows({k: ("'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@')) else v) for k, v in row.items()} for row in rows)
        print(json.dumps({"completed": name, "groups": len(rows)}), flush=True)
    total = report["totals"]["organisations"]
    for dimension in ["organization_status", "entity_types", "size_bands", "organization_countries", "family_partition"]:
        if sum(r["organization_rows"] for r in report[dimension]) != total:
            raise RuntimeError("Partition did not reconcile: " + dimension)
    report["limitations"] = ["Organization IDs are database records, not verified unique active legal businesses.", "Industry families, sources and geographic memberships overlap; their counts must not be summed as a population.", "Location rows, organizations, people and channel associations are different units.", "Unknown size is not small. A place or license row is not automatically a business, buying decision-maker or sendable contact.", "Sources preserve their own taxonomy versions; unspecified NAICS is not relabelled as verified NAICS-CA-2022.", "This report does not activate classification writes, outreach, research spending or source collection."]
    db.rollback(); db.close()
    (output / "audit.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"finished": True, "totals": report["totals"], "family_partition": report["family_partition"], "output": str(output)}), flush=True)
    return report

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", default="partnership-system/state/market-map.sqlite")
    parser.add_argument("--output", default="partnership-system/state/organization-breakdown-20261118")
    args = parser.parse_args()
    audit(args.database, args.output)
