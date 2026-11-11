import hashlib
import json
import unittest
from unittest.mock import patch
from scripts.market_map.site_source_extract import extract_source


class SourceExtractTests(unittest.TestCase):
    def org(self, **address):
        return {'@type': 'LocalBusiness', 'name': 'Example Shop', 'address': {
            '@type': 'PostalAddress', 'streetAddress': '42 Main St',
            'addressLocality': 'Windsor', **address}}

    def extract(self, data, **kwargs):
        body = ('<script type="application/ld+json">' + json.dumps(data) + '</script>').encode()
        return extract_source(body, source_url='https://example.org/locations',
                              retrieved_at='2026-10-30T00:00:00Z',
                              target_addresses=['42 Main St'], target_locality='Windsor', **kwargs)

    def test_explicit_match_is_not_current_occupancy(self):
        result = self.extract(self.org())
        self.assertEqual(result['route'], 'deterministic_evidence_review')
        candidate = result['candidates'][0]
        self.assertFalse(candidate['current_occupancy_verified'])
        self.assertFalse(result['tenant_coverage_complete'])
        self.assertEqual(candidate['evidence_text_sha256'], hashlib.sha256(candidate['evidence_text'].encode()).hexdigest())
        self.assertEqual(candidate['source_url'], result['source_url'])

    def test_country_conflict_routes_to_review(self):
        result=self.extract(self.org(addressCountry='US'))
        self.assertEqual(result['route'],'ai_research')
        self.assertIn('structured_country_or_province_conflict',result['gaps'])

    def test_closed_notice_prevents_structured_fast_path(self):
        body=('<p>We have ceased operations.</p><script type="application/ld+json">'+json.dumps(self.org())+'</script>').encode()
        result=extract_source(body,source_url='https://example.org',retrieved_at='2026-10-30',target_addresses=['42 Main St'],target_locality='Windsor')
        self.assertEqual(result['route'],'ai_research')
        self.assertIn('operating_status_notice_requires_temporal_review',result['gaps'])

    def test_multiple_organizations_preserved(self):
        a, b = self.org(), self.org()
        b['name'] = 'Other Organization'
        result = self.extract({'@graph': [a, b]})
        self.assertEqual(len(result['candidates']), 2)
        self.assertNotEqual(result['candidates'][0]['source_pointer'], result['candidates'][1]['source_pointer'])

    def test_suites_never_removed(self):
        for address in ({'streetAddress': '42 Main St Suite 2'}, {'unitNumber': '2'}, {'postOfficeBoxNumber': '42'}):
            with self.subTest(address=address):
                result = self.extract(self.org(**address))
                self.assertEqual(result['route'], 'ai_research')
                self.assertIsNone(result['candidates'][0]['matched_target_address'])

    def test_missing_wrong_locality_or_unstructured_address(self):
        for address in ({'addressLocality': ''}, {'addressLocality': 'Toronto'}, {'streetAddress': '44 Main St'}):
            self.assertEqual(self.extract(self.org(**address))['route'], 'ai_research')
        a = self.org()
        a['address'] = '42 Main St Windsor'
        self.assertEqual(self.extract(a)['route'], 'ai_research')
        del a['address']
        self.assertEqual(self.extract(a)['route'], 'ai_research')

    def test_reference_resolution_and_duplicate_ids(self):
        org = self.org()
        address = org['address']
        address['@id'] = '#address'
        org['address'] = {'@id': '#address'}
        self.assertEqual(self.extract({'@graph': [org, address]})['route'], 'deterministic_evidence_review')
        result = self.extract({'@graph': [org, address, dict(address)]})
        self.assertEqual(result['route'], 'ai_research')

    def test_hash_integrity(self):
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.extract(self.org(), expected_sha256='bad')

    def test_invalid_block_and_plain_text_not_proof(self):
        result = extract_source(b'<p>Shop 42 Main St Windsor</p><script type="application/ld+json">bad</script>',
                                source_url='https://example.org', retrieved_at='now',
                                target_addresses=['42 Main St'], target_locality='Windsor')
        self.assertEqual(result['route'], 'ai_research')
        self.assertEqual(result['candidates'], [])
        self.assertIn('invalid_jsonld_block:0', result['gaps'])
        self.assertNotIn('bad', result['text'])

    def test_pdf_without_dependency(self):
        with patch.dict('sys.modules', {'pypdf': None}):
            result = extract_source(b'%PDF-1.4', source_url='https://example.org/file.pdf',
                                    retrieved_at='now', target_addresses=['42 Main St'],
                                    target_locality='Windsor', content_type='application/pdf')
        self.assertIn('pdf_extractor_unavailable', result['gaps'])
        self.assertEqual(result['route'], 'ai_research')

    def test_person_not_collected(self):
        a = self.org()
        a['@type'] = 'Person'
        self.assertEqual(self.extract(a)['candidates'], [])


if __name__ == '__main__':
    unittest.main()
