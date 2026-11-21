"""Pinned Overture place-baseline collector, with durable per-envelope artifacts.

This optional connector uses Overture's official public GeoParquet client, not
the HTML transport. Its cloud library does not expose HTTP request or transfer
byte counters: those metrics stay unknown. Output bytes, accepted rows, release,
time limits, provenance and scope are explicit. Places remain candidates.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import signal
import socket
import time
from datetime import datetime, timezone
from pathlib import Path

PINNED_RELEASE = "2026-10-21.0"
ENVELOPES = {
    "windsor-essex": [-83.15, 41.95, -82.40, 42.40],
    "chatham-kent": [-82.70, 42.00, -81.50, 42.70],
    "sarnia-lambton": [-82.65, 42.65, -81.75, 43.25],
    "london-elgin-middlesex": [-81.65, 42.65, -80.80, 43.25],
    "woodstock-oxford": [-81.10, 42.70, -80.45, 43.35],
    "waterloo-guelph-wellington": [-80.85, 43.10, -80.05, 43.90],
    "toronto-gta-hamilton": [-80.20, 43.05, -78.50, 44.40],
    "ottawa-surrounding": [-76.55, 44.85, -75.10, 45.65],
    # Second-wave tiles correct geographic skew caused by hitting a large
    # catchment's cap early in the provider's storage order. These are collection
    # envelopes, not asserted municipality polygons or service boundaries.
    "toronto-core-west": [-79.65, 43.58, -79.40, 43.80],
    "toronto-core-east": [-79.40, 43.62, -79.12, 43.85],
    "toronto-north-york": [-79.56, 43.73, -79.20, 43.87],
    "mississauga": [-79.82, 43.48, -79.52, 43.75],
    "brampton": [-79.92, 43.61, -79.62, 43.88],
    "york-vaughan-richmond-hill": [-79.65, 43.76, -79.32, 44.05],
    "york-markham": [-79.42, 43.78, -79.12, 44.03],
    "york-northern": [-79.60, 44.00, -79.15, 44.42],
    "durham-urban": [-79.20, 43.78, -78.75, 44.05],
    "durham-rural": [-79.30, 44.00, -78.50, 44.45],
    "halton": [-80.05, 43.22, -79.58, 43.72],
    "guelph-wellington": [-80.62, 43.40, -80.00, 44.00],
    "stratford-perth": [-81.20, 43.20, -80.60, 43.90],
    "ottawa-east": [-75.70, 45.25, -75.05, 45.68],
    "ottawa-west": [-76.60, 45.10, -75.70, 45.60],
    # Rural-gap wave, justified by official named-place anchors and municipal
    # community lists. Boxes are retrieval bounds, not administrative polygons.
    "grand-bend-huron-coast": [-82.00, 43.24, -81.30, 43.65],
    "bayham-erie-lakeshore": [-81.10, 42.53, -80.64, 42.85],
    "norfolk-coast": [-80.65, 42.53, -80.00, 43.08],
    "brant-south-communities": [-80.62, 42.96, -80.20, 43.15],
    "northern-wellington-minto": [-81.05, 43.84, -80.45, 44.15],
    "western-lanark-highlands": [-76.95, 44.85, -76.45, 45.42],
}
PARENT_SCOPES = {
    **{area: "toronto-gta-hamilton" for area in ("toronto-core-west", "toronto-core-east", "toronto-north-york", "mississauga", "brampton", "york-vaughan-richmond-hill", "york-markham", "york-northern", "durham-urban", "durham-rural", "halton")},
    "guelph-wellington": "waterloo-guelph-wellington", "stratford-perth": "waterloo-guelph-wellington",
    "ottawa-east": "ottawa-surrounding", "ottawa-west": "ottawa-surrounding",
    "grand-bend-huron-coast": "sarnia-lambton",
    "bayham-erie-lakeshore": "london-elgin-middlesex", "norfolk-coast": "woodstock-oxford",
    "brant-south-communities": "waterloo-guelph-wellington",
    "northern-wellington-minto": "waterloo-guelph-wellington",
    "western-lanark-highlands": "ottawa-surrounding",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _atomic(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, indent=2, default=str))
    temp.replace(path)


def _read_durable_rows(path):
    """Recover a torn final JSONL write, never discard an interior corrupt row."""
    rows = []
    if not path.exists():
        return rows
    with path.open("r+b") as stream:
        while True:
            offset = stream.tell()
            line = stream.readline()
            if not line:
                break
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                if not line.endswith(b"\n") and stream.tell() == path.stat().st_size:
                    stream.truncate(offset)
                    stream.flush()
                    os.fsync(stream.fileno())
                    break
                raise ValueError("Corrupt interior place artifact; preserve and review before resuming")
    return rows


def normalize_place(feature, *, release, bbox, observed_at=None):
    props = feature.get("properties", {})
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates", [])
    if geometry.get("type") != "Point" or len(coordinates) != 2:
        raise ValueError("Place requires point geometry")
    x, y = coordinates
    if not all(isinstance(n, (int, float)) and math.isfinite(n) for n in (x, y)):
        raise ValueError("Non-finite place coordinate")
    if not (bbox[0] <= x <= bbox[2] and bbox[1] <= y <= bbox[3]):
        raise ValueError("Place outside configured envelope")
    name = (props.get("names") or {}).get("primary")
    gers = props.get("id")
    if not name or not gers:
        raise ValueError("Missing place name or GERS identifier")
    addresses = props.get("addresses") or []
    ontario = [a for a in addresses if a.get("country") == "CA" and str(a.get("region", "")).lower() in ("on", "ontario")]
    if not ontario:
        raise ValueError("Ontario relevance is not established by a CA/ON publisher address")
    address = ontario[0]
    taxonomy, legacy = props.get("taxonomy") or {}, props.get("categories") or {}
    primary = taxonomy.get("primary") or props.get("basic_category") or legacy.get("primary") or ""
    if isinstance(primary, dict):
        primary = primary.get("label") or primary.get("name") or json.dumps(primary, sort_keys=True)
    return {
        "name": name, "source_record_id": gers,
        "source_url": "https://stac.overturemaps.org/%s/catalog.json#gers=%s" % (release, gers),
        "website": (props.get("websites") or [""])[0],
        "city": address.get("locality") or "", "city_raw": address.get("locality") or "",
        "address": address.get("freeform") or "", "postal_code": address.get("postcode") or "",
        "province": "ON", "country": "CA", "latitude": y, "longitude": x,
        "coordinates_source": "Overture GERS:" + gers,
        "phone": (props.get("phones") or [""])[0], "email": "",
        "published_phones": props.get("phones") or [], "categories": primary,
        "taxonomy": "Overture Places", "taxonomy_version": release,
        "observed_at": observed_at or _now(), "external_id": gers,
        "external_scheme": "overture_gers", "entity_type": "place_candidate",
        "entity_kind": "place_candidate", "location_type": "unknown",
        "provider_existence_confidence": props.get("confidence"),
        "source_provenance": props.get("sources") or [],
        "raw_taxonomy": {"taxonomy": taxonomy, "basic_category": props.get("basic_category"), "categories": legacy},
        "raw_payload": feature,
        "scope_note": "Rough collection envelope, not an administrative boundary; place candidate, not a verified legal company or active buyer",
    }


def source_for(area, release=PINNED_RELEASE):
    return {
        "id": "overture-%s" % release,
        "name": "Overture places / Ontario service envelopes", "publisher": "Overture Maps Foundation and record contributors",
        "source_url": "https://stac.overturemaps.org/%s/catalog.json" % release,
        "source_type": "open_places", "geography_scope": list(ENVELOPES), "sector_scope": ["*"],
        "access_method": "documented_cloud_dataset", "retrieval_status": "accessible",
        "rights_status": "licensed_open", "cost_model": "free", "adapter_name": "overture_places",
        "source_date": release[:10], "refresh_interval": 30,
        "terms_url": "https://docs.overturemaps.org/attribution/",
        "attribution": "Overture Maps Foundation, overturemaps.org; contributor/source licence metadata retained on every record",
        "notes": "Pinned release. CDLA Permissive/Apache/CC0 as applicable per record and release. Bounding-box query includes only records with explicit CA/ON address. Not an all-business census.",
        "bbox": ENVELOPES[area], "collection_scope": area,
        "collection_parent_scope": PARENT_SCOPES.get(area, area), "release": release,
    }


def _feature(row):
    from shapely import wkb
    from shapely.geometry import mapping
    geometry = row.pop("geometry", None)
    if geometry is None:
        raise ValueError("No source geometry")
    return {"type": "Feature", "geometry": mapping(wkb.loads(geometry)), "properties": row}


def collect_area(area, output, *, release=PINNED_RELEASE, max_records=30000,
                 max_output_bytes=100_000_000, deadline_seconds=180, reader_factory=None):
    if area not in ENVELOPES:
        raise ValueError("Unknown configured collection envelope")
    if not 1 <= max_records <= 100000 or not 1 <= deadline_seconds <= 600:
        raise ValueError("Explicit bounded row/time limits required")
    if max_output_bytes < 1000:
        raise ValueError("Output byte cap too small")
    folder = Path(output)/area
    folder.mkdir(parents=True, exist_ok=True)
    manifest_path, rows_path = folder/"collection.json", folder/"normalised-records.jsonl"
    source = source_for(area, release)
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
    compressed_rows = rows_path.with_suffix(".jsonl.gz")
    if not rows_path.exists() and compressed_rows.exists():
        if not old or old.get("metadata", {}).get("status") != "completed":
            raise ValueError("Partial collection is losslessly gzip-compressed; decompress normalised-records.jsonl.gz to normalised-records.jsonl before resuming. Import accepts gzip directly.")
        digest = hashlib.sha256()
        recovered_bytes, rows = 0, []
        with gzip.open(compressed_rows, "rb") as stream:
            for line in stream:
                digest.update(line)
                recovered_bytes += len(line)
                if line.strip():
                    rows.append(json.loads(line))
        if old.get("rows_sha256") and (digest.hexdigest() != old["rows_sha256"] or recovered_bytes != old.get("rows_uncompressed_bytes")):
            raise ValueError("Compressed completed collection failed SHA256/byte integrity verification")
    else:
        rows = _read_durable_rows(rows_path)
    if manifest_path.exists():
        if old.get("source", {}).get("release") != release:
            raise ValueError("Release differs from durable artifact; choose a new output directory")
        if old.get("metadata", {}).get("status") == "completed":
            if len(rows) != old["metadata"]["fetched_count"]:
                raise ValueError("Completed place artifact count mismatch; review before replay")
            return {**old, "rows": rows, "replayed": True}
    seen = {row["source_record_id"] for row in rows}
    if len(rows) >= max_records:
        return {"source": source, "rows": rows,
            "metadata": {"status": "partial", "coverage_complete": False,
                "fetched_count": len(rows), "cursor_checkpoint": {"seen_gers": len(seen), "restart_scan_required": True},
                "coverage_note": "Record cap retained; raise the cap to continue this pinned envelope"}}
    started, observed, held = time.monotonic(), _now(), 0
    status, error, exhausted = "partial", None, False
    previous_handler = None
    def timeout(signum, frame):
        raise TimeoutError("Place collection deadline reached")
    if hasattr(signal, "SIGALRM"):
        previous_handler = signal.signal(signal.SIGALRM, timeout)
        signal.alarm(deadline_seconds)
    def snapshot():
        return {"source": source, "metadata": {
            "source_id": source["id"], "adapter_name": "overture_places", "parser_version": "market-map/overture1",
            "status": status, "coverage_complete": False,
            "source_query_exhausted": exhausted,
            "fetched_count": len(rows), "parsed_count": len(rows), "expected_count": None,
            "held_non_ontario_or_invalid": held, "requests": None, "bytes_fetched": None,
            "estimated_cost": 0, "paid_service_calls": 0, "model_tokens": 0,
            "output_bytes": rows_path.stat().st_size if rows_path.exists() else 0,
            "elapsed_seconds": round(time.monotonic()-started, 3), "observed_at": observed,
            "cursor_checkpoint": {"seen_gers": len(seen), "restart_scan_required": not exhausted},
            "collection_scope": area, "collection_parent_scope": PARENT_SCOPES.get(area, area),
            "limits": {"accepted_records": max_records, "output_bytes": max_output_bytes, "deadline_seconds": deadline_seconds},
            "coverage_note": "Pinned rough envelope, only explicit CA/ON addresses; source query traversal is not municipal/census completeness",
            "measurement_note": "Official client S3 internal HTTP request count and transferred bytes are not instrumented and remain unknown",
            "attribution": source["attribution"], "error": error}}
    try:
        if reader_factory is None:
            from overturemaps.core import record_batch_reader
            reader_factory = record_batch_reader
        socket.setdefaulttimeout(30)
        reader = reader_factory("place", tuple(ENVELOPES[area]), release, connect_timeout=10, request_timeout=30, stac=False)
        if reader is None:
            raise RuntimeError("No reader; not treated as empty geographic coverage")
        stop = False
        with rows_path.open("a") as stream:
            for batch in reader:
                for raw in batch.to_pylist():
                    try:
                        feature = _feature(raw)
                        row = normalize_place(feature, release=release, bbox=ENVELOPES[area], observed_at=observed)
                    except (ValueError, TypeError, KeyError):
                        held += 1
                        continue
                    row["collection_scope"] = area
                    row["collection_parent_scope"] = PARENT_SCOPES.get(area, area)
                    if row["source_record_id"] in seen:
                        continue
                    encoded = json.dumps(row, default=str) + "\n"
                    if len(rows) >= max_records or stream.tell()+len(encoded.encode()) > max_output_bytes:
                        stop = True
                        break
                    stream.write(encoded)
                    seen.add(row["source_record_id"])
                    rows.append(row)
                stream.flush()
                os.fsync(stream.fileno())
                _atomic(manifest_path, snapshot())
                print(json.dumps({"area": area, "accepted": len(rows), "held": held, "elapsed_seconds": round(time.monotonic()-started, 1)}), flush=True)
                if stop:
                    break
            else:
                exhausted = True
                status = "completed"
    except Exception as exc:
        error = str(exc)
        status = "partial" if rows else "blocked"
    finally:
        if previous_handler is not None:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, previous_handler)
    result = snapshot()
    _atomic(manifest_path, result)
    # Row file is the durable source of truth; avoid duplicating large source
    # payloads into every checkpoint manifest.
    result["rows"] = rows
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--area", action="append", choices=sorted(ENVELOPES))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release", default=PINNED_RELEASE)
    parser.add_argument("--max-records", type=int, default=30000)
    parser.add_argument("--max-output-bytes", type=int, default=100_000_000)
    parser.add_argument("--deadline-seconds", type=int, default=180)
    parser.add_argument("--compress", action="store_true", help="Verify and losslessly gzip each finished area's row file immediately")
    args = parser.parse_args()
    reports = []
    for area in args.area or list(ENVELOPES):
        result = collect_area(area, args.output, release=args.release, max_records=args.max_records,
            max_output_bytes=args.max_output_bytes, deadline_seconds=args.deadline_seconds)
        if args.compress:
            from .place_import import compress_collection_artifacts
            compressed = compress_collection_artifacts(args.output, remove_original=True, areas={area})
            print(json.dumps({"area": area, "lossless_compression": compressed}), flush=True)
        reports.append({"area": area, "source": result["source"], "metadata": result["metadata"]})
        print(json.dumps(reports[-1]), flush=True)
        _atomic(args.output/"index.json", reports)


if __name__ == "__main__":
    main()
