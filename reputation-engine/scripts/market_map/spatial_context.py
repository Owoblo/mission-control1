"""Derived reported-coordinate context against official municipal polygons.

This module writes separate draft artifacts only. It never changes canonical
city/address/coordinates, verifies occupancy, or proves that a place is a current
business. No hit means unknown against this selected polygon scope, not outside
Ontario. Ontario LIO MUNID identifiers are never called census CSD identifiers.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import sqlite3
import shutil
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlencode

from .geography import resolve_geography, municipality_for, normalise_locality
from .transport import Transport, SourceBlocked

LAYER_URL = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open03/MapServer/14"
HOST = "ws.lioservices.lrc.gov.on.ca"
NAMESPACE = "ontario:lio:munid:"
METHOD = "reported_coordinate_point_in_retrieved_official_municipal_polygon"


def _require_space(path, minimum):
    available = shutil.disk_usage(Path(path)).free
    if available < minimum:
        raise SourceBlocked(f"Storage pause: {available} bytes available; derived-artifact guard requires {minimum}. No canonical records changed.")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1048576), b""):
            digest.update(block)
    return digest.hexdigest()


def _save(path, value, *, pretty=True):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2 if pretty else None, separators=None if pretty else (",", ":"))
        handle.write("\n")
    temp.replace(path)


def service_scope(database, attribute_file=None):
    """Read configured municipalities/ancestors; review Hamilton from evidence."""
    db = sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    geographies = {r["id"]: dict(r) for r in db.execute("SELECT * FROM geographies")}
    configured = {r[0] for r in db.execute("SELECT DISTINCT geography_id FROM geography_service_areas")}
    selected, missing, unresolved = {}, {}, []
    for ident in configured:
        seen = set()
        current = ident
        while current in geographies and current not in seen:
            seen.add(current)
            row = geographies[current]
            if row["kind"] == "municipality":
                if row["official_id"] and row["official_id"].startswith(NAMESPACE):
                    code = row["official_id"][len(NAMESPACE):]
                    if not code.isdigit() or not 1 <= len(code) <= 5:
                        raise ValueError("Invalid source MUNID namespace value")
                    selected[code] = {"geography_id": current, "name": row["name"], "official_id": row["official_id"]}
                else:
                    missing[current] = row
                break
            current = row["parent_id"]
        else:
            unresolved.append(geographies[ident]["name"])
    reviews = []
    if attribute_file:
        attrs = json.loads(Path(attribute_file).read_text())
        rows = [f["attributes"] for f in attrs["features"]]
        city = [r for r in rows if str(r.get("MUNID")) == "25005"]
        township = [r for r in rows if str(r.get("MUNID")) == "14019"]
        for ident, row in list(missing.items()):
            parent = geographies.get(row["parent_id"], {})
            gta = db.execute("""SELECT 1 FROM geography_service_areas m JOIN geographies a ON a.id=m.service_area_id
                WHERE m.geography_id=? AND a.name LIKE '%GTA%'""", (ident,)).fetchone()
            if row["name"] == "Hamilton" and parent.get("name") == "Ontario" and gta and city and township:
                if not all(r.get("MUNICIPAL_NAME") == "CITY OF HAMILTON" and r.get("MUNICIPAL_TYPE") == "Single Tier Municipality" and not r.get("UPPER_TIER_MUNICIPALITY") for r in city):
                    raise ValueError("Hamilton city identifier review did not match official full name/type/parent")
                if not all(r.get("MUNICIPAL_NAME") == "TOWNSHIP OF HAMILTON" for r in township):
                    raise ValueError("Hamilton township distinction not established")
                selected["25005"] = {"geography_id": ident, "name": "Hamilton", "official_id": NAMESPACE + "25005", "review_decision": "configured_city_exact_publisher_full_name_type_and_parent"}
                reviews.append({"geography_id": ident, "reviewer": "Codex source-evidence review authorized by root", "before_official_id": row["official_id"],
                    "proposed_official_id": NAMESPACE + "25005", "publisher_full_name": "CITY OF HAMILTON", "excluded_different_municipality": {"official_id": NAMESPACE + "14019", "full_name": "TOWNSHIP OF HAMILTON"},
                    "evidence_file": str(attribute_file), "evidence_sha256": _hash(attribute_file), "source_url": LAYER_URL,
                    "reason": "Configured Hamilton is in the GTA service area and has Ontario as its administrative parent; official City Hamilton is single-tier with no upper-tier parent. Township Hamilton is a separate Northumberland municipality.",
                    "canonical_database_mutated": False})
                del missing[ident]
    db.close()
    if not selected:
        raise ValueError("No source-backed configured municipality identifiers available")
    return {"municipalities": selected, "missing_official_identifiers": [{"geography_id": i, "name": r["name"]} for i, r in missing.items()],
            "configured_labels_without_municipality_ancestor": sorted(unresolved), "identifier_namespace": NAMESPACE,
            "review_decisions": reviews, "canonical_database_mutated": False}


def acquire_boundaries(scope, output, *, transport, batch_size=20):
    """Fetch complete unsimplified GeoJSON for the explicit MUNID scope only."""
    folder = Path(output)
    folder.mkdir(parents=True, exist_ok=True)
    codes = sorted(scope["municipalities"])
    scope_hash = hashlib.sha256(json.dumps(codes).encode()).hexdigest()
    manifest_path, geo_path = folder / "polygon-source.json", folder / "municipal-polygons.geojson"
    if manifest_path.exists() and geo_path.exists():
        cached = json.loads(manifest_path.read_text())
        if cached.get("scope_hash") == scope_hash and cached.get("geojson_sha256") == _hash(geo_path) and cached.get("status") == "completed":
            return cached
        raise ValueError("Existing polygon artifact scope/hash changed; choose a new output directory")
    _save(folder / "municipality-scope.json", scope)
    def fetch(url, filename):
        response = transport.fetch(url, allowed_hosts=[HOST])
        (folder / filename).write_bytes(response.body)
        value = response.json()
        if value.get("error"):
            raise SourceBlocked("Official boundary service: " + str(value["error"]))
        return value
    metadata = fetch(LAYER_URL + "?f=json", "layer-metadata.json")
    if "open-government-licence-ontario" not in str(metadata.get("copyrightText", "")):
        raise SourceBlocked("Official layer reuse licence not established")
    if "geojson" not in str(metadata.get("supportedQueryFormats", "")).lower():
        raise SourceBlocked("Layer does not advertise GeoJSON queries")
    oid = next((f["name"] for f in metadata.get("fields", []) if f.get("type") == "esriFieldTypeOID"), None)
    maximum = int(metadata.get("maxRecordCount") or 0)
    if not oid or maximum < 1:
        raise SourceBlocked("Object ID / response limits missing")
    where = "MUNID IN (" + ",".join("'" + code + "'" for code in codes) + ")"
    base = LAYER_URL + "/query?"
    count = fetch(base + urlencode({"f": "json", "where": where, "returnCountOnly": "true"}), "polygon-count.json").get("count")
    inventory = fetch(base + urlencode({"f": "json", "where": where, "returnIdsOnly": "true"}), "polygon-ids.json")
    ids = inventory.get("objectIds") or []
    if count is None or len(ids) != len(set(ids)) or len(ids) != int(count) or not ids:
        raise SourceBlocked("Official polygon count/object-ID inventory does not reconcile")
    projected = fetch(base + urlencode({"f": "json", "where": where, "returnExtentOnly": "true", "outSR": "4326"}), "projected-extent.json")
    sr = (projected.get("extent") or {}).get("spatialReference") or {}
    if sr.get("wkid") != 4326 and sr.get("latestWkid") != 4326:
        raise SourceBlocked("Service did not confirm requested EPSG4326 output projection")
    size = min(batch_size, maximum)
    features, fetched_ids, retrieved_codes, pages = [], set(), set(), []
    fields = [oid, "MUNID", "MUNICIPAL_NAME", "MUNICIPAL_NAME_SHORTFORM", "MUNICIPAL_TYPE", "UPPER_TIER_MUNICIPALITY", "EFFECTIVE_DATETIME"]
    for offset in range(0, len(ids), size):
        chosen = sorted(ids)[offset:offset + size]
        filename = f"geometry-page-{offset:05d}.geojson"
        page = fetch(base + urlencode({"f": "geojson", "objectIds": ",".join(map(str, chosen)), "outFields": ",".join(fields),
            "returnGeometry": "true", "outSR": "4326"}), filename)
        if page.get("type") != "FeatureCollection" or page.get("exceededTransferLimit"):
            raise SourceBlocked("Geometry query failed or was truncated")
        returned = set()
        for feature in page.get("features", []):
            props = feature.get("properties") or {}
            ident = props.get(oid, feature.get("id"))
            if ident in returned or ident in fetched_ids:
                raise SourceBlocked("Duplicate polygon source object ID")
            returned.add(ident)
            code = str(props.get("MUNID"))
            if code not in scope["municipalities"]:
                raise SourceBlocked("Polygon outside requested MUNID scope")
            if (feature.get("geometry") or {}).get("type") not in {"Polygon", "MultiPolygon"}:
                raise SourceBlocked("Official polygon geometry missing/unsupported")
            retrieved_codes.add(code)
            features.append(feature)
        if returned != set(chosen):
            raise SourceBlocked("Returned polygon IDs do not match requested source IDs")
        fetched_ids.update(returned)
        pages.append({"path": filename, "sha256": _hash(folder / filename), "features": len(returned)})
    if fetched_ids != set(ids) or retrieved_codes != set(codes):
        raise SourceBlocked("Polygon collection incomplete for requested municipalities")
    _save(geo_path, {"type": "FeatureCollection", "features": features}, pretty=False)
    dates = defaultdict(set)
    for feature in features:
        value = feature["properties"].get("EFFECTIVE_DATETIME")
        if value is not None:
            dates[str(feature["properties"]["MUNID"])].add(datetime.fromtimestamp(value / 1000, timezone.utc).isoformat())
    manifest = {"status": "completed", "source_url": LAYER_URL, "terms_url": "https://www.ontario.ca/page/open-government-licence-ontario",
        "rights_status": "permitted", "attribution": "Contains information licensed under the Open Government Licence – Ontario.",
        "source_observed_at": _now(), "scope_hash": scope_hash, "selected_municipality_count": len(codes), "polygon_feature_count": len(features),
        "object_id_field": oid, "advertised_max_record_count": maximum, "source_native_spatial_reference": metadata.get("extent", {}).get("spatialReference"),
        "requested_output_spatial_reference": 4326, "validated_output_spatial_reference": sr, "geometry_simplification_requested": False,
        "geometry_precision_reduction_requested": False, "source_full_precision_retained": True,
        "geojson_path": geo_path.name, "geojson_sha256": _hash(geo_path), "raw_pages": pages,
        "municipality_effective_dates": {code: sorted(values) for code, values in dates.items()}, "transport": transport.metrics(),
        "scope_note": "Configured/ancestor municipality polygons only. No hit is unknown against this selected source scope, not outside Ontario. Coordinates and business occupancy remain unverified."}
    _save(manifest_path, manifest)
    return manifest


class PolygonIndex:
    def __init__(self, features, scope):
        from shapely.geometry import shape, box
        from shapely.prepared import prep
        from shapely.strtree import STRtree
        self.shapes, self.codes, self.invalid_shapes, self.invalid_codes = [], [], [], []
        self.scope = scope
        self.invalid_features = []
        for feature in features:
            geom = shape(feature["geometry"])
            code = str(feature["properties"]["MUNID"])
            if not geom.is_valid or geom.is_empty:
                self.invalid_features.append({"munid": code, "object_id": feature["properties"].get("OBJECTID"), "reason": "Invalid/empty source geometry retained without repair"})
                if not geom.is_empty:
                    self.invalid_shapes.append(box(*geom.bounds))
                    self.invalid_codes.append(code)
                continue
            if not (-180 <= geom.bounds[0] <= geom.bounds[2] <= 180 and -90 <= geom.bounds[1] <= geom.bounds[3] <= 90):
                raise ValueError("Polygon coordinates are not plausible longitude/latitude")
            self.shapes.append(geom)
            self.codes.append(code)
        if not self.shapes:
            raise ValueError("No valid polygon geometries available")
        self.tree = STRtree(self.shapes)
        self.prepared = [prep(geom) for geom in self.shapes]
        self.invalid_tree = STRtree(self.invalid_shapes) if self.invalid_shapes else None

    def locate(self, longitude, latitude):
        from shapely.geometry import Point
        if not all(isinstance(n, (int, float)) and math.isfinite(n) for n in (longitude, latitude)) or not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
            return {"status": "unknown_invalid_reported_coordinate", "municipality_code": None, "candidate_codes": []}
        point = Point(longitude, latitude)
        candidates, interiors, boundary = set(), set(), False
        for index in self.tree.query(point):
            geom = self.shapes[int(index)]
            prepared = self.prepared[int(index)]
            if prepared.covers(point):
                candidates.add(self.codes[int(index)])
                contains = prepared.contains(point)
                if contains:
                    interiors.add(self.codes[int(index)])
                boundary |= not contains
        invalid = {self.invalid_codes[int(i)] for i in self.invalid_tree.query(point) if self.invalid_shapes[int(i)].covers(point)} if self.invalid_tree is not None else set()
        if invalid:
            return {"status": "ambiguous_invalid_source_geometry", "municipality_code": None, "candidate_codes": sorted(candidates | invalid)}
        if len(candidates) > 1:
            return {"status": "ambiguous_overlapping_municipalities" if len(interiors) > 1 else "ambiguous_shared_boundary", "municipality_code": None, "candidate_codes": sorted(candidates)}
        if boundary and candidates:
            return {"status": "ambiguous_shared_boundary", "municipality_code": None, "candidate_codes": sorted(candidates)}
        if candidates:
            return {"status": "single_polygon_context", "municipality_code": next(iter(candidates)), "candidate_codes": sorted(candidates)}
        return {"status": "unknown_no_selected_polygon_hit", "municipality_code": None, "candidate_codes": []}


def derive_context(database, polygon_folder, collection_roots, output, *, release="2026-10-21.0", resume=False, min_free_bytes=1073741824):
    folder, polygon_folder = Path(output), Path(polygon_folder)
    folder.mkdir(parents=True, exist_ok=True)
    _require_space(folder, min_free_bytes)
    source = json.loads((polygon_folder / "polygon-source.json").read_text())
    scope = json.loads((polygon_folder / "municipality-scope.json").read_text())
    geo_path = polygon_folder / source["geojson_path"]
    if source["status"] != "completed" or _hash(geo_path) != source["geojson_sha256"]:
        raise ValueError("Polygon source is incomplete or changed")
    index = PolygonIndex(json.loads(geo_path.read_text())["features"], scope)
    db = sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    store = SimpleNamespace(db=db)
    geography_names = {r["id"]: r["name"] for r in db.execute("SELECT id,name FROM geographies")}
    locality_cache = {}
    inputs = []
    for root in collection_roots:
        for manifest_path in sorted(Path(root).rglob("collection.json")):
            manifest = json.loads(manifest_path.read_text())
            if manifest.get("source", {}).get("release") != release:
                continue
            data_path = manifest_path.parent / manifest.get("rows_file", "normalised-records.jsonl.gz")
            if not data_path.exists() or data_path.suffix != ".gz" or not manifest.get("lossless_compression_verified"):
                raise ValueError("Input is not a verified frozen gzip artifact: " + str(manifest_path))
            if _hash(data_path) != manifest.get("rows_compressed_sha256"):
                raise ValueError("Compressed input checksum mismatch: " + str(data_path))
            inputs.append((manifest_path, data_path, manifest))
    if not inputs:
        raise ValueError("No verified pinned-release place collections found")
    work_path = folder / "spatial-context-working.sqlite"
    if work_path.exists() and not resume:
        raise ValueError("Working artifact already exists; choose a new output directory")
    work = sqlite3.connect(work_path)
    work.row_factory = sqlite3.Row
    if work_path.exists() and resume:
        if work.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Owned derived scratch is inconsistent; preserve it and choose a new output directory")
    work.execute("PRAGMA journal_mode=DELETE")
    work.execute("PRAGMA synchronous=NORMAL")
    work.execute("PRAGMA cache_size=-8192")
    work.execute("""CREATE TABLE IF NOT EXISTS points(gers TEXT PRIMARY KEY,x REAL,y REAL,city TEXT,publisher_municipality TEXT,
        scope_status TEXT,assigned_code TEXT,candidates TEXT,comparison TEXT,review INTEGER,input_index INTEGER,
        line_number INTEGER,row_hash TEXT,observed_at TEXT,observations INTEGER DEFAULT 1,coordinate_conflict INTEGER DEFAULT 0)""")
    # Replay every verified input after a pause so observation counts and source
    # references remain exact even if interruption happened amid duplicates.
    work.execute("UPDATE points SET observations=0,coordinate_conflict=0")
    work.commit()
    input_receipts = []
    total = duplicates = duplicate_conflicts = 0
    conflict_path = folder / "duplicate-coordinate-conflicts.draft.csv.gz"
    conflict_handle = gzip.open(conflict_path, "wt", encoding="utf-8", newline="")
    conflict_writer = csv.DictWriter(conflict_handle, fieldnames=["gers", "first_longitude", "first_latitude", "conflicting_longitude", "conflicting_latitude", "first_input_manifest", "first_line", "first_row_sha256", "conflicting_input_manifest", "conflicting_line", "conflicting_row_sha256", "review_required"])
    conflict_writer.writeheader()
    for file_index, (manifest_path, data_path, manifest) in enumerate(inputs):
        digest = hashlib.sha256()
        count = 0
        with gzip.open(data_path, "rb") as handle:
            for line_number, line in enumerate(handle, 1):
                digest.update(line)
                if not line.strip():
                    continue
                row = json.loads(line)
                count += 1
                total += 1
                if total % 10000 == 0:
                    work.commit()
                    _require_space(folder, min_free_bytes)
                gers = str(row.get("source_record_id") or "")
                if not gers or row.get("taxonomy_version") != release:
                    raise ValueError("GERS identity/release missing or inconsistent")
                city = str(row.get("city_raw") or row.get("city") or "")
                x, y = row.get("longitude"), row.get("latitude")
                finite = all(isinstance(n, (int, float)) and math.isfinite(n) for n in (x, y))
                stored_x, stored_y = (x, y) if finite else (None, None)
                inserted = work.execute("INSERT OR IGNORE INTO points(gers,x,y,city) VALUES(?,?,?,?)", (gers, stored_x, stored_y, city)).rowcount
                if not inserted:
                    old = work.execute("SELECT x,y,coordinate_conflict,observations,input_index,line_number,row_hash FROM points WHERE gers=?", (gers,)).fetchone()
                    if old["observations"] == 0:
                        work.execute("UPDATE points SET x=?,y=?,city=?,observations=1 WHERE gers=?", (stored_x, stored_y, city, gers))
                        inserted = True
                if not inserted:
                    duplicates += 1
                    conflict = (old["x"], old["y"]) != (stored_x, stored_y)
                    duplicate_conflicts += int(conflict and not old["coordinate_conflict"])
                    if conflict:
                        conflict_writer.writerow({"gers": gers, "first_longitude": old["x"], "first_latitude": old["y"],
                            "conflicting_longitude": stored_x, "conflicting_latitude": stored_y,
                            "first_input_manifest": str(inputs[old["input_index"]][0]), "first_line": old["line_number"], "first_row_sha256": old["row_hash"],
                            "conflicting_input_manifest": str(manifest_path), "conflicting_line": line_number,
                            "conflicting_row_sha256": hashlib.sha256(line).hexdigest(), "review_required": True})
                    work.execute("""UPDATE points SET observations=observations+1,
                        coordinate_conflict=MAX(coordinate_conflict,?),review=MAX(COALESCE(review,0),?) WHERE gers=?""", (int(conflict), int(conflict), gers))
                    continue
                if city not in locality_cache:
                    locality_cache[city] = municipality_for(store, resolve_geography(store, city))
                publisher = locality_cache[city]
                located = index.locate(x, y)
                code = located["municipality_code"]
                assigned = scope["municipalities"].get(code, {})
                comparison = ("publisher_locality_unresolved" if not publisher else "agrees" if publisher == assigned.get("geography_id") else "conflict" if code else "inconclusive_no_unique_spatial_context")
                review = comparison == "conflict" or located["status"].startswith("ambiguous")
                work.execute("""UPDATE points SET publisher_municipality=?,scope_status=?,assigned_code=?,candidates=?,comparison=?,review=?,
                    input_index=?,line_number=?,row_hash=?,observed_at=? WHERE gers=?""", (publisher, located["status"], code,
                    json.dumps(located["candidate_codes"]), comparison, int(review), file_index, line_number,
                    hashlib.sha256(line).hexdigest(), row.get("observed_at"), gers))
        if count != manifest["metadata"]["fetched_count"] or digest.hexdigest() != manifest["rows_sha256"]:
            raise ValueError("Input record count/uncompressed checksum mismatch: " + str(data_path))
        work.commit()
        input_receipts.append({"manifest": str(manifest_path), "rows_path": str(data_path), "rows": count,
            "uncompressed_sha256": digest.hexdigest(), "compressed_sha256": manifest["rows_compressed_sha256"],
            "source_status": manifest["metadata"]["status"], "source_query_exhausted": manifest["metadata"].get("source_query_exhausted")})
    conflict_handle.close()
    fields = ["gers", "overture_release", "reported_longitude", "reported_latitude", "publisher_locality",
        "publisher_locality_municipality_id", "publisher_locality_municipality_name", "reported_coordinate_scope_status",
        "reported_coordinate_municipality_id", "reported_coordinate_municipality_name", "reported_coordinate_municipality_official_id",
        "candidate_municipality_official_ids", "publisher_locality_comparison", "needs_geography_review", "point_scope_method",
        "polygon_source_url", "polygon_source_sha256", "polygon_observed_at", "boundary_effective_dates", "point_observed_at",
        "input_manifest_reference", "input_line_number", "source_row_sha256", "observation_count", "source_coordinate_conflict",
        "canonical_values_overwritten", "business_or_occupancy_verified"]
    csv_path = folder / "reported-coordinate-context.draft.csv.gz"
    stats, comparisons, municipality_counts, unresolved = Counter(), Counter(), Counter(), Counter()
    with gzip.open(csv_path, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in work.execute("SELECT * FROM points WHERE observations>0 ORDER BY gers"):
            code = row["assigned_code"] if not row["coordinate_conflict"] else None
            assigned = scope["municipalities"].get(code, {})
            status = row["scope_status"] if not row["coordinate_conflict"] else "ambiguous_duplicate_reported_coordinates"
            comparison = row["comparison"] if not row["coordinate_conflict"] else "inconclusive_duplicate_reported_coordinates"
            stats[status] += 1
            comparisons[comparison] += 1
            if code:
                municipality_counts[assigned["name"]] += 1
                if not row["publisher_municipality"]:
                    unresolved[(row["city"], assigned["name"])] += 1
            record = {"gers": row["gers"], "overture_release": release, "reported_longitude": row["x"], "reported_latitude": row["y"],
                "publisher_locality": row["city"], "publisher_locality_municipality_id": row["publisher_municipality"],
                "publisher_locality_municipality_name": geography_names.get(row["publisher_municipality"]), "reported_coordinate_scope_status": status,
                "reported_coordinate_municipality_id": assigned.get("geography_id"), "reported_coordinate_municipality_name": assigned.get("name"),
                "reported_coordinate_municipality_official_id": assigned.get("official_id"),
                "candidate_municipality_official_ids": json.dumps([NAMESPACE + c for c in json.loads(row["candidates"] or "[]")]),
                "publisher_locality_comparison": comparison, "needs_geography_review": bool(row["review"]), "point_scope_method": METHOD,
                "polygon_source_url": source["source_url"], "polygon_source_sha256": source["geojson_sha256"], "polygon_observed_at": source["source_observed_at"],
                "boundary_effective_dates": json.dumps(source["municipality_effective_dates"].get(code, [])), "point_observed_at": row["observed_at"],
                "input_manifest_reference": input_receipts[row["input_index"]]["manifest"], "input_line_number": row["line_number"], "source_row_sha256": row["row_hash"],
                "observation_count": row["observations"], "source_coordinate_conflict": bool(row["coordinate_conflict"]),
                "canonical_values_overwritten": False, "business_or_occupancy_verified": False}
            writer.writerow({key: "'" + value if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@', '\t', '\r')) else value for key, value in record.items()})
    unique = work.execute("SELECT COUNT(*) FROM points WHERE observations>0").fetchone()[0]
    work.close()
    db.close()
    summary = {"status": "draft_for_root_review", "generated_at": _now(), "release": release, "input_files": len(inputs),
        "input_observations": total, "unique_gers": unique, "duplicate_observations": duplicates, "duplicate_coordinate_conflicts": duplicate_conflicts,
        "scope_status_counts": dict(stats), "publisher_locality_comparisons": dict(comparisons), "assigned_municipality_counts": dict(municipality_counts),
        "previously_unresolved_localities_with_unique_reported_coordinate_context": [{"publisher_locality": city, "derived_municipality": municipality, "gers_count": n} for (city, municipality), n in unresolved.most_common(100)],
        "invalid_source_geometries": index.invalid_features, "polygon_source": source, "scope_review_decisions": scope["review_decisions"],
        "inputs": input_receipts, "draft_csv": csv_path.name, "draft_csv_sha256": _hash(csv_path),
        "duplicate_coordinate_conflicts_csv": conflict_path.name, "duplicate_coordinate_conflicts_sha256": _hash(conflict_path),
        "canonical_database_mutated": False, "canonical_values_overwritten": 0, "is_business_or_occupancy_verification": False,
        "scope_note": "Point-in-polygon context uses reported, independently unverified provider coordinates and the retrieved boundary version. No hit is unknown against selected polygons, never proof of outside Ontario. Shared boundaries, overlaps and conflicting publisher locality require review. Draft requires root review before use/publication."}
    _save(folder / "spatial-context-summary.json", summary)
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--attribute-file", type=Path, required=True)
    parser.add_argument("--collection-root", action="append", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-geometry-bytes", type=int, default=50000000)
    parser.add_argument("--acquire-only", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--min-free-bytes", type=int, default=1073741824)
    args = parser.parse_args()
    scope = service_scope(args.database, args.attribute_file)
    transport = Transport(args.output / "polygons/http-cache", max_requests=100, max_bytes=args.max_geometry_bytes,
        max_response_bytes=args.max_geometry_bytes, timeout=40, min_interval=.25, retries=1)
    try:
        acquired = acquire_boundaries(scope, args.output / "polygons", transport=transport)
        print(json.dumps({"stage": "polygons", "features": acquired["polygon_feature_count"], "municipalities": acquired["selected_municipality_count"], "bytes_fetched": transport.bytes_fetched}), flush=True)
        if args.acquire_only:
            return
        result = derive_context(args.database, args.output / "polygons", args.collection_root, args.output / "derived", resume=args.resume, min_free_bytes=args.min_free_bytes)
        print(json.dumps({k: result[k] for k in ["status", "input_files", "input_observations", "unique_gers", "scope_status_counts", "publisher_locality_comparisons", "draft_csv"]}), flush=True)
    except Exception as error:
        _save(args.output / "blocked.json", {"status": "blocked", "error": str(error), "transport": transport.metrics(), "canonical_database_mutated": False})
        raise


if __name__ == "__main__":
    main()
