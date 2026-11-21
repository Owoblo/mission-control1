"""Read-only source audit; writes a proposed shared label catalog, never runtime settings.

Run: python3 -m scripts.market_map.reconcile_coverage_catalogs
IDs identify Ontario service labels, not verified municipal entities or boundaries.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

REGIONS = {"WINDSOR_ESSEX": "windsor", "CHATHAM_KENT": "chatham-kent",
           "SARNIA_LAMBTON": "sarnia", "LONDON_MIDDLESEX": "london",
           "WOODSTOCK_OXFORD": "woodstock", "WKG": "WKG", "OTTAWA": "ottawa", "GTA_HAMILTON": "gta"}
COMPOSITES = {"Greely Metcalfe Osgoode Vernon And Area", "Lower Town Sandy Hill",
              "Stittsville Munster Richmond"}


def normalize_label(value):
    """Only spelling punctuation/diacritics; never strip municipal qualifiers."""
    text = unicodedata.normalize("NFKD", value).casefold()
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in text if not unicodedata.combining(c)))


def canonical_key(value):
    key = normalize_label(value)
    return "gta" if key == "greatertorontoarea" else key


def label_id(value):
    return "coverage_on_" + hashlib.sha256(canonical_key(value).encode()).hexdigest()[:20]


def runtime_array(text, name):
    match = re.search(r"export\s+const\s+" + name + r"\s*=\s*(\[.*?\])\s*;", text, re.S)
    if not match:
        raise ValueError(f"Missing runtime array {name}")
    result = json.loads(match.group(1))
    if not result or not all(isinstance(x, str) for x in result):
        raise ValueError(f"Invalid runtime array {name}")
    return result


def grome_geography(text):
    seed = text.split("const seed:", 1)[1].split("export const slug", 1)[0]
    groups = re.findall(r"\['([^']+)',\s*'([^']+)',\s*`([^`]+)`\]", seed)
    if not groups:
        raise ValueError("Navigator seed format not recognized")
    rows = []
    for region, region_name, names in groups:
        for name in names.split("|"):
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            rows.append({"label": name, "source": "navigator_primary", "region": REGIONS[region],
                         "source_region": region, "source_region_label": region_name,
                         "source_id": f"loc_{slug}_on", "source_kind": "primary_location"})
    listing = re.search(r"export const listingAreas = \[(.*?)\]\.map", text, re.S)
    if not listing:
        raise ValueError("Navigator listing areas format not recognized")
    for name in re.findall(r"'([^']+)'", listing.group(1)):
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        rows.append({"label": name, "source": "navigator_listing", "region": "ottawa",
                     "source_region": "OTTAWA", "source_id": f"loc_{slug}_on",
                     "source_kind": "listing_area"})
    return rows


def dump_csv(path, rows, columns):
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: json.dumps(row.get(k), ensure_ascii=False) if isinstance(row.get(k), (dict, list)) else row.get(k, "") for k in columns})


def category_audit(repo, grome):
    text = (grome / "src/categories.ts").read_text()
    group_text = text.split("export const categoryGroups:", 1)[1].split("export const categories:", 1)[0]
    groups = {name: re.findall(r"'([^']+)'", body) for name, body in
              re.findall(r"'([^']+)':\s*\[(.*?)\]", group_text, re.S)}
    shortcuts = [x for labels in groups.values() for x in labels]
    taxonomy = json.loads((grome / "hub/taxonomy/reference/naics-canada-2022.json").read_text())
    routes = json.loads((grome / "hub/playbooks/generated-category-source-routing.json").read_text())
    counts = Counter()
    leaves = Counter()
    with (repo / "partnership-system/catalogs/classifications.csv").open() as stream:
        for row in csv.DictReader(stream):
            counts[row["system"]] += 1
            if row["level"] == ("4" if row["system"] in {"ISCO-08", "ISIC-5"} else "5"):
                leaves[row["system"]] += 1
    crm = (repo / "lib/partner-categories.ts").read_text().split("export const PARTNER_CATEGORIES:", 1)[1]
    ids = re.findall(r"^\s+id: '([^']+)'", crm, re.M)
    route_codes = [x["taxonomyCode"] for x in routes["routes"]]
    return {"navigator_shortcut_groups": len(groups), "navigator_shortcuts": len(shortcuts),
            "navigator_unique_shortcuts": len(set(shortcuts)), "navigator_groups": {k: len(v) for k, v in groups.items()},
            "navigator_naics_structure_rows": len(taxonomy["structure"]),
            "navigator_naics_leaf_rows": len(taxonomy["canadianIndustries"]),
            "navigator_source_routes_declared": routes["categoryCount"],
            "navigator_source_routes_observed": len(route_codes), "navigator_unique_route_codes": len(set(route_codes)),
            "root_classification_rows_by_system": dict(counts), "root_leaf_rows_by_system": dict(leaves),
            "crm_partner_category_count": len(ids), "crm_partner_category_ids": ids,
            "interpretation": "Query shortcuts, official classification leaves, source routing recipes and CRM categories are separate layers. Counts do not prove implemented collectors, completed searches, qualified leads or 1000 deployed outreach categories."}


def reconcile(repo, grome, output, coverage):
    paths = {"navigator_geography": grome / "src/geography.ts", "navigator_hub_geography_readme": grome / "hub/geography/README.md",
             "service_catalog": repo / "partnership-system/catalogs/service-areas.json", "runtime": repo / "lib/partnership-core/markets.mjs",
             "gta": repo / "lib/data/gta-service-cities.json", "coverage": coverage,
             "navigator_categories": grome / "src/categories.ts", "navigator_taxonomy": grome / "hub/taxonomy/reference/naics-canada-2022.json",
             "navigator_routes": grome / "hub/playbooks/generated-category-source-routing.json",
             "root_classifications": repo / "partnership-system/catalogs/classifications.csv", "crm_categories": repo / "lib/partner-categories.ts"}
    observations = grome_geography(paths["navigator_geography"].read_text())
    catalog = json.loads(paths["service_catalog"].read_text())["locations"]
    for row in catalog:
        observations.append({"label": row["location"], "source": "service_catalog", "region": row["region"], "source_kind": row["kind"]})
    runtime = paths["runtime"].read_text()
    for name, source in [("serviceLocations", "runtime_configured"), ("activeLocations", "runtime_active")]:
        observations.extend({"label": x, "source": source, "region": "", "source_kind": "runtime_label"} for x in runtime_array(runtime, name))
    observations.extend({"label": x, "source": "gta_config", "region": "toronto", "source_kind": "gta_service_label"} for x in json.loads(paths["gta"].read_text()))
    with coverage.open() as stream:
        coverage_rows = list(csv.DictReader(stream))
    for row in coverage_rows:
        observations.append({"label": row["configured_label"], "source": "saved_coverage", "region": row["configured_catchments"],
                             "source_kind": "saved_coverage_label", "saved_coverage": row})
    grouped = defaultdict(list)
    for row in observations:
        grouped[canonical_key(row["label"])].append(row)
    rows = []
    for key, members in sorted(grouped.items()):
        aliases = sorted({m["label"] for m in members})
        source_names = sorted({m["source"] for m in members})
        source_regions = {source: sorted({m["region"] for m in members if m["source"] == source and m["region"]}) for source in source_names}
        navigator_regions = set(source_regions.get("navigator_primary", []) + source_regions.get("navigator_listing", []))
        catalog_regions = set(source_regions.get("service_catalog", []))
        old_coverage = [m["saved_coverage"] for m in members if "saved_coverage" in m]
        kind = "composite_search_label" if any(a in COMPOSITES for a in aliases) else "metro_search_label" if key == "gta" else "locality_or_municipality_unverified"
        rows.append({"coverage_label_id": label_id(aliases[0]), "canonical_label": "GTA" if key == "gta" else aliases[0],
                     "aliases": aliases, "kind": kind, "municipality_id": None, "jurisdiction_status": "not_verified_by_this_audit",
                     "source_memberships": source_names, "source_regions": source_regions,
                     "source_ids": sorted({m["source_id"] for m in members if m.get("source_id")}),
                     "region_difference": bool(navigator_regions and catalog_regions and navigator_regions != catalog_regions),
                     "missing_navigator": not any(s.startswith("navigator_") for s in source_names),
                     "missing_service_catalog": "service_catalog" not in source_names,
                     "configured_runtime": "runtime_configured" in source_names, "active_runtime": "runtime_active" in source_names,
                     "saved_coverage_statuses": sorted({r["coverage_status"] for r in old_coverage}),
                     "saved_locality_references": sorted({r["resolved_locality_id"] for r in old_coverage if r["resolved_locality_id"]}),
                     "saved_municipality_labels": sorted({r["resolved_municipality"] for r in old_coverage if r["resolved_municipality"]}),
                     "saved_coverage_evidence": old_coverage})
    output.mkdir(parents=True, exist_ok=True)
    (output / "coverage-labels.json").write_text(json.dumps({"schema_version": 1, "status": "proposed_shared_catalog_not_runtime_installed", "rows": rows}, indent=2)+"\n")
    columns = [k for k in rows[0] if k != "saved_coverage_evidence"]
    dump_csv(output / "coverage-labels.csv", rows, columns)
    dump_csv(output / "source-memberships.csv", observations, ["label", "source", "region", "source_kind", "source_id"])
    counts = Counter(m["source"] for m in observations)
    summary = {"source_rows": dict(counts), "source_canonical_label_counts": {s: len({canonical_key(m["label"]) for m in observations if m["source"] == s}) for s in counts},
               "union_raw_spellings": len({m["label"] for m in observations}),
               "source_region_counts": {source: dict(Counter(m["region"] for m in observations if m["source"] == source and m["region"])) for source in counts},
               "union_canonical_service_labels": len(rows), "alias_groups": [r["aliases"] for r in rows if len(r["aliases"]) > 1],
               "missing_navigator_labels": [r["canonical_label"] for r in rows if r["missing_navigator"]],
               "missing_service_catalog_labels": [r["canonical_label"] for r in rows if r["missing_service_catalog"]],
               "region_differences": [r for r in rows if r["region_difference"]],
               "gta_labels_missing_navigator": [r["canonical_label"] for r in rows if r["missing_navigator"] and "gta_config" in r["source_memberships"]],
               "runtime_inactive_labels": [r["canonical_label"] for r in rows if r["configured_runtime"] and not r["active_runtime"]],
               "saved_coverage_status_counts": dict(Counter(r["coverage_status"] for r in coverage_rows)),
               "owner_count_claims": {"249": "not_assumed", "approximately_219": "not_assumed"},
               "categories": category_audit(repo, grome),
               "source_files": {name: {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for name, path in paths.items()},
               "limitations": ["Label reconciliation is not municipal boundary verification. Existing locality/municipality references are preserved as historical evidence, not newly endorsed.",
                               "Aliases are not additional municipalities. A locality is never merged with its parent merely because the parent contains it.",
                               "Runtime active status is configuration, not outreach permission or live sender health.",
                               "Saved coverage is a dated observation, not proof of exhaustive search or current inventory counts."]}
    (output / "summary.json").write_text(json.dumps(summary, indent=2)+"\n")
    (output / "integration-notes.txt").write_text(
        "PROPOSED SHARED COVERAGE CATALOG — NOT INSTALLED INTO RUNTIME\n\n"
        "Rebuild: python3 -m scripts.market_map.reconcile_coverage_catalogs\n"
        "Override --grome, --coverage or --output to audit another snapshot. All source files are read-only.\n\n"
        "coverage-labels.csv is the reviewable cross-source union. coverage-labels.json also preserves historical coverage rows. "
        "source-memberships.csv retains each original spelling, source and region. summary.json records exact input hashes and category counts.\n\n"
        "Integration steps:\n"
        "1. Adopt coverage_label_id as a proposed service-label join key; preserve every upstream location ID and original spelling. "
        "Do not rewrite existing entity IDs or fold a community into its municipality. Official municipality IDs remain unset by this audit.\n"
        "2. Add a reviewed GTA service group to the navigator from the 29 existing GTA config labels. "
        "Keep GTA/Greater Toronto Area as a metro query alias, not another municipality. No grome files were changed.\n"
        "3. Keep the four navigator listing areas separate from primary localities; three are composite search phrases. "
        "Blandford Blenheim is a spelling alias already represented by Blandford-Blenheim.\n"
        "4. Join acquisition receipts and source attempts by coverage_label_id + category system/code (or shortcut ID) + source ID. "
        "Store status, cursor, last attempted time, evidence path and partial/exhausted/error reason. "
        "Do not mark a cell complete because a route recipe exists or its parent municipality has business records.\n"
        "5. Crosswalk the 313 navigator shortcuts, 923 Canadian NAICS leaves/source routes and 21 CRM categories explicitly. "
        "They are different layers; US NAICS 1012 leaves do not prove 1000 Canadian collectors or outreach templates.\n"
        "6. Retain configured runtime vs active runtime separately. Historical Ottawa holds in old catalogs and current sender readiness "
        "must be reconciled by the operational system, not changed by this catalog report.\n\n"
        "Counts include localities, municipalities, aliases and composite/metro search labels. "
        "Neither 219 nor 249 is assumed to be a count of distinct cities. "
        "No geography completeness, jurisdiction verification or live collection-health claim is made.\n")
    return summary


def main():
    repo = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--grome", type=Path, default=Path("/Users/owoblo/Downloads/grome"))
    parser.add_argument("--output", type=Path, default=repo / "artifacts/coverage-catalog-reconciliation-20261027")
    parser.add_argument("--coverage", type=Path, default=repo / "partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26/rural-label-coverage/configured-label-coverage.csv")
    args = parser.parse_args()
    result = reconcile(repo, args.grome, args.output, args.coverage)
    print(json.dumps({k: result[k] for k in ["source_rows", "union_canonical_service_labels", "alias_groups", "missing_navigator_labels", "region_differences", "categories"]}, indent=2))


if __name__ == "__main__":
    main()
