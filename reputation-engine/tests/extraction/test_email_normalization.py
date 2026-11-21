import hashlib
import unittest
from scripts.market_map.contact_normalization import parse_email_candidate
from scripts.market_map.email_extraction import clean_email, extract_published_emails


class EmailNormalizationTests(unittest.TestCase):
    def test_unicode_local_is_retained_without_ascii_substring(self):
        for address in ['élise@fictional.test', 'e\u0301lise@fictional.test', '用户@fictional.test', 'a\u200db@fictional.test', '"a b"@fictional.test']:
            with self.subTest(address=address):
                body='<meta charset="utf-8"><p>'+address+'</p>'
                evidence=[]
                self.assertEqual(extract_published_emails(body, 'https://fictional.test/', candidate_evidence=evidence), [])
                self.assertTrue(any(r['raw_value']==address for r in evidence))
                self.assertTrue(all(r['page_content_sha256']==hashlib.sha256(body.encode()).hexdigest() for r in evidence))

    def test_domain_labels_and_entire_candidate_validation(self):
        for address in ['a@foo.-bar.test', 'a@-foo.test', 'a@foo-.test', 'a@foo..test', 'a@'+('x'*64)+'.test', 'a@foo_test.test', 'double..dot@foo.test']:
            self.assertIsNone(clean_email(address), address)
            self.assertEqual(extract_published_emails('<p>'+address+'</p>', 'https://fictional.test/'), [])

    def test_case_idna_and_roundtrip_policy(self):
        self.assertEqual(clean_email('Sales+Tag@BÜCHER.test'), 'Sales+Tag@xn--bcher-kva.test')
        self.assertEqual(clean_email('Sales@BUSINESS.test'), 'Sales@business.test')
        self.assertEqual(parse_email_candidate('a@faß.test')['status'], 'unsupported')
        rows=extract_published_emails('<p>Sales@BUSINESS.test sales@business.test</p>', 'https://fictional.test/')
        self.assertEqual({r['email'] for r in rows}, {'Sales@business.test','sales@business.test'})
        self.assertEqual(clean_email(clean_email('Sales@BÜCHER.test')), 'Sales@xn--bcher-kva.test')

    def test_source_layers_decode_once_and_keep_holds(self):
        page='<a href="mailto:Sales%2BTag@BUSINESS.test?body=ignored@other.test">Contact</a><div hidden>private@other.test</div><p>info@business.test.</p>'
        rows=extract_published_emails(page,'https://business.test/')
        self.assertEqual({r['email'] for r in rows},{'Sales+Tag@business.test','info@business.test'})
        self.assertTrue(all(r['ownership_status']=='not_checked' and r['outreach_eligibility']=='research_only' for r in rows))
        for value in ['a@business.test\r\n','a@business.test\x00','"quoted"@business.test','a@[127.0.0.1]']:
            self.assertIsNone(clean_email(value))

    def test_idn_visible_and_explicit_unsupported_channels(self):
        evidence=[]
        rows=extract_published_emails('<p>office@bücher.test</p><a href="mailto:élise@business.test">Email</a>', 'https://business.test/', candidate_evidence=evidence)
        self.assertEqual([r['email'] for r in rows], ['office@xn--bcher-kva.test'])
        self.assertTrue(any(r['status']=='unsupported' and r['raw_value']=='élise@business.test' for r in evidence))
