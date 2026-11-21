import hashlib
import json
from pathlib import Path
import unittest
from scripts.market_map.contact_normalization import parse_phone_candidate
from scripts.market_map.phone_extraction import normalize_phone, extract_published_phones


class PhoneNormalizationTests(unittest.TestCase):
    def test_frozen_phone_safety_set(self):
        from scripts.market_map.extraction_benchmark import benchmark
        fixtures = Path(__file__).parent / 'fixtures'
        run = benchmark(fixtures / 'manifest.json', fixtures / 'labels.jsonl')
        for channel in ('phone', 'phone_kind'):
            self.assertEqual((run['extraction'][channel]['fp'], run['extraction'][channel]['fn']), (0, 0))
        self.assertEqual(run['extraction']['fax_as_phone'], 0)

    def test_canadian_us_and_toll_free_formats_and_extensions(self):
        cases = {'(519) 555-0123 ext. 106': ('+15195550123', '106'),
                 'tel:+1-519-555-0123;ext=0042': ('+15195550123', '0042'),
                 'TEL:8005550123': ('+18005550123', ''),
                 '+1 (212) 555-0123 x9': ('+12125550123', '9'),
                 '15195550123': ('+15195550123', ''),
                 'tel:%2B15195550123;ext=3?ignored=true': ('+15195550123', '3'),
                 '519.555.0123 #8': ('+15195550123', '8')}
        for value, expected in cases.items():
            with self.subTest(value=value): self.assertEqual(normalize_phone(value), expected)

    def test_invalid_plus_one_never_uses_international_fallback(self):
        for value in ['+11234567890', '+15191550123', '+1519555012', '+151955501234', '+12345678', '+151955501234567']:
            with self.subTest(value=value):
                self.assertIsNone(normalize_phone(value))
                self.assertEqual(parse_phone_candidate(value)['reason'], 'invalid_nanp')

    def test_explicit_international_precedes_nanp_by_length(self):
        for value, expected in [('+4422345678', '+4422345678'), ('+44 20 7946 0123', '+442079460123'),
                                ('+61 2 5550 1234', '+61255501234'), ('+33 1 23 45 67 89', '+33123456789'),
                                ('+23456789', '+23456789'), ('+234567890123456', '+234567890123456')]:
            self.assertEqual(normalize_phone(value), (expected, ''))
            self.assertEqual(parse_phone_candidate(value)['reason'], 'international_shape_only')

    def test_malformed_plus_controls_and_unsupported_values(self):
        for value in ['++442079460123', '+44+2079460123', '519+555+0123', '+01234567890',
                      '+2345678', '+2345678901234567', '02079460123', '1-800-FLOWERS',
                      'tel:5195550123;phone-context=example.test', 'tel:5195550123;ext=12345678901',
                      'tel:5195550123%0d%0a', '5195550123\x00', '(519 555-0123',
                      '٥١٩٥٥٥٠١٢٣', '+44２０７９４６０１２３']:
            with self.subTest(value=value): self.assertIsNone(normalize_phone(value))

    def test_selected_unicode_separators_preserve_raw_and_extension(self):
        raw = 'tel:+1\u202f519\u2011555\u20130123;ext=04'
        parsed = parse_phone_candidate(raw)
        self.assertEqual((parsed['e164'], parsed['extension']), ('+15195550123', '04'))
        self.assertEqual(parsed['raw_value'], raw)

    def test_rejected_candidate_retains_raw_and_extension(self):
        raw = 'tel:+11234567890;ext=001'
        parsed = parse_phone_candidate(raw)
        self.assertEqual((parsed['raw_value'], parsed['extension'], parsed['e164'], parsed['status']), (raw, '001', None, 'invalid'))

    def test_normalization_is_idempotent(self):
        for value in ['5195550123', '+4422345678', '+44 20 7946 0123;ext=09']:
            phone, extension = normalize_phone(value)
            self.assertEqual(normalize_phone('tel:' + phone + (';ext=' + extension if extension else '')), (phone, extension))

    def test_all_extraction_methods_share_rejection_and_raw_contract(self):
        for value in ['+11234567890', '+15191550123']:
            page = '<a href="tel:' + value + '">Call</a><span itemprop="telephone" content="' + value + '"></span><script type="application/ld+json">' + json.dumps({'telephone': value}) + '</script><p>Phone: ' + value + '</p>'
            self.assertEqual(extract_published_phones(page, 'https://fictional.test/'), [])
        body = '<a href="tel:+44 20 7946 0123;ext=09">London</a>'
        row = extract_published_phones(body, 'https://fictional.test/')[0]
        self.assertEqual(row['raw_value'], 'tel:+44 20 7946 0123;ext=09')
        self.assertEqual(row['extension'], '09')
        self.assertEqual(row['page_content_sha256'], hashlib.sha256(body.encode()).hexdigest())
        self.assertEqual(row['organisation_ownership_status'], 'not_verified')
        self.assertEqual(row['outreach_eligibility'], 'research_only')
