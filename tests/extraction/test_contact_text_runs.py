import unittest
from lxml import html
from scripts.market_map.contact_text_runs import iter_contact_text_runs
from scripts.market_map.email_extraction import extract_published_emails
from scripts.market_map.phone_extraction import extract_published_phones

class InlineTests(unittest.TestCase):
    def emails(self,body):return [r['email'] for r in extract_published_emails(body,'https://business.test')]
    def test_inline_literal_and_explicit_obfuscation(self):
        for body in ['<p>sales<span>@</span>business.test</p>','<p>sales<span>[at]</span>business<span>[dot]</span>test</p>']:
            self.assertEqual(self.emails(body),['sales@business.test'])
            rows=extract_published_emails(body,'https://business.test')[0]['occurrences']
            self.assertTrue(any(r['text_position'].get('segments') for r in rows if r.get('text_position')))
    def test_no_cross_boundary_join(self):
        for middle in ['<br>','<span hidden>x</span>','<span style="display:none">x</span>', '</td><td>', '</div><div>', '<a href="/other">@</a>','<span class="business-card">@</span>']:
            self.assertEqual(self.emails('<div>sales'+middle+'business.test</div>'),[])
        self.assertEqual(self.emails('<div style="display:flex">sales<span>@</span>business.test</div>'),[])
    def test_phone_extension_and_fax_share_classifier(self):
        rows=extract_published_phones('<p>Fax: <span>(519)</span> 555-0123 ext. <b>09</b></p><p>Phone: (519) 555-0124</p>','https://business.test')
        fax=[r for r in rows if r['phone']=='+15195550123' and r['extension']=='09']
        self.assertTrue(fax);self.assertTrue(all(r['kind']=='fax' for r in fax))
        self.assertTrue(all(r['kind']=='phone' for r in rows if r['phone']=='+15195550124'))
    def test_resource_limits_and_original_segment_locations(self):
        doc=html.fromstring('<div><script>bad</script><p>sales<span>@</span>business.test</p></div>')
        for run in iter_contact_text_runs(doc):
            for segment in run['segments']:self.assertTrue(doc.getroottree().xpath(segment['source_dom_locator']))
        self.assertEqual(list(iter_contact_text_runs(html.fromstring('<p>sales<span>@</span>business.test</p>'),max_chars=5)),[])

    def test_partial_suffix_is_replaced_not_added_alongside_full_address(self):
        self.assertEqual(self.emails('<p>sal<span>es@business.test</span></p>'),['sales@business.test'])
        self.assertEqual(self.emails('<p>éli<span>se@business.test</span></p>'),[])
    def test_hidden_phone_nodes_are_not_joined_or_promoted(self):
        body='<p>Phone: (519)<span hidden>0</span>555-0123</p><span hidden itemprop="telephone" content="+15195550124"></span>'
        self.assertEqual(extract_published_phones(body,'https://business.test'),[])

    def test_boolean_schema_and_data_cards_are_boundaries(self):
        for attr in ['itemscope','data-company="other"']:
            self.assertEqual(self.emails('<p>sales<span '+attr+'>@</span>business.test</p>'),[])
