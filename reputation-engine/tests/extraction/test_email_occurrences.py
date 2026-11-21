import unittest
from lxml import html
from scripts.market_map.email_extraction import extract_email_occurrences, extract_published_emails, summarize_email_occurrences

class OccurrenceTests(unittest.TestCase):
    def test_occurrences_stable_original_locators_and_offsets(self):
        body='<div><script>nothing</script><p>desk@business.test desk@business.test</p><p><a href="mailto:desk@business.test">Email</a></p></div>'
        rows=extract_email_occurrences(body,'https://business.test')
        self.assertEqual(len(rows),3)
        self.assertEqual(rows,extract_email_occurrences(body,'https://business.test'))
        tree=html.fromstring(body).getroottree()
        for row in rows:self.assertEqual(len(tree.xpath(row['source_dom_locator'])),1)
        self.assertEqual(len({r['occurrence_id'] for r in rows}),3)
        self.assertEqual(len(summarize_email_occurrences(rows+rows)[0]['occurrences']),3)
    def test_vendor_warning_order_independent_and_contexts_retained(self):
        body='<div><p>Staff desk@business.test</p><footer>Website by desk@business.test</footer></div>'
        rows=extract_email_occurrences(body,'https://business.test')
        summary=summarize_email_occurrences(rows)[0]
        self.assertEqual(summary,summarize_email_occurrences(list(reversed(rows)))[0])
        self.assertIn('conflicting_occurrence_contexts',summary['review_warnings'])
        self.assertEqual(len({r['candidate_owner']['source_dom_locator'] for r in rows}),2)
    def test_hidden_elements_and_visible_tails(self):
        body='<div><p style="visibility:hidden">hidden@business.test</p><span hidden>x@business.test</span>visible@business.test</div>'
        self.assertEqual([r['email'] for r in extract_published_emails(body,'https://business.test')],['visible@business.test'])
    def test_json_pointers_and_distinct_scripts(self):
        body='<script type="application/json">{"a/b~":{"email":["desk@business.test","desk@business.test"]}}</script><script type="application/ld+json">{"@type":"Organization","email":"desk@business.test"}</script>'
        rows=extract_email_occurrences(body,'https://business.test')
        self.assertEqual(len(rows),3)
        self.assertIn('/a~1b~0/email/0',{r['json_pointer'] for r in rows})
        self.assertTrue(all(r['source_dom_locator'] for r in rows))
    def test_distinct_attribute_literal_and_obfuscated_occurrences(self):
        body='''<div data-email="desk@business.test" data-email-address="desk@business.test"></div>
        <p>desk [at] business [dot] test; desk [at] business [dot] test</p>
        <script>el.addEventListener('click', ()=>{location='mailto:desk'.concat('@business.test')}); el.addEventListener('click', ()=>{location='mailto:desk'.concat('@business.test')});</script>'''
        rows=extract_email_occurrences(body,'https://business.test')
        self.assertEqual(len(rows),6)
        self.assertEqual(len({r['occurrence_id'] for r in rows}),6)
    def test_hidden_vendor_text_does_not_contaminate_visible_context(self):
        rows=extract_email_occurrences('<p>desk@business.test <span hidden>Website by</span></p>','https://business.test')
        self.assertEqual(rows[0]['association_status'],'published_on_page; organisation_and_person_ownership_unverified')
