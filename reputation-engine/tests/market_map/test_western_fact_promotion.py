import gzip
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.market_map.factual_promotion import sha
from scripts.market_map.store import MarketMap
from scripts.market_map.transport import SourceBlocked
from scripts.market_map.western_fact_promotion import apply_western_facts, prepare_western, project_western


class WesternFactPromotionTests(unittest.TestCase):
    def fixture(self, root):
        folder = root / 'listowel';folder.mkdir()
        originals = [{'source_record_id': str(n), 'native_collection_item_id': str(n),
            'name': 'Business' if n == 1 else None, 'published_street_or_address_text': '12 Printed Street',
            'business_websites': ['https://business.test'], 'business_phone': '5195550100',
            'source_categories': ['Literal source category'], 'observed_at': '2026-10-27T05:00:00Z'} for n in [1, 2]]
        with gzip.open(folder / 'facts.gz', 'wt') as handle:
            for row in originals: handle.write(json.dumps(row) + '\n')
        m = {'source_id': 'listowel-test', 'status': 'complete_public_roster', 'source_inventory_exhausted': True,
             'source_url': 'https://publisher.test/directory', 'observed_at': '2026-10-27T05:00:00Z',
             'rights': {'rights_status': 'limited_factual_review_only'}}
        (folder / 'manifest.json').write_text(json.dumps(m));(folder / 'original.txt').write_text('Original source bytes')
        spec = {'source_id': m['source_id'], 'primary_manifest': 'listowel/manifest.json',
            'primary_manifest_sha256': sha(folder / 'manifest.json'), 'source_rows': 2,
            'rights_status': 'limited_factual_review_only', 'records_file': 'listowel/facts.gz',
            'records_sha256': sha(folder / 'facts.gz'), 'snapshot_files': {str(p.relative_to(root)): sha(p) for p in folder.iterdir()}}
        config = root / 'config.json';config.write_text(json.dumps({'source_cohorts': {'listowel': spec}}))
        return config, originals

    def test_native_blank_name_kept_raw_without_company_and_replay_exact(self):
        with tempfile.TemporaryDirectory() as directory, MarketMap(':memory:') as store:
            root = Path(directory);config, original = self.fixture(root)
            with patch('scripts.market_map.western_fact_promotion.CONFIG', config):
                result = apply_western_facts(store, root, kind='listowel')
                self.assertEqual((result['processed_source_rows'], result['candidate_rows'], result['raw_only_rows']), (2, 1, 1))
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM locations').fetchone()[0], 1)
                self.assertIsNone(store.db.execute('SELECT country FROM locations').fetchone()[0])
                self.assertIsNone(store.db.execute('SELECT city_raw FROM locations').fetchone()[0])
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM raw_records').fetchone()[0], 2)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM source_run_items').fetchone()[0], 2)
                for table in ['people', 'contact_channels', 'relationships']:
                    self.assertEqual(store.db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0], 0)
                raw = store.db.execute('SELECT id FROM raw_records WHERE source_record_id=?', ('1',)).fetchone()[0]
                self.assertEqual(store.get_raw_payload(raw)['raw_payload']['original_selected_source_observation'], original[0])
                self.assertEqual(apply_western_facts(store, root, kind='listowel')['new_organisations'], 0)
                self.assertFalse(store.db.execute('PRAGMA foreign_key_check').fetchall())

    def test_source_bytes_or_identity_drift_stops_before_any_mutations(self):
        with tempfile.TemporaryDirectory() as directory, MarketMap(':memory:') as store:
            root = Path(directory);config, _ = self.fixture(root)
            (root / 'listowel/original.txt').write_text('Changed source original')
            with patch('scripts.market_map.western_fact_promotion.CONFIG', config):
                with self.assertRaises(SourceBlocked): apply_western_facts(store, root, kind='listowel')
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM sources').fetchone()[0], 0)

    def test_no_geography_or_site_inferred_from_filters_or_map_context(self):
        manifest = {'source_url': 'https://publisher.test', 'observed_at': '2026-10-27T00:00:00Z'}
        projected = project_western({'source_record_id': 'profile-url:https://publisher.test/business',
            'native_profile_url': 'https://publisher.test/business', 'name': 'Company', 'published_address_lines': [],
            'source_municipality_filters': ['Known town'], 'reported_map_context': {'reported_latitude': 44.1},
            'source_profile_employee_scope': 'not_established', 'source_profile_fields': {'employee_count_text': '0'}}, 'elgin', manifest)
        self.assertIsNone(projected['address']);self.assertIsNone(projected['city']);self.assertIsNone(projected['country'])
        guelph = project_western({'source_record_id': '17', 'native_profile_id': 17, 'name': 'Company',
            'publisher_reported_address': {'street': None, 'city': 'Guelph', 'country': 'Canada'}}, 'guelph_bia', manifest)
        self.assertEqual(guelph['country'], 'Canada')
        self.assertIsNone(guelph['address'])
        with self.assertRaises(SourceBlocked): project_western({'source_record_id': '18', 'native_profile_id': 17}, 'guelph_bia', manifest)

    def test_assertion_failure_rolls_back_batch_and_leaves_source_facts_replayable(self):
        with tempfile.TemporaryDirectory() as directory, MarketMap(':memory:') as store:
            root = Path(directory);config, _ = self.fixture(root)
            with patch('scripts.market_map.western_fact_promotion.CONFIG', config):
                ordinary = store.assert_field
                def fail(entity, entity_type, field, *args, **kwargs):
                    if field == 'source_profile_fields': raise RuntimeError('Metadata failed')
                    return ordinary(entity, entity_type, field, *args, **kwargs)
                with patch.object(store, 'assert_field', side_effect=fail):
                    with self.assertRaisesRegex(RuntimeError, 'Metadata failed'): apply_western_facts(store, root, kind='listowel')
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM source_runs').fetchone()[0], 0)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM raw_records').fetchone()[0], 0)
                self.assertEqual(apply_western_facts(store, root, kind='listowel')['new_organisations'], 1)


if __name__ == '__main__': unittest.main()
