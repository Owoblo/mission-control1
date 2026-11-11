"""Portable evidence exports and honest geography/industry/source coverage.

Coverage cells describe research operations, never a census completeness claim.
Broad source applicability is kept separate from an executed sector query.
"""
from __future__ import annotations

import csv
import calendar
import hashlib
import json
import re
import itertools
import gzip
import io
from contextlib import ExitStack
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta, date
from pathlib import Path

from .geography import normalise_locality, resolve_geography, AREA_LABELS


def _now():
    return datetime.now(timezone.utc).isoformat()


def _json(value, default=None):
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value) if value else default
    except (ValueError, TypeError):
        return default


def _date(value):
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d
    except (TypeError, ValueError):
        return None


def _source_age(value, now, refresh_interval):
    """Keep year/month precision instead of manufacturing an exact first day."""
    raw = str(value).strip() if value is not None else None
    precision = "unknown"
    lower = upper = None
    try:
        if raw and re.fullmatch(r"\d{4}", raw):
            year = int(raw)
            lower, upper, precision = date(year, 1, 1), date(year, 12, 31), "year"
        elif raw and re.fullmatch(r"\d{4}-\d{2}", raw):
            year, month = map(int, raw.split("-"))
            lower, upper, precision = date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1]), "month"
        elif raw and re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            lower = upper = date.fromisoformat(raw)
            precision = "day"
        elif raw and re.match(r"^\d{4}-\d{2}-\d{2}T", raw):
            parsed = _date(raw)
            if parsed:
                lower = upper = parsed.date()
                precision = "timestamp"
    except (ValueError, OverflowError):
        lower = upper = None
        precision = "unknown"
    min_age = (now.date() - upper).days if upper else None
    max_age = (now.date() - lower).days if lower else None
    exact_age = min_age if precision in {"day", "timestamp"} else None
    warning = ("source_reference_period_is_in_future" if max_age is not None and max_age < 0
               else "underlying_reference_date_older_than_refresh_interval" if min_age is not None and min_age > refresh_interval
               else "reference_date_range_crosses_refresh_interval" if max_age is not None and max_age > refresh_interval
               else "reference_date_unknown" if min_age is None else None)
    return {"source_date_precision": precision, "source_data_age_days": exact_age,
            "source_data_age_days_min": min_age, "source_data_age_days_max": max_age,
            "source_data_age_warning": warning,
            "age_interpretation": "Age of the publisher reference date, separate from acquisition freshness; an old reference version does not by itself establish closure or invalidity."}


def _resource_summary(runs):
    """Deduplicate cumulative recovery meters; preserve uninstrumented I/O."""
    groups = {}
    raw_unknown = Counter()
    runtime_groups = {}
    runtime_raw_unknown = 0
    manifests = set()
    for index, run in enumerate(runs):
        metadata = _json(run.get("metadata_json"), {}) or {}
        acquisition_id = metadata.get("acquisition_id")
        group_key = ("acquisition", run.get("source_id"), acquisition_id) if acquisition_id else ("run", run.get("id", index))
        bucket = groups.setdefault(group_key, {"requests": [], "bytes_fetched": [], "estimated_cost": []})
        for field, flag in [("requests", "request_count_known"), ("bytes_fetched", "transfer_bytes_known")]:
            value = run.get(field)
            unmeasured = value is None or (field in metadata and metadata[field] is None) or metadata.get(flag) is False
            if unmeasured:
                raw_unknown[field] += 1
            else:
                bucket[field].append(value)
        if run.get("estimated_cost") is not None:
            bucket["estimated_cost"].append(run["estimated_cost"])
        duration = run.get("runtime_seconds")
        if duration is None:
            duration = run.get("elapsed_seconds")
        manifest = metadata.get("original_acquisition_manifest")
        runtime_key = ("manifest", manifest) if manifest else group_key
        if manifest:
            manifests.add(manifest)
            duration = metadata.get("original_acquisition_elapsed_seconds", duration)
        runtime_bucket = runtime_groups.setdefault(runtime_key, [])
        if duration is None:
            runtime_raw_unknown += 1
        else:
            runtime_bucket.append(duration)
    totals = {}
    unknown_groups = {}
    for field in ("requests", "bytes_fetched"):
        totals[field] = sum(max(g[field]) for g in groups.values() if g[field])
        unknown_groups[field] = sum(not g[field] for g in groups.values())
    return {"requests": totals["requests"] if not unknown_groups["requests"] else None,
            "requests_known_total": totals["requests"], "requests_unknown_run_count": raw_unknown["requests"],
            "requests_unknown_acquisition_count": unknown_groups["requests"],
            "request_measurement_complete": unknown_groups["requests"] == 0,
            "bytes_fetched": totals["bytes_fetched"] if not unknown_groups["bytes_fetched"] else None,
            "bytes_fetched_known_total": totals["bytes_fetched"], "transfer_bytes_unknown_run_count": raw_unknown["bytes_fetched"],
            "transfer_bytes_unknown_acquisition_count": unknown_groups["bytes_fetched"],
            "transfer_measurement_complete": unknown_groups["bytes_fetched"] == 0,
            "runtime_seconds": sum(max(values) for values in runtime_groups.values() if values),
            "runtime_unknown_run_count": runtime_raw_unknown,
            "runtime_unknown_acquisition_count": sum(not values for values in runtime_groups.values()),
            "runtime_measurement_complete": all(runtime_groups.values()),
            "estimated_paid_cost": sum(max(g["estimated_cost"]) for g in groups.values() if g["estimated_cost"]),
            "resource_acquisition_groups": len(groups), "distinct_acquisition_manifests": len(manifests),
            "measurement_note": "Known totals exclude uninstrumented HTTP/transfer values. Recovery prefix/final meters with the same source and acquisition_id use MAX cumulative values; old runs without acquisition_id remain independent. Original cloud acquisition runtime is counted once per manifest across chunks."}


def load_taxonomy():
    return json.loads((Path(__file__).parent / "config/taxonomy.json").read_text())


def _rows(store, table):
    # Internal table names only; never accept a user-supplied SQL identifier.
    if table not in _EXPORT_TABLES | {"geography_service_areas", "source_run_items", "field_assertions", "classifications"}:
        raise ValueError("Unknown report table")
    exists = store.db.execute("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?", (table,)).fetchone()
    return [dict(row) for row in store.db.execute(f'SELECT * FROM "{table}"')] if exists else []


FAMILY_ALIASES = {
    "municipal_business_directory": "municipal_directory", "chamber_member_directory": "chamber",
    "open_data_business_locations": "open_data_locations", "open_data": "open_data_locations",
    "league_team_directory": "league_roster", "provincial_association_members": "provincial_association",
    "procurement": "procurement_awards", "economic_directory": "economic_development",
    "company_website": "official_website", "website_relationships": "official_website",
}
SCOPE_ALIASES = {
    "durham": "Durham Region", "york": "York Region", "peel": "Peel Region", "halton": "Halton Region",
    "essex": "Essex County", "lambton": "Lambton County", "sarnialambton": "Lambton County",
    "oxford": "Oxford County", "middlesex": "Middlesex County", "elgin": "Elgin County",
    "wellington": "Wellington County", "waterlooregion": "Waterloo Region",
    "londoncatchment": "London / Middlesex / Elgin service area",
    "wkg": "Kitchener / Waterloo / Cambridge / Guelph service area",
    "windsorkitchener": "Ontario",
    "windsoressex": AREA_LABELS["windsor"], "chathamkent": AREA_LABELS["chatham-kent"],
    "londonelginmiddlesex": AREA_LABELS["london"], "woodstockoxford": AREA_LABELS["woodstock"],
    "waterlooguelphwellington": AREA_LABELS["WKG"], "ottawasurrounding": AREA_LABELS["ottawa"],
    "torontogtahamilton": AREA_LABELS["toronto"],
}
BLOCKED = {"blocked", "access_blocked", "forbidden", "membership_only", "login_required", "robots_disallowed", "unavailable", "temporarily_unavailable", "restricted"}
SUCCESS = {"completed", "complete", "success", "ingested", "partial", "partially_ingested"}
REFERENCE_FAMILIES = {"administrative_geography", "statistical_benchmark"}


def _source_status(source, runs, now):
    access = source.get("retrieval_status") or "discovered"
    rights = source.get("rights_status") or "unreviewed"
    # started_at is the source observation's acquisition time in the ingestion
    # contract; completed_at can be today's replay/import completion time.
    # Re-importing an old file must not make its original capture look fresh.
    success_dates = [_date(r.get("started_at")) or _date(r.get("completed_at")) for r in runs if r["status"] in SUCCESS]
    latest_success = max((d for d in success_dates if d), default=None)
    latest_success = latest_success or _date(source.get("last_success_at"))
    interval = int(source.get("refresh_interval") or 90)
    stale = bool(latest_success and latest_success + timedelta(days=interval) < now)
    if stale:
        state = "stale"
    elif access in BLOCKED:
        state = "access_blocked"
    elif any(r["status"] != "evidence_only" for r in runs):
        # Relationship excerpts may use the same publisher source. Their
        # evidence-only receipts cannot replace bulk-collection completion.
        last = sorted((r for r in runs if r["status"] != "evidence_only"), key=lambda r: r["started_at"])[-1]
        if last["status"] in SUCCESS:
            state = "ingested" if last.get("coverage_complete") and last["status"] not in {"partial", "partially_ingested"} else "partially_ingested"
        elif last["status"] in {"blocked", "held", "access_blocked"}:
            state = "access_blocked"
        else:
            state = "ingestion_pending"
    elif rights in {"permitted", "open_licence", "open_license", "licensed", "licensed_open", "reviewed_permitted"}:
        state = "ingestion_pending"
    else:
        state = "source_identified"
    return {"source_id": source["id"], "name": source["name"], "source_family": FAMILY_ALIASES.get(source["source_type"], source["source_type"]),
            "status": state, "retrieval_status": access, "rights_status": rights,
            "last_success_at": latest_success.isoformat() if latest_success else None,
            "source_date": source.get("source_date"), "refresh_interval_days": interval,
            "stale": stale, "stale_source": stale,
            "last_acquisition_age_days": (now - latest_success).days if latest_success else None,
            **_source_age(source.get("source_date"), now, interval),
            "run_count": len(runs), "source_url": source["source_url"]}


def _scope_ids(source, geographies, aliases):
    scopes = _json(source.get("geography_scope"), [])
    if isinstance(scopes, str):
        scopes = [scopes]
    selected = set()
    for scope in scopes:
        if isinstance(scope, dict):
            scope = scope.get("id") or scope.get("name") or ""
        if scope in geographies:
            selected.add(scope)
            continue
        norm = normalise_locality(scope)
        norm = normalise_locality(SCOPE_ALIASES.get(norm, scope))
        matches = aliases.get(norm, set())
        physical = {i for i in matches if geographies[i]["kind"] != "service_catchment"}
        selected.update(physical or matches)
    return selected


def _aggregate_coverage_python(store, *, geographies, member_scopes, family_by_source, sectors, taxonomy, run_source):
    """Reference aggregation for small stores and SQL equivalence tests."""
    def ancestors(ident):
        found = set()
        while ident in geographies and ident not in found:
            found.add(ident)
            ident = geographies[ident]["parent_id"]
        return found
    sector_set = set(sectors)
    org_sectors = defaultdict(set)
    explicit_non_organisation = set()
    for c in store.db.execute("SELECT entity_id,taxonomy,category FROM classifications"):
        if c["taxonomy"] in {taxonomy["industry_taxonomy"], "ssm_industry", "ssm_industry_families"} and c["category"] in sector_set:
            org_sectors[c["entity_id"]].add(c["category"])
        if c["taxonomy"] == "ssm_discovery_context" and c["category"] == "non_organisation_place_candidate":
            explicit_non_organisation.add(c["entity_id"])
    locs = {l["id"]: dict(l) for l in store.db.execute("SELECT id,organisation_id,municipality_id,city_raw,address_normalized,city_normalized,province,country,location_type FROM locations")}
    orgs = [dict(o) for o in store.db.execute("SELECT id,entity_type FROM organisations")]
    explicit_non_organisation &= {o["id"] for o in orgs}
    source_loc = defaultdict(set)
    loc_sources = defaultdict(set)
    for item in store.db.execute("SELECT run_id,location_id FROM source_run_items"):
        source = run_source.get(item["run_id"])
        if source and item["location_id"]:
            source_loc[source].add(item["location_id"])
            loc_sources[item["location_id"]].add(source)
    # Each cell uses distinct entity sets. Source applicability never creates a
    # physical business location or supplies an unknown municipality.
    cell_orgs = defaultdict(set)
    cell_locs = defaultdict(set)
    geo_orgs = defaultdict(set)
    geo_locs = defaultdict(set)
    unmapped = 0
    locality_cache = {}
    ancestor_cache = {}
    for ident, location in locs.items():
        city = location.get("city_raw")
        if city not in locality_cache:
            locality_cache[city] = resolve_geography(store, city)
        locality = locality_cache[city]
        municipality = location.get("municipality_id")
        for parent in (municipality, locality):
            if parent not in ancestor_cache:
                ancestor_cache[parent] = ancestors(parent)
        geographical_ids = ancestor_cache[municipality] | ancestor_cache[locality]
        if not geographical_ids:
            unmapped += 1
        # Operational coverage is another explicit grouping, not a physical
        # municipality claim. It is only added for a resolved locality/member.
        for gid in list(geographical_ids):
            geographical_ids |= member_scopes.get(gid, set())
        categories = org_sectors.get(location["organisation_id"]) or {"uncategorised"}
        for gid in geographical_ids:
            geo_orgs[gid].add(location["organisation_id"])
            geo_locs[gid].add(ident)
            for source in loc_sources[ident]:
                family = family_by_source.get(source, "unknown")
                for sector in categories | {"*"}:
                    cell_orgs[(gid, sector, family)].add(location["organisation_id"])
                    cell_locs[(gid, sector, family)].add(ident)
    distinct_addresses = {(l.get("address_normalized"), l.get("city_normalized"), l.get("province"), l.get("country"))
                          for l in locs.values() if l.get("address_normalized")}
    return {"counts": {"organisations": len(orgs), "locations": len(locs),
            "distinct_normalized_address_candidates": len(distinct_addresses),
            "unmapped_locations": unmapped,
            "unclassified_organisations": sum(not org_sectors.get(o["id"]) for o in orgs),
            "organisations_by_entity_type": dict(Counter(o["entity_type"] for o in orgs)),
            "explicit_non_organisation_place_candidates": len(explicit_non_organisation),
            "business_or_organisation_candidate_records": len(orgs) - len(explicit_non_organisation),
            "non_organisation_location_records": sum(l["organisation_id"] in explicit_non_organisation for l in locs.values()),
            "business_or_organisation_candidate_location_records": sum(l["organisation_id"] not in explicit_non_organisation for l in locs.values()),
            "location_records_by_type": dict(Counter(l["location_type"] for l in locs.values()))},
            "source_location_counts": {source: len(locations) for source, locations in source_loc.items()},
            "cell_counts": {key: {"organisations": len(entities), "locations": len(cell_locs[key])} for key, entities in cell_orgs.items()},
            "geo_counts": {key: {"organisations": len(entities), "locations": len(geo_locs[key]),
                "business_candidates": sum(o not in explicit_non_organisation for o in entities),
                "non_organisation_candidates": sum(o in explicit_non_organisation for o in entities)} for key, entities in geo_orgs.items()}}


def coverage_report(store, *, aggregation="auto"):
    taxonomy = load_taxonomy()
    now = datetime.now(timezone.utc)
    geographies = {g["id"]: g for g in _rows(store, "geographies")}
    aliases = defaultdict(set)
    for alias in _rows(store, "geography_aliases"):
        aliases[alias["alias_normalized"]].add(alias["geography_id"])
    memberships = _rows(store, "geography_service_areas")
    member_scopes = defaultdict(set)
    configured_labels = defaultdict(set)
    for member in memberships:
        member_scopes[member["geography_id"]].add(member["service_area_id"])
        configured_labels[member["geography_id"]].add(member["configured_label"])
    configured = sorted(configured_labels or {g for g in geographies if geographies[g]["kind"] in {"municipality", "community"}}, key=lambda g: geographies[g]["name"])

    def ancestors(ident):
        ids = set()
        while ident in geographies and ident not in ids:
            ids.add(ident)
            ident = geographies[ident]["parent_id"]
        return ids

    sources = _rows(store, "sources")
    runs = _rows(store, "source_runs")
    runs_by_source = defaultdict(list)
    run_source = {}
    for run in runs:
        runs_by_source[run["source_id"]].append(run)
        run_source[run["id"]] = run["source_id"]
    source_statuses = {s["id"]: _source_status(s, runs_by_source[s["id"]], now) for s in sources}
    source_by_id = {s["id"]: s for s in sources}
    source_scopes = {s["id"]: _scope_ids(s, geographies, aliases) for s in sources}
    family_by_source = {s["id"]: FAMILY_ALIASES.get(s["source_type"], s["source_type"]) for s in sources}
    families = sorted(set(taxonomy["source_families"]) | (set(family_by_source.values()) - REFERENCE_FAMILIES))
    sectors = [x["id"] for x in taxonomy["industry_families"]]
    if aggregation not in {"auto", "python", "sql"}:
        raise ValueError("Unknown coverage aggregation engine")
    use_sql = aggregation == "sql" or (aggregation == "auto" and store.db.execute("SELECT COUNT(*) FROM organisations").fetchone()[0] >= 50000)
    if use_sql:
        from .coverage_sql import aggregate_coverage
        summary = aggregate_coverage(store, geographies=geographies, member_scopes=member_scopes,
            family_by_source=family_by_source, sectors=sectors, taxonomy=taxonomy, configured=configured)
    else:
        summary = _aggregate_coverage_python(store, geographies=geographies, member_scopes=member_scopes,
            family_by_source=family_by_source, sectors=sectors, taxonomy=taxonomy, run_source=run_source)
    location_types = summary["counts"]["location_records_by_type"]
    mail_types = {"mailing_address", "registered_address", "registered_mailing_address", "po_box", "postal_route"}
    virtual_types = {"virtual", "remote_or_virtual"}
    programme_types = {"programme", "programme_site", "program_site"}
    mail_count = sum(location_types.get(kind, 0) for kind in mail_types)
    virtual_count = sum(location_types.get(kind, 0) for kind in virtual_types)
    programme_count = sum(location_types.get(kind, 0) for kind in programme_types)
    summary["counts"].update({"mail_route_location_records": mail_count,
        "virtual_location_records": virtual_count, "programme_location_records": programme_count,
        "physical_site_candidate_records": summary["counts"]["locations"] - mail_count - virtual_count - programme_count,
        "unknown_or_untyped_location_records": location_types.get("unknown", 0)})
    saved = {(c["geography_id"], c["sector_id"], c["source_lane"]): c for c in _rows(store, "coverage_cells")}
    applicable_by_geo = defaultdict(list)
    for gid in configured:
        applicable_scopes = ancestors(gid) | member_scopes.get(gid, set())
        for source in sources:
            if source_scopes[source["id"]] & applicable_scopes:
                applicable_by_geo[gid].append(source)
    priority = {"not_searched": 100, "searched_no_source_found": 95, "access_blocked": 90,
                "stale": 85, "source_identified": 80, "ingestion_pending": 75,
                "partially_ingested": 65, "ingested": 20}
    cells = []
    next_tasks = []
    for gid in configured:
        geo = geographies[gid]
        for sector in ["*"] + sectors:
            for family in families:
                candidates = []
                direct = []
                for source in applicable_by_geo[gid]:
                    if family_by_source[source["id"]] != family:
                        continue
                    ss = _json(source.get("sector_scope"), [])
                    if isinstance(ss, str):
                        ss = [ss]
                    if not ss or "*" in ss or "all" in ss or sector in ss or sector == "*":
                        candidates.append(source)
                    if sector == "*" or sector in ss:
                        direct.append(source["id"])
                statuses = [source_statuses[s["id"]]["status"] for s in candidates]
                counts_key = (gid, sector, family)
                organisation_count = summary["cell_counts"].get(counts_key, {}).get("organisations", 0)
                location_count = summary["cell_counts"].get(counts_key, {}).get("locations", 0)
                status = "not_searched"
                origin = "source_registry"
                note = "No configured source is evidence that no businesses exist."
                if candidates:
                    if direct:
                        direct_status = [source_statuses[s]["status"] for s in direct]
                        # A lane is fully ingested only if every identified
                        # applicable source in that lane completed; new/blocked
                        # sources keep outstanding work visible.
                        if all(s == "ingested" for s in direct_status) and len(direct) == len(candidates):
                            status = "ingested"
                        elif any(s in {"partially_ingested", "ingested"} for s in direct_status):
                            status = "partially_ingested"
                        elif "stale" in direct_status:
                            status = "stale"
                        elif all(s == "access_blocked" for s in direct_status):
                            status = "access_blocked"
                        elif "ingestion_pending" in direct_status:
                            status = "ingestion_pending"
                        else:
                            status = "source_identified"
                    else:
                        status = "partially_ingested" if location_count else "source_identified"
                    note = "Source coverage only. " + ("Explicit source/sector scope; municipality-wide completeness is unknown." if direct else "Broad source identified; no executed query in this exact sector is implied.")
                previous = saved.get(counts_key)
                if previous and previous["search_status"] in {"searched_no_source_found", "access_blocked", "stale"}:
                    status = previous["search_status"]
                    origin = "recorded_review"
                    note = previous.get("comparability_notes") or note
                cell = {"geography_id": gid, "geography": geo["name"], "geography_kind": geo["kind"],
                        "sector_id": sector, "source_lane": family, "search_status": status,
                        "source_count": len(candidates), "source_ids": [s["id"] for s in candidates],
                        "sector_scoped_source_count": len(direct), "unique_organisations": organisation_count,
                        "unique_locations": location_count, "benchmark_count": previous.get("benchmark_count") if previous else None,
                        "benchmark_definition": previous.get("benchmark_definition") if previous else None,
                        "benchmark_date": previous.get("benchmark_date") if previous else None,
                        "comparability_notes": note, "last_reviewed_at": previous.get("last_reviewed_at") if previous else None,
                        "status_origin": origin, "market_completeness_percentage": None}
                cells.append(cell)
                if status != "ingested":
                    next_tasks.append({"geography_id": gid, "geography": geo["name"], "sector_id": sector,
                                       "source_lane": family, "priority": priority[status], "status": status,
                                       "source_ids": cell["source_ids"], "next_action": _next_action(status),
                                       "dedupe_key": f"coverage:{gid}:{sector}:{family}"})
    queue = _rows(store, "discovery_queue")
    reviews = _rows(store, "review_queue")
    source_yield = []
    for source in sources:
        sruns = runs_by_source[source["id"]]
        insertions = sum(r["inserted_count"] for r in sruns)
        meters = _resource_summary(sruns)
        cost = meters["estimated_paid_cost"]
        source_yield.append({"source_id": source["id"], "source_name": source["name"], "runs": len(sruns),
                             "inserted_organisations": insertions,
                             "distinct_observed_locations": summary["source_location_counts"].get(source["id"], 0),
                             **meters,
                             "estimated_cost": cost, "cost_per_1000_inserted_organisations": cost * 1000 / insertions if insertions else None,
                             "errors": sum(r["error_count"] for r in sruns), "quarantined": sum(r["quarantined_count"] for r in sruns)})
    relationship_invocations = _rows(store, "relationship_invocations")
    relationship_wave_costs = {"invocations": len(relationship_invocations),
        "requests": sum(r.get("requests") or 0 for r in relationship_invocations),
        "bytes_fetched": sum(r.get("bytes_fetched") or 0 for r in relationship_invocations),
        "runtime_seconds": sum(r.get("elapsed_seconds") or 0 for r in relationship_invocations),
        "estimated_paid_cost": sum(r.get("estimated_cost") or 0 for r in relationship_invocations),
        "accounting_basis": "Separate relationship invocation receipts; not added to bulk source-run totals. Do not sum if these same requests are also recorded in source_runs."}
    return {"generated_at": now.isoformat(), "counts": {**summary["counts"],
            "relationships": store.db.execute("SELECT COUNT(*) FROM relationships").fetchone()[0], "evidence": store.db.execute("SELECT COUNT(*) FROM evidence").fetchone()[0],
            "sources": len(sources), "source_runs": len(runs), "configured_labels": len({m["configured_label"] for m in memberships}),
            "configured_geographies": len(configured), "configured_municipalities": sum(geographies[g]["kind"] == "municipality" for g in configured),
            "geographies": len(geographies)},
            "footprint": [{"geography_id": g, "name": geographies[g]["name"], "kind": geographies[g]["kind"],
                           "configured_labels": sorted(configured_labels[g]), "unique_organisations": summary["geo_counts"].get(g, {}).get("organisations", 0),
                           "business_or_organisation_candidates": summary["geo_counts"].get(g, {}).get("business_candidates", 0),
                           "explicit_non_organisation_place_candidates": summary["geo_counts"].get(g, {}).get("non_organisation_candidates", 0),
                           "unique_locations": summary["geo_counts"].get(g, {}).get("locations", 0), "official_id": geographies[g]["official_id"]} for g in configured],
            "coverage_status_counts": dict(Counter(c["search_status"] for c in cells)),
            "source_statuses": list(source_statuses.values()), "cells": cells,
            "next_source_queue": sorted(next_tasks, key=lambda t: (-t["priority"], t["geography"], t["sector_id"], t["source_lane"])),
            "pending_discovery": {"status_counts": dict(Counter(q["status"] for q in queue)),
                                  "remaining": sum(q["status"] not in {"completed", "cancelled", "discarded"} for q in queue)},
            "review_queue_status_counts": dict(Counter(r["status"] for r in reviews)), "source_yield": source_yield,
            "relationship_wave_costs": relationship_wave_costs,
            "run_costs": {**_resource_summary(runs),
                          "browser_rendered_pages": sum(r["browser_pages"] for r in runs),
                          "model_tokens": sum(r.get("model_tokens") or r.get("token_count") or 0 for r in runs),
                          "historical_collection_cost": "unknown unless recorded by the original collector; replay cost is not original acquisition cost"},
            "limitations": ["Organisations and locations are provisional discovery records, not verified legal entities or active buyers.",
                            "Zero records means none discovered; it does not mean zero businesses exist.",
                            "Location records are operating-site/programme candidates, not independently verified distinct buildings; collocated tenants/programmes may share an address.",
                            "Physical-site candidate totals exclude explicit mailing/registered addresses, virtual sites and programme-site records. Unknown location types remain untyped candidates; none of these counts verifies occupancy or distinct buildings.",
                            "The business/organisation candidate view excludes only explicit non_organisation_place_candidate context flags; unknown/unclassified records remain included. Full account/evidence exports retain every record.",
                            "No market-completeness percentage is calculated. Finite roster matching requires a named roster/date and comparable benchmark evidence.",
                            "Municipalities may carry source-backed Ontario LIO identifiers; unresolved parent assertions, community boundaries and composite labels remain held for review. LIO MUNID is not a StatCan CSDUID crosswalk.",
                            "Broad source applicability does not establish an executed search in a narrower sector or community.",
                            "Multiple source families may copy the same publisher; overlap alone is not independent corroboration.",
                            "Source discovery tasks are research-only and do not confer outreach permission."]}


def _next_action(status):
    return {"not_searched": "Find an appropriate source for this geography and source family; record access, scope and reuse conditions.",
            "searched_no_source_found": "Investigate an alternative publisher or source family; retain the unsuccessful search evidence.",
            "access_blocked": "Use a permitted alternative or manual import; record the access restriction.",
            "stale": "Refresh the source within its access and reuse limits; retain historical assertions.",
            "source_identified": "Validate access, reuse rights, source scope and a sample before ingestion.",
            "ingestion_pending": "Run the configured bounded adapter and reconcile source IDs/counts.",
            "partially_ingested": "Resume the cursor or inspect missing pages, uncertain scope and sector classifications."}.get(status, "Review source evidence and remaining gaps.")


_EXPORT_TABLES = {"organisations", "organisation_aliases", "locations", "properties", "domains", "relationships",
                  "evidence", "sources", "source_runs", "raw_records", "purchasing_routes", "contact_channels", "people",
                  "discovery_queue", "review_queue", "geographies", "geography_aliases", "coverage_cells", "external_ids", "identity_audit",
                  "organisation_resolution_links", "relationship_invocations", "relationship_page_receipts", "relationship_page_artifacts", "source_identities", "field_assertion_lineage"}


def _csv_value(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        value = json.dumps(value, sort_keys=True, ensure_ascii=False)
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + value
    return value


def _write_dataset(output, name, rows, columns=None, *, expected_count=None, jsonl_only=False):
    if expected_count is None and hasattr(rows, "__len__"):
        expected_count = len(rows)
    compressed = jsonl_only or (expected_count is not None and expected_count >= 25000)
    rows = iter(rows)
    if columns is None:
        first = next(rows, None)
        columns = list(first) if first else []
        rows = itertools.chain([first], rows) if first is not None else iter(())
    suffix = ".gz" if compressed else ""
    csv_path = output / f"{name}.csv{suffix}"
    json_path = output / f"{name}.jsonl{suffix}"
    count = 0
    with ExitStack() as stack:
        def open_text(path):
            if compressed:
                binary = stack.enter_context(path.open("wb"))
                zipped = stack.enter_context(gzip.GzipFile(filename="", mode="wb", fileobj=binary, mtime=0))
                return stack.enter_context(io.TextIOWrapper(zipped, encoding="utf-8", newline=""))
            return stack.enter_context(path.open("w", newline="", encoding="utf-8"))
        json_handle = open_text(json_path)
        writer = None
        if not jsonl_only:
            writer = csv.DictWriter(open_text(csv_path), fieldnames=columns, extrasaction="ignore")
            writer.writeheader()
        for row in rows:
            row = dict(row)
            if writer is not None:
                writer.writerow({k: _csv_value(row.get(k)) for k in columns})
            json_handle.write(json.dumps(row, sort_keys=True, ensure_ascii=False) + "\n")
            count += 1
    def checksum(path):
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1_048_576), b""):
                digest.update(block)
        return digest.hexdigest()
    return {"rows": count, "csv": csv_path.name if not jsonl_only else None, "jsonl": json_path.name,
            "compression": "gzip" if compressed else None,
            "sha256_csv": checksum(csv_path) if not jsonl_only else None, "sha256_jsonl": checksum(json_path)}


def _accounts(store, *, business_only=False):
    """Stream the flat view; SQL groups provenance once rather than per account."""
    contacts = defaultdict(list)
    details = store.db.execute("SELECT 1 FROM sqlite_master WHERE name='phone_channel_details'").fetchone()
    query = "SELECT c.organisation_id,c.location_id,c.id,c.channel_type,c.value,c.outreach_eligibility,c.suppression_status"
    query += ",d.extension,d.raw_value,d.format_status,d.normalizer_version FROM contact_channels c LEFT JOIN phone_channel_details d ON d.channel_id=c.id" if details else " FROM contact_channels c"
    for c in store.db.execute(query):
        contacts[c["organisation_id"]].append(dict(c))
    relations = {r[0]: r[1] for r in store.db.execute("SELECT subject_id,COUNT(*) FROM relationships GROUP BY subject_id")}
    has_lineage = store.db.execute("SELECT 1 FROM sqlite_master WHERE name='field_assertion_lineage' AND type IN ('table','view')").fetchone()
    lineage = "field_assertion_lineage" if has_lineage else "field_assertions"
    sql = """
    WITH assertion_evidence AS (
        SELECT entity_id,GROUP_CONCAT(DISTINCT evidence_id) AS evidence_ids
        FROM """ + lineage + """ GROUP BY entity_id
    ), org_sources AS (
        SELECT i.organisation_id,GROUP_CONCAT(DISTINCT r.source_id) AS source_ids
        FROM source_run_items i JOIN source_runs r ON r.id=i.run_id
        WHERE i.organisation_id IS NOT NULL GROUP BY i.organisation_id
    ), discovery_classifications AS (
        SELECT entity_id,
            JSON_GROUP_ARRAY(DISTINCT CASE WHEN taxonomy='ssm_discovery_context' THEN category END) AS context_flags,
            JSON_GROUP_ARRAY(DISTINCT CASE WHEN taxonomy='ssm_industry_family' THEN category END) AS industry_families
        FROM classifications WHERE taxonomy IN ('ssm_discovery_context','ssm_industry_family') GROUP BY entity_id
    )
    SELECT o.id AS organisation_id,l.id AS location_id,o.legal_name,o.trading_name,o.entity_type,
           o.status AS organisation_status,o.primary_domain,l.address_raw,l.city_raw,l.municipality_id,
           l.postal_code,l.province,l.location_type,o.first_seen_at,o.last_seen_at,
           oe.evidence_ids AS org_evidence_ids,le.evidence_ids AS location_evidence_ids,s.source_ids,
           dc.context_flags AS discovery_context_flags,dc.industry_families AS industry_family_ids
    FROM organisations o LEFT JOIN locations l ON l.organisation_id=o.id
    LEFT JOIN assertion_evidence oe ON oe.entity_id=o.id
    LEFT JOIN assertion_evidence le ON le.entity_id=l.id
    LEFT JOIN org_sources s ON s.organisation_id=o.id
    LEFT JOIN discovery_classifications dc ON dc.entity_id=o.id
    """
    if business_only:
        sql += """ WHERE NOT EXISTS(SELECT 1 FROM classifications excluded WHERE excluded.entity_id=o.id
            AND excluded.taxonomy='ssm_discovery_context' AND excluded.category='non_organisation_place_candidate')"""
    sql += " ORDER BY o.id,l.id"
    for record in store.db.execute(sql):
        row = dict(record)
        ident, location_id = row["organisation_id"], row["location_id"]
        channels = [c for c in contacts.get(ident, ()) if c["location_id"] is None or c["location_id"] == location_id]
        org_evidence = (row.pop("org_evidence_ids") or "").split(",")
        loc_evidence = (row.pop("location_evidence_ids") or "").split(",")
        row["evidence_ids"] = sorted(set(org_evidence + loc_evidence) - {""})
        row["source_ids"] = sorted(set((row.get("source_ids") or "").split(",")) - {""})
        row["discovery_context_flags"] = sorted(x for x in _json(row["discovery_context_flags"], []) if x)
        row["industry_family_ids"] = sorted(x for x in _json(row["industry_family_ids"], []) if x)
        row["explicit_non_organisation_place_candidate"] = "non_organisation_place_candidate" in row["discovery_context_flags"]
        row["business_or_organisation_candidate_view_eligible"] = not row["explicit_non_organisation_place_candidate"]
        row.update({"published_emails": sorted({c["value"] for c in channels if c["channel_type"] == "email"}),
                    "published_phones": sorted({c["value"] for c in channels if c["channel_type"] in {"phone", "telephone"}}),
                    "phone_channel_details": [c for c in channels if c['channel_type'] in {'phone','telephone','fax'}],
                    "contact_channel_ids": [c["id"] for c in channels],
                    "contact_eligibility": sorted({c["outreach_eligibility"] for c in channels}) or ["research_only"],
                    "suppression_statuses": sorted({c["suppression_status"] for c in channels}) or ["unknown"],
                    "campaign_ready": False,
                    "suppressed_channel_present": any(c["suppression_status"] not in {"clear", "not_suppressed", "none", "unknown"} for c in channels),
                    "outgoing_relationship_count": relations.get(ident, 0)})
        yield row


def blocked_source_handoff(store):
    """Concrete operator handoff for observed blocks and unresolved restrictions.

    An unsearched source with unknown rights is a research gap, not an observed
    access block. Manual review must still follow publisher access/reuse terms.
    """
    runs = defaultdict(list)
    for run in _rows(store, "source_runs"):
        runs[run["source_id"]].append(run)
    handoff = []
    for source in _rows(store, "sources"):
        config = _json(source.get("config_json"), {}) or {}
        rights = source.get("rights_status") or "unreviewed"
        rights_blocked = rights in {"prohibited", "not_permitted", "restricted", "permission_review_required", "commercial_use_prohibited", "licence_conflict"}
        permission_conflict = bool(config.get("licence_conflict") or config.get("license_conflict") or config.get("permission_conflict"))
        access_blocked = source.get("retrieval_status") in BLOCKED
        if not (rights_blocked or permission_conflict or access_blocked):
            continue
        source_runs = sorted(runs[source["id"]], key=lambda r: r["started_at"], reverse=True)
        failed = next((r for r in source_runs if r.get("error_message")), None)
        errors = failed.get("error_message") if failed else None
        reason = "Publisher permission restriction" if rights_blocked else "Competing licence metadata requires review" if permission_conflict else "Observed access restriction or service failure"
        if rights_blocked or permission_conflict:
            next_step = "Open the publisher source and terms links to resolve the recorded restriction. Import only material whose commercial reuse is confirmed; retain the licence evidence. A manual copy does not override publisher restrictions."
        else:
            next_step = "Open the publisher source URL for manual review. Use a permitted official export or public API if available, or a different source; preserve source/observation/licence metadata with any permitted manual import. Do not bypass sign-in, CAPTCHA, robots rules or access limits."
        handoff.append({"source_id": source["id"], "name": source["name"], "source_url": source["source_url"],
                        "terms_url": source.get("terms_url"), "retrieval_status": source.get("retrieval_status"),
                        "rights_status": rights, "block_reason": reason, "latest_recorded_error": errors,
                        "latest_error_run_id": failed["id"] if failed else None, "source_notes": source.get("notes"),
                        "last_checked_at": source.get("last_checked_at"), "permitted_next_step": next_step,
                        "bulk_reuse_permission_confirmed": rights in {"permitted", "licensed_open", "open_licence", "open_license", "reviewed_permitted"} and not permission_conflict,
                        "automatic_bypass_authorized": False})
    return sorted(handoff, key=lambda r: r["name"])


def _source_run_export_rows(rows):
    for record in rows:
        row = dict(record)
        metadata = _json(row.get("metadata_json"), {}) or {}
        row["stored_requests"] = row.get("requests")
        row["stored_bytes_fetched"] = row.get("bytes_fetched")
        for field, flag in [("requests", "request_count_known"), ("bytes_fetched", "transfer_bytes_known")]:
            unknown = row.get(field) is None or (field in metadata and metadata[field] is None) or metadata.get(flag) is False
            row[flag] = not unknown
            if unknown:
                row[field] = None
        yield row


def export_all(store, output_path):
    output = Path(output_path)
    output.mkdir(parents=True, exist_ok=True)
    report = coverage_report(store)
    manifest = {"generated_at": _now(), "schema": "ssm-market-map-export-v1", "datasets": {},
                "counts": report["counts"], "campaign_enrolment": "disabled; research-only exports",
                "csv_policy": "Text that could be interpreted as a spreadsheet formula is prefixed with an apostrophe; JSONL preserves original values."}
    for table in sorted(_EXPORT_TABLES | {"field_assertions", "classifications", "source_run_items", "geography_service_areas"}):
        info = list(store.db.execute(f'PRAGMA table_info("{table}")'))
        columns = [r["name"] for r in info]
        if table == "raw_records":
            columns = [c for c in columns if c != "payload_json"]
        primary = [r["name"] for r in sorted(info, key=lambda r: r["pk"]) if r["pk"]]
        ordering = primary or (["id"] if "id" in columns else columns[:1])
        order_sql = ",".join('"' + c + '"' for c in ordering)
        projection = ",".join('"' + c + '"' for c in columns)
        relation_type = store.db.execute("SELECT type FROM sqlite_master WHERE name=?", (table,)).fetchone()
        # Expanding compact assertion groups and sorting millions of generated
        # rows wastes disk. Stream the compatibility view; original IDs remain
        # the join contract irrespective of physical row order.
        ordering_sql = "" if relation_type and relation_type[0] == "view" else " ORDER BY " + order_sql
        rows = store.db.execute(f'SELECT {projection} FROM "{table}"' + ordering_sql) if columns else iter(())
        count = store.db.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] if columns else 0
        if table == "source_runs":
            rows = _source_run_export_rows(rows)
            columns += ["request_count_known", "transfer_bytes_known", "stored_requests", "stored_bytes_fetched"]
        manifest["datasets"][table] = _write_dataset(output, table, rows, columns, expected_count=count)
    def payloads():
        for raw in store.db.execute("SELECT id,payload_json FROM raw_records ORDER BY id"):
            payload = store.get_raw_payload(raw["id"]) if hasattr(store, "get_raw_payload") else json.loads(raw["payload_json"])
            yield {"raw_record_id": raw["id"], "payload": payload}
    manifest["datasets"]["raw_payloads"] = _write_dataset(output, "raw_payloads", payloads(),
        ["raw_record_id", "payload"], expected_count=report["counts"]["evidence"], jsonl_only=True)
    for name, data in [("accounts", _accounts(store)), ("business-organisation-candidates", _accounts(store, business_only=True)), ("coverage", report["cells"]),
                       ("next_source_queue", report["next_source_queue"]), ("source_yield", report["source_yield"]),
                       ("service_footprint", report["footprint"]), ("blocked-source-handoff", blocked_source_handoff(store))]:
        expected_count = None
        if name in {"accounts", "business-organisation-candidates"}:
            expected_count = store.db.execute("SELECT COUNT(*) FROM organisations o LEFT JOIN locations l ON l.organisation_id=o.id").fetchone()[0]
        manifest["datasets"][name] = _write_dataset(output, name, data, expected_count=expected_count)
    city_summary = [dict(r) for r in store.db.execute("""WITH excluded AS(
        SELECT DISTINCT entity_id FROM classifications WHERE taxonomy='ssm_discovery_context' AND category='non_organisation_place_candidate')
        SELECT l.city_raw,l.province,l.country,l.municipality_id,COUNT(*) AS location_records,
        COUNT(DISTINCT l.organisation_id) AS provisional_organisation_records,
        COUNT(DISTINCT CASE WHEN excluded.entity_id IS NULL THEN l.organisation_id END) AS business_or_organisation_candidate_records,
        COUNT(DISTINCT CASE WHEN excluded.entity_id IS NOT NULL THEN l.organisation_id END) AS explicit_non_organisation_place_candidates,
        SUM(CASE WHEN l.location_type IN ('mailing_address','registered_address','registered_mailing_address','po_box','postal_route') THEN 1 ELSE 0 END) mail_route_location_records,
        SUM(CASE WHEN l.location_type IN ('virtual','remote_or_virtual') THEN 1 ELSE 0 END) virtual_location_records,
        SUM(CASE WHEN l.location_type IN ('programme','programme_site','program_site') THEN 1 ELSE 0 END) programme_location_records,
        SUM(CASE WHEN l.location_type NOT IN ('mailing_address','registered_address','registered_mailing_address','po_box','postal_route','virtual','remote_or_virtual','programme','programme_site','program_site') THEN 1 ELSE 0 END) physical_site_candidate_records,
        COUNT(DISTINCT l.address_normalized) AS distinct_normalized_address_candidates
        FROM locations l LEFT JOIN excluded ON excluded.entity_id=l.organisation_id
        GROUP BY l.city_raw,l.province,l.country,l.municipality_id ORDER BY location_records DESC,l.city_raw""")]
    categories = [dict(r) for r in store.db.execute("""WITH excluded AS(
        SELECT DISTINCT entity_id FROM classifications WHERE taxonomy='ssm_discovery_context' AND category='non_organisation_place_candidate')
        SELECT c.taxonomy,c.category,COUNT(DISTINCT c.entity_id) AS classified_entity_records,
        COUNT(*) AS evidence_backed_classification_assertions,
        COUNT(DISTINCT CASE WHEN excluded.entity_id IS NULL THEN c.entity_id END) AS business_or_organisation_candidate_entities
        FROM classifications c LEFT JOIN excluded ON excluded.entity_id=c.entity_id
        GROUP BY c.taxonomy,c.category ORDER BY c.taxonomy,classified_entity_records DESC,c.category""")]
    manifest["datasets"]["city-summary"] = _write_dataset(output, "city-summary", city_summary)
    manifest["datasets"]["category-summary"] = _write_dataset(output, "category-summary", categories)
    # Explicitly empty until a separately authorized CRM/channel review produces
    # a campaign contract. Public contact details alone never qualify a record.
    manifest["datasets"]["campaign_ready"] = _write_dataset(output, "campaign_ready", [],
        ["organisation_id", "location_id", "contact_channel_id", "outreach_eligibility", "suppression_status"])
    compact = {k: v for k, v in report.items() if k not in {"cells", "next_source_queue"}}
    compact["coverage_grid_rows"] = len(report["cells"])
    compact["next_source_queue_rows"] = len(report["next_source_queue"])
    compact["next_source_queue_preview"] = report["next_source_queue"][:25]
    (output / "coverage-report.json").write_text(json.dumps(compact, indent=2, ensure_ascii=False) + "\n")
    (output / "topline.json").write_text(json.dumps({"generated_at": report["generated_at"], "counts": report["counts"],
        "run_costs": report["run_costs"], "relationship_wave_costs": report["relationship_wave_costs"],
        "scope": "Provisional discovery/account/location records; not a count of independently verified companies or buildings.",
        "large_file_policy": "Datasets with at least25,000 rows use streamed gzip CSV and JSONL. Original raw payloads use one lossless JSONL.gz dataset; raw_records contains metadata/references."}, indent=2) + "\n")
    lines = ["# SSM commercial market map — coverage report", "", f"Generated: {report['generated_at']}", "",
             f"Provisional organisations: {report['counts']['organisations']:,}; location/address records: {report['counts']['locations']:,}; physical-site candidates: {report['counts']['physical_site_candidate_records']:,}.",
             f"Explicit mailing/registered address routes: {report['counts']['mail_route_location_records']:,}; virtual records: {report['counts']['virtual_location_records']:,}; programme-site records: {report['counts']['programme_location_records']:,}. Unknown location types remain candidates, not verified buildings.",
             f"Configured service labels: {report['counts']['configured_labels']}; distinct configured geographies: {report['counts']['configured_geographies']}.",
             f"Sources: {report['counts']['sources']}; recorded source runs: {report['counts']['source_runs']}.",
             f"Unmapped location candidates: {report['counts']['unmapped_locations']}; organisations without an explicit SSM industry mapping: {report['counts']['unclassified_organisations']}.",
             "", "## Coverage operations", "", "| Status | Cells |", "| --- | ---: |"]
    lines += [f"| {status} | {count:,} |" for status, count in sorted(report["coverage_status_counts"].items())]
    lines += ["", "The all-sector (`*`) lane records broad collection. Sector rows require their own scope/evidence; a completed directory is not a completed market.",
              "", "## Run resources", "", "```json", json.dumps(report["run_costs"], indent=2), "```", "",
              "## Relationship-wave resources", "", "```json", json.dumps(report["relationship_wave_costs"], indent=2), "```", "",
              "## Next research actions", ""]
    for item in report["next_source_queue"][:20]:
        lines.append(f"- **{item['geography']} / {item['sector_id']} / {item['source_lane']}**: {item['next_action']}")
    lines += ["", "## Limitations", ""] + [f"- {x}" for x in report["limitations"]]
    (output / "COVERAGE-REPORT.md").write_text("\n".join(lines) + "\n")
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    return manifest
