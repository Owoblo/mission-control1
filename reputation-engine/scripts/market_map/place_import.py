"""Stream durable Overture envelopes into the market map with global GERS keys."""
import hashlib
import gzip
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .places import ENVELOPES
from .store import digest, dumps, stable_id


class StoragePaused(RuntimeError):
    """A new import batch was held before SQLite writes for storage capacity."""
    def __init__(self, context):
        self.context = {"status": "storage_paused", **context}
        super().__init__("Storage paused before new batch: source_folder={source_folder}, area={area}, "
            "chunk={chunk}, free_bytes={free_bytes}, required_free_bytes={required_free_bytes}. "
            "Committed batches and acquired artifacts are intact; resume the same command after freeing space.".format(**self.context))


def _committed_batch(store, source_id, rows, metadata):
    """Recognise the store's exact replay identity without starting a write."""
    identity = {key: metadata[key] for key in ("observed_at", "captured_at", "started_at", "source_date",
        "adapter_name", "parser_version", "cursor_checkpoint", "batch_id", "attempt_id") if key in metadata}
    fingerprint = digest({"source": source_id, "rows": sorted(rows, key=dumps), "metadata": identity})
    run_id = str(metadata.get("run_id") or stable_id("source-run", source_id, fingerprint))
    prior = store.db.execute("SELECT fingerprint,status,result_json FROM source_runs WHERE id=?", (run_id,)).fetchone()
    if prior and prior["fingerprint"] == fingerprint and prior["status"] in ("completed", "partial", "ingested", "fixture", "replayed"):
        return {**json.loads(prior["result_json"]), "replayed": True}
    return None


def _guard_storage(store, rows, context):
    if store.path == ":memory:":
        return
    reserve = 256 * 1024 * 1024
    serialized_bytes = sum(len(dumps(row).encode("utf-8")) for row in rows)
    # Allow for raw evidence, assertion/index pages and WAL amplification. This
    # is a conservative operational reserve, not a prediction of exact DB growth.
    allowance = max(64 * 1024 * 1024, serialized_bytes * 16)
    directory = Path(store.path).resolve().parent
    available = shutil.disk_usage(directory).free
    if available < reserve + allowance:
        raise StoragePaused({**context, "database": str(Path(store.path).resolve()),
            "free_bytes": available, "required_free_bytes": reserve + allowance,
            "minimum_reserve_bytes": reserve, "batch_write_allowance_bytes": allowance,
            "serialized_batch_bytes": serialized_bytes, "batch_rows": len(rows)})


def _legacy_gers_mappings(store):
    """Recover publisher IDs from retained V2 payloads, not V2 site keys.

    The backfill deliberately keys source_identities by v2:<entity_id>. GERS IDs
    remain inside the historical payload, including compressed raw payloads.
    """
    prior = {}
    records = store.db.execute("""SELECT si.*,e.raw_record_id FROM source_identities si
        JOIN sources s ON s.id=si.source_id
        LEFT JOIN evidence e ON e.id=si.last_evidence_id
        WHERE s.adapter_name='legacy_v2' AND (s.name LIKE '%overture%' OR s.id LIKE '%overture%')""")
    for record in records:
        row = dict(record)
        payload = store.get_raw_payload(row["raw_record_id"]) if row.get("raw_record_id") else {}
        raw = payload.get("raw_payload") or {}
        properties = raw.get("properties") or {}
        gers = payload.get("external_id") or raw.get("external_id") or properties.get("id")
        if not gers and not row["source_record_id"].startswith("v2:"):
            gers = row["source_record_id"]
        if gers:
            prior.setdefault(str(gers), []).append(row)
    return prior


def review_cross_release_gers(store, source_id=None):
    """Add idempotent review links for already imported archived/current places."""
    prior = _legacy_gers_mappings(store)
    source_ids = [source_id] if source_id else [r[0] for r in store.db.execute("SELECT id FROM sources WHERE adapter_name='overture_places'")]
    matches = 0
    before = store.db.execute("SELECT COUNT(*) FROM review_queue WHERE issue_type='cross_release_gers_identity'").fetchone()[0]
    with store.transaction():
        for gers, archived in prior.items():
            for current_source in source_ids:
                current = store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?", (current_source, gers)).fetchone()
                for older in archived:
                    if current and current["organisation_id"] != older["organisation_id"]:
                        matches += 1
                        store.add_review("cross_release_gers_identity", [current["organisation_id"], older["organisation_id"]], [current["last_evidence_id"], older["last_evidence_id"]], "Same publisher GERS identifier across archived/current releases; verify parent/site identity before reversible merge")
    after = store.db.execute("SELECT COUNT(*) FROM review_queue WHERE issue_type='cross_release_gers_identity'").fetchone()[0]
    return {"archived_gers_ids": len(prior), "matched_cross_release_pairs": matches, "new_reviews": after-before}


def _hash_stream(stream):
    digest = hashlib.sha256()
    count = 0
    while True:
        block = stream.read(1024 * 1024)
        if not block:
            break
        digest.update(block)
        count += len(block)
    return digest.hexdigest(), count


def _rows_path(manifest_path, manifest):
    name = manifest.get("rows_file") or "normalised-records.jsonl"
    if Path(name).name != name:
        raise ValueError("Row artifact must be a sibling basename, not a path")
    path = manifest_path.parent/name
    if not path.exists() and name == "normalised-records.jsonl" and path.with_suffix(".jsonl.gz").exists():
        path = path.with_suffix(".jsonl.gz")
    return path


def _verify_rows_integrity(row_file, manifest):
    expected = manifest.get("rows_sha256")
    if not expected:
        return
    opener = gzip.open if row_file.suffix == ".gz" else open
    with opener(row_file, "rb") as stream:
        observed, byte_count = _hash_stream(stream)
    if observed != expected or byte_count != manifest.get("rows_uncompressed_bytes"):
        raise ValueError("Row artifact SHA256/byte integrity mismatch: " + str(row_file))


def compress_collection_artifacts(folder, *, remove_original=False, areas=None):
    """Losslessly compress this collector's JSONL, verifying before replacement.

    Caller must stop readers/writers first. Only normalised-records.jsonl siblings
    of Overture manifests are eligible. The complete original SHA256 and byte
    count are independently checked through gzip decompression before an original
    may be unlinked. Existing mismatching gzip artifacts are never overwritten.
    """
    report = {"files": [], "original_bytes": 0, "compressed_bytes": 0, "freed_bytes": 0}
    for manifest_path in sorted(Path(folder).glob("*/collection.json")):
        if areas is not None and manifest_path.parent.name not in areas:
            continue
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("source", {}).get("adapter_name") != "overture_places":
            continue
        original = manifest_path.parent/"normalised-records.jsonl"
        destination = original.with_suffix(".jsonl.gz")
        if original.is_symlink() or destination.is_symlink():
            raise ValueError("Refusing symlink row artifacts")
        if not original.exists():
            if destination.exists() and manifest.get("rows_sha256"):
                with gzip.open(destination, "rb") as stream:
                    recovered_hash, recovered_bytes = _hash_stream(stream)
                if recovered_hash != manifest["rows_sha256"] or recovered_bytes != manifest["rows_uncompressed_bytes"]:
                    raise ValueError("Existing compressed artifact failed integrity verification")
                report["files"].append({"area": manifest_path.parent.name, "rows_file": destination.name,
                    "replayed": True, "sha256": recovered_hash, "uncompressed_bytes": recovered_bytes,
                    "compressed_bytes": destination.stat().st_size})
            continue
        original_stat = original.stat()
        with original.open("rb") as stream:
            original_hash, original_bytes = _hash_stream(stream)
        temp = None
        if not destination.exists():
            temp = destination.with_name(destination.name+".tmp-"+uuid.uuid4().hex)
            with original.open("rb") as source, temp.open("xb") as raw:
                with gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=6, mtime=0) as zipped:
                    while True:
                        block = source.read(1024*1024)
                        if not block:
                            break
                        zipped.write(block)
                raw.flush()
                os.fsync(raw.fileno())
        candidate = temp or destination
        with gzip.open(candidate, "rb") as stream:
            recovered_hash, recovered_bytes = _hash_stream(stream)
        after = original.stat()
        if (original_hash != recovered_hash or original_bytes != recovered_bytes
                or (original_stat.st_ino, original_stat.st_size, original_stat.st_mtime_ns)
                != (after.st_ino, after.st_size, after.st_mtime_ns)):
            raise ValueError("Lossless verification failed or original changed; original preserved")
        if temp:
            temp.replace(destination)
        with destination.open("rb") as stream:
            compressed_hash, compressed_bytes = _hash_stream(stream)
        manifest.update(rows_file=destination.name, rows_encoding="gzip", rows_sha256=original_hash,
            rows_compressed_sha256=compressed_hash, rows_uncompressed_bytes=original_bytes,
            rows_compressed_bytes=compressed_bytes, lossless_compression_verified=True,
            compression_verified_at=datetime.now(timezone.utc).isoformat())
        manifest_temp = manifest_path.with_name(manifest_path.name+".tmp-"+uuid.uuid4().hex)
        with manifest_temp.open("x") as stream:
            stream.write(json.dumps(manifest, indent=2))
            stream.flush()
            os.fsync(stream.fileno())
        manifest_temp.replace(manifest_path)
        # The verified gzip and its manifest now exist durably before this step.
        if remove_original:
            original.unlink()
        report["original_bytes"] += original_bytes
        report["compressed_bytes"] += compressed_bytes
        report["freed_bytes"] += original_bytes-compressed_bytes if remove_original else -compressed_bytes
        report["files"].append({"area": manifest_path.parent.name, "rows_file": destination.name,
            "sha256": original_hash, "uncompressed_bytes": original_bytes,
            "compressed_bytes": compressed_bytes, "original_removed": remove_original})
    return report


def import_collections(store, folder, *, batch_size=500, progress=None):
    """Import manifests + JSONL produced by places.py; safe to rerun after a crash.

    Envelope overlaps are deduplicated deterministically before batching. Source
    metadata remains explicit about unmeasured S3 requests and transfer bytes.
    No live HTTP, CRM or outreach action occurs during this import.
    """
    if not 1 <= batch_size <= 2000:
        raise ValueError("Place import batch size must be1-2000")
    folder = Path(folder)
    manifests = {path.parent.name: path for path in folder.glob("*/collection.json")}
    areas = [a for a in ENVELOPES if a in manifests] + sorted(set(manifests)-set(ENVELOPES))
    seen = set()
    report = {"envelopes": [], "input_observations": 0, "unique_gers": 0,
              "overlap_observations": 0, "inserted_count": 0, "updated_count": 0,
              "quarantined_count": 0, "replayed_batches": 0, "live_network_requests": 0,
              "measurement_note": "This is local import only. Original official-client S3 HTTP request/transfer byte totals remain unknown; paid-service calls are zero."}
    # Old Overture evidence is not silently merged into current GERS mappings.
    # Review a reused publisher GERS ID across releases when old evidence exists.
    prior = _legacy_gers_mappings(store)
    for area in areas:
        manifest = json.loads(manifests[area].read_text())
        source = dict(manifest["source"])
        release = source.get("release") or source.get("source_date")
        source_id = "overture-" + str(release)
        source["id"] = source_id
        source["geography_scope"] = list(ENVELOPES)
        source.pop("bbox", None)
        source.pop("collection_scope", None)
        source["config"] = {**source, "collection_envelopes": ENVELOPES}
        store.upsert_source(source)
        metadata = manifest.get("metadata", {})
        row_file = _rows_path(manifests[area], manifest)
        area_report = {"area": area, "source_id": source_id, "input_rows": 0,
                       "unique_rows": 0, "overlap_rows": 0, "batches": [],
                       "acquisition_status": metadata.get("status"),
                       "source_query_exhausted": metadata.get("source_query_exhausted", False)}
        if not row_file.exists():
            area_report["error"] = metadata.get("error") or "No durable row artifact"
            report["envelopes"].append(area_report)
            continue
        # Verify the acquisition's persisted whole-file digest before committing
        # any batch. Gzip CRC alone cannot detect a rewritten but valid gzip file.
        _verify_rows_integrity(row_file, manifest)
        chunk, chunk_index = [], 0
        def submit():
            nonlocal chunk, chunk_index
            if not chunk:
                return
            identities = [row["source_record_id"] for row in chunk]
            batch_key = hashlib.sha256(json.dumps(identities).encode()).hexdigest()
            batch_meta = {**metadata,
                "batch_id": "overture:%s:%s:%s:%s" % (release, area, chunk_index, batch_key),
                "collection_scope": area, "collection_bbox": ENVELOPES.get(area),
                "original_acquisition_manifest": str(manifests[area]),
                "original_acquisition_elapsed_seconds": metadata.get("elapsed_seconds"),
                "elapsed_seconds": metadata.get("elapsed_seconds") if chunk_index == 0 else 0,
                "status": "partial", "coverage_complete": False,
                "expected_count": None, "requests": None, "bytes_fetched": None,
                "request_count_known": False, "transfer_bytes_known": False,
                "paid_service_calls": 0, "estimated_cost": 0,
                "cost_scope": "No paid-service calls; original compute/network cost unknown",
                "cursor_checkpoint": {"area": area, "chunk_index": chunk_index, "id_hash": batch_key}}
            result = _committed_batch(store, source_id, chunk, batch_meta)
            if result is None:
                _guard_storage(store, chunk, {"source_folder": str(folder), "area": area,
                    "chunk": chunk_index, "batch_id": batch_meta["batch_id"], "source_id": source_id})
                result = store.ingest(source_id, chunk, run_metadata=batch_meta)
            if result.get("replayed"):
                report["replayed_batches"] += 1
            else:
                for count in ("inserted_count", "updated_count", "quarantined_count"):
                    report[count] += result.get(count, 0)
            # Reused GERS across archived/current releases is a reviewable link,
            # not a domain/name merge or a retroactive company assertion.
            candidates = [r for r in chunk if r["source_record_id"] in prior]
            if candidates:
                with store.transaction():
                    for row in candidates:
                        current = store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?", (source_id, row["source_record_id"])).fetchone()
                        for older in prior[row["source_record_id"]]:
                            if current and current["organisation_id"] != older["organisation_id"]:
                                store.add_review("cross_release_gers_identity", [current["organisation_id"], older["organisation_id"]], [current["last_evidence_id"], older["last_evidence_id"]], "Same publisher GERS identifier across archived/current releases; verify parent/site identity before reversible merge")
            area_report["batches"].append({"batch": chunk_index, "rows": len(chunk), "run_id": result["run_id"], "replayed": result.get("replayed", False)})
            if progress:
                progress({"area": area, "batch": chunk_index, "rows": len(chunk), "ingestion": result})
            chunk, chunk_index = [], chunk_index + 1
        opener = gzip.open if row_file.suffix == ".gz" else open
        with opener(row_file, "rt", encoding="utf-8") as stream:
            for number, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                row = json.loads(line)
                gers = row.get("source_record_id") or row.get("external_id")
                if not gers:
                    raise ValueError("Missing GERS at %s:%s" % (row_file, number))
                area_report["input_rows"] += 1
                report["input_observations"] += 1
                identity = (release, gers)
                if identity in seen:
                    area_report["overlap_rows"] += 1
                    report["overlap_observations"] += 1
                    continue
                seen.add(identity)
                area_report["unique_rows"] += 1
                row["source_record_id"] = str(gers)
                row["external_id"] = str(gers)
                row["external_scheme"] = "overture_gers"
                row["entity_type"] = "place_candidate"
                row["collection_scope"] = area
                chunk.append(row)
                if len(chunk) >= batch_size:
                    submit()
        submit()
        if metadata.get("fetched_count") is not None and metadata["fetched_count"] != area_report["input_rows"]:
            raise ValueError("Durable row file does not match acquisition manifest: " + area)
        report["envelopes"].append(area_report)
    report["unique_gers"] = len(seen)
    return report
