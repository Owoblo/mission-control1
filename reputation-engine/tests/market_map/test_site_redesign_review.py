"""Regression cases from independent review of the integrated source-first runner."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.market_map.site_research_ai import SiteResearchAI, _site_context
from scripts.market_map.site_research_runner import BudgetTransport, run, site_context
from scripts.market_map.site_research_queue import SiteResearchQueue


class ReviewRegressionTests(unittest.TestCase):
    def test_runner_context_survives_ai_normalization(self):
        site={'site_id':'site:a','municipality':'Windsor','district':'Centre','category':'numbered',
              'addresses':'["42 Main St"]','members':[{'building_id':'building:a',
              'reported_place_names':['Known Shop'],'candidate_addresses_original':['42 Main St'],
              'queue_snapshot':{'latitude':42.3,'longitude':-83.0,'zoning_codes':['CD2']}}]}
        context=_site_context(site_context(site))
        self.assertEqual(context['building_ids'],['building:a'])
        self.assertEqual(context['reported_place_names'],['Known Shop'])
        self.assertEqual(context['zoning_codes'],['CD2'])
        self.assertTrue(context['coordinates'])

    def test_preflight_budget_rejection_can_resume_without_uncertain_charge(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'docs').mkdir()
            (root/'docs/source-first-current-contract.md').write_text('Find supported occupants.')
            budget=BudgetTransport(root,root,max_calls=0,transport=lambda b:self.fail('No budget'))
            site={'site_id':'site:a','municipality':'Windsor','addresses':['42 Main St']}
            ai=SiteResearchAI(root,root/'ai',call=budget)
            with self.assertRaises(RuntimeError):ai.discover(site)
            calls=[]
            def transport(body):
                calls.append(body)
                return {'status':'completed','output':[{'type':'message','content':[{
                    'type':'output_text','text':json.dumps({'sources':[],'proposals':[],'gaps':['unresolved']})}]}]}
            ai=SiteResearchAI(root,root/'ai',call=BudgetTransport(root,root,max_calls=1,transport=transport))
            ai.discover(site)
            self.assertEqual(len(calls),1)

    def test_rendering_gap_survives_saved_result_even_if_ai_reports_no_conflict(self):
        class AI:
            def __init__(self,*a,**kw):pass
            def discover(self,site):return {'urls':['https://example.org/location'],'proposals':[],'gaps':[]}
            def analyze(self,*a):return {'claims':[],'held_claims':[],'gaps':[], 'requires_review':False}
            def usage_summary(self):return {'estimated_token_usd':0}
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);db=root/'queue.sqlite3';q=SiteResearchQueue(db)
            q.db.execute('INSERT INTO sites VALUES(?,?,?,?,?,?,0,0,NULL,NULL,NULL,NULL,0)',
                ('site:a','Windsor','Centre','["42 Main St"]','numbered','pending'))
            q.db.execute('INSERT INTO members VALUES(?,?,?)',('site:a','building:a',json.dumps({'building_id':'building:a'})))
            q.close();body=b'<p>Example Shop at 42 Main St Windsor.</p>';(root/'body').write_bytes(body)
            def collector(events,*a,**kw):
                return {events[0]['source_url']:dict(body_path='body',body_sha256=hashlib.sha256(body).hexdigest(),
                    retrieved_at='2026-10-30',content_type='text/html',rendering_gap='Browser timed out')}
            with patch('scripts.market_map.site_research_runner.shutil.disk_usage') as usage:
                usage.return_value.free=10*1024**3
                run(db,root,root/'out',district='Centre',limit=1,ai_factory=AI,collector=collector)
            q=SiteResearchQueue(db)
            result=json.loads(q.db.execute('SELECT result FROM research_results').fetchone()[0]);q.close()
            self.assertTrue(any('Browser timed out' in gap for gap in result['gaps']))
            self.assertTrue(result['requires_review'])


if __name__=='__main__':unittest.main()
