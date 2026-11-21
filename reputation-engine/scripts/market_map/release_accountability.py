"""Verify a saved release's complete configuration grid without database writes.

Rows for every configured label/industry/source lane are accountability records.
They do not establish complete markets, current operations, or firm-size coverage.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from .reporting import _write_dataset, load_taxonomy

MARKER = "<!-- scope-accountability -->"


def _hash(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1048576), b""):
            result.update(block)
    return result.hexdigest()


def _save(path, payload):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def _dataset_path(folder, manifest, name):
    dataset = manifest["datasets"][name]
    filename = dataset["jsonl"]
    if not isinstance(filename, str) or Path(filename).name != filename:
        raise ValueError("Dataset must reference a sibling artifact: " + name)
    path = folder / filename
    if _hash(path) != dataset["sha256_jsonl"]:
        raise ValueError("Dataset input hash differs: " + name)
    return path


def _json_rows(path):
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def supplement_release_scope(export_folder, snapshot_path, *, configured_labels,
                             industry_ids=None, source_families=None):
    """Validate all axes, then append flat label coverage and scope evidence.

    The existing generated datasets retain their hashes. Aliases share the
    canonical geography's counts; summing label rows would double-count aliases.
    Validation finishes before a new manifest or scope supplement is published.
    """
    folder = Path(export_folder)
    manifest_path = folder / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    snapshot_bytes = Path(snapshot_path).read_bytes()
    snapshot = json.loads(snapshot_bytes)
    taxonomy = load_taxonomy()
    industries = set(industry_ids if industry_ids is not None else
                     (entry["id"] for entry in taxonomy["industry_families"]))
    expected_families = set(source_families if source_families is not None else taxonomy["source_families"])
    labels = set(configured_labels)
    if not labels or not industries or not expected_families:
        raise ValueError("Configured labels, industries and source families must be explicit")
    if snapshot["configured_service_labels"] != len(labels):
        raise ValueError("Runtime label count differs from reviewed scope snapshot")
    if snapshot["industry_buckets_including_uncategorised"] != len(industries):
        raise ValueError("Industry axes differ from reviewed scope snapshot")
    if snapshot["source_families_tracked"] != len(expected_families):
        raise ValueError("Source-family axes differ from reviewed scope snapshot")
    if manifest.get("counts", {}).get("configured_labels") != len(labels):
        raise ValueError("Manifest configured-label count differs from runtime scope")
    if ("minimum_business_size_filter" not in snapshot or snapshot["minimum_business_size_filter"] is not None
            or snapshot.get("published_website_required_for_inclusion") is not False
            or snapshot.get("published_email_required_for_inclusion") is not False):
        raise ValueError("Unrestricted size/site/email inclusion requires explicit reviewed evidence")
    review_labels = set(snapshot["scope_review_labels"])
    if not review_labels <= labels:
        raise ValueError("A scope-review label is absent from the runtime configuration")
    paths = {name: _dataset_path(folder, manifest, name)
             for name in ("service_footprint", "coverage", "sources")}
    label_to_geo = {}
    aliases = defaultdict(list)
    geographies = {}
    for row in _json_rows(paths["service_footprint"]):
        gid = row["geography_id"]
        geographies[gid] = row
        for label in row["configured_labels"]:
            if label in label_to_geo and label_to_geo[label] != gid:
                raise ValueError("One configured label has competing canonical geographies: " + label)
            label_to_geo[label] = gid
            aliases[gid].append(label)
    if set(label_to_geo) != labels or set(aliases) != set(geographies):
        raise ValueError("Export footprint omits or adds configured labels/geographies")
    dates = {row["id"]: row.get("source_date") for row in _json_rows(paths["sources"])}
    keys, lanes, sectors = set(), set(), set()
    zero_cells = unsearched_cells = 0
    for cell in _json_rows(paths["coverage"]):
        gid, sector, family = cell["geography_id"], cell["sector_id"], cell["source_lane"]
        key = (gid, sector, family)
        if gid not in geographies or sector not in industries | {"*"} or not family or key in keys:
            raise ValueError("Coverage grid has duplicate or unconfigured axes")
        if cell.get("market_completeness_percentage") is not None:
            raise ValueError("This release has no comparable full-market completeness benchmark")
        if cell["search_status"] in {"complete", "market_complete", "fully_covered"}:
            raise ValueError("Source retrieval cannot establish complete market coverage")
        if cell["search_status"] not in {"not_searched", "searched_no_source_found", "source_identified",
                "access_blocked", "ingestion_pending", "partially_ingested", "ingested", "stale"}:
            raise ValueError("Unrecognised coverage research status")
        source_ids = cell["source_ids"]
        if len(source_ids) != len(set(source_ids)) or len(source_ids) != cell["source_count"] or any(source not in dates for source in source_ids):
            raise ValueError("Coverage cell source evidence does not reconcile")
        if cell["unique_organisations"] < 0 or cell["unique_locations"] < 0:
            raise ValueError("Coverage counts cannot be negative")
        keys.add(key)
        lanes.add(family)
        sectors.add(sector)
        zero_cells += cell["unique_organisations"] == 0
        unsearched_cells += cell["search_status"] == "not_searched"
    expected_cells = len(geographies) * (len(industries) + 1) * len(lanes)
    if (not expected_families <= lanes or sectors != industries | {"*"}
            or len(keys) != expected_cells or manifest["datasets"]["coverage"]["rows"] != len(keys)):
        raise ValueError("Coverage grid omits a geography, industry or source-family cell")
    expected_flat_rows = len(labels) * len(industries) * len(lanes)

    def flat_rows():
        for cell in _json_rows(paths["coverage"]):
            if cell["sector_id"] == "*":
                continue
            gid = cell["geography_id"]
            for label in sorted(aliases[gid]):
                yield {"configured_label": label, "geography_id": gid,
                       "canonical_geography": geographies[gid]["name"],
                       "geography_kind": geographies[gid]["kind"],
                       "scope_review_required": label in review_labels,
                       "industry_bucket": cell["sector_id"], "source_family": cell["source_lane"],
                       "search_status": cell["search_status"], "source_count": cell["source_count"],
                       "source_ids": cell["source_ids"],
                       "source_publication_or_update_dates": [{"source_id": source, "source_date": dates[source]}
                                                              for source in cell["source_ids"]],
                       "provisional_organisation_records": cell["unique_organisations"],
                       "location_observation_records": cell["unique_locations"],
                       "market_completeness_percentage": None,
                       "comparability_notes": cell["comparability_notes"]}

    dataset = _write_dataset(folder, "configured-label-sector-coverage", flat_rows(),
                             expected_count=expected_flat_rows)
    if dataset["rows"] != expected_flat_rows:
        raise ValueError("Flat configured-label coverage counts do not reconcile")
    summary = {"verified_at": datetime.now(timezone.utc).isoformat(),
               "accountability_axes_complete": True, "configured_service_labels": len(labels),
               "canonical_geographies": len(geographies), "industry_buckets_including_uncategorised": len(industries),
               "configured_source_families": len(expected_families), "export_source_lanes": len(lanes),
               "coverage_grid_cells": len(keys), "zero_organisation_cells_retained": zero_cells,
               "unsearched_cells_retained": unsearched_cells, "per_label_sector_source_rows": dataset["rows"],
               "scope_review_labels": sorted(review_labels),
               "configured_label_evidence_status": snapshot.get("configured_label_evidence_status"),
               "scope_snapshot_at": snapshot.get("at"),
               "label_evidence_status_scope": "Earlier reviewed source-presence snapshot; not recalculated across subsequently promoted cohorts and not a market census.",
               "requested_label_count_review": snapshot["requested_label_count_review"],
               "minimum_business_size_filter": snapshot.get("minimum_business_size_filter"),
               "published_website_required_for_inclusion": False,
               "published_email_required_for_inclusion": False,
               "business_size_coverage_verified": False,
               "coverage_grid_is_execution_proof": False,
               "full_city_category_market_completeness_verified": False,
               "alias_policy": "Configured aliases share canonical geography counts; do not sum alias rows as independent towns.",
               "currency_policy": "Source presence and retrieval dates do not verify current operations. CRA2024 addresses are mailing routes; ODBus2023 includes older provider observations. Consult source dates, address roles and evidence.",
               "source_snapshot_sha256": hashlib.sha256(snapshot_bytes).hexdigest()}
    snapshot_copy = folder / "scope-accountability-snapshot.json"
    snapshot_copy.write_bytes(snapshot_bytes)
    scope_path = folder / "scope-accountability.json"
    _save(scope_path, summary)
    for name in ("topline.json", "coverage-report.json"):
        path = folder / name
        payload = json.loads(path.read_text())
        payload["scope_accountability"] = summary
        _save(path, payload)
    markdown = folder / "COVERAGE-REPORT.md"
    prefix = markdown.read_text().split(MARKER)[0].rstrip()
    discrepancy = snapshot["requested_label_count_review"]
    requested = discrepancy.get("user_mentioned")
    text = (f"\n\n{MARKER}\n## Scope accountability\n\n"
            f"All {len(labels)} configured labels have rows for every one of the {len(industries)} industry buckets "
            f"and {len(lanes)} export source lanes. Zero and unsearched cells remain visible. "
            "The grid records configuration coverage; complete business enumeration remains unverified.\n\n"
            f"The requested {requested}-label count differs from the {len(labels)} observed runtime labels; "
            "that discrepancy remains open. Scope-review labels: " + "; ".join(sorted(review_labels)) + ".\n\n"
            "No minimum business-size, website or email requirement removes otherwise eligible observations. "
            "Size coverage is unverified. Current operations, historical observations, mailing routes and source presence "
            "remain separate evidence questions. Alias rows share counts and must not be summed as independent towns.\n\n"
            f"Full label grid: [{dataset['csv']}]({dataset['csv']}); "
            "scope evidence: [scope-accountability.json](scope-accountability.json).\n")
    markdown.write_text(prefix + text)
    manifest["datasets"]["configured-label-sector-coverage"] = dataset
    manifest["scope_accountability"] = summary
    auxiliary = manifest.setdefault("auxiliary_artifacts", {})
    for name, path in (("scope-accountability", scope_path), ("scope-accountability-snapshot", snapshot_copy)):
        auxiliary[name] = {"file": path.name, "sha256": _hash(path)}
    _save(manifest_path, manifest)
    return {"passed": True, "scope_accountability": summary,
            "dataset": dataset, "manifest_sha256": _hash(manifest_path)}


def main():
    from .geography import configured_footprint
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--snapshot", type=Path, required=True)
    args = parser.parse_args()
    result = supplement_release_scope(args.folder, args.snapshot,
                                      configured_labels=[entry["label"] for entry in configured_footprint()])
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
