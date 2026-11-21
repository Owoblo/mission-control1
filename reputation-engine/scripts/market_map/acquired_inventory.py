"""Usable provider-baseline exports from frozen acquisitions, without SQL writes.

GERS identity is a provider place identity. These exports never certify legal
companies or confer campaign eligibility. Unknown categories remain candidates.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import sqlite3
from collections import Counter
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path

from .classify import NON_ORGANISATION, mapped_families, VERSION as CROSSWALK_VERSION
from .place_import import _rows_path, _verify_rows_integrity, _hash_stream
from .places import ENVELOPES
from .geography import resolve_geography, municipality_for

COLUMNS = ["provider_gers_id", "provider_release", "record_type", "name", "address", "city",
    "province", "country", "postal_code", "latitude", "longitude", "website", "phones_json",
    "source_category", "ssm_industry_families", "observed_at", "source_url", "first_envelope",
    "source_provenance_json", "licences_json", "service_footprint_status", "configured_catchments",
    "outreach_eligibility", "campaign_ready"]


class ServiceFootprint:
    """Read only the geography reference, never initialise or mutate MarketMap."""
    def __init__(self, database=None):
        self.db = None
        self.cache = {}
        self.memberships = {}
        self.database = str(Path(database).resolve()) if database else None
        if database:
            self.db = sqlite3.connect(Path(database).resolve().as_uri()+"?mode=ro", uri=True)
            self.db.row_factory = sqlite3.Row
            self.db.execute("PRAGMA query_only=ON")
            for row in self.db.execute("""SELECT m.geography_id,g.name
                FROM geography_service_areas m JOIN geographies g ON g.id=m.service_area_id""").fetchall():
                self.memberships.setdefault(row["geography_id"], set()).add(row["name"])

    def close(self):
        if self.db:
            self.db.close()

    def resolve(self, value):
        label = str(value or "")
        if label in self.cache:
            return self.cache[label]
        result = {"service_footprint_status": "scope_review_required", "configured_catchments": ""}
        if self.db:
            locality = resolve_geography(self, label)
            municipality = municipality_for(self, locality) if locality else None
            catchments = set(self.memberships.get(locality, ())) | set(self.memberships.get(municipality, ()))
            if locality and catchments:
                result = {"service_footprint_status": "configured_label_match", "configured_catchments": ";".join(sorted(catchments))}
            elif municipality:
                official = self.db.execute("SELECT official_id FROM geographies WHERE id=?", (municipality,)).fetchone()
                if official and official["official_id"]:
                    result = {"service_footprint_status": "outside_configured_footprint", "configured_catchments": ""}
        self.cache[label] = result
        return result


def safe_cell(value):
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    text = str(value)
    return "'"+text if text.lstrip().startswith(("=", "+", "-", "@")) else text


class _HashingWriter:
    def __init__(self, stream):
        self.stream = stream
        self.digest = hashlib.sha256()
        self.bytes = 0

    def write(self, text):
        encoded = text.encode("utf-8")
        self.digest.update(encoded)
        self.bytes += len(encoded)
        return self.stream.write(text)


def _writer(stack, path):
    raw = stack.enter_context(path.open("wb"))
    compressed = stack.enter_context(gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=6, mtime=0))
    text = stack.enter_context(io.TextIOWrapper(compressed, encoding="utf-8", newline=""))
    hashing = _HashingWriter(text)
    writer = csv.DictWriter(hashing, fieldnames=COLUMNS)
    writer.writeheader()
    return writer, hashing


def _category(row):
    value = row.get("categories") or ""
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)


def _non_organisation(category):
    controlled = re.sub(r"[^a-z0-9]+", "_", category.casefold()).strip("_")
    return controlled in NON_ORGANISATION


def build_inventory(folders, output, *, expected_unique=None, expected_files=None, geography_database=None,
                    expected_business_candidates=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    manifests = []
    order = {area: index for index, area in enumerate(ENVELOPES)}
    for folder in map(Path, folders):
        manifests.extend(sorted(folder.glob("*/collection.json"), key=lambda p: (order.get(p.parent.name, 10000), p.parent.name)))
    if not manifests or (expected_files is not None and len(manifests) != expected_files):
        raise ValueError("Acquisition manifest count mismatch: found %s" % len(manifests))
    taxonomy = json.loads((Path(__file__).parent/"config/taxonomy.json").read_text())["industry_families"]
    seen = set()
    city_counts, category_counts = Counter(), Counter()
    city_business, category_business = Counter(), Counter()
    industry_counts, input_notes = Counter(), []
    scope_counts, scope_business, scope_configured = Counter(), Counter(), Counter()
    counts = Counter()
    all_path, business_path = output/"all-place-candidates.csv.gz.partial", output/"organisation-business-candidates.csv.gz.partial"
    configured_path = output/"configured-service-area-business-candidates.csv.gz.partial"
    started = datetime.now(timezone.utc).isoformat()
    with ExitStack() as stack:
        footprint = ServiceFootprint(geography_database)
        stack.callback(footprint.close)
        all_writer, all_hash = _writer(stack, all_path)
        business_writer, business_hash = _writer(stack, business_path)
        configured_writer, configured_hash = _writer(stack, configured_path)
        for manifest_path in manifests:
            manifest = json.loads(manifest_path.read_text())
            row_path = _rows_path(manifest_path, manifest)
            if not row_path.exists():
                raise ValueError("Missing acquired row file: "+str(row_path))
            _verify_rows_integrity(row_path, manifest)
            with row_path.open("rb") as stream:
                stored_hash, stored_bytes = _hash_stream(stream)
            release = manifest["source"].get("release") or manifest["source"].get("source_date")
            if not release:
                raise ValueError("Pinned release missing: "+str(manifest_path))
            opener = gzip.open if row_path.suffix == ".gz" else open
            input_rows, input_new = 0, 0
            with opener(row_path, "rt", encoding="utf-8") as stream:
                for line in stream:
                    if not line.strip():
                        continue
                    row = json.loads(line)
                    gers = row.get("source_record_id") or row.get("external_id")
                    if not gers:
                        raise ValueError("Missing provider place identity in "+str(row_path))
                    input_rows += 1
                    counts["input_observations"] += 1
                    identity = (str(release), str(gers))
                    if identity in seen:
                        counts["overlap_observations"] += 1
                        continue
                    seen.add(identity)
                    input_new += 1
                    category = _category(row)
                    families = mapped_families(row.get("taxonomy") or "Overture Places", category, taxonomy)
                    provenance = row.get("source_provenance") or []
                    licences = sorted({str(p["license"]) for p in provenance if isinstance(p, dict) and p.get("license")})
                    phones = row.get("published_phones") or ([row["phone"]] if row.get("phone") else [])
                    scope = footprint.resolve(row.get("city"))
                    record = {
                        "provider_gers_id": gers, "provider_release": release, "record_type": "place_candidate",
                        "name": row.get("name"), "address": row.get("address"), "city": row.get("city"),
                        "province": row.get("province"), "country": row.get("country"), "postal_code": row.get("postal_code"),
                        "latitude": row.get("latitude"), "longitude": row.get("longitude"), "website": row.get("website"),
                        "phones_json": json.dumps(phones, ensure_ascii=False), "source_category": category,
                        "ssm_industry_families": ";".join(families), "observed_at": row.get("observed_at"),
                        "source_url": row.get("source_url"), "first_envelope": manifest_path.parent.name,
                        "source_provenance_json": json.dumps(provenance, ensure_ascii=False, separators=(",", ":")),
                        "licences_json": json.dumps(licences, ensure_ascii=False),
                        **scope,
                        "outreach_eligibility": "research_only", "campaign_ready": False,
                    }
                    serialized = {key: safe_cell(record.get(key)) for key in COLUMNS}
                    all_writer.writerow(serialized)
                    counts["unique_place_candidates"] += 1
                    city = str(row.get("city") or "")
                    city_counts[city] += 1
                    category_counts[category] += 1
                    industry_counts.update(families)
                    scope_counts[scope["service_footprint_status"]] += 1
                    counts["unknown_category_candidates"] += int(not category)
                    counts["with_published_website"] += int(bool(row.get("website")))
                    counts["with_published_phone"] += int(bool(phones))
                    counts["with_address"] += int(bool(row.get("address")))
                    if _non_organisation(category):
                        counts["explicit_non_organisation_places_excluded_from_business_view"] += 1
                    else:
                        business_writer.writerow(serialized)
                        counts["organisation_business_candidates"] += 1
                        city_business[city] += 1
                        category_business[category] += 1
                        scope_business[scope["service_footprint_status"]] += 1
                        if scope["service_footprint_status"] == "configured_label_match":
                            configured_writer.writerow(serialized)
                            counts["configured_service_area_business_candidates"] += 1
                            scope_configured[scope["service_footprint_status"]] += 1
            if input_rows != manifest.get("metadata", {}).get("fetched_count"):
                raise ValueError("Acquisition row-count mismatch: "+str(row_path))
            input_notes.append({"manifest": str(manifest_path), "rows_file": str(row_path),
                "stored_sha256": stored_hash, "stored_bytes": stored_bytes,
                "original_rows_sha256": manifest.get("rows_sha256"),
                "input_rows": input_rows, "new_unique_place_candidates": input_new,
                "source_query_exhausted": manifest.get("metadata", {}).get("source_query_exhausted", False),
                "acquisition_status": manifest.get("metadata", {}).get("status")})
            print(json.dumps({"inventory_area": manifest_path.parent.name, "input_rows": input_rows,
                "new_unique": input_new, "cumulative_unique": len(seen)}), flush=True)
    if expected_unique is not None and len(seen) != expected_unique:
        raise ValueError("Independent unique-count mismatch: expected%s, found%s" % (expected_unique, len(seen)))
    if expected_business_candidates is not None and counts["organisation_business_candidates"] != expected_business_candidates:
        raise ValueError("Broad business-candidate count changed during scope enrichment")
    output_files = []
    for path, hashing, rows in ((all_path, all_hash, counts["unique_place_candidates"]),
                                (business_path, business_hash, counts["organisation_business_candidates"]),
                                (configured_path, configured_hash, counts["configured_service_area_business_candidates"])):
        with gzip.open(path, "rb") as stream:
            recovered_hash, recovered_bytes = _hash_stream(stream)
        if recovered_hash != hashing.digest.hexdigest() or recovered_bytes != hashing.bytes:
            raise ValueError("Output CSV gzip failed independent integrity verification")
        final = path.with_name(path.name.removesuffix(".partial"))
        path.replace(final)
        with final.open("rb") as stream:
            compressed_hash, compressed_bytes = _hash_stream(stream)
        output_files.append({"file": final.name, "rows": rows, "sha256": compressed_hash,
            "bytes": compressed_bytes, "decompressed_sha256": recovered_hash, "decompressed_bytes": recovered_bytes})
    for filename, first_label, all_counts, business_counts in (
        ("city-summary.csv", "publisher_locality", city_counts, city_business),
        ("category-summary.csv", "source_category", category_counts, category_business)):
        path = output/filename
        with path.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.writer(stream)
            writer.writerow([first_label, "place_candidates", "organisation_business_candidates"])
            for value, count in all_counts.most_common():
                writer.writerow([safe_cell(value), count, business_counts[value]])
        with path.open("rb") as stream:
            file_hash, byte_count = _hash_stream(stream)
        output_files.append({"file": filename, "rows": len(all_counts), "sha256": file_hash, "bytes": byte_count})
    scope_path = output/"scope-summary.csv"
    with scope_path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["service_footprint_status", "place_candidates", "organisation_business_candidates", "configured_service_area_business_candidates"])
        for status in ("configured_label_match", "outside_configured_footprint", "scope_review_required"):
            writer.writerow([status, scope_counts[status], scope_business[status], scope_configured[status]])
    with scope_path.open("rb") as stream:
        scope_hash, scope_bytes = _hash_stream(stream)
    output_files.append({"file": scope_path.name, "rows": 3, "sha256": scope_hash, "bytes": scope_bytes})
    topline = {"generated_at": datetime.now(timezone.utc).isoformat(), "started_at": started,
        "inventory_type": "deduplicated_provider_place_baseline", "counts": dict(counts),
        "industry_crosswalk_version": CROSSWALK_VERSION,
        "input_envelopes": len(manifests), "distinct_publisher_locality_labels": len(city_counts),
        "distinct_source_categories": len(category_counts), "pinned_releases": sorted({release for release, _ in seen}),
        "top_publisher_localities": city_counts.most_common(40), "ssm_industry_family_candidate_counts": dict(industry_counts),
        "service_footprint_place_counts": dict(scope_counts), "service_footprint_business_candidate_counts": dict(scope_business),
        "service_footprint_reference": {"database": footprint.database, "mode": "read_only_geography_tables",
            "distinct_locality_labels_cached": len(footprint.cache),
            "policy": "Unambiguous locality or municipality membership gives configured_label_match; an official municipality without membership is outside_configured_footprint; unmapped/composite labels require review. No coordinate-boundary assignment is inferred."},
        "explicit_non_organisation_exclusion_categories": sorted(NON_ORGANISATION),
        "campaign_ready": False, "outreach_eligibility": "research_only", "canonical_sql_ids_included": False,
        "limitations": ["Provider place IDs are not verified legal-company identities or named purchasing contacts.",
            "Business candidate view excludes only explicit controlled non-organisation categories; unknowns remain.",
            "Publisher locality labels include communities and neighbourhoods, not an official municipality census.",
            "Collection envelopes overlap and are approximate; capped partial envelopes retain source gaps.",
            "Envelopes include incidental out-of-footprint places such as Niagara; only configured_label_match rows enter the configured-service-area business view.",
            "Coordinates and contact routes are source-reported and unverified; no campaign enrolment is granted.",
            "This acquired baseline is separate from canonical SQL exports and CRM mapping.",
            "Source licence/contributor metadata is retained; no endorsement is implied.",
            "CSV values that could execute as spreadsheet formulas are prefixed with an apostrophe."]}
    (output/"topline.json").write_text(json.dumps(topline, indent=2, ensure_ascii=False)+"\n")
    (output/"manifest.json").write_text(json.dumps({"generated_at": topline["generated_at"], "status": "completed",
        "industry_crosswalk_version": CROSSWALK_VERSION,
        "counts": dict(counts), "input_artifacts": input_notes, "output_files": output_files,
        "deduplication_key": ["pinned_release", "provider_gers_id"],
        "hash_verification": "Persisted acquisition SHA256 verified before reading; output CSV decompression hashes independently verified."}, indent=2)+"\n")
    (output/"README.txt").write_text(
        "SSM acquired commercial-landscape provider baseline\n"+topline["generated_at"]+"\n\n"
        +f"{counts['unique_place_candidates']:,} unique provider place candidates; {counts['organisation_business_candidates']:,} organisation/business candidates.\n"
        +"all-place-candidates.csv.gz contains every deduplicated acquired provider place.\n"
        +"organisation-business-candidates.csv.gz excludes only explicitly classified parks, monuments, ATMs and other categories listed in topline.json; unknowns remain.\n"
        +"configured-service-area-business-candidates.csv.gz contains the business candidates whose unambiguous published locality or municipality has a configured service-catchment membership. This is a label/reference match, not point-in-boundary validation or a service-capability guarantee.\n"
        +"Incidental places such as Niagara remain in the broad files. Outside configured municipalities are flagged; unmapped or composite locality labels remain scope_review_required and are retained in the broad files.\n"
        +"Open the gzip CSVs with a gzip-capable spreadsheet/import tool, or decompress locally while retaining the archive.\n"
        +"city-summary.csv and category-summary.csv are small uncompressed summaries.\n"
        +"These are source-reported place candidates, not verified legal companies, qualified leads, decision-makers or campaign-ready contacts.\n"
        +"There are no invented canonical SSM IDs. Provider GERS IDs remain stable within the pinned release.\n"
        +"Source age, partial envelope limits and unknown fields remain visible in the acquisition manifests.\n"
        +"Source/contributor licence records are included per row. Contains Overture Maps Foundation data and its recorded contributors; no endorsement is implied.\n")
    return {**topline, "output": str(output), "files": output_files}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-unique", type=int)
    parser.add_argument("--expected-files", type=int)
    parser.add_argument("--geography-database", type=Path)
    parser.add_argument("--expected-business-candidates", type=int)
    args = parser.parse_args()
    result = build_inventory(args.input, args.output, expected_unique=args.expected_unique, expected_files=args.expected_files,
        geography_database=args.geography_database, expected_business_candidates=args.expected_business_candidates)
    print(json.dumps({"counts": result["counts"], "output": result["output"]}, indent=2))


if __name__ == "__main__":
    main()
