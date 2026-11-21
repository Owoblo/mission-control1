import hashlib
import json
import unittest
from scripts.market_map.html_evidence_metadata import extract_metadata

class MetadataTests(unittest.TestCase):
    def test_inline_entities_footer(self):
        body=b'<title>A &amp; B</title><h1>4<sup>th</sup> Street</h1><footer>Call <a href="tel:+15195551234">Sales &amp; service</a><script>BAD</script><style>BAD</style></footer>'
        result=extract_metadata(body,'https://example.org')
        self.assertEqual(result['records'][0]['text'],'A & B')
        self.assertEqual(result['records'][1]['text'],'4th Street')
        contact=result['records'][2];self.assertEqual(contact['dom_context'],'Call Sales & service')
        self.assertEqual(contact['raw_sha256'],hashlib.sha256(body).hexdigest())
    def test_logo_and_json_are_candidates(self):
        body=b'<img alt="ACME logo" src="/logo.png"><script type="application/ld+json">{"name":"ACME"}</script><script type="application/ld+json">{broken}</script>'
        result=extract_metadata(body,'https://example.org')
        image=next(r for r in result['records'] if r['kind']=='image')
        self.assertFalse(image['relationship_inferred']);self.assertEqual(image['verification_status'],'candidate')
        structured=next(r for r in result['records'] if r['kind']=='json_ld')
        self.assertEqual(structured['parsed'],{'name':'ACME'})
        self.assertEqual(result['rejected'][0]['reason'],'malformed_or_nonobject_json')
    def test_caps_explicit(self):
        result=extract_metadata(b'<h1>Long heading</h1><h2>Second</h2>','https://example.org',max_records=1,max_text_chars=4)
        self.assertTrue(result['truncated']);self.assertEqual(result['records'][0]['text'],'Long')
        self.assertEqual(set(result['truncation_reasons']),{'text_chars','record_count'})
        result=extract_metadata(b'<h2>foo</h2>'*100,'https://example.org',max_output_bytes=1000)
        self.assertLessEqual(len(json.dumps(result,ensure_ascii=False).encode()),1000)
        self.assertIn('output_bytes',result['truncation_reasons'])
    def test_no_input_truncation_and_json_limit(self):
        with self.assertRaises(ValueError):extract_metadata(b'12345','https://example.org',max_input_bytes=4)
        result=extract_metadata(b'<script type="application/ld+json">{"name":"long"}</script>','https://example.org',max_json_chars=3)
        self.assertEqual(result['rejected'][0]['reason'],'over_json_budget')
        self.assertTrue(result['truncated'])

if __name__=='__main__':unittest.main()
