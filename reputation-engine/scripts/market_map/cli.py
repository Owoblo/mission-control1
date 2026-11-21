"""Operator commands for discovery, evidence review, and portable exports."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import uuid
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .store import MarketMap
from .sources import load_sources
from .transport import Transport, SourceBlocked, BudgetExceeded

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = ROOT / "partnership-system/state/market-map.sqlite"
RUNS = ROOT / "partnership-system/markets/ca/on/all-service-areas/runs"


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def emit(data):
    print(json.dumps(data, ensure_ascii=False, indent=2, default=str))


def save_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2, default=str)
        handle.write("\n")
    temporary.replace(path)


def default_output(label):
    return RUNS / datetime.now(timezone.utc).strftime("%Y-%m-%d") / label


def seed_sources(store, path=None, *, preserve_operational=True):
    seeded = []
    for config in load_sources(path):
        current = store.db.execute("SELECT * FROM sources WHERE id=?", (config["id"],)).fetchone()
        source = {**config, "config": config}
        if current:
            for field in ("retrieval_status", "last_checked_at", "last_success_at", "robots_checked_at"):
                if current[field] and (preserve_operational or not config.get(field)):
                    source[field] = current[field]
        seeded.append(store.upsert_source(source))
    return seeded


def source_config(store, source_id):
    row = store.db.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone()
    if row is None:
        raise ValueError("Unknown source; run init or sources --import first: " + source_id)
    config = json.loads(row["config_json"] or "{}")
    return {**config, **dict(row)}


def build_parser():
    parser = argparse.ArgumentParser(description="SSM commercial landscape discovery. Local research; no CRM writes or sends.")
    parser.add_argument("--database", type=Path, default=DEFAULT_DB)
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init", help="Migrate store and seed full service footprint, taxonomy, and sources")
    init.add_argument("--registry", type=Path)
    sources = sub.add_parser("sources", help="List registry, or import a reviewed registry JSON")
    sources.add_argument("--import", dest="registry", type=Path)
    sources.add_argument("--source")
    legacy = sub.add_parser("backfill", help="Read-only replay of historical Discovery V2 observations")
    legacy.add_argument("--legacy", type=Path, required=True)
    legacy.add_argument("--output", type=Path)
    snapshots = sub.add_parser("backfill-snapshots", help="Import original Windsor snapshots and evidence-linked related-company research tasks")
    snapshots.add_argument("--output", type=Path)
    institutions = sub.add_parser("import-schools", help="Import a licensed school batch and explicit school-board relationships")
    institutions.add_argument("batch", type=Path)
    institutions.add_argument("--source-registry", type=Path, required=True)
    charities = sub.add_parser("import-charities", help="Import saved licensed CRA annual-return observations; current status and physical premises stay unverified")
    charities.add_argument("folder", type=Path)
    charities.add_argument("--batch-size", type=int, default=500)
    charities.add_argument("--output", type=Path)
    rosters = sub.add_parser("import-institution-rosters", help="Import saved first-party institution/union facts and register held sources without network access")
    rosters.add_argument("folder", type=Path)
    rosters.add_argument("--output", type=Path)
    places = sub.add_parser("import-places", help="Stream acquired Overture envelope artifacts with stable cross-envelope GERS identities")
    places.add_argument("folder", type=Path)
    places.add_argument("--batch-size", type=int, default=500)
    places.add_argument("--output", type=Path)
    properties = sub.add_parser("import-properties", help="Apply saved first-party property/tenant factual-review batches and record held sources")
    properties.add_argument("path", type=Path)
    geography = sub.add_parser("import-geographies", help="Attach official municipality IDs from a saved licensed boundary attribute source")
    geography.add_argument("payload", type=Path)
    geography.add_argument("--source", type=Path, required=True)
    community = sub.add_parser("import-community-context", help="Apply an official community-to-municipality assertion without adding service commitments")
    community.add_argument("payload", type=Path)
    coordinate = sub.add_parser("import-coordinate-reviews", help="Append geographic quality reviews without replacing publisher locality or coordinates")
    coordinate.add_argument("payload", type=Path)
    sub.add_parser("compact", help="Losslessly compress existing large raw payloads with hash verification")
    audit = sub.add_parser("audit", help="Check stored provenance, graph references, payload recovery, and optional database integrity")
    audit.add_argument("--integrity", action="store_true")
    audit.add_argument("--expected-provider-count", type=int)
    audit.add_argument("--output", type=Path)
    collect = sub.add_parser("collect", help="Collect one configured permitted source with explicit limits")
    collect.add_argument("source")
    collect.add_argument("--max-records", type=int, default=10000)
    collect.add_argument("--max-pages", type=int, default=100)
    collect.add_argument("--max-requests", type=int, default=100)
    collect.add_argument("--max-bytes", type=int, default=100_000_000)
    collect.add_argument("--checkpoint", type=Path, help="Prior batch JSON; uses its continuation cursor")
    collect.add_argument("--output", type=Path)
    imported = sub.add_parser("import-batch", help="Ingest an adapter's saved rows/metadata JSON without network access")
    imported.add_argument("batch", type=Path)
    imported.add_argument("--source", help="Source ID if absent from batch metadata")
    imported.add_argument("--parser-revision", help="Reprocess the same acquired payload with a revised parser; incremental network meters are zero")
    relationships = sub.add_parser("relationships", help="Run a bounded, durable website relationship-discovery wave")
    relationships.add_argument("--seed", action="store_true", help="Queue source-reported websites from Ontario location candidates")
    relationships.add_argument("--organisation", action="append", help="Restrict seed to specific stable organisation IDs")
    relationships.add_argument("--seed-limit", type=int, default=10)
    relationships.add_argument("--max-jobs", type=int, default=20)
    relationships.add_argument("--max-requests", type=int, default=40)
    relationships.add_argument("--max-bytes", type=int, default=20_000_000)
    relationships.add_argument("--max-depth", type=int, default=2)
    relationships.add_argument("--pages-per-domain", type=int, default=20)
    relationships.add_argument("--wave", type=int, default=1)
    relationships.add_argument("--output", type=Path)
    report = sub.add_parser("report", help="Compute source/geography/sector coverage and research gaps")
    report.add_argument("--output", type=Path)
    exported = sub.add_parser("export", help="Write separate CSV/JSONL datasets and flattened account research view")
    exported.add_argument("--output", type=Path, required=True)
    review = sub.add_parser("reviews", help="List unresolved identity, geography and relationship issues")
    review.add_argument("--limit", type=int, default=50)
    query = sub.add_parser("query", help="Search the actual landscape by organisation, city, street, or source category")
    query.add_argument("--name")
    query.add_argument("--city")
    query.add_argument("--street")
    query.add_argument("--category")
    query.add_argument("--limit", type=int, default=50)
    sub.add_parser("classify", help="Map supported source taxonomy labels to SSM industry families with evidence")
    resolve = sub.add_parser("resolve", help="Record an evidence-backed reversible identity decision")
    resolve.add_argument("left")
    resolve.add_argument("right")
    resolve.add_argument("--decision", choices=["same_organisation", "different_organisation", "same_parent", "same_site", "uncertain"], required=True)
    resolve.add_argument("--reason", required=True)
    resolve.add_argument("--reviewer", required=True)
    resolve.add_argument("--evidence", action="append", required=True)
    reverse = sub.add_parser("reverse-resolution", help="Reverse a reviewed identity link while preserving its audit history")
    reverse.add_argument("resolution_id")
    reverse.add_argument("--reason", required=True)
    reverse.add_argument("--reviewer", required=True)
    crm = sub.add_parser("crm-dry-run", help="Compare a local CRM snapshot; never writes CRM records")
    crm.add_argument("snapshot", type=Path)
    crm.add_argument("--output", type=Path, required=True)
    return parser


def run(args):
    with MarketMap(args.database) as store:
        if args.command == "init":
            from .geography import seed_geographies
            sources = seed_sources(store, args.registry)
            geographies = seed_geographies(store, ROOT)
            return {"database": str(args.database), "source_count": len(sources), "geography": geographies,
                    "paid_services": "disabled", "crm_mutation": False}
        if args.command == "sources":
            if args.registry:
                seed_sources(store, args.registry, preserve_operational=False)
            if args.source:
                return source_config(store, args.source)
            return [dict(row) for row in store.db.execute("SELECT id,name,source_type,geography_scope,retrieval_status,rights_status,adapter_name,last_success_at FROM sources ORDER BY id")]
        if args.command == "backfill":
            result = store.backfill_legacy(args.legacy)
            output = args.output or default_output("legacy-backfill") / "report.json"
            save_json(output, result)
            return {key: value for key, value in result.items() if key != "runs"} | {"report": str(output)}
        if args.command == "backfill-snapshots":
            from .legacy import backfill_windsor_snapshots
            output = args.output or default_output("windsor-snapshot-backfill")
            result = backfill_windsor_snapshots(store, ROOT, output)
            return {key: value for key, value in result.items() if key != "runs"} | {"report_directory": str(output)}
        if args.command == "import-schools":
            from .institutions import ingest_school_batch
            configs = load_sources(args.source_registry)
            batch = json.loads(args.batch.read_text())
            source_id = batch.get("metadata", {}).get("source_id")
            source = next((row for row in configs if row["id"] == source_id), None)
            if source is None:
                raise ValueError("School batch source is missing from registry")
            seed_sources(store, args.source_registry)
            return ingest_school_batch(store, batch, source)
        if args.command == "import-charities":
            from .institution_sources import apply_charity_acquisition
            from .place_import import StoragePaused
            output = args.output or default_output("charities-import") / "report.json"
            def progress(event):
                save_json(output.with_suffix(".checkpoint.json"), {"at": timestamp(), "completed": False,
                    "folder": str(args.folder), "batch_size": args.batch_size, **event,
                    "resume": "Repeat import-charities with the same folder and batch size; each committed batch replays safely."})
                if event["processed_rows"] % 5000 < event["batch_rows"]:
                    print(json.dumps({"progress": "charity_import", **event}), file=sys.stderr, flush=True)
            try:
                result = apply_charity_acquisition(store, args.folder, batch_size=args.batch_size, progress=progress)
            except StoragePaused as error:
                save_json(output.with_suffix(".paused.json"), error.context)
                return error.context
            save_json(output, result)
            save_json(output.with_suffix(".checkpoint.json"), {"at": timestamp(), "completed": True,
                "folder": str(args.folder), "batch_size": args.batch_size, "rows": result["rows"], "report": str(output)})
            return {**result, "report": str(output)}
        if args.command == "import-institution-rosters":
            from .institution_sources import apply_roster_acquisitions
            from .place_import import StoragePaused
            output = args.output or default_output("institution-roster-import") / "report.json"
            def progress(event):
                save_json(output.with_suffix(".checkpoint.json"), {"at": timestamp(), "completed": False,
                    "folder": str(args.folder), "last_committed_source": event})
                print(json.dumps({"progress": "institution_roster_import", **event}), file=sys.stderr, flush=True)
            try:
                results = apply_roster_acquisitions(store, args.folder, progress=progress)
            except StoragePaused as error:
                save_json(output.with_suffix(".paused.json"), error.context)
                return error.context
            result = {"sources": results, "records_imported": sum(row["records_imported"] for row in results),
                "new_organisations": sum(row.get("new_organisations", 0) for row in results),
                "physical_locations_asserted": 0}
            save_json(output, result)
            save_json(output.with_suffix(".checkpoint.json"), {"at": timestamp(), "completed": True,
                "folder": str(args.folder), "report": str(output)})
            return {**result, "report": str(output)}
        if args.command == "import-places":
            from .place_import import import_collections, StoragePaused
            output = args.output or default_output("places-import") / "report.json"
            processed = 0
            def progress(event):
                nonlocal processed
                processed += event["rows"]
                save_json(output.with_suffix(".checkpoint.json"), {"at": timestamp(),
                    "folder": str(args.folder), "database": str(args.database), "batch_size": args.batch_size,
                    "processed_rows": processed, "last_committed_area": event["area"],
                    "last_committed_batch": event["batch"], "run_id": event["ingestion"]["run_id"],
                    "completed": False, "resume": "Repeat this import-places command with the same folder and batch size; committed batches replay safely."})
                if processed % 5000 < event["rows"]:
                    print(json.dumps({"progress": "place_import", "processed": processed, "area": event["area"]}), file=sys.stderr, flush=True)
            try:
                result = import_collections(store, args.folder, batch_size=args.batch_size, progress=progress)
            except StoragePaused as error:
                save_json(output.with_suffix(".paused.json"), error.context)
                return error.context
            save_json(output, result)
            save_json(output.with_suffix(".checkpoint.json"), {"at": timestamp(), "completed": True,
                "folder": str(args.folder), "batch_size": args.batch_size, "report": str(output),
                "input_observations": result["input_observations"], "unique_gers": result["unique_gers"]})
            summary = {key: value for key, value in result.items() if key != "envelopes"}
            summary["envelopes"] = [{key: value for key, value in envelope.items() if key != "batches"} for envelope in result["envelopes"]]
            summary["report"] = str(output)
            return summary
        if args.command == "import-properties":
            from .property_sources import apply_property_batch
            paths = sorted(args.path.glob("*.json")) if args.path.is_dir() else [args.path]
            results = []
            for path in paths:
                batch = json.loads(path.read_text())
                if "records" not in batch or not isinstance(batch.get("source"), dict):
                    continue
                results.append({"batch": str(path), **apply_property_batch(store, batch)})
            return {"batches": len(results), "results": results}
        if args.command == "import-geographies":
            from .geography_official import apply_official_geographies
            payload = json.loads(args.payload.read_text())
            source = json.loads(args.source.read_text())
            if "sources" in source:
                source = source["sources"][0]
            return apply_official_geographies(store, payload, source, create_missing=True)
        if args.command == "import-community-context":
            from .context import apply_community_batch
            return apply_community_batch(store, json.loads(args.payload.read_text()))
        if args.command == "import-coordinate-reviews":
            from .context import import_coordinate_reviews
            return import_coordinate_reviews(store, json.loads(args.payload.read_text()))
        if args.command == "compact":
            return store.compact_existing_raw()
        if args.command == "audit":
            from .audit import audit_store
            result = audit_store(store, integrity=args.integrity, expected_provider_count=args.expected_provider_count)
            if args.output:
                save_json(args.output, result)
            return result
        if args.command == "collect":
            from .adapters import collect
            source = source_config(store, args.source)
            output = args.output or default_output("collect-" + args.source)
            output.mkdir(parents=True, exist_ok=True)
            checkpoint = None
            recovered = None
            if args.checkpoint:
                prior = json.loads(args.checkpoint.read_text())
                if prior.get("metadata", {}).get("source_id", args.source) != args.source:
                    raise ValueError("Checkpoint belongs to a different source")
                checkpoint = prior.get("metadata", {}).get("cursor_checkpoint", prior)
                # Recovery checkpoints are written before ingestion. Preserve
                # their fetched rows before advancing beyond that cursor.
                if prior.get("rows"):
                    prior_metadata = dict(prior.get("metadata", {}))
                    prior_metadata.setdefault("acquisition_id", "saved-batch-" + hashlib.sha256(json.dumps(prior, sort_keys=True).encode()).hexdigest())
                    recovered = store.ingest(args.source, prior["rows"], run_metadata=prior_metadata)
                prior_meta = prior.get("metadata", {})
                if prior_meta.get("status") == "completed" and (prior_meta.get("coverage_complete") or prior_meta.get("source_query_exhausted")):
                    return {"status": "completed", "replayed": True, "recovered_batch": recovered,
                            "checkpoint": str(args.checkpoint), "transport": {"requests": 0, "bytes_fetched": 0},
                            "note": "Saved completed acquisition replayed without fetching the source again."}
            transport = Transport(output / "http-cache", max_requests=args.max_requests, max_bytes=args.max_bytes)
            acquisition_id = uuid.uuid4().hex
            def persist_progress(partial):
                partial.setdefault("metadata", {})["acquisition_id"] = acquisition_id
                save_json(output / "recovery-batch.json", partial)
            try:
                if source.get("adapter_name") == "toronto_ckan_licences":
                    from .toronto_licences import collect_toronto_licences
                    batch = collect_toronto_licences(source, transport=transport, output_path=output / "ckan-pages",
                        max_records=args.max_records, max_pages=args.max_pages, page_size=5000)
                else:
                    batch = collect(source, transport=transport, checkpoint=checkpoint,
                                    max_records=args.max_records, max_pages=args.max_pages,
                                    progress=persist_progress)
                batch.setdefault("metadata", {})["source_id"] = args.source
                batch["metadata"]["acquisition_id"] = acquisition_id
                batch["metadata"].setdefault("elapsed_seconds", transport.metrics().get("elapsed_seconds"))
                batch["attribution"] = {"publisher": source.get("publisher"), "source_url": source.get("source_url"),
                    "terms_url": source.get("terms_url"), "rights_status": source.get("rights_status"),
                    "licence": source.get("licence") or source.get("license")}
                batch_path = output / ("batch-" + hashlib.sha256(json.dumps(batch, sort_keys=True, default=str).encode()).hexdigest()[:16] + ".json")
                save_json(batch_path, batch)
                result = store.ingest(args.source, batch["rows"], run_metadata=batch["metadata"])
                save_json(output / "latest-checkpoint.json", batch)
                save_json(output / "ingestion.json", result)
                return {"batch": str(batch_path), "ingestion": result, "recovered_batch": recovered, "transport": transport.metrics()}
            except (SourceBlocked, BudgetExceeded) as error:
                result = store.record_run_failure(args.source, str(error), run_metadata=transport.metrics(),
                                                 status="budget_paused" if isinstance(error, BudgetExceeded) else "blocked")
                save_json(output / "blocked.json", result)
                return {**result, "transport": transport.metrics()}
        if args.command == "import-batch":
            batch = json.loads(args.batch.read_text())
            source_id = args.source or batch.get("metadata", {}).get("source_id") or batch.get("source_id")
            if not source_id:
                raise ValueError("Saved batch requires metadata.source_id or --source")
            metadata = dict(batch.get("metadata", {}))
            if args.parser_revision:
                metadata.update({"parser_version": args.parser_revision, "requests": 0, "bytes_fetched": 0,
                    "estimated_cost": 0, "elapsed_seconds": 0,
                    "reprocessed_from_batch": str(args.batch), "acquisition_meters": "accounted in original collection run"})
            return store.ingest(source_id, batch["rows"], run_metadata=metadata)
        if args.command == "relationships":
            from .relationships import RelationshipWave
            output = args.output or default_output("relationships-wave-" + str(args.wave))
            output.mkdir(parents=True, exist_ok=True)
            # Persist only bounded extracts for websites; whole-page disk cache is disabled.
            transport = Transport(max_requests=args.max_requests, max_bytes=args.max_bytes)
            wave = RelationshipWave(store, transport, max_depth=args.max_depth,
                                    pages_per_domain=args.pages_per_domain, wave=args.wave)
            seeded = wave.seed(args.organisation, args.seed_limit) if args.seed else 0
            result = wave.run(args.max_jobs)
            result["seeded"] = seeded
            result["at"] = timestamp()
            save_json(output / ("wave-" + result["at"].replace(":", "-") + ".json"), result)
            return result
        if args.command == "report":
            from .reporting import coverage_report
            report = coverage_report(store)
            if args.output:
                save_json(args.output, report)
                return {"report": str(args.output), "counts": report["counts"],
                        "coverage_status_counts": report["coverage_status_counts"],
                        "run_costs": report["run_costs"]}
            return report
        if args.command == "export":
            from .reporting import export_all
            return export_all(store, args.output)
        if args.command == "reviews":
            if not 1 <= args.limit <= 10000:
                raise ValueError("Review limit must be 1–10000")
            return [dict(row) for row in store.db.execute("SELECT * FROM review_queue WHERE status IN ('pending','open') ORDER BY created_at,id LIMIT ?", (args.limit,))]
        if args.command == "query":
            from .queries import query_landscape
            return query_landscape(store, name=args.name, city=args.city, street=args.street,
                                   category=args.category, limit=args.limit)
        if args.command == "classify":
            from .classify import classify
            return classify(store)
        if args.command == "resolve":
            if not hasattr(store, "record_resolution"):
                raise ValueError("Resolution API is not available in this schema version")
            return store.record_resolution(args.left, args.right, args.decision,
                                           evidence_ids=args.evidence, reason=args.reason, reviewer=args.reviewer)
        if args.command == "reverse-resolution":
            return store.reverse_resolution(args.resolution_id, reason=args.reason, reviewer=args.reviewer)
        if args.command == "crm-dry-run":
            from .crm import dry_run
            return dry_run(store, args.snapshot, args.output)
        raise ValueError("Unknown command")


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        result = run(args)
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError, sqlite3.Error) as error:
        print(json.dumps({"error": str(error), "command": args.command}), file=sys.stderr)
        return 1
    emit(result)
    return 2 if isinstance(result, dict) and (result.get("status") in ("blocked", "budget_paused", "storage_paused") or result.get("passed") is False) else 0


if __name__ == "__main__":
    sys.exit(main())
