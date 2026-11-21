import hashlib
import json
import unittest

from scripts.market_map.phone_extraction import extract_published_phones


class PhoneExtractionTests(unittest.TestCase):
    def test_comment_tail_phone_does_not_crash(self):
        records=extract_published_phones(b'<div><!-- note -->Phone: 519-555-0123</div>','https://business.test/')
        self.assertTrue(any(r['phone']=='+15195550123' for r in records))

    def extract(self, body, url='https://business.test/contact'):
        return extract_published_phones(body.encode(), url)

    def test_tel_preserves_extension_separately_and_source_evidence(self):
        body='<p>Windsor office: <a href="tel:+1-519-555-0123;ext=42">Call reception</a></p>'
        rows=self.extract(body)
        row=next(r for r in rows if r['phone']=='+15195550123')
        self.assertEqual(row['extension'],'42')
        self.assertIn('519',row['raw_value'])
        self.assertEqual(row['source_url'],'https://business.test/contact')
        self.assertEqual(row['page_content_sha256'],hashlib.sha256(body.encode()).hexdigest())
        self.assertIn('Windsor',row['context'])
        self.assertEqual(row['verification_status'],'source_published_unverified')
        self.assertTrue(row['extraction_method'])

    def test_visible_extension_and_formatted_phone_are_not_combined(self):
        rows=self.extract('<p>Telephone: (519) 555-0123 ext. 106</p>')
        self.assertIn(('+15195550123','106'),{(r['phone'],r['extension']) for r in rows})
        self.assertNotIn('+15195550123106',{r['phone'] for r in rows})

    def test_jsonld_phone_and_fax_keep_distinct_kind(self):
        structured={'@context':'https://schema.org','@type':'LocalBusiness','name':'Example Office',
                    'telephone':'+1 519 555 0123','faxNumber':'+1 519 555 0124'}
        rows=self.extract('<script type="application/ld+json">'+json.dumps(structured)+'</script>')
        self.assertIn(('+15195550123','phone'),{(r['phone'],r['kind']) for r in rows})
        self.assertIn(('+15195550124','fax'),{(r['phone'],r['kind']) for r in rows})

    def test_microdata_and_explicit_international_numbers(self):
        rows=self.extract('<span itemprop="telephone" content="+44 20 7946 0123"></span><a href="tel:5195550123">Call</a>')
        self.assertIn('+442079460123',{r['phone'] for r in rows})
        self.assertIn('+15195550123',{r['phone'] for r in rows})

    def test_script_noise_hidden_contacts_order_ids_and_dates_are_ignored(self):
        body='''<script>var x="519-555-0123";</script>
        <div hidden>Phone: 519-555-0124</div>
        <div style="display:none">Phone: 519-555-0125</div>
        <p>Order number 5195550126. Date: 2026-10-27.</p>'''
        self.assertEqual(self.extract(body),[])

    def test_invalid_jsonld_does_not_drop_visible_contact(self):
        rows=self.extract('<script type="application/ld+json">{broken</script><p>Office: 519-555-0123</p>')
        self.assertIn('+15195550123',{r['phone'] for r in rows})

    def test_same_shared_number_keeps_each_source_context(self):
        body='<p>Phone: 519-555-0123</p>'
        first=self.extract(body,'https://first.test/contact')
        second=self.extract(body,'https://second.test/contact')
        self.assertTrue(first and second)
        self.assertEqual(first[0]['phone'],second[0]['phone'])
        self.assertNotEqual(first[0]['source_url'],second[0]['source_url'])
        self.assertEqual(first[0]['verification_status'],'source_published_unverified')


if __name__=='__main__':unittest.main()
