import html
import json
import contextlib
import io
from pathlib import Path
import tempfile
import unittest
from .windsor_saved_review import SavedResearchParser, review_cohort, collect

class SavedReviewTests(unittest.TestCase):
    def row(self, **kw):
        return {'site_id':'site', 'name':'A & B', 'address':'1 Main St', 'unit':'', 'source_url':'https://example.com',
                'quote':'A & B at 1 Main St', 'body_sha256':'hash', 'temporal_status':'reported_current',
                'district':'Walkerville', **kw}

    def test_html_json_entities_decode_without_losing_evidence(self):
        p=SavedResearchParser(); value={'site_id':'one', 'claims':[{'organization':'A & B <Company>'}]}
        p.feed('<pre>'+html.escape(json.dumps(value))+'</pre><pre>{}</pre>')
        self.assertEqual(p.results,[value])

    def test_old_or_incomplete_claims_are_not_in_first_current_review_cohort(self):
        rows=[self.row(),self.row(site_id='old',temporal_status='historical'),self.row(site_id='missing',source_url=None)]
        result=review_cohort(rows)
        self.assertEqual(len(result),1);self.assertFalse(result[0]['outreach_eligible'])

    def test_duplicates_and_district_balance(self):
        rows=[self.row(site_id='w1'),self.row(site_id='w1'),self.row(site_id='w2'),self.row(site_id='s1',district='Sandwich')]
        result=review_cohort(rows,2)
        self.assertEqual({r['district'] for r in result},{'Sandwich','Walkerville'})

    def test_brand_at_different_sites_is_not_merged(self):
        self.assertEqual(len(review_cohort([self.row(site_id='one'),self.row(site_id='two')])),2)

    def test_partial_cloud_export_is_rejected_before_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); secret=root/'password';secret.write_text('fixture-only')
            def fetch(path):
                if path=='/status':return json.dumps({'queue':{'saved_investigations':2,'site_tasks':3}}).encode()
                return b'<pre>{"site_id":"one","claims":[]}</pre>'
            with self.assertRaisesRegex(ValueError,'count differs'):
                collect(root/'out',secret,fetcher=fetch)
            self.assertFalse((root/'out/summary.json').exists())

    def test_saved_results_are_reused_without_provider_or_model_calls(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); secret=root/'password';secret.write_text('fixture-only')
            data={'site_id':'one','district':'Walkerville','claims':[self.row()]}
            def fetch(path):
                if path=='/status':return json.dumps({'queue':{'saved_investigations':1,'site_tasks':2}}).encode()
                return ('<pre>'+html.escape(json.dumps(data))+'</pre>').encode()
            with contextlib.redirect_stdout(io.StringIO()):result=collect(root/'out',secret,fetcher=fetch)
            self.assertEqual(result['site_investigations'],1)
            self.assertEqual(result['paid_model_calls'],0)
            self.assertFalse(json.loads((root/'out/first-review-cohort.json').read_text())['automatic_send'])

if __name__=='__main__': unittest.main()
