"""Research indexes of published addresses; no zoning or street verification."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .acquired_inventory import COLUMNS, safe_cell


# These are explicit user-supplied research corridors. Lawson remains its own
# unresolved spelling; it is never silently replaced with Lauzon.
CORRIDORS = [
    ("Windsor/Essex: Walker", "windsor", r"\bwalker\s+(?:rd|road)\b"),
    ("Windsor/Essex: Lauzon Road", "windsor", r"\blauzon\s+(?:rd|road)\b"),
    ("Windsor/Essex: Lauzon Parkway", "windsor", r"\blauzon\s+(?:pkwy|parkway)\b"),
    ("Windsor/Essex: Lawson spelling review", "windsor", r"\blawson\b"),
    ("GTA: Yonge", "toronto", r"\byonge\s+(?:st|street)\b"),
    ("GTA: Bloor", "toronto", r"\bbloor\s+(?:st|street)\b"),
]


def _write_csv(path, rows, columns):
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: safe_cell(row.get(key)) for key in columns})


def build_corridor_indexes(input_file, output):
    input_file, output = Path(input_file), Path(output)
    output.mkdir(parents=True, exist_ok=True)
    groups, cities, corridor_counts = {}, Counter(), Counter()
    records = parsed = matched = 0
    patterns = [(label, area, re.compile(pattern, re.I)) for label, area, pattern in CORRIDORS]
    match_columns = ["corridor", *COLUMNS, "match_method", "current_occupancy_verified"]
    with gzip.open(input_file, "rt", encoding="utf-8", newline="") as handle, gzip.open(
            output / "named-corridor-candidates.csv.gz", "wt", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=match_columns)
        writer.writeheader()
        for row in csv.DictReader(handle):
            records += 1
            city, address = row["city"], row["address"]
            cities[city] += 1
            # Remove only a leading published house-number token. This simple
            # candidate parser intentionally leaves unit/address ambiguities.
            match = re.fullmatch(r"\s*\d+[A-Za-z]?(?:[-–]\d+[A-Za-z]?)?\s+(.+?)\s*", address)
            if match and re.search(r"[A-Za-z]", match[1]):
                parsed += 1
                street = " ".join(match[1].split())
                key = (city, street.casefold())
                group = groups.setdefault(key, {"city": city, "reported_street_candidate": street,
                    "candidate_records": 0, "with_published_website": 0, "with_published_phone": 0,
                    "industry_families": Counter(), "sample_names": [], "sample_provider_ids": []})
                group["candidate_records"] += 1
                group["with_published_website"] += bool(row["website"])
                group["with_published_phone"] += bool(json.loads(row["phones_json"] or "[]"))
                group["industry_families"].update(filter(None, row["ssm_industry_families"].split(";")))
                if len(group["sample_names"]) < 5:
                    group["sample_names"].append(row["name"])
                    group["sample_provider_ids"].append(row["provider_gers_id"])
            catchments = row["configured_catchments"].casefold()
            row_matched = False
            for label, area, pattern in patterns:
                if area not in catchments or not pattern.search(address):
                    continue
                corridor_counts[label] += 1
                row_matched = True
                item = {**row, "corridor": label, "match_method": "explicit_published_address_phrase_and_service_catchment",
                    "current_occupancy_verified": False, "campaign_ready": False}
                writer.writerow({key: safe_cell(item.get(key)) for key in match_columns})
            matched += row_matched
    ordered = sorted(groups.values(), key=lambda row: (-row["candidate_records"], row["city"], row["reported_street_candidate"]))
    for row in ordered:
        row["industry_families"] = json.dumps(row["industry_families"], sort_keys=True)
        row["sample_names"] = json.dumps(row["sample_names"], ensure_ascii=False)
        row["sample_provider_ids"] = json.dumps(row["sample_provider_ids"])
    columns = ["city", "reported_street_candidate", "candidate_records", "with_published_website",
        "with_published_phone", "industry_families", "sample_names", "sample_provider_ids"]
    _write_csv(output / "city-street-candidate-summary.csv", ordered, columns)
    city_rows = [{"city": city, "business_candidate_records": count} for city, count in cities.most_common()]
    _write_csv(output / "city-input-summary.csv", city_rows, ["city", "business_candidate_records"])
    corridor_rows = [{"corridor": label, "matched_records": corridor_counts[label]} for label, _, _ in CORRIDORS]
    _write_csv(output / "named-corridor-summary.csv", corridor_rows, ["corridor", "matched_records"])
    manifest = {"generated_at": datetime.now(timezone.utc).isoformat(), "input": str(input_file),
        "input_sha256": hashlib.sha256(input_file.read_bytes()).hexdigest(), "input_records": records,
        "records_with_street_candidate": parsed, "records_without_street_candidate": records-parsed,
        "city_street_candidate_groups": len(groups), "publisher_city_labels": len(cities),
        "named_corridor_unique_provider_candidates": matched, "named_corridor_match_rows": sum(corridor_counts.values()),
        "named_corridors": corridor_rows, "current_occupancy_verified": False, "campaign_ready": False,
        "policy": ["Source-reported addresses only; no official street, zoning, parcel or current-tenant verification.",
            "The street index removes a leading house-number token; unit formats and spelling variants may fragment groups.",
            "Named corridors match explicit address phrases within configured catchments; zero matches do not prove no businesses.",
            "Lawson is an unresolved user spelling and is not assumed to mean Lauzon Road or Lauzon Parkway.",
            "City counts are publisher locality labels, not a municipality census; overlaps between corridor phrases must not be added as unique businesses."]}
    manifest["files"] = [{"file": path.name, "bytes": path.stat().st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in sorted(output.iterdir()) if path.suffix in (".csv", ".gz")]
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+"\n")
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    manifest = build_corridor_indexes(args.input, args.output)
    print(json.dumps({key: value for key, value in manifest.items() if key not in ("files", "policy")}))


if __name__ == "__main__":
    main()
