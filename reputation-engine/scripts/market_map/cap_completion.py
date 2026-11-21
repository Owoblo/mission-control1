"""Separate next-release acquisitions closing bounded first-release queries.

Only source query rectangles are completed. Neither a rectangle union nor an
exhausted provider query proves complete municipal territory or commercial data.
The first release, its 395352 GERS baseline and its importer are never modified.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import shutil
import signal
import socket
import time
from collections import Counter
from contextlib import ExitStack
from pathlib import Path

from .places import source_for, normalize_place, _feature, _now, _atomic
from .place_import import compress_collection_artifacts, _rows_path, _verify_rows_integrity

PARTITIONS = [
    {"id": "gta-central", "parent": "toronto-gta-hamilton", "bbox": [-79.60, 43.05, -79.35, 44.40]},
    {"id": "gta-east-central", "parent": "toronto-gta-hamilton", "bbox": [-79.35, 43.05, -79.10, 44.40]},
    {"id": "gta-west-central", "parent": "toronto-gta-hamilton", "bbox": [-79.85, 43.05, -79.60, 44.40]},
    {"id": "gta-west", "parent": "toronto-gta-hamilton", "bbox": [-80.20, 43.05, -79.85, 44.40]},
    {"id": "gta-east", "parent": "toronto-gta-hamilton", "bbox": [-79.10, 43.05, -78.80, 44.40]},
    {"id": "gta-far-east", "parent": "toronto-gta-hamilton", "bbox": [-78.80, 43.05, -78.50, 44.40]},
    {"id": "waterloo-guelph-wellington-full", "parent": "waterloo-guelph-wellington", "bbox": [-80.85, 43.10, -80.05, 43.90]},
    {"id": "guelph-northern-gap", "parent": "guelph-wellington", "bbox": [-80.62, 43.90, -80.20, 44.00]},
    {"id": "ottawa-full", "parent": "ottawa-surrounding", "bbox": [-76.55, 44.85, -75.10, 45.65]},
]
PINNED_RELEASE = "2026-10-21.0"
FIRST_RELEASE = 395352
COHORT = "next_release_cap_completion_wave_4"


class AcquisitionPaused(RuntimeError):
    pass


def guard_space(folder, minimum=2*1024**3):
    free = shutil.disk_usage(Path(folder).resolve()).free
    if free < minimum:
        raise AcquisitionPaused(f"Acquisition paused: {free} bytes available; at least {minimum} required before a fresh query. Frozen acquisitions and MAIN are untouched.")
    return free


def recover_ids(path):
    """Keep only identifiers in memory; repair only a torn final JSONL record."""
    seen = set()
    if not path.exists():
        return seen
    with path.open("r+b") as stream:
        while True:
            offset = stream.tell()
            line = stream.readline()
            if not line:
                break
            if not line.strip():
                continue
            try:
                record = json.loads(line)
                key = record["source_record_id"]
            except (ValueError, KeyError):
                if not line.endswith(b"\n") and stream.tell() == path.stat().st_size:
                    stream.truncate(offset)
                    stream.flush()
                    os.fsync(stream.fileno())
                    break
                raise ValueError("Interior next-release row corruption; preserve and review")
            if key in seen:
                raise ValueError("Duplicate identifier inside a query artifact")
            seen.add(key)
            if not line.endswith(b"\n"):
                stream.write(b"\n")
                stream.flush()
                os.fsync(stream.fileno())
    return seen


def collect_partition(partition, output, *, max_records=150000, max_output_bytes=500_000_000,
                      deadline_seconds=600, reader_factory=None):
    if not 1 <= max_records <= 150000 or not 1000 <= max_output_bytes <= 500_000_000 or not 1 <= deadline_seconds <= 600:
        raise ValueError("Declared row, serialized-byte and time caps exceed next-release limits")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    folder = output/partition["id"]
    manifest_path = folder/"collection.json"
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
    if old and (old["source"]["release"] != PINNED_RELEASE or old["source"]["bbox"] != partition["bbox"]):
        raise ValueError("Pinned release or query rectangle differs from durable artifact")
    if old and old["metadata"]["status"] == "completed":
        rows_file = _rows_path(manifest_path, old)
        _verify_rows_integrity(rows_file, old)
        return {**old, "replayed": True}
    rows_path = folder/"normalised-records.jsonl"
    if rows_path.with_suffix(".jsonl.gz").exists() and not rows_path.exists():
        raise ValueError("Partial query is compressed; explicitly verify/decompress before resuming, or collect finer independent partitions")
    free = guard_space(output)
    folder.mkdir(parents=True, exist_ok=True)
    if rows_path.exists() and rows_path.stat().st_size and old is None:
        raise ValueError("Rows lack their query manifest; review before resuming")
    seen = recover_ids(rows_path)
    source = source_for(partition["parent"], release=PINNED_RELEASE)
    source.update({"bbox": partition["bbox"], "collection_scope": partition["id"],
        "collection_parent_scope": partition["parent"], "market_map_cohort": COHORT})
    observed, started = _now(), time.monotonic()
    held, examined = 0, 0
    exhausted, status, error, stop_reason = False, "partial", None, None
    old_handler = None
    def timeout(signum, frame):
        raise TimeoutError("Declared source-query deadline reached")
    def snapshot():
        return {"source": source, "metadata": {"source_id": source["id"], "adapter_name": "overture_places",
            "parser_version": "market-map/overture-cap-completion1", "status": status,
            "source_query_exhausted": exhausted, "coverage_complete": False,
            "fetched_count": len(seen), "parsed_count": len(seen), "expected_count": None,
            "examined_source_records_this_attempt": examined, "held_non_ontario_or_invalid_this_attempt": held,
            "requests": None, "bytes_fetched": None, "estimated_cost": 0, "currency": None,
            "paid_service_calls": 0, "model_tokens": 0, "output_bytes": rows_path.stat().st_size if rows_path.exists() else 0,
            "elapsed_seconds": round(time.monotonic()-started, 3), "observed_at": observed,
            "cursor_checkpoint": {"seen_gers": len(seen), "restart_scan_required": not exhausted},
            "collection_scope": partition["id"], "collection_parent_scope": partition["parent"],
            "original_query_bbox": partition["bbox"],
            "query_boundary_semantics": "Official client strict bbox intersection; additional tiny bridge queries cover shared edges.",
            "market_map_cohort": COHORT, "first_release_unique_place_baseline": FIRST_RELEASE,
            "limits": {"accepted_records": max_records, "output_bytes": max_output_bytes, "deadline_seconds": deadline_seconds},
            "preflight_disk_free_bytes": free, "minimum_preflight_free_bytes": 2*1024**3,
            "measurement_note": "Official cloud client's internal requests and transferred bytes are unknown; serialized output bytes and elapsed time measured.",
            "coverage_note": "Rough retrieval rectangle only; source traversal and partition coverage are not municipal/census/market completeness.",
            "attribution": source["attribution"], "stop_reason": stop_reason, "error": error}}
    if hasattr(signal, "SIGALRM"):
        old_handler = signal.signal(signal.SIGALRM, timeout)
        signal.alarm(deadline_seconds)
    try:
        if reader_factory is None:
            from overturemaps.core import record_batch_reader
            reader_factory = record_batch_reader
        socket.setdefaulttimeout(30)
        reader = reader_factory("place", tuple(partition["bbox"]), PINNED_RELEASE, connect_timeout=10, request_timeout=30, stac=False)
        if reader is None:
            raise RuntimeError("No source reader; not empty geographic coverage")
        stop = False
        with rows_path.open("ab") as stream:
            for batch in reader:
                for raw in batch.to_pylist():
                    examined += 1
                    try:
                        row = normalize_place(_feature(raw), release=PINNED_RELEASE, bbox=partition["bbox"], observed_at=observed)
                    except (ValueError, TypeError, KeyError):
                        held += 1
                        continue
                    if row["source_record_id"] in seen:
                        continue
                    row.update({"collection_scope": partition["id"], "collection_parent_scope": partition["parent"],
                        "market_map_cohort": COHORT, "source_published_at": PINNED_RELEASE[:10]})
                    encoded = (json.dumps(row, default=str)+"\n").encode()
                    if len(seen) >= max_records:
                        stop, stop_reason = True, "record_cap"
                        break
                    if stream.tell()+len(encoded) > max_output_bytes:
                        stop, stop_reason = True, "serialized_byte_cap"
                        break
                    stream.write(encoded)
                    seen.add(row["source_record_id"])
                stream.flush()
                os.fsync(stream.fileno())
                _atomic(manifest_path, snapshot())
                print(json.dumps({"query": partition["id"], "accepted": len(seen), "output_bytes": stream.tell(), "elapsed_seconds": round(time.monotonic()-started, 1)}), flush=True)
                if stop:
                    break
            else:
                exhausted, status = True, "completed"
    except Exception as exc:
        error = str(exc)
        stop_reason = "deadline" if isinstance(exc, TimeoutError) else "source_error"
        status = "partial" if seen else "blocked"
    finally:
        if old_handler is not None:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old_handler)
    result = snapshot()
    _atomic(manifest_path, result)
    return result


def uncovered_cells(rectangle, completed_boxes):
    """Exact axis-aligned rectangle-union check, without municipality inference."""
    left, bottom, right, top = rectangle
    boxes = [box for box in completed_boxes if box[0] < right and box[2] > left and box[1] < top and box[3] > bottom]
    xs = sorted({left, right, *(max(left, min(right, x)) for box in boxes for x in (box[0], box[2]))})
    ys = sorted({bottom, top, *(max(bottom, min(top, y)) for box in boxes for y in (box[1], box[3]))})
    missing = []
    for x1, x2 in zip(xs, xs[1:]):
        for y1, y2 in zip(ys, ys[1:]):
            x, y = (x1+x2)/2, (y1+y2)/2
            if not any(box[0] <= x <= box[2] and box[1] <= y <= box[3] for box in boxes):
                missing.append([x1, y1, x2, y2])
    # The official client uses strict bbox-intersection predicates. Interior
    # shared edges must also lie strictly inside an exhausted query, otherwise
    # a rounded point exactly on that seam could be excluded by both neighbours.
    xchecks = sorted({*xs[1:-1], *((a+b)/2 for a, b in zip(xs, xs[1:]))})
    ychecks = sorted({*ys[1:-1], *((a+b)/2 for a, b in zip(ys, ys[1:]))})
    for x in xchecks:
        for y in ychecks:
            if not any(box[0] < x < box[2] and box[1] < y < box[3] for box in boxes):
                if any(cell[0] <= x <= cell[2] and cell[1] <= y <= cell[3] for cell in missing):
                    continue
                missing.append([x, y, x, y])
    return missing


def boundary_partitions(partitions, completed_ids, epsilon=0.000001):
    """Small overlapping bridges for strict-query seams, without full requery."""
    completed = [item for item in partitions if item["id"] in completed_ids and item.get("purpose") != "strict_bbox_boundary_bridge"]
    intervals = {}
    for index, first in enumerate(completed):
        a = first["bbox"]
        for second in completed[index+1:]:
            b = second["bbox"]
            for axis in (0, 1):
                other = 1-axis
                if a[axis+2] == b[axis] or b[axis+2] == a[axis]:
                    coordinate = a[axis+2] if a[axis+2] == b[axis] else b[axis+2]
                    low, high = max(a[other], b[other]), min(a[other+2], b[other+2])
                    if low < high:
                        key = (axis, coordinate)
                        intervals.setdefault(key, {"parent": first["parent"], "ranges": []})["ranges"].append((low, high))
    bridges = []
    for (axis, coordinate), value in sorted(intervals.items()):
        merged = []
        for low, high in sorted(value["ranges"]):
            if merged and low <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], high)
            else:
                merged.append([low, high])
        for index, (low, high) in enumerate(merged):
            box = [coordinate-epsilon, low-epsilon, coordinate+epsilon, high+epsilon] if axis == 0 else [low-epsilon, coordinate-epsilon, high+epsilon, coordinate+epsilon]
            bridges.append({"id": "boundary-"+("longitude" if axis == 0 else "latitude")+"-"+str(coordinate).replace("-","m").replace(".","p")+"-"+str(index),
                "parent": value["parent"], "bbox": box, "purpose": "strict_bbox_boundary_bridge",
                "epsilon_degrees": epsilon, "notes": "Tiny overlap preserves rounded points excluded by both strict adjacent bbox predicates; no administrative-boundary inference."})
    return bridges


def read_baseline(inventory):
    inventory = Path(inventory)
    manifest = json.loads((inventory.parent/"manifest.json").read_text())
    expected = next(item for item in manifest["output_files"] if item["file"] == inventory.name)
    digest = hashlib.sha256()
    with inventory.open("rb") as stream:
        for block in iter(lambda: stream.read(1024*1024), b""):
            digest.update(block)
    if digest.hexdigest() != expected["sha256"]:
        raise ValueError("First-release baseline file differs from its frozen manifest")
    ids, count = set(), 0
    with gzip.open(inventory, "rt", encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            if row["provider_release"] != PINNED_RELEASE:
                raise ValueError("Baseline provider release is not the pinned next-cohort release")
            ids.add(row["provider_gers_id"])
            count += 1
    if len(ids) != FIRST_RELEASE or count != FIRST_RELEASE:
        raise ValueError("First-release baseline must remain exactly395352 unique GERS")
    return ids, {"file": str(inventory), "stored_sha256": digest.hexdigest(), "rows": count,
        "sorted_gers_sha256": hashlib.sha256("\n".join(sorted(ids)).encode()).hexdigest()}


def acquire(output, baseline, *, reader_factory=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    _, baseline_receipt = read_baseline(baseline)
    plan_path = output/"next-release-plan.json"
    old = json.loads(plan_path.read_text()) if plan_path.exists() else {}
    if old and old["baseline"]["sorted_gers_sha256"] != baseline_receipt["sorted_gers_sha256"]:
        raise ValueError("First-release GERS baseline changed; preserve separate cohorts")
    plan = {"cohort": COHORT, "provider_release": PINNED_RELEASE, "baseline": baseline_receipt,
        "partitions": old.get("partitions", PARTITIONS), "status": "running", "completed": old.get("completed", []),
        "limits_per_query": {"records":150000, "serialized_bytes":500000000, "deadline_seconds":600},
        "minimum_preflight_free_bytes": 2*1024**3, "first_release_files_modified": False,
        "note": "Separate next-market-map cohort; pinned provider release unchanged. No MAIN writes or first-release importer/count changes."}
    _atomic(plan_path, plan)
    try:
        for partition in plan["partitions"]:
            prior_path = output/partition["id"]/"collection.json"
            frozen_partial = json.loads(prior_path.read_text()) if prior_path.exists() else None
            if frozen_partial and frozen_partial["metadata"]["status"] == "partial" and _rows_path(prior_path, frozen_partial).suffix == ".gz":
                _verify_rows_integrity(_rows_path(prior_path, frozen_partial), frozen_partial)
                result = frozen_partial
            else:
                result = collect_partition(partition, output, reader_factory=reader_factory)
            if result["metadata"]["status"] == "blocked":
                raise RuntimeError("Source query blocked: " + str(result["metadata"].get("error")))
            compress_collection_artifacts(output, remove_original=True, areas={partition["id"]})
            manifest = json.loads((output/partition["id"]/"collection.json").read_text())
            plan["completed"] = [item for item in plan["completed"] if item["query"] != partition["id"]]
            plan["completed"].append({"query": partition["id"], "status": result["metadata"]["status"],
                "source_query_exhausted": result["metadata"]["source_query_exhausted"], "records": result["metadata"]["fetched_count"],
                "rows_sha256": manifest["rows_sha256"], "stop_reason": result["metadata"].get("stop_reason")})
            _atomic(plan_path, plan)
            if result["metadata"]["status"] == "partial" and result["metadata"].get("stop_reason") in ("record_cap", "serialized_byte_cap", "deadline") and partition.get("depth", 0) < 2:
                box = partition["bbox"]
                # Split latitude first for a narrow, populous GTA strip.
                middle = (box[1]+box[3])/2
                for suffix, child_box in (("south",[box[0],box[1],box[2],middle]),("north",[box[0],middle,box[2],box[3]])):
                    child = {"id": partition["id"]+"-"+suffix, "parent":partition["parent"], "bbox":child_box,
                        "depth":partition.get("depth",0)+1,"replaces_capped_partition":partition["id"]}
                    if not any(item["id"] == child["id"] for item in plan["partitions"]):
                        plan["partitions"].append(child)
                _atomic(plan_path, plan)
        completed_ids = {item["query"] for item in plan["completed"] if item["source_query_exhausted"]}
        bridges = boundary_partitions(plan["partitions"], completed_ids)
        additions = [item for item in bridges if not any(prior["id"] == item["id"] for prior in plan["partitions"])]
        if additions:
            plan["partitions"].extend(additions)
            _atomic(plan_path, plan)
            return acquire(output, baseline, reader_factory=reader_factory)
        plan["status"] = "acquisition_finished"
    except (AcquisitionPaused, ValueError, RuntimeError) as exc:
        plan["status"], plan["error"] = "paused", str(exc)
        _atomic(plan_path, plan)
        raise
    _atomic(plan_path, plan)
    return plan


def summarize(output, baseline, *, frozen_folders=None, geography_database=None):
    """Export only GERS absent from the immutable first-release baseline."""
    from .acquired_inventory import COLUMNS, ServiceFootprint, safe_cell, _writer, _category, _non_organisation
    from .classify import VERSION as CROSSWALK_VERSION, mapped_families
    output = Path(output)
    plan = json.loads((output/"next-release-plan.json").read_text())
    if plan["status"] not in ("acquisition_finished", "paused"):
        raise ValueError("Finish or durably pause the collector before next-release export")
    baseline_ids, baseline_receipt = read_baseline(baseline)
    if baseline_receipt["sorted_gers_sha256"] != plan["baseline"]["sorted_gers_sha256"]:
        raise ValueError("First-release provider identities changed during next-cohort collection")
    run = Path(baseline).parent.parent
    frozen_folders = frozen_folders or [run/"overture-2026-10-21", run/"overture-municipal-wave-2", run/"overture-rural-wave-3"]
    frozen_partial = []
    for folder in map(Path, frozen_folders):
        for path in sorted(folder.glob("*/collection.json")):
            original = json.loads(path.read_text())
            if original["metadata"]["status"] == "partial":
                frozen_partial.append({"area":path.parent.name,"bbox":original["source"]["bbox"],
                    "original_manifest":str(path),"original_manifest_sha256":hashlib.sha256(path.read_bytes()).hexdigest(),
                    "original_status":"partial","original_records":original["metadata"]["fetched_count"]})
    if len(frozen_partial) != 12:
        raise ValueError("Expected the12frozen first-release capped query receipts")
    order = {item["id"]: index for index, item in enumerate(plan["partitions"])}
    paths = sorted(output.glob("*/collection.json"), key=lambda p:(order.get(p.parent.name,100000),p.parent.name))
    taxonomy = json.loads((Path(__file__).parent/"config/taxonomy.json").read_text())["industry_families"]
    targets = [(output/"next-release-incremental-place-candidates.csv.gz.partial", "net_new_place_candidates"),
        (output/"next-release-incremental-business-candidates.csv.gz.partial", "net_new_business_candidates"),
        (output/"next-release-configured-service-business-candidates.csv.gz.partial", "net_new_configured_business_candidates")]
    seen, counts, categories, cities, scopes = set(), Counter(), Counter(), Counter(), Counter()
    counts.update({"query_observations":0,"overlap_observations_between_next_queries":0,
        "unique_next_query_places_already_in_first_release":0,"net_new_place_candidates":0,
        "net_new_business_candidates":0,"net_new_configured_business_candidates":0})
    business_categories, business_cities, business_scopes = Counter(), Counter(), Counter()
    receipts, completed_boxes = [], []
    completed_ids = []
    with ExitStack() as stack:
        footprint = ServiceFootprint(geography_database)
        stack.callback(footprint.close)
        writers = [_writer(stack,path) for path,_ in targets]
        for manifest_path in paths:
            manifest = json.loads(manifest_path.read_text())
            metadata = manifest["metadata"]
            if manifest["source"]["release"] != PINNED_RELEASE or metadata.get("market_map_cohort") != COHORT:
                raise ValueError("Unexpected provider release or acquisition cohort in next-release folder")
            if metadata["status"] == "blocked":
                receipts.append({"query":manifest_path.parent.name,"status":"blocked","rows":0,"error":metadata.get("error")})
                continue
            row_file = _rows_path(manifest_path,manifest)
            if row_file.suffix != ".gz" or not manifest.get("rows_sha256"):
                raise ValueError("Every finished query must be compressed and SHA-verified before export")
            _verify_rows_integrity(row_file,manifest)
            input_rows, new_for_query = 0, 0
            with gzip.open(row_file,"rt",encoding="utf-8") as stream:
                for line in stream:
                    if not line.strip():
                        continue
                    row = json.loads(line)
                    identity = row["source_record_id"]
                    input_rows += 1
                    counts["query_observations"] += 1
                    if identity in seen:
                        counts["overlap_observations_between_next_queries"] += 1
                        continue
                    seen.add(identity)
                    if identity in baseline_ids:
                        counts["unique_next_query_places_already_in_first_release"] += 1
                        continue
                    new_for_query += 1
                    category = _category(row)
                    families = mapped_families(row.get("taxonomy") or "Overture Places",category,taxonomy)
                    provenance = row.get("source_provenance") or []
                    licences = sorted({str(item["license"]) for item in provenance if isinstance(item,dict) and item.get("license")})
                    phones = row.get("published_phones") or ([row["phone"]] if row.get("phone") else [])
                    scope = footprint.resolve(row.get("city"))
                    record = {"provider_gers_id":identity,"provider_release":PINNED_RELEASE,"record_type":"place_candidate",
                        **{key:row.get(key) for key in ("name","address","city","province","country","postal_code","latitude","longitude","website","observed_at","source_url")},
                        "phones_json":json.dumps(phones,ensure_ascii=False),"source_category":category,
                        "ssm_industry_families":";".join(families),"first_envelope":row.get("collection_scope") or manifest_path.parent.name,
                        "source_provenance_json":json.dumps(provenance,ensure_ascii=False,sort_keys=True),"licences_json":json.dumps(licences),
                        **scope,"outreach_eligibility":"research_only","campaign_ready":False}
                    serialized = {key:safe_cell(record.get(key)) for key in COLUMNS}
                    writers[0][0].writerow(serialized)
                    counts["net_new_place_candidates"] += 1
                    cities[str(row.get("city") or "")] += 1
                    categories[category] += 1
                    scopes[scope["service_footprint_status"]] += 1
                    counts["net_new_with_published_website"] += int(bool(row.get("website")))
                    counts["net_new_with_published_phone"] += int(bool(phones))
                    if not category:
                        counts["net_new_unknown_category_candidates"] += 1
                    if _non_organisation(category):
                        counts["net_new_explicit_non_organisation_places"] += 1
                        continue
                    writers[1][0].writerow(serialized)
                    counts["net_new_business_candidates"] += 1
                    business_cities[str(row.get("city") or "")] += 1
                    business_categories[category] += 1
                    business_scopes[scope["service_footprint_status"]] += 1
                    if scope["service_footprint_status"] == "configured_label_match":
                        writers[2][0].writerow(serialized)
                        counts["net_new_configured_business_candidates"] += 1
            if input_rows != metadata["fetched_count"]:
                raise ValueError("Query row count differs from frozen receipt")
            receipt = {"query":manifest_path.parent.name,"manifest":str(manifest_path),"bbox":manifest["source"]["bbox"],
                "status":metadata["status"],"source_query_exhausted":metadata["source_query_exhausted"],"rows":input_rows,
                "new_unique_vs_baseline_and_prior_queries":new_for_query,"rows_sha256":manifest["rows_sha256"],
                "compressed_sha256":manifest["rows_compressed_sha256"],"compressed_bytes":row_file.stat().st_size,
                "serialized_bytes":manifest["rows_uncompressed_bytes"],"elapsed_seconds":metadata["elapsed_seconds"],
                "stop_reason":metadata.get("stop_reason"),"limits":metadata["limits"]}
            receipts.append(receipt)
            if metadata["source_query_exhausted"]:
                completed_boxes.append(manifest["source"]["bbox"])
                completed_ids.append(manifest_path.parent.name)
            print(json.dumps({"export_query":manifest_path.parent.name,"rows":input_rows,"net_new_so_far":counts["net_new_place_candidates"]}),flush=True)
    counts["unique_places_in_next_query_artifacts"] = len(seen)
    counts["first_release_place_candidates"] = len(baseline_ids)
    counts["prospective_combined_provider_places_if_promoted"] = len(baseline_ids)+counts["net_new_place_candidates"]
    outputs = []
    for (partial,count_name),(_,hashing) in zip(targets,writers):
        digest, parsed_rows = hashlib.sha256(), 0
        with gzip.open(partial,"rb") as stream:
            def lines():
                for line in stream:
                    digest.update(line)
                    yield line.decode("utf-8")
            for _ in csv.DictReader(lines()):
                parsed_rows += 1
        if parsed_rows != counts[count_name] or digest.hexdigest() != hashing.digest.hexdigest():
            raise ValueError("Incremental export count or recovery hash mismatch")
        final = partial.with_name(partial.name.removesuffix(".partial"))
        partial.replace(final)
        outputs.append({"file":final.name,"rows":parsed_rows,"sha256":hashlib.sha256(final.read_bytes()).hexdigest(),"decompressed_sha256":digest.hexdigest()})
    for filename,label,all_counts,business_counts in (("city-summary.csv","published_locality",cities,business_cities),
            ("category-summary.csv","source_category",categories,business_categories),("scope-summary.csv","service_footprint_status",scopes,business_scopes)):
        path = output/filename
        with path.open("w",newline="",encoding="utf-8") as stream:
            writer = csv.writer(stream)
            writer.writerow([label,"net_new_place_candidates","net_new_business_candidates"])
            writer.writerows([safe_cell(value),count,business_counts[value]] for value,count in all_counts.most_common())
        outputs.append({"file":filename,"rows":len(all_counts),"sha256":hashlib.sha256(path.read_bytes()).hexdigest()})
    completion = []
    for item in frozen_partial:
        missing = uncovered_cells(item["bbox"],completed_boxes)
        completion.append({**item,"next_cohort_status":"covered_by_exhausted_replacement_queries" if not missing else "replacement_query_gap_remaining",
            "uncovered_cells_or_strict_seam_samples":missing,
            "scope":"Original retrieval rectangle only; no municipal polygon or complete-business claim."})
        if hashlib.sha256(Path(item["original_manifest"]).read_bytes()).hexdigest() != item["original_manifest_sha256"]:
            raise ValueError("Frozen first-release receipt changed during export")
    report = {"generated_at":_now(),"cohort":COHORT,"provider_release":PINNED_RELEASE,
        "baseline":baseline_receipt,"counts":dict(counts),"query_status_counts":dict(Counter(item["status"] for item in receipts)),
        "completed_query_ids":completed_ids,"first_release_cap_completion":completion,
        "original_capped_areas":len(completion),"original_capped_areas_with_remaining_query_gaps":sum(bool(item["uncovered_cells_or_strict_seam_samples"]) for item in completion),
        "source_artifacts":receipts,"output_files":outputs,"industry_crosswalk_version":CROSSWALK_VERSION,
        "requests":None,"bytes_fetched":None,"estimated_cost":0,"currency":None,"paid_service_calls":0,"model_tokens":0,
        "first_release_files_modified":False,"first_release_importer_modified":False,"main_database_writes":0,
        "release_status":"next_release_acquisition_only_not_promoted","campaign_ready":False,
        "limitations":["Source query exhaustion is not complete municipal territory or commercial-market coverage.",
            "All original first-release partial receipts remain frozen; completion uses exhausted replacement rectangles and strict-boundary overlap bridges.",
            "Net-new means provider GERS absent from the395352-place baseline; it does not mean a new legal company, buyer or operating site.",
            "Reported locations/categories/contact routes remain source observations and require verification.",
            "Official cloud-client request and transferred-byte counters are not instrumented and remain unknown.",
            "Configured service scope uses published locality/reference membership, not point-in-administrative-boundary or occupancy validation."]}
    _atomic(output/"next-release-summary.json",report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--summarize-only",action="store_true")
    parser.add_argument("--geography-database",type=Path)
    args = parser.parse_args()
    if not args.summarize_only:
        print(json.dumps(acquire(args.output, args.baseline), indent=2))
    print(json.dumps(summarize(args.output,args.baseline,geography_database=args.geography_database),indent=2))


if __name__ == "__main__":
    main()
