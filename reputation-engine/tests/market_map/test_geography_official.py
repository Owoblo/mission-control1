import json
import sys
import unittest
import hashlib
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from market_map.geography import seed_geographies, resolve_geography
from market_map.geography_official import apply_official_geographies, apply_reviewed_hamilton_id
from market_map.store import MarketMap


class OfficialGeographyTests(unittest.TestCase):
    def setUp(self):
        self.store = MarketMap(':memory:')
        seed_geographies(self.store)
        self.source = {'id': 'fixture-official-geography', 'name': 'Fixture municipality boundary attributes',
                       'source_url': 'https://boundaries.test/municipalities', 'source_type': 'administrative_geography',
                       'rights_status': 'permitted', 'last_checked_at': '2026-10-26T00:00:00Z',
                       'config': {'expected_polygon_count': 2}}

    def tearDown(self):
        self.store.close()

    def payload(self):
        row = {'MUNID': 'fixture-00001', 'MUNICIPAL_NAME': 'CITY OF WINDSOR', 'MUNICIPAL_NAME_SHORTFORM': 'WINDSOR',
               'MUNICIPAL_TYPE': 'Single Tier Municipality', 'UPPER_TIER_MUNICIPALITY': None, 'MAH_CODE': 'fixture-code',
               'EFFECTIVE_DATETIME': 1707992793000}
        return {'features': [{'attributes': {**row, 'OBJECTID': 1}}, {'attributes': {**row, 'OBJECTID': 2}}]}

    def test_multiple_polygon_features_map_to_one_official_municipality_with_evidence(self):
        result = apply_official_geographies(self.store, self.payload(), self.source)
        ident = resolve_geography(self.store, 'Windsor')
        self.assertEqual(result['polygon_features'], 2)
        self.assertEqual(result['distinct_municipal_ids'], 1)
        self.assertEqual(result['official_ids_attached'], 1)
        self.assertEqual(self.store.db.execute('SELECT official_id FROM geographies WHERE id=?', (ident,)).fetchone()[0], 'ontario:lio:munid:fixture-00001')
        assertion = self.store.db.execute("SELECT * FROM field_assertions WHERE entity_type='geography' AND field_name='official_municipal_id'").fetchone()
        self.assertIsNotNone(self.store.db.execute('SELECT 1 FROM evidence WHERE id=?', (assertion['evidence_id'],)).fetchone())
        self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM organisations').fetchone()[0], 0)
        repeat = apply_official_geographies(self.store, self.payload(), self.source)
        self.assertEqual(repeat['already_attached'], 1)
        self.assertEqual(repeat['official_ids_attached'], 0)

    def test_conflicting_existing_identifier_is_preserved_for_review(self):
        ident = resolve_geography(self.store, 'Windsor')
        self.store.db.execute("UPDATE geographies SET official_id='existing:external:id' WHERE id=?", (ident,))
        self.store.db.commit()
        report = apply_official_geographies(self.store, self.payload(), self.source)
        self.assertEqual(self.store.db.execute('SELECT official_id FROM geographies WHERE id=?', (ident,)).fetchone()[0], 'existing:external:id')
        self.assertEqual(report['reviews'], 1)

    def test_truncation_or_missing_publisher_ids_cannot_create_fake_official_geography(self):
        with self.assertRaises(ValueError):
            apply_official_geographies(self.store, {**self.payload(), 'exceededTransferLimit': True}, self.source)
        broken = self.payload()
        broken['features'][0]['attributes']['MUNID'] = None
        with self.assertRaises(ValueError):
            apply_official_geographies(self.store, broken, self.source)

    def test_explicit_hamilton_review_is_narrow_audited_repeatable_and_hash_guarded(self):
        ident = resolve_geography(self.store, 'Hamilton')
        city = {**self.payload()['features'][0]['attributes'], 'MUNID': '25005',
                'MUNICIPAL_NAME': 'CITY OF HAMILTON', 'MUNICIPAL_NAME_SHORTFORM': 'HAMILTON'}
        township = {**city, 'MUNID': '14019', 'MUNICIPAL_NAME': 'TOWNSHIP OF HAMILTON',
                    'MUNICIPAL_TYPE': 'Lower Tier Municipality', 'UPPER_TIER_MUNICIPALITY': 'COUNTY OF NORTHUMBERLAND'}
        source = {**self.source, 'source_url': 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open03/MapServer/14'}
        original = json.dumps({'features': [{'attributes': city}, {'attributes': township}]}).encode()
        decision = {'geography_id': ident, 'proposed_official_id': 'ontario:lio:munid:25005',
                    'publisher_full_name': 'CITY OF HAMILTON', 'source_url': source['source_url'],
                    'excluded_different_municipality': {'official_id': 'ontario:lio:munid:14019', 'full_name': 'TOWNSHIP OF HAMILTON'},
                    'evidence_sha256': hashlib.sha256(original).hexdigest()}
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / 'attributes.json'
            receipt.write_bytes(original)
            result = apply_reviewed_hamilton_id(self.store, decision, receipt, source)
            self.assertEqual(result['status'], 'attached')
            repeat = apply_reviewed_hamilton_id(self.store, decision, receipt, source)
            self.assertEqual(repeat['status'], 'already_attached')
            self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM field_assertions WHERE entity_id=? AND field_name='official_identifier_review_decision'", (ident,)).fetchone()[0], 1)
            self.assertEqual(self.store.db.execute('SELECT COUNT(*) FROM organisations').fetchone()[0], 0)
            self.store.db.execute("UPDATE geographies SET official_id='competing:external:id' WHERE id=?", (ident,))
            self.store.db.commit()
            conflict = apply_reviewed_hamilton_id(self.store, decision, receipt, source)
            self.assertEqual(conflict['status'], 'conflict_review_required')
            self.assertEqual(self.store.db.execute('SELECT official_id FROM geographies WHERE id=?', (ident,)).fetchone()[0], 'competing:external:id')
            receipt.write_bytes(original + b' ')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                apply_reviewed_hamilton_id(self.store, decision, receipt, source)


if __name__ == '__main__':
    unittest.main()
