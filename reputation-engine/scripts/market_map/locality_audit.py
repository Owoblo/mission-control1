"""Audit every configured label against acquired evidence and collection envelopes.

Parent-municipality support never claims a community was exhaustively searched.
Official representative name coordinates can reveal envelope gaps; they never
assign business points to administrative boundaries.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path

from .acquired_inventory import ServiceFootprint, safe_cell
from .geography import configured_footprint, resolve_geography, municipality_for, normalise_locality


def boxes_for_point(longitude, latitude, envelopes):
    return sorted(name for name, box in envelopes.items()
        if box[0] <= longitude <= box[2] and box[1] <= latitude <= box[3])


def executed_envelopes(inventory):
    """Use acquisition receipts, never future configured-but-unexecuted boxes."""
    manifest_path = Path(inventory).parent/"manifest.json"
    inventory_manifest = json.loads(manifest_path.read_text())
    boxes = {}
    repo = Path(__file__).resolve().parents[2]
    for item in inventory_manifest["input_artifacts"]:
        path = Path(item["manifest"])
        if not path.is_absolute() and not path.exists():
            path = repo/path
        acquisition = json.loads(path.read_text())
        box = acquisition.get("source", {}).get("bbox")
        if box:
            boxes[path.parent.name] = box
    if not boxes:
        raise ValueError("No executed envelope receipts found; do not substitute configured boxes")
    return boxes


def build_locality_audit(inventory, geography_database, output, *, anchors=None, envelopes=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    envelopes = envelopes or executed_envelopes(inventory)
    community_evidence_path = output/"rural-community-parent-evidence.json"
    community_evidence = json.loads(community_evidence_path.read_text()).get("assertions", []) if community_evidence_path.exists() else []
    footprint = ServiceFootprint(geography_database)
    published, locality, municipalities = Counter(), Counter(), Counter()
    representative = defaultdict(list)
    resolved = {}
    try:
        with gzip.open(inventory, "rt", encoding="utf-8", newline="") as stream:
            for row in csv.DictReader(stream):
                label = row["city"]
                if label not in resolved:
                    loc = resolve_geography(footprint, label)
                    resolved[label] = (loc, municipality_for(footprint, loc) if loc else None)
                loc, municipality = resolved[label]
                published[normalise_locality(label)] += 1
                if loc:
                    locality[loc] += 1
                if municipality:
                    municipalities[municipality] += 1
                if len(representative[normalise_locality(label)]) < 3:
                    representative[normalise_locality(label)].append({"provider_gers_id": row["provider_gers_id"],
                        "publisher_locality": label, "latitude": row["latitude"], "longitude": row["longitude"],
                        "first_envelope": row["first_envelope"], "source_url": row["source_url"]})
        anchors = anchors or {}
        rows = []
        for configured in configured_footprint():
            label, key = configured["label"], normalise_locality(configured["label"])
            loc = resolve_geography(footprint, label)
            municipality = municipality_for(footprint, loc) if loc else None
            municipality_row = footprint.db.execute("SELECT name,official_id FROM geographies WHERE id=?", (municipality,)).fetchone() if municipality else None
            direct = locality[loc] if loc else published[key]
            parent = municipalities[municipality] if municipality else 0
            status = "direct_published_matches" if direct else "parent_municipality_support" if parent else "unknown_label"
            reason = ("Provider locality directly or unambiguously aliases this configured label; no completeness claim" if direct else
                "Other observed localities support the parent municipality; this community still needs targeted verification" if parent else
                "Label is unresolved/composite or lacks direct/parent observations; zero observations does not mean zero businesses")
            anchor = anchors.get(label)
            anchor_boxes = boxes_for_point(anchor["longitude"], anchor["latitude"], envelopes) if anchor else []
            child_gaps = []
            if loc and loc == municipality:
                for assertion in community_evidence:
                    if normalise_locality(assertion["municipality"]) != normalise_locality(municipality_row["name"]):
                        continue
                    for child in assertion["communities"]:
                        child_anchor = anchors.get(child)
                        if child_anchor and not boxes_for_point(child_anchor["longitude"], child_anchor["latitude"], envelopes):
                            child_gaps.append({"community": child, "anchor_source": child_anchor["source_url"],
                                "parent_source": assertion["source_url"]})
            if anchor and not anchor_boxes:
                status = "collection_envelope_gap"
                reason = "Official representative named-place point falls outside all executed envelopes; this does not establish municipal boundary coverage"
            elif child_gaps:
                status = "collection_envelope_gap"
                reason = "Officially documented subordinate community anchor falls outside executed envelopes; municipality-level observations do not cover every community"
            rows.append({"configured_label": label, "configured_catchments": ";".join(configured["areas"]),
                "configured_runtime": configured["configured_runtime"], "active_runtime": configured["active_runtime"],
                "coverage_status": status, "direct_published_place_candidates": direct,
                "parent_municipality_place_candidates": parent,
                "resolved_locality_id": loc or "", "resolved_municipality": municipality_row["name"] if municipality_row else "",
                "municipality_official_id": municipality_row["official_id"] if municipality_row else "",
                "official_anchor_latitude": anchor["latitude"] if anchor else "",
                "official_anchor_longitude": anchor["longitude"] if anchor else "",
                "official_anchor_source": anchor["source_url"] if anchor else "",
                "anchor_review_status": ("official_point_within_executed_envelope" if anchor_boxes else
                    "official_point_outside_executed_envelopes" if anchor else "not_independently_anchored"),
                "uncovered_documented_subcommunities": json.dumps(child_gaps, ensure_ascii=False),
                "anchor_within_executed_envelopes": ";".join(anchor_boxes), "reason": reason,
                "sample_published_records": json.dumps(representative[key], ensure_ascii=False)})
    finally:
        footprint.close()
    path = output/"configured-label-coverage.csv"
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows({key: safe_cell(value) for key, value in row.items()} for row in rows)
    summary = {"configured_labels": len(rows), "acquired_place_candidates": sum(published.values()),
        "coverage_status_counts": dict(Counter(row["coverage_status"] for row in rows)),
        "executed_collection_envelopes": envelopes, "official_anchors_checked": len(anchors),
        "configured_labels_with_official_anchor": sum(bool(anchors.get(row["configured_label"])) for row in rows),
        "configured_labels_without_official_anchor": sum(not anchors.get(row["configured_label"]) for row in rows),
        "gap_assessment_scope": "Only reviewed official representative points and documented subordinate communities; no claim that every configured label or municipal boundary was independently geocoded.",
        "confirmed_envelope_gap_labels": [row["configured_label"] for row in rows if row["coverage_status"] == "collection_envelope_gap"],
        "unknown_labels": [row["configured_label"] for row in rows if row["coverage_status"] == "unknown_label"],
        "requested_label_count_review": {"user_mentioned": 249, "configured_runtime_labels_observed": len(rows),
            "status": "review_required" if len(rows) != 249 else "matched", "policy": "No invented city or automatic service-area expansion; aliases are not additional independent municipalities."},
        "distinct_resolved_municipality_references": len({row["resolved_municipality"] for row in rows if row["resolved_municipality"]}),
        "aliases_share_reference_geographies": [labels for labels in
            ([row["configured_label"] for row in rows if row["resolved_locality_id"] == ident]
             for ident in {row["resolved_locality_id"] for row in rows if row["resolved_locality_id"]}) if len(labels) > 1],
        "limitations": ["Direct matches and parent support are observed evidence, not market completeness.",
            "A named-place representative point is not a municipality polygon or a business-address geocode.",
            "Provider locality/coordinate disagreement is preserved and requires review.",
            "No observation is never interpreted as no businesses exist."]}
    (output/"summary.json").write_text(json.dumps(summary, indent=2)+"\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--geography-database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--anchors", type=Path)
    args = parser.parse_args()
    anchors = json.loads(args.anchors.read_text()) if args.anchors else {}
    print(json.dumps(build_locality_audit(args.inventory, args.geography_database, args.output, anchors=anchors), indent=2))


if __name__ == "__main__":
    main()
