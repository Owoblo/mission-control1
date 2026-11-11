"""Reconcile configured service labels without confusing sales areas with cities.

The hierarchy below is an internal routing aid, not an official boundary dataset.
Official identifiers stay empty until an official source supplies them. Every
runtime label is retained, including composite labels that require review.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


def normalise_locality(value):
    value = unicodedata.normalize("NFKD", str(value or ""))
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in value if not unicodedata.combining(c)).lower())


def geography_id(name, kind="municipality"):
    return "geo_" + hashlib.sha256(f"CA|ON|{kind}|{normalise_locality(name)}".encode()).hexdigest()[:24]


AREA_LABELS = {
    "windsor": "Windsor / Essex County",
    "chatham-kent": "Chatham-Kent service area",
    "sarnia": "Sarnia / Lambton service area",
    "london": "London / Middlesex / Elgin service area",
    "woodstock": "Woodstock / Oxford service area",
    "WKG": "Kitchener / Waterloo / Cambridge / Guelph service area",
    "ottawa": "Ottawa and surrounding service communities",
    "toronto": "Toronto / GTA / Hamilton service area",
}

# Membership in these upper-tier units is distinct from the operational areas.
# Single-tier/separated municipalities deliberately have Ontario as their parent.
UPPER_TIERS = {
    "Essex County": "county", "Lambton County": "county", "Middlesex County": "county",
    "Elgin County": "county", "Oxford County": "county", "Wellington County": "county",
    "Huron County": "county", "Perth County": "county", "Dufferin County": "county",
    "Lanark County": "county", "Renfrew County": "county",
    "United Counties of Prescott and Russell": "united_counties",
    "United Counties of Stormont, Dundas and Glengarry": "united_counties",
    "United Counties of Leeds and Grenville": "united_counties",
    "Waterloo Region": "region", "Peel Region": "region", "York Region": "region",
    "Durham Region": "region", "Halton Region": "region",
}
MUNICIPALITY_GROUPS = {
    "Essex County": "Amherstburg|Essex|Kingsville|Lakeshore|LaSalle|Leamington|Tecumseh",
    "Lambton County": "Sarnia|Point Edward|St. Clair|Dawn-Euphemia|Petrolia|Oil Springs|Plympton-Wyoming|Warwick|Brooke-Alvinston|Lambton Shores|Enniskillen",
    "Middlesex County": "Lucan Biddulph|North Middlesex|Strathroy-Caradoc|Newbury|Adelaide-Metcalfe|Southwest Middlesex|Middlesex Centre|Thames Centre",
    "Elgin County": "Central Elgin|Southwold|Dutton-Dunwich|West Elgin|Aylmer|Malahide|Bayham",
    "Oxford County": "Woodstock|Ingersoll|Norwich|Tillsonburg|East Zorra-Tavistock|Zorra|South-West Oxford|Blandford-Blenheim",
    "Wellington County": "Puslinch|Guelph-Eramosa|Centre Wellington|Mapleton|Wellington North|Minto|Erin",
    "Waterloo Region": "Kitchener|Waterloo|Cambridge|Woolwich|Wellesley|Wilmot|North Dumfries",
    "Huron County": "Bluewater|South Huron",
    "Perth County": "Perth South|Perth East|North Perth",
    "Dufferin County": "East Garafraxa",
    "Lanark County": "Beckwith|Carleton Place|Lanark Highlands|Mississippi Mills",
    "Renfrew County": "Arnprior|McNab/Braeside",
    "United Counties of Prescott and Russell": "Clarence-Rockland|Russell",
    "United Counties of Stormont, Dundas and Glengarry": "North Dundas",
    "United Counties of Leeds and Grenville": "North Grenville",
    "Peel Region": "Brampton|Caledon|Mississauga",
    "York Region": "Aurora|East Gwillimbury|King|Markham|Newmarket|Richmond Hill|Vaughan|Georgina|Whitchurch-Stouffville",
    "Durham Region": "Ajax|Oshawa|Pickering|Uxbridge|Whitby|Brock|Clarington|Scugog",
    "Halton Region": "Burlington|Milton|Oakville|Halton Hills",
    "Ontario": "Windsor|Chatham-Kent|London|St. Thomas|St. Marys|Guelph|Stratford|Brantford|Brant|Norfolk County|Ottawa|Hamilton|Toronto",
}
# A community is retained as a location and linked to a municipality; it is not
# folded into another locality's physical-location count.
COMMUNITY_GROUPS = {
    "Lakeshore": "Belle River|Comber|Stoney Point|St. Joachim|Puce|Emeryville|Lighthouse Cove",
    "Amherstburg": "Anderdon", "Essex": "Harrow|Colchester", "Kingsville": "Cottam|Ruthven",
    # Town of Tecumseh's official history and Oldcastle planning documents
    # identify Oldcastle as a community within the municipality. This adds
    # research geography, not another runtime service label.
    "Tecumseh": "Maidstone|Oldcastle",
    "Chatham-Kent": "Chatham|Tilbury|Wallaceburg|Dresden|Pain Court|Blenheim|Merlin|Charing Cross|Cedar Springs|Dealtown|Ridgetown|Thamesville|Bothwell|Highgate|Morpeth|Muirkirk|Mitchell’s Bay|Erieau|Shrewsbury|Erie Beach|Wheatley",
    "Sarnia": "Brights Grove", "Plympton-Wyoming": "Camlachie|Wyoming",
    "St. Clair": "Corunna|Mooretown|Courtright|Sombra|Port Lambton|Brigden",
    "Warwick": "Watford", "Brooke-Alvinston": "Alvinston",
    "Lambton Shores": "Forest|Thedford|Grand Bend|Port Franks|Ipperwash|Arkona",
    "Lucan Biddulph": "Lucan", "North Middlesex": "Ailsa Craig|Parkhill",
    "Middlesex Centre": "Ilderton|Komoka|Arva|Delaware",
    "Strathroy-Caradoc": "Strathroy|Mount Brydges", "Adelaide-Metcalfe": "Kerwood",
    "Southwest Middlesex": "Glencoe|Wardsville", "Thames Centre": "Dorchester",
    "Central Elgin": "Belmont|Port Stanley", "Southwold": "Talbotville|Shedden|Fingal",
    "Dutton-Dunwich": "Dutton|Wallacetown", "West Elgin": "West Lorne|Rodney",
    "Malahide": "Springfield", "Bayham": "Vienna|Port Burwell",
    "South-West Oxford": "Sweaburg|Mount Elgin",
    "Norwich": "Burgessville|Otterville|Milldale",
    "Norfolk County": "Courtland|Delhi|Simcoe|Port Dover|Waterford|Port Rowan|St. Williams", "East Zorra-Tavistock": "Tavistock|Innerkip|Hickson",
    "Zorra": "Thamesford|Embro|Kintore", "Blandford-Blenheim": "Drumbo|Princeton|Plattsville|Bright",
    "Brant": "Burford|Cathcart|Paris|Scotland|Oakland", "Perth East": "Shakespeare|Milverton",
    "Woolwich": "Elmira|St. Jacobs|Conestogo|Breslau", "Wilmot": "New Hamburg|Baden",
    "North Dumfries": "Ayr", "Guelph-Eramosa": "Rockwood",
    "Centre Wellington": "Fergus|Elora|Belwood", "Mapleton": "Drayton|Moorefield",
    "Wellington North": "Arthur|Mount Forest", "Minto": "Palmerston|Harriston|Clifford", "Puslinch": "Arkell|Morriston",
    "Lanark Highlands": "Flower Station|Elphin|Watson’s Corners|McDonald’s Corners",
    "North Perth": "Listowel",
    "Ottawa": "Kanata|Nepean|Orleans|Gloucester|Stittsville|Barrhaven|Manotick|Carp|Richmond|Pineview",
    "Clarence-Rockland": "Rockland", "Toronto": "Scarborough|Etobicoke|North York",
}
ALIASES = {"Chatham Kent": "Chatham-Kent", "Blandford Blenheim": "Blandford-Blenheim",
           "Greater Toronto Area": "GTA"}
UNRESOLVED = {
    "McGregor": "Community crosses Essex and Amherstburg; select municipality from street/address evidence.",
    "Beachville": "Community crosses Zorra and South-West Oxford; select municipality from street/address evidence.",
    "Dashwood": "Settlement spans municipal boundaries; select municipality from street/address evidence.",
    "Conestogo Lake": "Lake/recreation-area label spans localities; street/address evidence required.",
    "Greely Metcalfe Osgoode Vernon And Area": "Composite search label; split individual communities before municipality assignment.",
    "Lower Town Sandy Hill": "Composite neighbourhood search label; preserve original and review address.",
    "Stittsville Munster Richmond": "Composite search label; preserve original and review address.",
}
QUALIFIED_COMMUNITIES = {normalise_locality(label): (parent, community)
    for parent, names in COMMUNITY_GROUPS.items() for community in names.split("|")
    for label in (f"{parent} {community}", f"{community} {parent}")}

# NRCan CGNDB has official Oakland named places in both Brant (FCGJY) and
# Essex (FCGJX). A municipal source proves one community's parent, not that a
# publisher's bare locality label necessarily identifies that community.
AMBIGUOUS_LOCALITIES = {normalise_locality("Oakland"): {
    "source_url": "https://geogratis.gc.ca/services/geoname/en/geonames.json?q=Oakland&province=35",
    "official_place_ids": ["FCGJY", "FCGJX"],
    "reason": "Official Oakland named places exist in Brant and Essex; qualified municipality or address-supported context required."}}


def ambiguous_locality(label):
    return normalise_locality(label) in AMBIGUOUS_LOCALITIES


def _runtime_array(text, name):
    match = re.search(r"export\s+const\s+" + re.escape(name) + r"\s*=\s*(\[.*?\])\s*;", text, re.S)
    if not match:
        raise ValueError(f"Configured {name} array missing; refusing incomplete service footprint")
    labels = json.loads(match.group(1))
    if not labels or not all(isinstance(x, str) and x.strip() for x in labels):
        raise ValueError(f"Invalid {name} service labels")
    return labels


def configured_footprint(repo_root=None):
    repo = Path(repo_root) if repo_root else Path(__file__).resolve().parents[2]
    text = (repo / "lib/partnership-core/markets.mjs").read_text()
    runtime = _runtime_array(text, "serviceLocations")
    active = set(_runtime_array(text, "activeLocations"))
    older = json.loads((repo / "partnership-system/catalogs/service-areas.json").read_text())
    by_label = defaultdict(list)
    for row in older["locations"]:
        by_label[row["location"]].append(row["region"])
    gta = set(json.loads((repo / "lib/data/gta-service-cities.json").read_text())) | {"GTA", "Greater Toronto Area"}
    all_labels = list(dict.fromkeys(runtime + [r["location"] for r in older["locations"]] + sorted(gta)))
    return [{"label": label, "areas": by_label[label] or (["toronto"] if label in gta else []),
             "configured_runtime": label in runtime, "active_runtime": label in active,
             "sending_status": "subject_to_contact_review" if label in active else "not_in_active_runtime"}
            for label in all_labels]


def seed_geographies(store, repo_root=None):
    db = store.db
    db.execute("""CREATE TABLE IF NOT EXISTS geography_service_areas(
        geography_id TEXT NOT NULL REFERENCES geographies(id),
        service_area_id TEXT NOT NULL REFERENCES geographies(id), configured_label TEXT NOT NULL,
        source TEXT NOT NULL, sending_status TEXT NOT NULL,
        PRIMARY KEY(geography_id,service_area_id,configured_label))""")
    footprint = configured_footprint(repo_root)
    before = db.execute("SELECT COUNT(*) FROM geographies").fetchone()[0]
    inserted_reviews = 0
    mapping = {n: parent for parent, names in MUNICIPALITY_GROUPS.items() for n in names.split("|")}
    communities = {n: parent for parent, names in COMMUNITY_GROUPS.items() for n in names.split("|")}
    ids = {}

    def add(name, kind, parent=None, notes=None):
        ident = geography_id(name, kind)
        ids[name] = ident
        db.execute("""INSERT INTO geographies(id,name,kind,parent_id,province,country,official_id,discovery_status,notes)
            VALUES(?,?,?,?, 'ON','CA',NULL,'not_searched',?) ON CONFLICT(id) DO NOTHING""",
                   (ident, name, kind, ids.get(parent), json.dumps(notes or {"hierarchy_status": "internal_mapping_unverified", "official_boundary_source": None}, sort_keys=True)))
        return ident

    def alias(name, ident, source):
        aid = "ga_" + hashlib.sha256(f"{ident}|{name}|{source}".encode()).hexdigest()[:24]
        db.execute("""INSERT OR IGNORE INTO geography_aliases(id,geography_id,alias,alias_normalized,source)
            VALUES(?,?,?,?,?)""", (aid, ident, name, normalise_locality(name), source))

    with db:
        add("Ontario", "province", notes={"code": "ON", "scope": "province", "official_identifier_status": "not_loaded"})
        for name, kind in UPPER_TIERS.items():
            add(name, kind, "Ontario")
        for area, label in AREA_LABELS.items():
            add(label, "service_catchment", "Ontario", {"service_code": area, "administrative_boundary": False})
            alias(area, ids[label], "existing_service_area_code")
        for name, parent in sorted(mapping.items()):
            add(name, "municipality", parent)
        for name, parent in sorted(communities.items()):
            add(name, "community", parent)
        add("GTA", "metro_area", "Ontario", {"administrative_boundary": False, "scope": "Greater Toronto Area; does not imply Hamilton boundary inclusion"})
        add("Kettle Point", "indigenous_community", "Ontario", {"hierarchy_status": "municipality_not_assumed", "official_identifier_status": "not_loaded"})
        for row in footprint:
            label = row["label"]
            canonical = ALIASES.get(label, label)
            if canonical not in ids:
                reason = UNRESOLVED.get(label, "Configured locality has no reviewed administrative mapping.")
                add(canonical, "service_area_label" if " " in canonical and label in UNRESOLVED else "locality_unresolved", "Ontario", {"mapping_status": "review_required", "reason": reason})
                rid = "geo_review_" + hashlib.sha256(label.encode()).hexdigest()[:24]
                if db.execute("SELECT 1 FROM review_queue WHERE id=?", (rid,)).fetchone() is None:
                    db.execute("""INSERT INTO review_queue(id,issue_type,candidate_ids,evidence_ids,reason,status,resolution,created_at)
                        VALUES(?, 'geography_mapping', ?, '[]', ?, 'pending', NULL, ?)""", (rid, json.dumps([ids[canonical]]), reason, datetime.now(timezone.utc).isoformat()))
                    inserted_reviews += 1
            alias(label, ids[canonical], "runtime_serviceLocations" if row["configured_runtime"] else "service_catalog")
            alias(canonical, ids[canonical], "canonical_internal_name")
            for area in row["areas"]:
                db.execute("""INSERT INTO geography_service_areas VALUES(?,?,?,?,?)
                    ON CONFLICT(geography_id,service_area_id,configured_label) DO UPDATE SET sending_status=excluded.sending_status""",
                    (ids[canonical], ids[AREA_LABELS[area]], label, "existing_service_configuration", row["sending_status"]))
        # All canonical hierarchy nodes can be resolved without being mislabeled as
        # configured service communities.
        for name, ident in ids.items():
            alias(name, ident, "canonical_internal_name")
        for parent, names in COMMUNITY_GROUPS.items():
            for community in names.split("|"):
                for label in (f"{parent} {community}", f"{community} {parent}"):
                    alias(label, ids[community], "explicit_parent_qualified_community")
    tasks = seed_geography_tasks(store)
    return {"configured_labels": len(footprint), "runtime_labels": sum(r["configured_runtime"] for r in footprint),
            "active_runtime_labels": sum(r["active_runtime"] for r in footprint),
            "service_catchments": len(AREA_LABELS),
            "new_geographies": db.execute("SELECT COUNT(*) FROM geographies").fetchone()[0] - before,
            "unique_configured_geographies": db.execute("SELECT COUNT(DISTINCT geography_id) FROM geography_service_areas").fetchone()[0],
            "new_mapping_reviews": inserted_reviews,
            "research_tasks": tasks,
            "official_ids_loaded": db.execute("SELECT COUNT(*) FROM geographies WHERE official_id IS NOT NULL").fetchone()[0],
            "official_ids_added_by_service_seed": 0,
            "note": "Service labels include aliases, neighbourhoods, catchments and composite searches. Counts are not counts of municipalities; administrative mappings require official-boundary verification."}


def seed_geography_tasks(store):
    """Durable source-research frontier for every locality and source family.

    The executor must select a configured adapter before fetching a source. A
    proposed query is not a performed search. Sector-specific gaps are exported
    by reporting; these tasks cover the all-sector source-discovery operation.
    """
    config = json.loads((Path(__file__).parent / "config/taxonomy.json").read_text())
    db = store.db
    now = datetime.now(timezone.utc).isoformat()
    before = db.execute("SELECT COUNT(*) FROM discovery_queue").fetchone()[0]
    configured = db.execute("""SELECT DISTINCT g.* FROM geography_service_areas m
        JOIN geographies g ON g.id=m.geography_id ORDER BY g.name""").fetchall()
    with db:
        for geo in configured:
            for family in config["source_families"]:
                dedupe = f"geographic_source_research:{geo['id']}:{family}"
                ident = "dq_geo_" + hashlib.sha256(dedupe.encode()).hexdigest()[:24]
                query = f"{geo['name']} Ontario {family.replace('_',' ')}"
                metadata = {"geography_id": geo["id"], "geography_kind": geo["kind"], "source_lane": family,
                            "sector_id": "*", "industry_families_to_review": [x["id"] for x in config["industry_families"]],
                            "execution_status": "planned_not_searched", "requires_configured_adapter": True,
                            "access_and_reuse_review_required": True}
                db.execute("""INSERT OR IGNORE INTO discovery_queue(id,target_url_or_query,task_type,traversal_depth,priority,status,attempts,dedupe_key,metadata_json,created_at,updated_at)
                    VALUES(?,?,'geographic_source_research',0,40,'pending',0,?,?,?,?)""", (ident, query, dedupe, json.dumps(metadata, sort_keys=True), now, now))
        for corridor in config.get("corridor_research_seeds", []):
            dedupe = f"corridor_source_discovery:{corridor.get('city')}:{corridor['label']}"
            ident = "dq_corridor_" + hashlib.sha256(dedupe.encode()).hexdigest()[:24]
            query = f"{corridor['label']} {corridor.get('city') or '[city unresolved]'} Ontario"
            metadata = {**corridor, "execution_status": "planned_not_searched", "source_lane": "corridor_sweep",
                        "requires_configured_adapter": True, "no_street_scrape_implied": True}
            status = "review_required" if not corridor.get("city") else "pending"
            db.execute("""INSERT OR IGNORE INTO discovery_queue(id,target_url_or_query,task_type,traversal_depth,priority,status,attempts,dedupe_key,metadata_json,created_at,updated_at)
                VALUES(?,?,'corridor_source_discovery',0,80,?,0,?,?,?,?)""", (ident, query, status, dedupe, json.dumps(metadata, sort_keys=True), now, now))
            if status == "review_required":
                rid = "geo_review_" + hashlib.sha256(dedupe.encode()).hexdigest()[:24]
                db.execute("""INSERT OR IGNORE INTO review_queue(id,issue_type,candidate_ids,evidence_ids,reason,status,created_at)
                    VALUES(?,'corridor_geography','[]','[]',?,'pending',?)""", (rid, corridor["purpose"], now))
    return {"new_tasks": db.execute("SELECT COUNT(*) FROM discovery_queue").fetchone()[0] - before,
            "source_families_per_configured_geography": len(config["source_families"]),
            "corridor_seed_count": len(config.get("corridor_research_seeds", [])),
            "note": "Research frontier only; tasks are unsearched until a permitted source operation is executed."}


def resolve_geography(store, city, region=None):
    """Return only an unambiguous locality; a region is an optional context hint.

    Composite and unresolved search labels never become physical municipalities.
    A community result retains its community ID; callers can follow parent_id.
    """
    norm = normalise_locality(city)
    if not norm:
        return None
    candidates = store.db.execute("""SELECT DISTINCT g.* FROM geography_aliases a
        JOIN geographies g ON g.id=a.geography_id WHERE a.alias_normalized=?
        AND g.kind IN ('municipality','community','indigenous_community')""", (norm,)).fetchall()
    if not candidates and norm in QUALIFIED_COMMUNITIES:
        # Exact explicit parent+community pairs also work in read-only reports
        # before the next service-alias seed. No fuzzy name or street inference.
        parent, community = QUALIFIED_COMMUNITIES[norm]
        candidates = store.db.execute("""SELECT g.* FROM geographies g
            JOIN geographies p ON p.id=g.parent_id WHERE g.kind='community' AND g.name=? AND p.name=?""",
            (community, parent)).fetchall()
    if ambiguous_locality(city) and not region:
        return None
    if region and candidates:
        rn = normalise_locality(region)
        known_hint = store.db.execute("""SELECT 1 FROM geography_aliases a
            JOIN geographies g ON g.id=a.geography_id WHERE a.alias_normalized=?
            AND g.kind IN ('municipality','county','region','province','country','community') LIMIT 1""", (rn,)).fetchone()
        matching = []
        for row in candidates:
            current, ancestors, visited = row, [], set()
            while current and current["id"] not in visited:
                visited.add(current["id"])
                ancestors.append(current)
                current = store.db.execute("SELECT * FROM geographies WHERE id=?", (current["parent_id"],)).fetchone() if current["parent_id"] else None
            context = ancestors[1:2] if ambiguous_locality(city) else ancestors
            if any(normalise_locality(p["name"]) == rn or store.db.execute(
                    "SELECT 1 FROM geography_aliases WHERE geography_id=? AND alias_normalized=? LIMIT 1", (p["id"], rn)).fetchone() for p in context):
                matching.append(row["id"])
        if len(matching) == 1:
            return matching[0]
        if known_hint or ambiguous_locality(city):
            return None
    if len(candidates) == 1:
        return candidates[0]["id"]
    return None


def municipality_for(store, locality_id):
    """Return municipality ancestor without calling a county/metro a city."""
    visited = set()
    while locality_id and locality_id not in visited:
        visited.add(locality_id)
        row = store.db.execute("SELECT * FROM geographies WHERE id=?", (locality_id,)).fetchone()
        if row is None:
            return None
        if row["kind"] == "municipality":
            return row["id"]
        if row["kind"] not in ("community", "indigenous_community"):
            return None
        locality_id = row["parent_id"]
    return None
