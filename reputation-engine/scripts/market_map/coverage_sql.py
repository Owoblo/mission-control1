"""Disk-backed coverage aggregation without retaining every entity in Python.

Only temporary scratch tables are written. File-backed stores are read through
an isolated read-only SQLite connection with a bounded cache. No commercial
record, source claim, review decision, or coverage status is changed here.
"""
from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path

from .geography import resolve_geography


@contextmanager
def _scratch_connection(store):
    current = store.db
    main = next((row for row in current.execute("PRAGMA database_list") if row[1] == "main"), None)
    own = bool(main and main[2] and not current.in_transaction)
    connection = sqlite3.connect(Path(main[2]).resolve().as_uri() + "?mode=ro", uri=True) if own else current
    connection.row_factory = sqlite3.Row
    query_only = connection.execute("PRAGMA query_only").fetchone()[0]
    if own:
        connection.execute("PRAGMA temp_store=FILE")
        connection.execute("PRAGMA cache_size=-8192")
        connection.execute("PRAGMA mmap_size=0")
    elif query_only:
        # The file-backed path above remains immutable by URI. For an in-memory
        # fixture/transaction, query_only must permit TEMP scratch writes; every
        # statement below names TEMP explicitly when modifying anything.
        connection.execute("PRAGMA query_only=OFF")
    try:
        yield connection
    finally:
        if own:
            connection.close()
        elif query_only:
            connection.execute("PRAGMA query_only=ON")


def aggregate_coverage(store, *, geographies, member_scopes, family_by_source, sectors, taxonomy, configured):
    """Return integer aggregates with the reference implementation's semantics."""
    prefix = "mm_cov_" + uuid.uuid4().hex
    names = {key: prefix + "_" + key for key in ["city", "closure", "families", "source_sectors", "sectors", "excluded"]}
    table = lambda key: 'temp."' + names[key] + '"'
    savepoint = prefix + "_savepoint"
    targets = set(configured)

    def closure(start):
        seen = set()
        current = start
        while current in geographies and current not in seen:
            seen.add(current)
            current = geographies[current]["parent_id"]
        expanded = set(seen)
        for ancestor in seen:
            expanded.update(member_scopes.get(ancestor, ()))
        return expanded & targets

    with _scratch_connection(store) as db:
        wrapper = type("ReadOnlyGeographyLookup", (), {"db": db})()
        db.execute("SAVEPOINT " + savepoint)
        try:
            db.execute(f"CREATE TEMP TABLE {names['city']}(city_raw TEXT PRIMARY KEY,locality_id TEXT) WITHOUT ROWID")
            # Distinct publisher locality strings are a small lookup, rather
            # than one Python object for each of hundreds of thousands of sites.
            cities = [row[0] for row in db.execute("SELECT DISTINCT city_raw FROM main.locations WHERE city_raw IS NOT NULL")]
            db.executemany(f"INSERT INTO {table('city')} VALUES(?,?)", ((city, resolve_geography(wrapper, city)) for city in cities))
            db.execute(f"CREATE TEMP TABLE {names['closure']}(start_id TEXT,geography_id TEXT,PRIMARY KEY(start_id,geography_id)) WITHOUT ROWID")
            db.executemany(f"INSERT INTO {table('closure')} VALUES(?,?)", ((start, target) for start in geographies for target in closure(start)))
            db.execute(f"CREATE TEMP TABLE {names['families']}(source_id TEXT PRIMARY KEY,family TEXT NOT NULL) WITHOUT ROWID")
            db.executemany(f"INSERT INTO {table('families')} VALUES(?,?)", family_by_source.items())
            db.execute(f"CREATE TEMP TABLE {names['source_sectors']}(organisation_id TEXT,sector_id TEXT,PRIMARY KEY(organisation_id,sector_id)) WITHOUT ROWID")
            accepted_taxonomies = [taxonomy["industry_taxonomy"], "ssm_industry", "ssm_industry_families"]
            taxonomy_marks = ",".join("?" for _ in accepted_taxonomies)
            sector_marks = ",".join("?" for _ in sectors)
            db.execute(f"""INSERT OR IGNORE INTO {table('source_sectors')}
                SELECT c.entity_id,c.category FROM main.classifications c JOIN main.organisations o ON o.id=c.entity_id
                WHERE c.taxonomy IN ({taxonomy_marks}) AND c.category IN ({sector_marks})""", [*accepted_taxonomies, *sectors])
            db.execute(f"CREATE TEMP TABLE {names['sectors']}(organisation_id TEXT,sector_id TEXT,PRIMARY KEY(organisation_id,sector_id)) WITHOUT ROWID")
            db.execute(f"INSERT INTO {table('sectors')} SELECT * FROM {table('source_sectors')}")
            db.execute(f"""INSERT OR IGNORE INTO {table('sectors')} SELECT o.id,'uncategorised' FROM main.organisations o
                WHERE NOT EXISTS(SELECT 1 FROM {table('source_sectors')} s WHERE s.organisation_id=o.id)""")
            db.execute(f"INSERT OR IGNORE INTO {table('sectors')} SELECT id,'*' FROM main.organisations")
            db.execute(f"CREATE TEMP TABLE {names['excluded']}(organisation_id TEXT PRIMARY KEY) WITHOUT ROWID")
            db.execute(f"""INSERT OR IGNORE INTO {table('excluded')} SELECT c.entity_id FROM main.classifications c
                JOIN main.organisations o ON o.id=c.entity_id WHERE c.taxonomy='ssm_discovery_context'
                AND c.category='non_organisation_place_candidate'""")
            location_geos = f"""SELECT l.id AS location_id,l.organisation_id,c.geography_id
                    FROM main.locations l JOIN {table('closure')} c ON c.start_id=l.municipality_id
                UNION
                SELECT l.id AS location_id,l.organisation_id,c.geography_id
                    FROM main.locations l JOIN {table('city')} m ON m.city_raw=l.city_raw
                    JOIN {table('closure')} c ON c.start_id=m.locality_id"""
            geo_counts = {}
            for row in db.execute(f"""WITH location_geos AS({location_geos})
                SELECT g.geography_id,COUNT(DISTINCT g.organisation_id) organisations,
                    COUNT(DISTINCT g.location_id) locations,
                    COUNT(DISTINCT CASE WHEN x.organisation_id IS NULL THEN g.organisation_id END) business_candidates,
                    COUNT(DISTINCT CASE WHEN x.organisation_id IS NOT NULL THEN g.organisation_id END) non_organisation_candidates
                FROM location_geos g LEFT JOIN {table('excluded')} x ON x.organisation_id=g.organisation_id
                GROUP BY g.geography_id"""):
                geo_counts[row["geography_id"]] = dict(row)
            cell_counts = {}
            for row in db.execute(f"""WITH location_geos AS({location_geos})
                SELECT g.geography_id,s.sector_id,COALESCE(f.family,'unknown') family,
                    COUNT(DISTINCT g.organisation_id) organisations,COUNT(DISTINCT g.location_id) locations
                FROM location_geos g JOIN main.source_run_items i ON i.location_id=g.location_id
                JOIN main.source_runs r ON r.id=i.run_id
                LEFT JOIN {table('families')} f ON f.source_id=r.source_id
                JOIN {table('sectors')} s ON s.organisation_id=g.organisation_id
                GROUP BY g.geography_id,s.sector_id,COALESCE(f.family,'unknown')"""):
                cell_counts[(row["geography_id"], row["sector_id"], row["family"])] = {"organisations": row["organisations"], "locations": row["locations"]}
            source_counts = {row[0]: row[1] for row in db.execute("""SELECT r.source_id,COUNT(DISTINCT i.location_id)
                FROM main.source_run_items i JOIN main.source_runs r ON r.id=i.run_id
                WHERE i.location_id IS NOT NULL GROUP BY r.source_id""")}
            scalar = lambda sql: db.execute(sql).fetchone()[0]
            organisations = scalar("SELECT COUNT(*) FROM main.organisations")
            locations = scalar("SELECT COUNT(*) FROM main.locations")
            non_org = scalar(f"SELECT COUNT(*) FROM {table('excluded')}")
            non_org_locations = scalar(f"SELECT COUNT(*) FROM main.locations l JOIN {table('excluded')} x ON x.organisation_id=l.organisation_id")
            counts = {"organisations": organisations, "locations": locations,
                "distinct_normalized_address_candidates": scalar("""SELECT COUNT(*) FROM(
                    SELECT DISTINCT address_normalized,city_normalized,province,country FROM main.locations
                    WHERE address_normalized IS NOT NULL AND address_normalized<>'')"""),
                "unmapped_locations": scalar(f"""SELECT COUNT(*) FROM main.locations l
                    LEFT JOIN main.geographies g ON g.id=l.municipality_id
                    LEFT JOIN {table('city')} c ON c.city_raw=l.city_raw
                    WHERE g.id IS NULL AND c.locality_id IS NULL"""),
                "unclassified_organisations": scalar(f"""SELECT COUNT(*) FROM main.organisations o
                    WHERE NOT EXISTS(SELECT 1 FROM {table('source_sectors')} s WHERE s.organisation_id=o.id)"""),
                "organisations_by_entity_type": dict(db.execute("SELECT entity_type,COUNT(*) FROM main.organisations GROUP BY entity_type").fetchall()),
                "location_records_by_type": dict(db.execute("SELECT location_type,COUNT(*) FROM main.locations GROUP BY location_type").fetchall()),
                "explicit_non_organisation_place_candidates": non_org,
                "business_or_organisation_candidate_records": organisations - non_org,
                "non_organisation_location_records": non_org_locations,
                "business_or_organisation_candidate_location_records": locations - non_org_locations}
            result = {"counts": counts, "geo_counts": geo_counts, "cell_counts": cell_counts, "source_location_counts": source_counts}
            for name in reversed(list(names.values())):
                db.execute('DROP TABLE temp."' + name + '"')
            db.execute("RELEASE SAVEPOINT " + savepoint)
            return result
        except BaseException:
            db.execute("ROLLBACK TO SAVEPOINT " + savepoint)
            db.execute("RELEASE SAVEPOINT " + savepoint)
            raise
