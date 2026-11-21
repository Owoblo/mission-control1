import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.market_map.eastern_central_bia import parse_listing, collect, original, ENTRY, ACTION
from scripts.market_map.transport import Response, SourceBlocked


def listing(name, slug):
    return '<div class="store-card"><a href="https://kanatacentral.com/stores/' + slug + '/"><h3>' + name + '</h3><div class="store-excerpt">Narrative excluded</div></a></div>'


class EasternCentralBIATests(unittest.TestCase):
    def fixture(self, folder):
        entry = '<html><div class="uc_post_title"><a href="https://kanatacentral.com/stores/one/">One</a></div><script>var directory_ajax = ' + json.dumps({'ajax_url': ACTION, 'nonce': 'ANONYMOUS'}) + ';</script><footer>Ottawa ON</footer></html>'
        original(folder, 'entry', entry.encode(), {'url': ENTRY})
        original(folder, 'first-result', listing('One', 'one').encode(), {'url': ACTION})
        (folder / 'rights-review.json').write_text(json.dumps({'rights_status': 'limited_factual_review_only', 'internal_factual_research_approved': True}))

    def test_internal_profile_is_source_identity_not_website_or_site(self):
        row = parse_listing(listing('Équipement', 'equipment').encode(), page=1, observed_at='now', body_hash='hash')[0]
        self.assertEqual(row['name'], 'Équipement')
        self.assertEqual(row['source_record_id'], 'https://kanatacentral.com/stores/equipment/')
        self.assertIsNone(row['website'])
        self.assertIsNone(row['city'])
        self.assertIsNone(row['country'])
        self.assertNotIn('Narrative', json.dumps(row))
        self.assertFalse(row['physical_site_verified'])

    def test_source_documented_pages_to_explicit_empty_and_cached_replay(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            self.fixture(folder)
            with patch('scripts.market_map.eastern_central_bia.Transport') as cls:
                t = cls.return_value
                t.fetch_directory_form.side_effect = [Response(listing('Two', 'two').encode(), {}, ACTION), Response(b'<div>No stores found</div>', {}, ACTION)]
                t.metrics.return_value = {'requests': 2}
                first = collect(folder)
                self.assertEqual(first['observed_source_rows'], 2)
                self.assertEqual(first['unique_published_profile_urls'], 2)
                self.assertTrue(first['initial_entry_profiles_all_reconciled'])
                self.assertEqual(first['terminal_empty_page'], 3)
                self.assertIsNone(first['reported_row_count'])
                t.fetch_directory_form.reset_mock()
                replay = collect(folder)
                t.fetch_directory_form.assert_not_called()
                self.assertEqual(first['normalized_sha256'], replay['normalized_sha256'])

    def test_loop_retains_partial_receipts_and_does_not_claim_complete(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            self.fixture(folder)
            with patch('scripts.market_map.eastern_central_bia.Transport') as cls:
                cls.return_value.fetch_directory_form.return_value = Response(listing('One', 'one').encode(), {}, ACTION)
                cls.return_value.metrics.return_value = {'requests': 1}
                with self.assertRaisesRegex(SourceBlocked, 'loop'):
                    collect(folder)
            self.assertFalse((folder / 'manifest.json').exists())
            status = json.loads((folder / 'acquisition-status.json').read_text())
            self.assertEqual(status['status'], 'acquired_partial')
            self.assertTrue((folder / 'result-page-2.private.gz').exists())


if __name__ == '__main__': unittest.main()
