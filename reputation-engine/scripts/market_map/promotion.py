"""Prepare new provider identities while retaining every acquired observation.

The complete immutable query archives remain source evidence. An additional
line/hash index accounts for observations already represented by the same pinned
provider release, without manufacturing duplicate canonical companies/sites.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import shutil
from pathlib import Path

from .store import dumps


def _hash(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def _save(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False)+"\n")
    temporary.replace(path)


def prepare_incremental_promotion(folder, output):
    folder, output = Path(folder), Path(output)
    if output.resolve() == folder.resolve() or output.resolve().is_relative_to(folder.resolve()):
        raise ValueError("Promotion output must be separate from immutable query inputs")
    summary_path = folder / "next-release-summary.json"
    summary = json.loads(summary_path.read_text())
    release = summary["provider_release"]
    baseline = Path(summary["baseline"]["file"])
    if _hash(baseline) != summary["baseline"]["stored_sha256"]:
        raise ValueError("Frozen baseline checksum differs")
    baseline_ids = set()
    with gzip.open(baseline, "rt", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if row["provider_release"] != release or row["provider_gers_id"] in baseline_ids:
                raise ValueError("Baseline release or identity uniqueness differs")
            baseline_ids.add(row["provider_gers_id"])
    if len(baseline_ids) != summary["baseline"]["rows"]:
        raise ValueError("Baseline identity count differs")
    incremental = next(item for item in summary["output_files"] if item["file"] == "next-release-incremental-place-candidates.csv.gz")
    expected_path = folder / incremental["file"]
    if _hash(expected_path) != incremental["sha256"]:
        raise ValueError("Verified incremental identity inventory checksum differs")
    with gzip.open(expected_path, "rt", encoding="utf-8", newline="") as handle:
        expected_ids = {row["provider_gers_id"] for row in csv.DictReader(handle)}
    if len(expected_ids) != incremental["rows"] or expected_ids & baseline_ids:
        raise ValueError("Incremental inventory overlaps the baseline or has wrong unique count")
    output.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(output).free < 512 * 1024 * 1024:
        raise RuntimeError("Promotion preparation needs at least 512 MiB free; original inputs remain intact")
    pending_manifests, new_ids, reobserved_ids = [], set(), set()
    counts = {"source_observations": 0, "new_provider_observations": 0,
        "baseline_reobservations": 0, "duplicate_new_provider_observations": 0}
    index_path = output / "source-observation-lineage.jsonl.gz"
    with index_path.with_suffix(".gz.tmp").open("wb") as index_raw, gzip.GzipFile(
            filename="", mode="wb", fileobj=index_raw, mtime=0, compresslevel=6) as index:
        for artifact in summary["source_artifacts"]:
            source_manifest_path = Path(artifact["manifest"])
            if source_manifest_path.resolve().parent.parent != folder.resolve():
                raise ValueError("Query manifest is outside the frozen source folder")
            source_manifest = json.loads(source_manifest_path.read_text())
            _manifest_hash = _hash(source_manifest_path)
            if source_manifest["source"].get("release") != release:
                raise ValueError("Mixed provider releases cannot share a promotion")
            filename = source_manifest["rows_file"]
            if Path(filename).name != filename:
                raise ValueError("Query rows must be a sibling basename")
            original = source_manifest_path.parent / filename
            if original.is_symlink() or _hash(original) != source_manifest["rows_compressed_sha256"]:
                raise ValueError("Original compressed query checksum differs")
            if shutil.disk_usage(output).free < 512 * 1024 * 1024:
                raise RuntimeError("Promotion preparation paused for free space; source archives remain intact")
            area = source_manifest_path.parent.name
            destination = output / area
            destination.mkdir(parents=True, exist_ok=True)
            rows_path = destination / "normalised-records.jsonl.gz"
            retained_hash, original_hash = hashlib.sha256(), hashlib.sha256()
            retained_bytes = original_bytes = retained_count = original_count = 0
            with gzip.open(original, "rb") as source, rows_path.with_suffix(".gz.tmp").open("wb") as raw, gzip.GzipFile(
                    filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=6) as target:
                for line_number, line in enumerate(source, 1):
                    original_hash.update(line)
                    original_bytes += len(line)
                    if not line.strip():
                        continue
                    row = json.loads(line)
                    gers = row.get("source_record_id")
                    if not gers or not row.get("name"):
                        raise ValueError("Original query record lacks publisher identity/name")
                    counts["source_observations"] += 1
                    original_count += 1
                    if gers in baseline_ids:
                        disposition = "baseline_reobservation"
                        counts["baseline_reobservations"] += 1
                        reobserved_ids.add(gers)
                    elif gers in new_ids:
                        disposition = "duplicate_new_provider_observation"
                        counts["duplicate_new_provider_observations"] += 1
                    else:
                        disposition = "new_provider_identity"
                        new_ids.add(gers)
                        counts["new_provider_observations"] += 1
                        retained_count += 1
                        target.write(line)
                        retained_hash.update(line)
                        retained_bytes += len(line)
                    index.write((dumps({"source_record_id": gers, "query": area, "line": line_number,
                        "original_manifest": str(source_manifest_path), "original_manifest_sha256": _manifest_hash,
                        "normalised_source_line_sha256": hashlib.sha256(line).hexdigest(), "disposition": disposition})+"\n").encode("utf-8"))
            if (original_hash.hexdigest() != source_manifest["rows_sha256"] or
                    original_bytes != source_manifest["rows_uncompressed_bytes"] or original_count != artifact["rows"]):
                raise ValueError("Recovered whole-file query checksum/bytes/count differ")
            rows_path.with_suffix(".gz.tmp").replace(rows_path)
            metadata = {**source_manifest["metadata"], "promotion_mode": "new_provider_ids_only",
                "promotion_baseline_sha256": summary["baseline"]["stored_sha256"],
                "original_source_manifest": str(source_manifest_path), "original_source_manifest_sha256": _manifest_hash,
                "original_source_observations": original_count, "promotion_rows": retained_count,
                "fetched_count": retained_count, "parsed_count": retained_count,
                "coverage_complete": False, "expected_count": None}
            manifest = {**source_manifest, "metadata": metadata, "rows_file": rows_path.name,
                "rows_sha256": retained_hash.hexdigest(), "rows_uncompressed_bytes": retained_bytes,
                "rows_compressed_sha256": _hash(rows_path), "rows_compressed_bytes": rows_path.stat().st_size,
                "promotion_lineage_index": str(index_path)}
            pending_manifests.append((destination / "collection.json", manifest))
    if new_ids != expected_ids or counts["source_observations"] != summary["counts"]["query_observations"]:
        raise ValueError("Full observed and incremental identity sets do not reconcile")
    if len(reobserved_ids) != summary["counts"]["unique_next_query_places_already_in_first_release"]:
        raise ValueError("Previously represented provider identity count differs")
    index_path.with_suffix(".gz.tmp").replace(index_path)
    for path, manifest in pending_manifests:
        _save(path, manifest)
    result = {"status": "verified_ready_for_guarded_import", "source_summary_sha256": _hash(summary_path),
        "provider_release": release, "baseline_provider_ids": len(baseline_ids), "counts": counts,
        "unique_new_provider_ids": len(new_ids), "unique_baseline_ids_reobserved": len(reobserved_ids),
        "prospective_provider_ids": len(baseline_ids)+len(new_ids), "query_archives_retained": len(pending_manifests),
        "lineage_index": index_path.name, "lineage_index_sha256": _hash(index_path),
        "original_source_artifacts_modified": False, "main_database_writes": 0,
        "source_observations_discarded": 0,
        "policy": "Every original row remains in its immutable query archive and the line/hash receipt index. Existing IDs in the same pinned release do not create duplicate canonical companies/sites."}
    _save(output / "promotion-summary.json", result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare_incremental_promotion(args.folder, args.output), indent=2))


if __name__ == "__main__":
    main()
