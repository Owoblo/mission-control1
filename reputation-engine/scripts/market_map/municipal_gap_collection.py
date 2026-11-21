"""Collect municipal query gaps and retain every returned raw provider row."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

from .cap_completion import collect_partition, guard_space
from .geography import AREA_LABELS, geography_id
from .place_import import compress_collection_artifacts
from .places import _feature

PARENT_QUERIES = {"windsor": "windsor-essex", "chatham-kent": "chatham-kent", "sarnia": "sarnia-lambton",
    "london": "london-elgin-middlesex", "woodstock": "woodstock-oxford", "WKG": "waterloo-guelph-wellington",
    "ottawa": "ottawa-surrounding", "toronto": "toronto-gta-hamilton"}


def _hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024*1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _save(path, value):
    temporary = path.with_suffix(path.suffix+".tmp")
    temporary.write_text(json.dumps(value, indent=2)+"\n")
    temporary.replace(path)


def collect_with_raw(partition, output, *, reader_factory=None):
    """Canonical Ontario candidates plus a complete raw-feature/quarantine trail."""
    output, folder = Path(output), Path(output)/partition["id"]
    manifest_path = folder/"collection.json"
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text())
        if previous.get("metadata", {}).get("status") == "completed":
            raw = previous.get("raw_feature_receipt")
            if not raw or _hash(folder/raw["file"]) != raw["sha256"]:
                raise ValueError("Completed query lacks an intact full raw-feature receipt")
            # Reuse the collector's independent normalised-artifact verification.
            return collect_partition(partition, output, reader_factory=reader_factory)
        raise ValueError("Partial gap query requires finer independent partitions; existing raw inputs remain frozen")
    output.mkdir(parents=True, exist_ok=True)
    guard_space(output)
    folder.mkdir(parents=True, exist_ok=True)
    raw_path = folder/"all-returned-provider-features.jsonl.gz"
    raw_count = 0
    with raw_path.open("wb") as raw_file, gzip.GzipFile(filename="", fileobj=raw_file, mode="wb", mtime=0, compresslevel=6) as capture:
        def recorded_factory(*args, **kwargs):
            factory = reader_factory
            if factory is None:
                from overturemaps.core import record_batch_reader
                factory = record_batch_reader
            original = factory(*args, **kwargs)
            if original is None:
                return None
            class Batch:
                def __init__(self, batch):
                    self.batch = batch
                def to_pylist(self):
                    nonlocal raw_count
                    for raw in self.batch.to_pylist():
                        try:
                            feature = _feature(dict(raw))
                            encoding = "geojson_feature"
                        except Exception:
                            feature = {key: ({"encoding": "hex", "value": value.hex()} if isinstance(value, bytes) else value)
                                for key, value in raw.items()}
                            encoding = "original_row_with_tagged_binary"
                        capture.write((json.dumps({"source_record_id": raw.get("id"), "representation": encoding,
                            "provider_record": feature}, ensure_ascii=False, default=str)+"\n").encode())
                        raw_count += 1
                        yield raw
            return (Batch(batch) for batch in original)
        result = collect_partition(partition, output, reader_factory=recorded_factory)
    compress_collection_artifacts(output, remove_original=True, areas=[partition["id"]])
    result = json.loads(manifest_path.read_text())
    count = 0
    with gzip.open(raw_path, "rt", encoding="utf-8") as check:
        for line in check:
            json.loads(line)
            count += 1
    if count != raw_count:
        raise ValueError("Raw source capture row count differs after gzip recovery")
    result["raw_feature_receipt"] = {"file": raw_path.name, "rows": count, "sha256": _hash(raw_path),
        "policy": "All returned rows retained before the Ontario-address/name/geometry candidate checks, including held rows. Representation is GeoJSON or tagged original-row binary; no held row is promoted as a verified Ontario business."}
    result["metadata"]["market_map_cohort"] = "municipal_polygon_gap_collection"
    result["source"]["market_map_cohort"] = "municipal_polygon_gap_collection"
    result["metadata"]["parser_version"] = "market-map/municipal-gap-with-raw1"
    result["metadata"]["municipality_code_for_query_planning"] = partition.get("municipality_code")
    result["metadata"]["raw_returned_rows_retained"] = count
    _save(manifest_path, result)
    return result


def parent_routes(database, polygon_folder):
    connection = sqlite3.connect(Path(database).resolve().as_uri()+"?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    geographies = {row["id"]: dict(row) for row in connection.execute("SELECT * FROM geographies")}
    area_ids = {geography_id(label, "service_catchment"): area for area, label in AREA_LABELS.items()}
    membership = defaultdict(set)
    for row in connection.execute("SELECT geography_id,service_area_id FROM geography_service_areas"):
        current, visited = row["geography_id"], set()
        while current and current not in visited and current in geographies:
            visited.add(current)
            if row["service_area_id"] in area_ids:
                membership[current].add(area_ids[row["service_area_id"]])
            current = geographies[current]["parent_id"]
    connection.close()
    scope = json.loads((Path(polygon_folder)/"municipality-scope.json").read_text())
    routes = {}
    for code, municipality in scope["municipalities"].items():
        areas = membership[municipality["geography_id"]]
        if areas:
            routes[code] = PARENT_QUERIES[sorted(areas)[0]]
    return routes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--polygon-folder", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    routes = parent_routes(args.database, args.polygon_folder)
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for query in plan["queries"]:
        if query["municipality_code"] not in routes:
            results.append({"query": query["id"], "status": "scope_parent_review_required"})
            continue
        result = collect_with_raw({**query, "parent": routes[query["municipality_code"]]}, args.output)
        item = {"query": query["id"], "municipality": query["municipality"],
            "status": result["metadata"]["status"], "source_query_exhausted": result["metadata"]["source_query_exhausted"],
            "candidate_rows": result["metadata"]["fetched_count"], "raw_rows_retained": result.get("raw_feature_receipt", {}).get("rows"),
            "manifest": str(args.output/query["id"]/"collection.json")}
        results.append(item)
        _save(args.output/"gap-collection-status.json", {"plan": str(args.plan), "results": results,
            "planned_queries": len(plan["queries"]), "main_database_writes": 0, "market_completeness_verified": False})
        print(json.dumps(item), flush=True)


if __name__ == "__main__":
    main()
