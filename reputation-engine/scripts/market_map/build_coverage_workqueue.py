"""Build an evidence-led, bounded locality/category/source work queue; never send or scrape.

python3 -m scripts.market_map.build_coverage_workqueue
Optional --receipts JSONL accepts structured acquisition receipts described in manifest.json.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from .reconcile_coverage_catalogs import canonical_key, label_id, reconcile

SOURCE_ROUTES = [
    {"id": "google_maps", "purpose": "Local branch listings and place records", "execution": "Existing Google Navigator extension; user must enable/reload it; capture result and terminal-page receipts"},
    {"id": "local_directory", "purpose": "Municipal economic-development, chamber and local business directories", "execution": "Find the relevant directory, record filters/pagination and collect its published records"},
    {"id": "association_directory", "purpose": "Industry association and professional member directories", "execution": "Use published member lists; retain membership separately from physical location"},
    {"id": "company_relationships", "purpose": "Client, partner, sponsor, project and branch pages", "execution": "Start from existing organizations; preserve the relationship source and verify each linked organization independently"},
    {"id": "company_websites", "purpose": "Official organization and contact-page evidence", "execution": "Record exact page, observation time, entity/branch identity and contact evidence"},
    {"id": "official_jurisdiction", "purpose": "Resolve the actual government responsible for each locality", "execution": "Verify locality type, governing municipality, upper tier where applicable, official directory and jurisdiction evidence"},
]
STATES = {"unknown", "not_searched", "searched_no_results", "found_unverified", "verified", "contacted"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def task_id(locality, category, source):
    return "coverage_task_" + hashlib.sha256(f"{locality}|{category}|{source}".encode()).hexdigest()[:24]


def validate_receipt(row):
    """A planning checkbox or zero imported rows must never imply an exhausted search."""
    for field in ["locality_id", "category_id", "source_id", "state", "evidence_ref", "observed_at"]:
        if not isinstance(row.get(field), str) or not row[field].strip():
            raise ValueError("Receipt missing " + field)
    if row["state"] not in STATES or row["source_id"] not in {r["id"] for r in SOURCE_ROUTES}:
        raise ValueError("Unknown receipt state or source")
    observed = datetime.fromisoformat(row["observed_at"].replace("Z", "+00:00"))
    if observed.tzinfo is None or observed > datetime.now(timezone.utc):
        raise ValueError("Receipt timestamp requires a past timezone-aware observation")
    if row["state"] == "searched_no_results" and not (
        row.get("query") and row.get("completed") is True and row.get("result_count") == 0
        and row.get("terminal_evidence_ref") and row.get("source_url")
    ):
        raise ValueError("Zero-result receipt requires a completed query and terminal evidence")
    if row["state"] in {"found_unverified", "verified"} and not (type(row.get("result_count")) is int and row["result_count"] > 0):
        raise ValueError("Found/verified requires positive result count")
    if row["state"] == "verified" and not (row.get("verification_scope") and row.get("verification_evidence_ref")):
        raise ValueError("Verified requires scoped verification evidence")
    if row["state"] == "contacted" and not row.get("provider_receipt"):
        raise ValueError("Contacted requires actual provider receipt")
    if row["state"] == "not_searched" and row.get("assertion") != "explicit_not_started":
        raise ValueError("Not searched requires an explicit not-started assertion")
    return row


def read_csv(path):
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def dump_csv(path, rows):
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]) if rows else ["id"])
        writer.writeheader()
        writer.writerows(rows)


def build(repo, grome, output, receipt_files=()):
    output.mkdir(parents=True, exist_ok=True)
    coverage = repo / "partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/rural-label-coverage/configured-label-coverage.csv"
    fresh = reconcile(repo, grome, output / "catalog-reconciliation", coverage)
    (output / "catalog-reconciliation/integration-notes.txt").write_text(
        f"Fresh catalog reconciliation: {fresh['source_rows']['navigator_primary']} Navigator primary labels and "
        f"{fresh['source_rows']['navigator_listing']} separate listing areas.\n"
        "This report does not activate the extension or execute collection.\n"
        "Missing labels: " + ", ".join(fresh["missing_navigator_labels"]) + "\n"
        "Consult manifest.json and municipal-jurisdiction-workqueue.csv; labels are not independently verified municipal jurisdictions.\n")
    labels = json.loads((output / "catalog-reconciliation/coverage-labels.json").read_text())["rows"]
    categories = read_csv(repo / "partnership-system/catalogs/outreach-overlay.csv")
    catalog_by_id = {r["coverage_label_id"]: r for r in labels}
    by_key = {canonical_key(r["canonical_label"]): r for r in labels}
    legacy = repo / "partnership-system/markets/service-area-category-coverage.csv"
    legacy_states, legacy_receipts = Counter(), 0
    with legacy.open() as stream:
        for row in csv.DictReader(stream):
            legacy_states[row["status"]] += 1
            legacy_receipts += bool(row.get("last_checked") or row.get("source_urls"))

    # Existing pilot evidence is narrow, entity-level evidence. No category crosswalk is guessed.
    pilot = repo / "artifacts/partnership-pilot-3000-20261027"
    reviewed = {}
    input_files = [legacy, repo / "partnership-system/catalogs/outreach-overlay.csv"]
    for path in sorted(pilot.glob("additional-reviewed-parallel-*-source.jsonl")):
        input_files.append(path)
        for line, text in enumerate(path.read_text().splitlines(), 1):
            if not text.strip():
                continue
            row = json.loads(text)
            key = row.get("organisation_id")
            if not key or not row.get("reviewed_city") or not row.get("sources"):
                continue
            if row.get("identity_email_binding") != "pass" or not row.get("reviewed_at"):
                continue
            candidate = {**row, "_evidence_ref": str(path.relative_to(repo)) + f":{line}"}
            if key not in reviewed or row.get("reviewed_at", "") > reviewed[key].get("reviewed_at", ""):
                reviewed[key] = candidate
    observations, unmapped = [], []
    for oid, row in reviewed.items():
        locality = by_key.get(canonical_key(row["reviewed_city"]))
        if not locality:
            unmapped.append({"organisation_id": oid, "observed_label": row["reviewed_city"], "evidence_ref": row["_evidence_ref"], "action": "Resolve geography; do not silently assign to a neighboring city"})
            continue
        observations.append({"locality_id": locality["coverage_label_id"], "category_id": "pilot_sector:" + str(row.get("reviewed_sector", "unclassified")), "source_id": "company_websites", "state": "found_unverified", "organisation_id": oid, "observed_at": row.get("reviewed_at"), "evidence_ref": row["_evidence_ref"], "source_urls": [s.get("url") or s.get("final_url") for s in row["sources"] if s.get("url") or s.get("final_url")], "result_count": 1, "verification_scope": "Saved business/contact page review exists; not exhaustive geography, current mailbox validation, or automatic outreach eligibility"})
    status_path = pilot / "live-pilot-status.json"
    if status_path.exists():
        input_files.append(status_path)
        live = json.loads(status_path.read_text())
        dispatched = {r["job_id"]: r for r in live.get("dispatches", []) if r.get("state") == "accepted" and r.get("message_id") and r.get("accepted_at")}
        admissions = {}
        for path in [pilot / "first-reviewed-admission.json", *sorted(pilot.glob("additional-reviewed-*.json"))]:
            if not path.exists():
                continue
            input_files.append(path)
            for row in json.loads(path.read_text()).get("records", []):
                if row.get("jobId") and row.get("payload"):
                    admissions[row["jobId"]] = (row, str(path.relative_to(repo)))
        for job, dispatch in dispatched.items():
            if job not in admissions:
                continue
            row, ref = admissions[job]
            locality = by_key.get(canonical_key(row["payload"]["city"]))
            if not locality:
                continue
            sector = reviewed.get(row.get("organisation_id"), {}).get("reviewed_sector", "unclassified")
            observations.append({"locality_id": locality["coverage_label_id"], "category_id": "pilot_sector:" + sector, "source_id": "company_websites", "state": "contacted", "organisation_id": row.get("organisation_id"), "observed_at": dispatch["accepted_at"], "evidence_ref": str(status_path.relative_to(repo)) + "#job=" + job, "parent_admission_ref": ref, "provider_receipt": dispatch["message_id"], "contacted_definition": "Provider accepted an actual email; not delivery, response, or whole-category coverage"})
    explicit_receipts = []
    for path in receipt_files:
        input_files.append(path)
        for text in path.read_text().splitlines():
            if text.strip():
                r = validate_receipt(json.loads(text))
                if r["locality_id"] not in catalog_by_id:
                    raise ValueError("Receipt locality is outside catalog")
                explicit_receipts.append(r)
    # Only explicit same-cell execution receipts alter queue state. Pilot sectors remain a separate namespace.
    evidence_by_cell = {}
    for row in explicit_receipts:
        key = (row["locality_id"], row["category_id"], row["source_id"])
        if key not in evidence_by_cell or row["observed_at"] > evidence_by_cell[key]["observed_at"]:
            evidence_by_cell[key] = row
    municipal, queue = [], []
    for index, locality in enumerate(labels):
        lid, name = locality["coverage_label_id"], locality["canonical_label"]
        municipal_receipt = evidence_by_cell.get((lid, "overlay:category-04", "official_jurisdiction"))
        municipal.append({"task_id": task_id(lid, "overlay:category-04", "official_jurisdiction"), "locality_id": lid, "locality_label": name, "category_id": "overlay:category-04", "source_id": "official_jurisdiction", "state": municipal_receipt["state"] if municipal_receipt else "unknown", "historical_municipality_labels": json.dumps(locality.get("saved_municipality_labels", [])), "jurisdiction_status": "scoped_official_route_verified" if municipal_receipt and municipal_receipt["state"] == "verified" else "unverified_by_this_queue", "query": f'"{name}" Ontario official municipal government jurisdiction', "next_action": "Verify locality type and responsible municipality; link each actual government once, then map departments/facilities separately", "evidence_ref": municipal_receipt["evidence_ref"] if municipal_receipt else "", "is_city_hall_assumed": False})
        # Three executable searches per locality, spread across all 28 outreach groups.
        # Remaining combinations are lazy/unmaterialized, not falsely marked searched or absent.
        for offset, source in enumerate(SOURCE_ROUTES[:3]):
            cat = categories[(index * 3 + offset) % len(categories)]
            cid = "overlay:" + cat["category_id"]
            synonyms = cat["search_synonyms"].split(";")
            suffix = {"google_maps": "", "local_directory": " chamber business directory", "association_directory": " association member directory"}[source["id"]]
            query = f'{synonyms[0]} {name} Ontario' + suffix
            receipt = evidence_by_cell.get((lid, cid, source["id"]))
            queue.append({"task_id": task_id(lid, cid, source["id"]), "locality_id": lid, "locality_label": name, "category_id": cid, "category": cat["category"], "source_id": source["id"], "state": receipt["state"] if receipt else "unknown", "reason": "Imported execution receipt" if receipt else "No exact locality/category/source execution receipt imported; this is not proof it was never searched", "query": query, "search_url": "https://www.google.com/maps/search/" + quote(query) if source["id"] == "google_maps" else "", "next_action": source["execution"], "evidence_ref": receipt["evidence_ref"] if receipt else "", "remaining_synonyms": ";".join(synonyms[1:]), "completion_rule": "Save exact query/bounds, result IDs, pagination cursor and terminal/partial/error evidence; never infer exhaustion from an empty import"})
    dump_csv(output / "municipal-jurisdiction-workqueue.csv", municipal)
    dump_csv(output / "locality-category-source-workqueue.csv", queue)
    with (output / "observations.jsonl").open("w") as f:
        for row in [*observations, *explicit_receipts]:
            f.write(json.dumps(row) + "\n")
    (output / "unmapped-observed-localities.json").write_text(json.dumps(unmapped, indent=2))
    (output / "category-and-source-catalog.json").write_text(json.dumps({"categories": categories, "sources": SOURCE_ROUTES, "category_namespace_rule": "overlay IDs are not NAICS, navigator shortcuts or observed pilot sectors. Crosswalk explicitly before merging coverage."}, indent=2))
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(), "mode": "read_only_inputs_no_scrapes_no_sends", "locality_labels": len(labels), "distinct_municipalities": None,
        "outreach_overlay_categories": len(categories), "source_route_families": len(SOURCE_ROUTES),
        "bounded_search_tasks": len(queue), "municipal_jurisdiction_tasks": len(municipal), "search_queue_states": dict(Counter(r["state"] for r in queue)),
        "imported_entity_observations": len(observations), "entity_observation_states": dict(Counter(r["state"] for r in observations)), "observation_localities": len({r["locality_id"] for r in observations}),
        "explicit_cell_execution_receipts": len(explicit_receipts), "unmapped_observed_locality_records": len(unmapped),
        "legacy_planning_grid": {"rows": sum(legacy_states.values()), "states": dict(legacy_states), "rows_with_date_or_url": legacy_receipts, "interpretation": "Historical planning declarations; not fresh proof that no work occurred elsewhere, nor completed collection."},
        "fresh_navigator": {"primary": fresh["source_rows"]["navigator_primary"], "listing_areas": fresh["source_rows"]["navigator_listing"], "missing_canonical_labels": fresh["missing_navigator_labels"]},
        "completion_claim": False,
        "limitations": ["This imports only configured catalogs, saved pilot source reviews, and the saved pilot send snapshot. Other collection datasets are not yet reconciled into per-query receipts.", "Finding or contacting one organization never completes a locality/category/source cell.", "Historical provider locality labels and parent municipality hints are not independently verified physical locations or jurisdictions.", "An unknown cell is not a zero-result search. Unmaterialized combinations remain unknown.", "Franchise brand, operator and physical branch are separate entities; same brand is not grounds for deleting branches, and separate branches do not prove independent ownership.", "Alias/composite service labels do not each represent an independent city government."],
        "receipt_schema": {"required": ["locality_id", "category_id", "source_id", "state", "evidence_ref", "observed_at"], "states": sorted(STATES), "zero_result_required": ["query", "completed=true", "result_count=0", "terminal_evidence_ref", "source_url"], "verified_required": ["result_count>0", "verification_scope", "verification_evidence_ref"], "contacted_required": ["provider_receipt"]},
        "source_files": [{"path": str(p), "sha256": digest(p)} for p in dict.fromkeys(input_files)],
    }
    (output / "manifest.json").write_text(json.dumps(summary, indent=2))
    return summary


def main():
    repo = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--grome", type=Path, default=Path("/Users/owoblo/Downloads/grome"))
    parser.add_argument("--output", type=Path, default=repo / "artifacts/coverage-workqueue-20261028")
    parser.add_argument("--receipts", type=Path, action="append", default=[])
    args = parser.parse_args()
    result = build(repo, args.grome, args.output, args.receipts)
    print(json.dumps({k: result[k] for k in ["locality_labels", "bounded_search_tasks", "municipal_jurisdiction_tasks", "entity_observation_states", "legacy_planning_grid", "completion_claim"]}, indent=2))


if __name__ == "__main__":
    main()
