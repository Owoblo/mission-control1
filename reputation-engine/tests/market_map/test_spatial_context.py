import csv
import gzip
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from market_map.geography import seed_geographies, resolve_geography
from market_map.spatial_context import acquire_boundaries, derive_context, PolygonIndex, NAMESPACE, _hash
from market_map.spatial_review import publish_reviewed_context, exhaustive_point_check, _context_status
from market_map.store import MarketMap
from market_map.transport import SourceBlocked

HAS_SHAPELY = importlib.util.find_spec('shapely') is not None


def feature(code, points, oid=1):
    return {'type': 'Feature', 'properties': {'OBJECTID': oid, 'MUNID': str(code), 'MUNICIPAL_NAME': 'FIXTURE MUNICIPALITY',
            'MUNICIPAL_NAME_SHORTFORM': 'FIXTURE', 'EFFECTIVE_DATETIME': 1707992793000},
            'geometry': {'type': 'Polygon', 'coordinates': [points]}}


def square(code='1', start=0, end=1, oid=1):
    return feature(code, [[start, 0], [end, 0], [end, 1], [start, 1], [start, 0]], oid)


class FakeTransport:
    def __init__(self, wrong_projection=False):
        self.requests = self.bytes_fetched = 0
        self.wrong_projection = wrong_projection

    def fetch(self, url, **kwargs):
        self.requests += 1
        query = parse_qs(urlsplit(url).query)
        if '/query?' not in url:
            data = {'copyrightText': 'https://www.ontario.ca/page/open-government-licence-ontario', 'supportedQueryFormats': 'JSON,geoJSON',
                    'maxRecordCount': 2, 'fields': [{'name': 'OBJECTID', 'type': 'esriFieldTypeOID'}], 'extent': {'spatialReference': {'wkid': 4269}}}
        elif query.get('returnCountOnly'):
            data = {'count': 2}
        elif query.get('returnIdsOnly'):
            data = {'objectIds': [1, 2]}
        elif query.get('returnExtentOnly'):
            data = {'extent': {'spatialReference': {'wkid': 3857 if self.wrong_projection else 4326}}}
        else:
            ids = list(map(int, query['objectIds'][0].split(',')))
            data = {'type': 'FeatureCollection', 'features': [square(str(i), i - 1, i, i) for i in ids]}
        body = json.dumps(data).encode()
        self.bytes_fetched += len(body)
        return type('Response', (), {'body': body, 'json': lambda self: data})()

    def metrics(self):
        return {'requests': self.requests, 'bytes_fetched': self.bytes_fetched}


class PolygonAcquisitionTests(unittest.TestCase):
    def scope(self):
        return {'municipalities': {str(i): {'geography_id': 'fixture-' + str(i), 'name': 'Fixture ' + str(i), 'official_id': NAMESPACE + str(i)} for i in [1, 2]}, 'review_decisions': []}

    def test_source_ids_counts_projection_and_full_geometry_are_reconciled(self):
        with tempfile.TemporaryDirectory() as folder:
            transport = FakeTransport()
            manifest = acquire_boundaries(self.scope(), folder, transport=transport, batch_size=1)
            self.assertEqual(manifest['polygon_feature_count'], 2)
            self.assertEqual(manifest['selected_municipality_count'], 2)
            self.assertEqual(manifest['validated_output_spatial_reference']['wkid'], 4326)
            self.assertFalse(manifest['geometry_simplification_requested'])
            before = transport.requests
            acquire_boundaries(self.scope(), folder, transport=transport)
            self.assertEqual(transport.requests, before)

    def test_unconfirmed_output_projection_blocks_spatial_claims(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(SourceBlocked, 'projection'):
                acquire_boundaries(self.scope(), folder, transport=FakeTransport(wrong_projection=True))


@unittest.skipUnless(HAS_SHAPELY, 'Spatial feature uses the isolated Shapely environment')
class SpatialContextTests(unittest.TestCase):
    def test_shared_boundaries_overlap_holes_and_no_hit_never_assign_arbitrarily(self):
        index = PolygonIndex([square('1', 0, 1), square('2', 1, 2, 2)], {'municipalities': {}})
        self.assertEqual(index.locate(.5, .5)['municipality_code'], '1')
        self.assertEqual(index.locate(1, .5)['status'], 'ambiguous_shared_boundary')
        self.assertEqual(exhaustive_point_check([square('1', 0, 1), square('2', 1, 2, 2)], 1, .5)['status'], 'ambiguous_shared_boundary')
        self.assertIsNone(index.locate(1, .5)['municipality_code'])
        self.assertEqual(index.locate(5, 5)['status'], 'unknown_no_selected_polygon_hit')
        overlap = PolygonIndex([square('1', 0, 2), square('2', 1, 3, 2)], {'municipalities': {}})
        self.assertEqual(overlap.locate(1.5, .5)['status'], 'ambiguous_overlapping_municipalities')
        self.assertEqual(index.locate(float('nan'), .5)['status'], 'unknown_invalid_reported_coordinate')
        hole = square('1', 0, 4)
        hole['geometry']['coordinates'].append([[1, .2], [2, .2], [2, .8], [1, .8], [1, .2]])
        self.assertEqual(PolygonIndex([hole], {'municipalities': {}}).locate(1.5, .5)['status'], 'unknown_no_selected_polygon_hit')

    def test_invalid_source_geometry_is_not_silently_repaired(self):
        invalid = feature('2', [[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]], 2)
        index = PolygonIndex([square(), invalid], {'municipalities': {}})
        self.assertEqual(index.locate(.2, .2)['status'], 'ambiguous_invalid_source_geometry')
        self.assertEqual(len(index.invalid_features), 1)

    def write_input(self, folder, name, rows):
        directory = folder / name
        directory.mkdir()
        raw = ''.join(json.dumps(row) + '\n' for row in rows).encode()
        path = directory / 'normalised-records.jsonl.gz'
        with gzip.open(path, 'wb') as handle:
            handle.write(raw)
        manifest = {'source': {'release': '2026-10-21.0'}, 'metadata': {'fetched_count': len(rows), 'status': 'completed', 'source_query_exhausted': True},
                    'rows_file': path.name, 'lossless_compression_verified': True, 'rows_sha256': hashlib.sha256(raw).hexdigest(), 'rows_compressed_sha256': _hash(path)}
        (directory / 'collection.json').write_text(json.dumps(manifest))

    def test_draft_dedup_conflicts_and_resume_preserve_canonical_geography(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            database = folder / 'fixture.sqlite'
            with MarketMap(database) as store:
                seed_geographies(store)
                london, toronto = resolve_geography(store, 'London'), resolve_geography(store, 'Toronto')
            scope = {'municipalities': {'1': {'geography_id': london, 'name': 'London', 'official_id': NAMESPACE + '1'},
                                        '2': {'geography_id': toronto, 'name': 'Toronto', 'official_id': NAMESPACE + '2'}}, 'review_decisions': []}
            polygons = folder / 'polygons'
            acquire_boundaries(scope, polygons, transport=FakeTransport())
            inputs = folder / 'inputs'
            inputs.mkdir()
            def row(gers, x, city='London'):
                return {'source_record_id': gers, 'longitude': x, 'latitude': .5, 'city': city, 'taxonomy_version': '2026-10-21.0', 'observed_at': '2026-10-26T00:00:00Z'}
            self.write_input(inputs, 'a', [row('same', .5), row('conflict', .5), row('hidden', 1.5, 'Unmapped Fixture Hamlet')])
            self.write_input(inputs, 'b', [row('same', .5), row('conflict', 1.5)])
            output = folder / 'derived'
            summary = derive_context(database, polygons, [inputs], output, min_free_bytes=0)
            self.assertEqual(summary['unique_gers'], 3)
            self.assertEqual(summary['duplicate_observations'], 2)
            self.assertEqual(summary['duplicate_coordinate_conflicts'], 1)
            self.assertFalse(summary['canonical_database_mutated'])
            with gzip.open(output / summary['draft_csv'], 'rt') as handle:
                rows = {r['gers']: r for r in csv.DictReader(handle)}
            self.assertEqual(rows['conflict']['reported_coordinate_municipality_id'], '')
            self.assertEqual(rows['hidden']['reported_coordinate_municipality_name'], 'Toronto')
            self.assertEqual(rows['hidden']['publisher_locality_comparison'], 'publisher_locality_unresolved')
            self.assertTrue(all(r['business_or_occupancy_verified'] == 'False' for r in rows.values()))
            published = publish_reviewed_context(database, polygons, output, reviewer='Fixture agent evidence review', authorization='Fixture root authorized publication after checks', min_free_bytes=0)
            self.assertEqual(published['unique_gers'], 3)
            self.assertEqual(published['input_observations'], 5)
            self.assertEqual(published['unique_coordinate_contexts_with_unresolved_publisher_locality'], 1)
            review = json.loads((output / 'coordinate-context-review.json').read_text())
            self.assertEqual(len(review['focused_original_source_line_checks']), 3)
            self.assertFalse(review['canonical_database_mutated'])
            with gzip.open(output / published['research_csv'], 'rt') as handle:
                research = {r['gers']: r for r in csv.DictReader(handle)}
            self.assertEqual(research['conflict']['context_status'], 'geography_review_required')
            self.assertEqual(research['hidden']['context_status'], 'reviewed_derived_coordinate_research_context')
            self.assertEqual(research['hidden']['needs_geography_review'], 'True')
            self.assertEqual(research['hidden']['publisher_locality'], 'Unmapped Fixture Hamlet')
            with self.assertRaisesRegex(ValueError, 'authorization'):
                publish_reviewed_context(database, polygons, output, reviewer='Fixture', authorization='', min_free_bytes=0)
            repeated = derive_context(database, polygons, [inputs], output, min_free_bytes=0, resume=True)
            self.assertEqual(repeated['unique_gers'], 3)
            self.assertEqual(repeated['duplicate_observations'], 2)
            with MarketMap(database) as store:
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM organisations').fetchone()[0], 0)

    def test_storage_guard_stops_before_creating_derived_working_database(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(SourceBlocked, 'Storage pause'):
                derive_context('unused.sqlite', 'unused-polygons', [], Path(folder) / 'derived', min_free_bytes=10**20)
            self.assertFalse((Path(folder) / 'derived/spatial-context-working.sqlite').exists())


if __name__ == '__main__':
    unittest.main()
