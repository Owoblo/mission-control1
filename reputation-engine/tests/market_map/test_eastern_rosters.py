import gzip
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.market_map.eastern_rosters import parse_page, collect, apply_eastern_acquisition, ENTRY, PAGE
from scripts.market_map.transport import Response, SourceBlocked
from scripts.market_map.store import MarketMap


def page(first, last, total, *, repeated=False):
    cards = []
    for ordinal in range(first, last + 1):
        native = 1 if repeated and ordinal == last else ordinal
        cards.append(f'<div class="listing-summary row"><h3><a href="/listing/{native}">Business {native}</a></h3>'
                     f'<div class="address">{native} Main St, Kemptville, ON</div>'
                     f'<div id="field-9-link-{native}"><a href="tel:6135551234">6135551234</a></div>'
                     '<script>hidden email is not decoded</script></div>')
    return (f'<html><p>Results {first} - {last} of {total} This Category</p>' + ''.join(cards) + '<footer>Other town address</footer></html>').encode()


class EasternRosterTests(unittest.TestCase):
    def test_native_ids_source_address_and_unverified_fields_preserved(self):
        parsed = parse_page(page(1, 2, 2), ENTRY, '2026-10-27T00:00:00Z')
        self.assertEqual([r['source_record_id'] for r in parsed['rows']], ['1', '2'])
        row = parsed['rows'][0]
        self.assertEqual(row['city'], 'Kemptville')
        self.assertEqual(row['province'], 'ON')
        self.assertIsNone(row['country'])
        self.assertIsNone(row['email'])
        self.assertIsNone(row['phone'])
        self.assertEqual(row['raw_payload']['source_phone'], '6135551234')
        self.assertFalse(row['physical_site_verified'])
        with_postal = page(1, 1, 1).replace(b'1 Main St, Kemptville, ON', b'1 Main St, Kemptville, ON, K0G1J0')
        self.assertEqual(parse_page(with_postal, ENTRY, 'now')['rows'][0]['city'], 'Kemptville')
        no_province = page(1, 1, 1).replace(b'1 Main St, Kemptville, ON', b'1 Main St, Kemptville, K0G1J0')
        preserved = parse_page(no_province, ENTRY, 'now')['rows'][0]
        self.assertEqual(preserved['city'], 'Kemptville')
        self.assertIsNone(preserved['province'])
        explicit_foreign = page(1, 1, 1).replace(b'1 Main St, Kemptville, ON', b'1 Main St, Gatineau, QC, Canada')
        foreign = parse_page(explicit_foreign, ENTRY, 'now')['rows'][0]
        self.assertEqual((foreign['city'], foreign['province'], foreign['country']), ('Gatineau', 'QC', 'CA'))
        repeated = page(1, 1, 1).replace(b'1 Main St, Kemptville, ON', b'1 Main St, Kemptville, ON, Canada, Ontario')
        repeated_row = parse_page(repeated, ENTRY, 'now')['rows'][0]
        self.assertEqual((repeated_row['city'], repeated_row['province'], repeated_row['country']), ('Kemptville', 'ON', 'CA'))
        with self.assertRaisesRegex(SourceBlocked, 'range'):
            parse_page(page(1, 2, 3).replace(b'1 - 2', b'1 - 3'), ENTRY, 'now')

    def test_full_pages_preserve_duplicate_appearances_and_cached_replay_calls_no_network(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            (folder / 'rights-review.json').write_text(json.dumps({'rights_status': 'limited_factual_review_only', 'internal_factual_research_approved': True}))
            def fetch(url):
                return Response(page(21, 21, 21, repeated=True) if url == PAGE + '20' else page(1, 20, 21), {'Content-Type': 'text/html'}, url)
            with patch('scripts.market_map.eastern_rosters.Transport') as cls:
                transport = cls.return_value
                transport.fetch.side_effect = fetch
                transport.metrics.return_value = {'requests': 3}
                first = collect(folder)
                self.assertEqual(transport.fetch.call_count, 3)
                self.assertEqual(first['observed_listing_appearances'], 21)
                self.assertEqual(first['unique_source_profile_keys'], 20)
                self.assertEqual(first['repeated_profile_keys'], 1)
                self.assertTrue(first['source_inventory_exhausted'])
                self.assertFalse(first['market_completeness_verified'])
                transport.fetch.reset_mock()
                replay = collect(folder)
                transport.fetch.assert_not_called()
                self.assertEqual(replay['normalized_sha256'], first['normalized_sha256'])
            (folder / 'independent-verification.json').write_text(json.dumps({'status': 'passed', 'normalized_sha256': first['normalized_sha256']}))
            with MarketMap(':memory:') as store:
                original = store.assert_field
                def fail_metadata(entity, kind, field, *args, **kwargs):
                    if field == 'source_profile_url':
                        raise RuntimeError('Metadata interruption')
                    return original(entity, kind, field, *args, **kwargs)
                with patch.object(store, 'assert_field', side_effect=fail_metadata):
                    with self.assertRaisesRegex(RuntimeError, 'Metadata interruption'):
                        apply_eastern_acquisition(store, folder)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM organisations').fetchone()[0], 0)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM raw_records').fetchone()[0], 0)
                imported = apply_eastern_acquisition(store, folder)
                self.assertEqual(imported['rows'], 21)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM source_identities').fetchone()[0], 20)
                imported_replay = apply_eastern_acquisition(store, folder)
                self.assertEqual(imported_replay['new_organisations'], 0)
                for table in ['people', 'contact_channels', 'relationships']:
                    self.assertEqual(store.db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0], 0)
                self.assertEqual(store.db.execute('PRAGMA foreign_key_check').fetchall(), [])
            with gzip.open(folder / first['normalized_file'], 'rt') as handle:
                rows = [json.loads(line) for line in handle]
            self.assertEqual(len(rows), 21)
            self.assertEqual(rows[0]['source_record_id'], rows[-1]['source_record_id'])

    def test_roster_change_keeps_raw_checkpoint_and_never_marks_complete(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            (folder / 'rights-review.json').write_text(json.dumps({'rights_status': 'limited_factual_review_only', 'internal_factual_research_approved': True}))
            with patch('scripts.market_map.eastern_rosters.Transport') as cls:
                cls.return_value.fetch.side_effect = [Response(page(1, 20, 21), {}, ENTRY), Response(page(21, 21, 22), {}, PAGE + '20')]
                cls.return_value.metrics.return_value = {'requests': 2}
                with self.assertRaisesRegex(SourceBlocked, 'changed'):
                    collect(folder)
            self.assertFalse((folder / 'manifest.json').exists())
            status = json.loads((folder / 'acquisition-status.json').read_text())
            self.assertEqual(status['status'], 'acquired_partial')
            self.assertFalse(status['source_inventory_exhausted'])
            self.assertTrue((folder / 'page-entry-route-1.private.html.gz').exists())


if __name__ == '__main__':
    unittest.main()
