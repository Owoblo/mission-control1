import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.market_map.eastern_public_rosters import acquire, audit_saved_roster, parse_page
from scripts.market_map.transport import Response, SourceBlocked


class EasternPublicRosterTests(unittest.TestCase):
    def test_mcnab_counts_reconcile_categories_without_dropping_duplicate_appearances(self):
        card = '<div class="business-summary"><div><strong><a href="/business-directory/Art/">Art</a></strong></div><div class="control"><a>2 listings - see all</a></div><div><a href="/business-directory/12/">Published business</a></div><div><a href="/business-directory/13/">Published association</a></div></div>'
        rows, next_urls, counts = parse_page('mcnab', card.encode(), 'https://www.mcnabbraeside.com/business-directory/')
        self.assertEqual(len(rows), 2);self.assertEqual(next_urls, ['https://www.mcnabbraeside.com/business-directory/Art/']);self.assertEqual(counts[0]['parsed_rows'], 2)
        self.assertIsNone(rows[0]['address']);self.assertIsNone(rows[0]['country']);self.assertIsNone(rows[0]['website'])
        with self.assertRaisesRegex(SourceBlocked, 'reconcile'):
            parse_page('mcnab', card.replace('2 listings', '3 listings').encode(), 'https://www.mcnabbraeside.com/business-directory/')

    def test_rockland_only_printed_components_and_native_profile_identity(self):
        body = '<article about="/business-resources/business-directory/example" class="node--type-business"><span class="field--name-title">Example</span><span class="address-line1">12 Street</span><span class="locality">Town</span><div class="field--name-field-business-website"><a href="https://business.test">Website</a></div></article><li class="pager__item--next"><a href="?page=1">Next</a></li>'
        rows, next_urls, _ = parse_page('rockland', body.encode(), 'https://choisir-choose.clarence-rockland.com/business-resources/business-directory')
        self.assertEqual(rows[0]['city'], 'Town');self.assertIsNone(rows[0]['country']);self.assertIsNone(rows[0]['phone'])
        self.assertEqual(rows[0]['source_record_id'], 'https://choisir-choose.clarence-rockland.com/business-resources/business-directory/example')
        self.assertEqual(next_urls, ['https://choisir-choose.clarence-rockland.com/business-resources/business-directory?page=1'])

    def test_lanark_excludes_biographies_contacts_and_preserves_unknown_address(self):
        body = '<div id="wpbdp-listing-12"><div class="listing-title"><h3><a href="/listings/12/business/">Business</a></h3></div><div class="wpbdp-field-long_business_description"><div class="value">Person biography excluded</div></div><div class="wpbdp-field-business_contact_email"><div class="value">person@example.test</div></div><div class="wpbdp-field-business_genre"><div class="value"><a>Literal category</a></div></div></div><a href="/listings/page/2/">Next →</a>'
        rows, next_urls, _ = parse_page('lanark', body.encode(), 'https://www.lanarkhighlandsbta.ca/listings/')
        self.assertEqual(rows[0]['categories'], ['Literal category']);self.assertIsNone(rows[0]['address'])
        self.assertNotIn('biography', str(rows));self.assertNotIn('person@example', str(rows));self.assertEqual(len(next_urls), 1)

    def test_lanark_exact_business_address_label_has_no_guessed_components(self):
        body = '<div id="wpbdp-listing-12"><div class="listing-title"><h3><a href="/listings/12/business/">Business</a></h3></div><div class="address-info wpbdp-field-display"><span class="field-label address-label">Business Address</span><div>375 Printed Avenue, Printed Town, Ontario<br> K1A0A1</div></div></div>'
        rows, _, _ = parse_page('lanark', body.encode(), 'https://www.lanarkhighlandsbta.ca/listings/')
        self.assertIn('375 Printed Avenue', rows[0]['address']);self.assertIsNone(rows[0]['city']);self.assertIsNone(rows[0]['country'])
        legacy, _, _ = parse_page('lanark', body.encode(), 'https://www.lanarkhighlandsbta.ca/listings/', include_lanark_address=False)
        self.assertIsNone(legacy[0]['address'])

    def test_repeated_native_page_ids_leave_partial_receipts_and_do_not_claim_exhaustion(self):
        body = b'<article about="/business-resources/business-directory/example" class="node--type-business"><span class="field--name-title">Example</span></article><li class="pager__item--next"><a href="?page=1">Next</a></li>'
        class FakeTransport:
            def __init__(self, **kwargs): pass
            def fetch(self, url): return Response(body, {}, url)
            def metrics(self): return {'requests': 2, 'bytes_fetched': len(body) * 2}
        with tempfile.TemporaryDirectory() as directory, patch('scripts.market_map.eastern_public_rosters.Transport', FakeTransport):
            result = acquire(Path(directory), 'rockland')
            self.assertEqual(result['status'], 'acquired_partial');self.assertFalse(result['source_inventory_exhausted'])
            self.assertEqual(result['pages'], 2);self.assertEqual(result['unique_source_ids'], 1)
            self.assertIn('overlap', result['error'])

    def test_complete_plain_next_traversal_is_independently_reparsed_and_tamper_held(self):
        class FakeTransport:
            def __init__(self, **kwargs): pass
            def fetch(self, url):
                number = 2 if '/page/2/' in url else 1
                body = '<div id="wpbdp-listing-' + str(number) + '"><div class="listing-title"><h3><a href="/listings/' + str(number) + '/business/">Business' + str(number) + '</a></h3></div></div>'
                if number == 1: body += '<a href="/listings/page/2/">Next →</a>'
                return Response(body.encode(), {}, url)
            def metrics(self): return {'requests': 2, 'bytes_fetched': 500}
        with tempfile.TemporaryDirectory() as directory, patch('scripts.market_map.eastern_public_rosters.Transport', FakeTransport):
            folder = Path(directory);result = acquire(folder, 'lanark')
            self.assertTrue(result['source_inventory_exhausted']);self.assertEqual(result['unique_source_ids'], 2)
            audit = audit_saved_roster(folder, 'lanark');self.assertEqual(audit['independently_reparsed_original_pages'], 2)
            (folder / result['raw_receipts'][0]['file']).write_bytes(b'Changed source original')
            with self.assertRaisesRegex(SourceBlocked, 'gzip checksum'): audit_saved_roster(folder, 'lanark')


if __name__ == '__main__': unittest.main()
