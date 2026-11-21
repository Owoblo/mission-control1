"""Read-only baseline screening and a deterministic, coverage-aware pilot.

This module never constructs MarketMap, merges identities, or changes a source
claim. Offline checks establish presence/format only. SQLite TEMP aggregates
are disposable; the inventory is opened using mode=ro.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import heapq
import json
import re
import shutil
import sqlite3
from collections import Counter, defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit, urlunsplit

from .geography import configured_footprint, resolve_geography

VERSION = "ssm-verification-pilot/2"
MIN_FREE = 2 * 1024 ** 3
BAD_NAMES = {"", "none", "null", "undefined", "nan", "n/a"}


def stamp():
    return datetime.now(timezone.utc).isoformat()


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def storage_guard(path):
    if shutil.disk_usage(path).free < MIN_FREE:
        raise RuntimeError("Verification paused: retain at least 2 GiB free space")


def spreadsheet_cell(value):
    text = "" if value is None else str(value)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r", "\n")) else text


@contextmanager
def compressed_lines(path):
    # Stable gzip headers allow independent replay/hash comparison.
    with Path(path).open("wb") as raw:
        with gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as compressed:
            class Writer:
                def write(self, row):
                    compressed.write((encode(row) + "\n").encode("utf-8"))
            yield Writer()


def website_candidate(value):
    value = str(value or "").strip()
    if not value:
        return {"status": "missing", "url": None}
    try:
        parsed = urlsplit(value if "://" in value else "https://" + value)
        host = (parsed.hostname or "").encode("idna").decode("ascii").lower()
        if (parsed.scheme not in {"http", "https"} or not host or "." not in host
                or parsed.username or parsed.password or parsed.port not in {None, 80, 443}
                or re.search(r"[\s<>]", host)):
            raise ValueError("Not a public website URL candidate")
        # HTTPS is a retrieval candidate; no assertion is made about HTTP support.
        return {"status": "syntax_only_unverified", "url": urlunsplit(("https", host, parsed.path or "/", parsed.query, ""))}
    except (ValueError, UnicodeError):
        return {"status": "format_review", "url": None}


def check_contact(kind, value):
    raw = str(value or "").strip()
    if kind in ("phone", "fax"):
        from .contact_normalization import parse_phone_candidate
        parsed = parse_phone_candidate(value)
        status = ('nanp_syntax_only' if parsed['reason']=='nanp_shape_only' else 'international_syntax_only') if parsed['e164'] else 'format_review'
        return {"format_status": status,
                "normalised_candidate": parsed['e164'],
                "extension": parsed['extension'] or None,
                "ownership_status": "not_checked", "reachability_status": "not_checked"}
    if kind == "email":
        plausible = bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", raw))
        return {"format_status": "syntax_only" if plausible else "format_review",
                "domain_mail_routing_status": "not_checked", "mailbox_status": "not_checked",
                "ownership_status": "not_checked"}
    return {"format_status": "not_checked"}


class ScopeLookup:
    def __init__(self, db):
        self.reader = SimpleNamespace(db=db)
        self.parents = dict(db.execute("SELECT id,parent_id FROM geographies"))
        self.members = defaultdict(list)
        self.areas = dict(db.execute("SELECT id,name FROM geographies WHERE kind='service_area'"))
        self.runtime = {row["label"] for row in configured_footprint() if row["configured_runtime"]}
        for row in db.execute("SELECT geography_id,service_area_id,configured_label FROM geography_service_areas"):
            if row[2] in self.runtime:
                self.members[row[0]].append((row[2], row[1]))
        self.cache = {}

    def chain(self, start):
        seen = set()
        while start and start not in seen:
            seen.add(start)
            start = self.parents.get(start)
        return seen

    def details(self, municipality_id, city):
        key = municipality_id, city
        if key not in self.cache:
            city_id = resolve_geography(self.reader, city)
            conflict = bool(municipality_id and city_id and
                            municipality_id not in self.chain(city_id) and city_id not in self.chain(municipality_id))
            starts = {municipality_id, city_id} - {None}
            labels, areas, visited = set(), set(), set()
            for start in starts:
                while start and start not in visited:
                    visited.add(start)
                    for label, area in self.members.get(start, []):
                        labels.add(label)
                        areas.add(self.areas.get(area, area))
                    start = self.parents.get(start)
            self.cache[key] = {"service_labels": [] if conflict else sorted(labels),
                               "operational_areas": [] if conflict else sorted(areas),
                               "geography_claim_conflict": conflict,
                               "claimed_service_labels": sorted(labels),
                               "city_resolved_geography_id": city_id}
        return self.cache[key]

    def match(self, municipality_id, city):
        result = self.details(municipality_id, city)
        return result["service_labels"], result["operational_areas"]


class PilotSampler:
    """Bounded hash reservoirs, first covering available service labels/strata.

    Purposive coverage sample, not a probability sample for market-wide rates.
    """
    def __init__(self, size):
        if not 1 <= size <= 10000:
            raise ValueError("Pilot size must be between 1 and 10000")
        self.size, self.buckets, self.global_heap = size, defaultdict(list), []
        self.eligible = 0

    @staticmethod
    def push(heap, item, capacity):
        if len(heap) < capacity:
            heapq.heappush(heap, item)
        elif item[:2] > heap[0][:2]:
            heapq.heapreplace(heap, item)

    def add(self, row):
        if not row["service_labels"] or row["disposition"] != "research_candidate":
            return
        self.eligible += 1
        rank = int(hashlib.sha256((VERSION + row["organisation_id"]).encode()).hexdigest(), 16)
        item = (-rank, row["organisation_id"], row)
        self.push(self.global_heap, item, self.size)
        tags = [("service_label", label) for label in row["service_labels"]]
        tags += [("source_type", value) for value in row["source_types"]]
        tags += [("source_id", value) for value in row.get("source_ids", [])]
        tags += [("industry", value) for value in row["industries"]]
        tags += [("locality_evidence", "resolved_community" if context.get("geography_kind") == "community" else "municipality_or_unknown")
                 for context in row.get("location_scopes", [])]
        tags = list(dict.fromkeys(tags))
        tags += [("entity_type", row["entity_type"]), ("location_type", row["location_type"]),
                 ("route_pattern", str(bool(row["website_candidate_url"])) + ":" + str(bool(row["phone_count"])))]
        row["sampling_tags"] = [list(tag) for tag in tags]
        for tag in tags:
            self.push(self.buckets[tag], item, 8)

    def finish(self):
        chosen = {}
        ordered = {key: sorted(heap, reverse=True) for key, heap in sorted(self.buckets.items())}
        # First one per available label, then one per other independently tracked
        # dimension. Fill subsequent rounds fairly, then deterministic fallback.
        keys = sorted(ordered, key=lambda key: (key[0] != "service_label", key))
        for depth in range(8):
            for key in keys:
                items = ordered[key]
                if len(items) > depth and len(chosen) < self.size:
                    item = items[depth]
                    chosen.setdefault(item[1], item[2])
        for item in sorted(self.global_heap, reverse=True):
            if len(chosen) < self.size:
                chosen.setdefault(item[1], item[2])
        rows = sorted(chosen.values(), key=lambda row: row["organisation_id"])
        available = {kind: sorted({value for family, value in ordered if family == kind})
                     for kind in {kind for kind, _ in ordered}}
        selected = defaultdict(set)
        for row in rows:
            for kind, value in row["sampling_tags"]:
                selected[kind].add(value)
        return rows, {"eligible_organisations": self.eligible,
                      "design": "deterministic purposive coverage sample; not population-representative",
                      "available_strata": available,
                      "unrepresented_strata": {kind: sorted(set(values) - selected[kind]) for kind, values in available.items()}}


def baseline_screen(database, output, *, pilot_size=2000, progress=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    if (output / "manifest.json").exists():
        raise ValueError("Use a new versioned output directory; existing manifest is immutable")
    storage_guard(output)
    database = Path(database).resolve()
    db = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA temp_store=FILE")
    db.execute("PRAGMA cache_size=-65536")
    db.execute("PRAGMA mmap_size=268435456")
    db.execute("BEGIN")
    started = stamp()
    progress = progress or (lambda value: None)
    counts, flags, contacts, location_flags = Counter(), Counter(), Counter(), Counter()
    location_rows = 0
    sampler = PilotSampler(pilot_size)
    try:
        snapshot = {table: db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
                    for table in ("organisations", "locations", "contact_channels", "source_identities")}
        progress({"stage": "snapshot_open", "counts": snapshot})
        scope = ScopeLookup(db)
        geography_kinds = dict(db.execute("SELECT id,kind FROM geographies"))
        sources = [dict(row) for row in db.execute("SELECT id,name,source_url,source_type,source_date,rights_status,notes FROM sources ORDER BY id")]
        (output / "source-context.json").write_text(json.dumps(sources, indent=2) + "\n")
        # All aggregates name TEMP explicitly; source inventory is immutable.
        # Screen ALL locations, so a legal organisation's second/rural branch
        # contributes to scope even when its first representative is elsewhere.
        db.execute("CREATE TEMP TABLE vp_location_input(organisation_id TEXT,location_id TEXT,scope_json TEXT)")
        batch = []
        with compressed_lines(output / "location-baseline.jsonl.gz") as stream:
            for original in db.execute("SELECT id,organisation_id,city_raw,address_raw,location_type,municipality_id,latitude,longitude FROM main.locations NOT INDEXED"):
                location = dict(original)
                context = dict(scope.details(location["municipality_id"], location["city_raw"]))
                context.update({"location_id": location["id"], "city_raw": location["city_raw"],
                                "address_raw": location["address_raw"], "location_type": location["location_type"],
                                "geography_kind": geography_kinds.get(context["city_resolved_geography_id"], "unknown")})
                location["scope_context"] = context
                location["verification_status"] = "source_claims_not_independently_verified"
                stream.write(location)
                batch.append((location["organisation_id"], location["id"], encode(context)))
                location_flags["geography_claim_conflict"] += int(context["geography_claim_conflict"])
                location_rows += 1
                if len(batch) >= 1000:
                    db.executemany("INSERT INTO temp.vp_location_input VALUES(?,?,?)", batch)
                    batch.clear()
                if location_rows % 25000 == 0:
                    storage_guard(output)
                    progress({"stage": "location_screen", "rows": location_rows})
            if batch:
                db.executemany("INSERT INTO temp.vp_location_input VALUES(?,?,?)", batch)
        statements = [
            "CREATE TEMP TABLE vp_location AS SELECT organisation_id,COALESCE(MIN(CASE WHEN json_array_length(scope_json,'$.service_labels')>0 THEN location_id END),MIN(location_id)) representative_id,COUNT(*) location_count,json_group_array(json(scope_json)) location_scopes FROM temp.vp_location_input GROUP BY organisation_id",
            "CREATE INDEX temp.vp_location_idx ON vp_location(organisation_id)",
            "DROP TABLE temp.vp_location_input",
            "CREATE TEMP TABLE vp_contact AS SELECT organisation_id,SUM(channel_type='phone') phone_count,SUM(channel_type='email') email_count FROM main.contact_channels GROUP BY organisation_id",
            "CREATE INDEX temp.vp_contact_idx ON vp_contact(organisation_id)",
            "CREATE TEMP TABLE vp_source AS SELECT i.organisation_id,json_group_array(DISTINCT i.source_id) source_ids,json_group_array(DISTINCT s.source_type) source_types FROM main.source_identities i JOIN main.sources s ON s.id=i.source_id GROUP BY i.organisation_id",
            "CREATE INDEX temp.vp_source_idx ON vp_source(organisation_id)",
            "CREATE TEMP TABLE vp_industry AS SELECT entity_id,json_group_array(DISTINCT category) industries FROM main.classifications WHERE entity_type='organisation' AND taxonomy IN ('ssm_industry_family','ssm_industry','ssm_industry_families') GROUP BY entity_id",
            "CREATE INDEX temp.vp_industry_idx ON vp_industry(entity_id)",
            "CREATE TEMP TABLE vp_nonorg AS SELECT DISTINCT entity_id FROM main.classifications WHERE taxonomy='ssm_discovery_context' AND category='non_organisation_place_candidate'",
            "CREATE INDEX temp.vp_nonorg_idx ON vp_nonorg(entity_id)"
        ]
        for index, sql in enumerate(statements):
            storage_guard(output)
            db.execute(sql)
            progress({"stage": "temporary_aggregate", "step": index + 1, "steps": len(statements)})
        query = """SELECT o.id organisation_id,o.trading_name name,o.entity_type,o.status organisation_status,o.primary_domain,
            v.location_count,v.location_scopes,l.id location_id,l.city_raw,l.address_raw,l.location_type,l.municipality_id,
            COALESCE(c.phone_count,0) phone_count,COALESCE(c.email_count,0) email_count,
            s.source_ids,s.source_types,i.industries,n.entity_id nonorg_id
            FROM main.organisations o LEFT JOIN temp.vp_location v ON v.organisation_id=o.id
            LEFT JOIN main.locations l ON l.id=v.representative_id
            LEFT JOIN temp.vp_contact c ON c.organisation_id=o.id
            LEFT JOIN temp.vp_source s ON s.organisation_id=o.id
            LEFT JOIN temp.vp_industry i ON i.entity_id=o.id
            LEFT JOIN temp.vp_nonorg n ON n.entity_id=o.id"""
        with compressed_lines(output / "organisation-baseline.jsonl.gz") as stream:
            for original in db.execute(query):
                row = dict(original)
                candidate = website_candidate(row.pop("primary_domain"))
                row["website_candidate_url"], row["website_format_status"] = candidate["url"], candidate["status"]
                row["name_status"] = "present_unverified" if str(row["name"] or "").strip().casefold() not in BAD_NAMES else "format_review"
                row["location_scopes"] = json.loads(row["location_scopes"] or "[]")
                row["service_labels"] = sorted({label for context in row["location_scopes"] for label in context["service_labels"]})
                row["operational_areas"] = sorted({area for context in row["location_scopes"] for area in context["operational_areas"]})
                row["source_ids"] = json.loads(row["source_ids"] or "[]")
                row["source_types"] = json.loads(row["source_types"] or '["unknown"]')
                row["industries"] = json.loads(row["industries"] or '["uncategorised"]')
                row["location_type"] = row["location_type"] or "unknown"
                row["location_role_scope"] = "representative display location; scope eligibility considers all locations"
                row["disposition"] = ("non_organisation_place_review" if row.pop("nonorg_id") else
                                      "identity_hold" if row["organisation_status"] == "quarantined" or row["name_status"] == "format_review"
                                      else "research_candidate")
                row["screening_status"] = "offline_presence_and_format_only"
                row["field_verification_status"] = "not_checked"
                row["quality_flags"] = [flag for condition, flag in [
                    (not row["location_id"], "no_location_record"),
                    (not row["service_labels"], "service_scope_unresolved_or_outside"),
                    (not row["address_raw"], "address_missing"),
                    (not row["website_candidate_url"], "website_missing_or_format_review"),
                    (not row["phone_count"] and not row["email_count"], "no_imported_phone_or_email"),
                    (row["location_type"] != "physical_site_candidate", "location_role_requires_review"),
                    (row["location_count"] and row["location_count"] > 1, "multiple_locations_representative_only"),
                    (any(context["geography_claim_conflict"] for context in row["location_scopes"]), "geography_claim_conflict"),
                    (row["industries"] == ["uncategorised"], "industry_unknown_or_classification_pending")
                ] if condition]
                stream.write(row)
                sampler.add(row)
                counts[row["disposition"]] += 1
                flags.update(row["quality_flags"])
                if sum(counts.values()) % 25000 == 0:
                    storage_guard(output)
                    progress({"stage": "organisation_screen", "rows": sum(counts.values())})
        pilot, design = sampler.finish()
        selected = {row["organisation_id"]: row for row in pilot}
        for row in pilot:
            row["contact_records"] = []
        with compressed_lines(output / "contact-baseline.jsonl.gz") as stream:
            details = db.execute("SELECT 1 FROM main.sqlite_master WHERE name='phone_channel_details'").fetchone()
            query = "SELECT c.*,d.extension,d.raw_value,d.format_status,d.normalizer_version FROM main.contact_channels c LEFT JOIN main.phone_channel_details d ON d.channel_id=c.id ORDER BY c.id" if details else "SELECT * FROM main.contact_channels ORDER BY id"
            for original in db.execute(query):
                row = dict(original)
                row["offline_check"] = check_contact(row["channel_type"], row["value"])
                if row.get('extension'):
                    row['offline_check']['extension'] = row['extension']
                stream.write(row)
                contacts[row["channel_type"] + ":" + row["offline_check"]["format_status"]] += 1
                if row["organisation_id"] in selected:
                    selected[row["organisation_id"]]["contact_records"].append(row)
                if sum(contacts.values()) % 25000 == 0:
                    storage_guard(output)
                    progress({"stage": "contact_screen", "rows": sum(contacts.values())})
        with compressed_lines(output / "pilot-records.jsonl.gz") as stream:
            for row in pilot:
                stream.write(row)
        with (output / "pilot-review.csv").open("w", newline="") as handle:
            fields = ["organisation_id", "name", "city_raw", "address_raw", "location_type", "location_scopes", "website_candidate_url",
                      "service_labels", "industries", "source_ids", "source_types", "name_review", "website_identity_review",
                      "location_review", "contact_ownership_review", "reviewer", "evidence_url", "reviewed_at", "notes"]
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for row in pilot:
                writer.writerow({key: spreadsheet_cell(encode(row[key]) if isinstance(row.get(key), list) else row.get(key, "")) for key in fields})
        pilot_labels = {label for row in pilot for label in row["service_labels"]}
        report = {"version": VERSION, "started_at": started, "completed_at": stamp(), "database_path": str(database),
                  "implementation_sha256": file_hash(Path(__file__)),
                  "main_database_access": "sqlite_uri_mode_ro; disposable TEMP aggregates only",
                  "main_database_writes": 0, "network_requests": 0, "paid_service_calls": 0,
                  "snapshot_counts": snapshot, "organisation_dispositions": dict(counts),
                  "quality_flag_counts": dict(flags), "contact_format_counts": dict(contacts),
                  "location_rows_screened": location_rows, "location_quality_flag_counts": dict(location_flags),
                  "organisation_rows_screened": sum(counts.values()), "contact_rows_screened": sum(contacts.values()),
                  "pilot_records": len(pilot), "pilot_requested": pilot_size,
                  "configured_runtime_labels": len(scope.runtime), "pilot_service_labels_represented": len(pilot_labels),
                  "configured_labels_without_selected_record": sorted(scope.runtime - pilot_labels),
                  "sampling": design, "market_completeness_verified": False,
                  "limitations": ["Offline format checks establish no ownership, reachability, current operation or purchasing authority.",
                                  "Display address is one labelled representative; service-label eligibility uses all locations. Conflicting geographic claims do not count as clean label representation.",
                                  "Pilot is purposive and cannot estimate whole-market verification rates without a separate probability sample.",
                                  "Unloaded cohorts and incomplete classifications are absent from this version; regenerate as new versions."]}
        report["counts_reconcile"] = report["organisation_rows_screened"] == snapshot["organisations"] and report["contact_rows_screened"] == snapshot["contact_channels"] and location_rows == snapshot["locations"]
        if not report["counts_reconcile"]:
            raise RuntimeError("Baseline row counts do not reconcile")
        artifacts = ["organisation-baseline.jsonl.gz", "location-baseline.jsonl.gz", "contact-baseline.jsonl.gz", "pilot-records.jsonl.gz", "pilot-review.csv", "source-context.json"]
        report["artifacts"] = [{"path": name, "sha256": file_hash(output / name), "bytes": (output / name).stat().st_size} for name in artifacts]
        (output / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
        progress({"stage": "complete", "organisation_rows": sum(counts.values()), "pilot_records": len(pilot)})
        return report
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--pilot-size", type=int, default=2000)
    args = parser.parse_args()
    baseline_screen(args.database, args.output, pilot_size=args.pilot_size,
                    progress=lambda value: print(encode(value), flush=True))


if __name__ == "__main__":
    main()
