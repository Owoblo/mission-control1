"""Screen official municipal geometry against exhausted retrieval rectangles.

This measures geographic query coverage only. It never establishes a complete
business census, verifies reported business coordinates, or repairs geometry.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path


def _hash(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def compare_geometry(features, municipalities, rectangles):
    from shapely.geometry import box, shape
    from shapely.ops import unary_union
    footprint = unary_union([box(*rectangle) for rectangle in rectangles])
    grouped = defaultdict(list)
    for feature in features:
        grouped[str(feature["properties"]["MUNID"])].append(feature)
    rows, gap_queries = [], []
    for code, municipality in sorted(municipalities.items()):
        members = grouped.get(code, [])
        row = {"municipality_code": code, **municipality, "polygon_features": len(members),
            "query_market_completeness_verified": False}
        if not members:
            rows.append({**row, "status": "official_geometry_missing"})
            continue
        geometries = [shape(feature["geometry"]) for feature in members]
        invalid = [str(feature["properties"]["OBJECTID"]) for feature, geometry in zip(members, geometries) if not geometry.is_valid]
        if invalid:
            # A bounding rectangle is a conservative acquisition target even
            # when the source shape itself cannot support polygon assertions.
            bounds = unary_union([box(*geometry.bounds) for geometry in geometries])
            missing = bounds.difference(footprint)
            row.update(status="invalid_source_geometry", invalid_source_object_ids=invalid,
                conservative_source_bounds_query_covered=missing.is_empty)
        else:
            geometry = unary_union(geometries)
            missing = geometry.difference(footprint)
            row["status"] = "retrieval_geometry_covered" if missing.is_empty else "retrieval_geometry_gap"
        row["gap_query_count"] = 0
        parts = list(missing.geoms) if hasattr(missing, "geoms") else [missing]
        for number, part in enumerate(parts):
            if part.is_empty or part.area <= 0:
                continue
            min_x, min_y, max_x, max_y = part.bounds
            epsilon = 0.000001
            bbox = [min_x-epsilon, min_y-epsilon, max_x+epsilon, max_y+epsilon]
            query = {"id": "municipal-gap-"+code+"-"+str(number), "municipality_code": code,
                "municipality": municipality["name"], "bbox": bbox,
                "geometry_basis": "conservative_source_bounds" if invalid else "uncovered_official_polygon_component",
                "source_polygon_valid": not invalid,
                "purpose": "Collect all eligible provider rows within this previously unqueried geographic component; not an absence or business-census claim."}
            gap_queries.append(query)
            row["gap_query_count"] += 1
        rows.append(row)
    return rows, gap_queries


def audit_queries(polygon_folder, collection_roots, output):
    polygon_folder, output = Path(polygon_folder), Path(output)
    scope = json.loads((polygon_folder/"municipality-scope.json").read_text())
    source = json.loads((polygon_folder/"polygon-source.json").read_text())
    geo_path = polygon_folder/source["geojson_path"]
    if _hash(geo_path) != source["geojson_sha256"]:
        raise ValueError("Official polygon source checksum differs")
    geo = json.loads(geo_path.read_text())
    rectangles, receipts = [], []
    for folder in map(Path, collection_roots):
        for path in sorted(folder.glob("*/collection.json")):
            manifest = json.loads(path.read_text())
            metadata = manifest.get("metadata", {})
            if not metadata.get("source_query_exhausted"):
                continue
            bbox = metadata.get("original_query_bbox") or manifest.get("source", {}).get("bbox")
            if not bbox or len(bbox) != 4:
                raise ValueError("Exhausted query has no original retrieval rectangle: "+str(path))
            rectangles.append(bbox)
            receipts.append({"manifest": str(path), "sha256": _hash(path), "bbox": bbox,
                "provider_release": manifest["source"].get("release")})
    if not receipts or len({item["provider_release"] for item in receipts}) != 1:
        raise ValueError("Query audit needs a nonempty single-release set of exhausted queries")
    rows, queries = compare_geometry(geo["features"], scope["municipalities"], rectangles)
    counts = dict((status, sum(row["status"] == status for row in rows)) for status in sorted({row["status"] for row in rows}))
    result = {"scope": "Official configured/ancestor municipal geometry versus actually exhausted retrieval rectangles",
        "municipalities_reviewed": len(rows), "status_counts": counts, "gap_queries": len(queries),
        "exhausted_query_receipts": receipts, "municipalities": rows,
        "official_source_url": source["source_url"], "official_geometry_sha256": source["geojson_sha256"],
        "official_source_observed_at": source["source_observed_at"],
        "market_completeness_verified": False, "invalid_geometry_repaired": False, "main_database_writes": 0,
        "limitations": ["Only the selected official municipality scope is screened; composite/unresolved service labels still need scope review.",
            "Rectangle unions model closed bounds; collectors use strict inequalities. Proposed queries deliberately overlap edges by one millionth of a degree.",
            "Invalid official polygons are retained and only conservative bounding rectangles are considered for acquisition.",
            "Area/point coverage never proves every business or category has been found; this is an acquisition gap screen."]}
    output.mkdir(parents=True, exist_ok=True)
    (output/"municipal-query-geometry-audit.json").write_text(json.dumps(result, indent=2)+"\n")
    (output/"gap-query-plan.json").write_text(json.dumps({"queries": queries, "source_audit": "municipal-query-geometry-audit.json",
        "provider_release": receipts[0]["provider_release"], "main_database_writes": 0}, indent=2)+"\n")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--polygon-folder", type=Path, required=True)
    parser.add_argument("--collection-root", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit_queries(args.polygon_folder, args.collection_root, args.output)
    print(json.dumps({key: result[key] for key in ("municipalities_reviewed", "status_counts", "gap_queries", "market_completeness_verified")}))


if __name__ == "__main__":
    main()
