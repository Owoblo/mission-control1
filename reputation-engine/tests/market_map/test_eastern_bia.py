import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.market_map.eastern_bia import collect, fetch_page, parse_cards, apply_bia_acquisition, POLICY, SCRIPT, ENTRY
from scripts.market_map.transport import Response, SourceBlocked
from scripts.market_map.store import MarketMap


def card(name='Published Company', address='12 Main St, Kanata, ON K2K 1A1'):
    return '<article class="company"><h2 class="company__heading">' + name + '</h2><p class="company__address">' + address + '</p><p class="company__description" data-html="Biography excluded">Narrative excluded</p><div class="company__details"><div><h3><span>Website:</span></h3><p><a href="https://business.example/">Website</a></p></div></div></article>'


class EasternBIATests(unittest.TestCase):
    def test_minimal_fields_exclude_prose_and_unverified_relationships(self):
        row = parse_cards(card().encode(), source_url=ENTRY, observed_at='now', page=1, source_body_hash='hash')[0]
        self.assertEqual((row['city'], row['province']), ('Kanata', 'ON'))
        self.assertIsNone(row['country'])
        self.assertEqual(row['website'], 'https://business.example/')
        self.assertNotIn('Biography', json.dumps(row))
        self.assertNotIn('Narrative', json.dumps(row))
        self.assertFalse(row['ownership_or_tenancy_inferred'])
        self.assertIsNone(row['phone'])
        self.assertIsNone(row['email'])
        category_row = parse_cards(card().replace('</article>', '<div class="company__terms"><span class="modal__page-label">Manufacturing, Engineering &amp; Design</span></div></article>').encode(), source_url=ENTRY, observed_at='now', page=1, source_body_hash='hash')[0]
        self.assertEqual(category_row['categories'], ['Manufacturing, Engineering & Design'])
        unicode_row = parse_cards(card('Équipement Montréal', '\u00a0329 March Rd, Kanata, ON K2K 1A1').encode(), source_url=ENTRY, observed_at='now', page=1, source_body_hash='hash')[0]
        self.assertEqual(unicode_row['name'], 'Équipement Montréal')
        self.assertEqual(unicode_row['address'], '329 March Rd, Kanata, ON K2K 1A1')
        floor_row = parse_cards(card(address='12 Main St, 5th floor Kanata, ON K2K 1A1').encode(), source_url=ENTRY, observed_at='now', page=1, source_body_hash='hash')[0]
        self.assertIsNone(floor_row['city'])
        self.assertIn('5th floor Kanata', floor_row['raw_payload']['source_printed_address'])

    def test_nonce_never_saved_or_logged_and_failure_redacts_request_url(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            with patch('scripts.market_map.eastern_bia.require_space'), patch('scripts.market_map.eastern_bia.Transport') as cls:
                response = json.dumps({'success': True, 'data': {'posts': [card()], 'more': False, 'total': 1}}).encode()
                cls.return_value.fetch.return_value = Response(response, {}, 'https://source/?nonce=SECRET')
                value, metadata = fetch_page(folder, 1, 'SECRET', 10, cls.return_value)
                self.assertNotIn('SECRET', json.dumps(metadata))
                self.assertNotIn('SECRET', (folder / 'page-1.receipt.json').read_text())
                cls.return_value.fetch.side_effect = SourceBlocked('HTTP403 https://source/?nonce=SECRET')
                with self.assertRaises(SourceBlocked) as error:
                    fetch_page(folder, 2, 'SECRET', 10, cls.return_value)
                self.assertNotIn('SECRET', str(error.exception))

    def fixtures(self, folder):
        original = '<html><strong class="companies__results">2</strong><div class="companies__target" data-posts-per-page="10">' + card('One') + card('Two') + '</div><input id="_wpnonce" value="SECRET"></html>'
        payload = original.encode()
        (folder / 'source.gz').write_bytes(gzip.compress(payload))
        (folder / 'kanata-north-directory.receipt.json').write_text(json.dumps({'file': 'source.gz', 'gzip_sha256': hashlib.sha256((folder / 'source.gz').read_bytes()).hexdigest(), 'source_body_sha256': hashlib.sha256(payload).hexdigest(), 'checked_at': 'now'}))
        for url in (POLICY, SCRIPT):
            key = hashlib.sha256(url.encode()).hexdigest()[:16]
            path = folder / (key + '.gz')
            path.write_bytes(gzip.compress(b'fixture'))
            (folder / ('policy-' + key + '.receipt.json')).write_text(json.dumps({'response_status': 200, 'file': path.name, 'gzip_sha256': hashlib.sha256(path.read_bytes()).hexdigest()}))
        (folder / 'rights-review.json').write_text(json.dumps({'rights_status': 'limited_factual_review_only', 'internal_factual_research_approved': True}))

    def test_robots_blocks_before_nonce_and_full_get_pagination_replays_cached_bodies(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            self.fixtures(folder)
            with patch('scripts.market_map.eastern_bia.Transport') as cls:
                t = cls.return_value
                t._check_robots.side_effect = SourceBlocked('robots disallows action')
                t.metrics.return_value = {'requests': 1}
                with self.assertRaisesRegex(SourceBlocked, 'robots disallows'):
                    collect(folder, folder)
                t.fetch.assert_not_called()
                self.assertFalse((folder / 'manifest.json').exists())
                t._check_robots.side_effect = None
                data = {'success': True, 'data': {'posts': [card('One'), card('Two')], 'more': False, 'total': 2}}
                t.fetch.return_value = Response(json.dumps(data).encode(), {}, 'source')
                report = collect(folder, folder)
                self.assertEqual(report['observed_source_rows'], 2)
                self.assertEqual(report['distinct_factual_fingerprints'], 2)
                self.assertFalse(report['market_completeness_verified'])
                t.fetch.reset_mock()
                replay = collect(folder, folder, offline_replay=True)
                t.fetch.assert_not_called()
                self.assertEqual(replay['normalized_sha256'], report['normalized_sha256'])
            (folder / 'independent-verification.json').write_text(json.dumps({'status': 'passed', 'normalized_sha256': report['normalized_sha256']}))
            with MarketMap(':memory:') as store:
                original = store.assert_field
                def fail_metadata(entity, kind, field, *args, **kwargs):
                    if field == 'source_listed_role':
                        raise RuntimeError('Metadata interruption')
                    return original(entity, kind, field, *args, **kwargs)
                with patch.object(store, 'assert_field', side_effect=fail_metadata):
                    with self.assertRaisesRegex(RuntimeError, 'Metadata interruption'):
                        apply_bia_acquisition(store, folder)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM raw_records').fetchone()[0], 0)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM organisations').fetchone()[0], 0)
                first = apply_bia_acquisition(store, folder)
                self.assertEqual(first['rows'], 2)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM source_identities').fetchone()[0], 2)
                replay = apply_bia_acquisition(store, folder)
                self.assertEqual(replay['new_organisations'], 0)
                self.assertEqual(replay['replayed_batches'], 1)
                for table in ['people', 'contact_channels', 'relationships']:
                    self.assertEqual(store.db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0], 0)
                self.assertFalse(store.db.execute('PRAGMA foreign_key_check').fetchall())


if __name__ == '__main__':
    unittest.main()
