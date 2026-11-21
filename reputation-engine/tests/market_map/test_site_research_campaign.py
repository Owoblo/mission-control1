import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from scripts.market_map.site_research_queue import SiteResearchQueue
from scripts.market_map.site_research_campaign import campaign,eligible


class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.db=self.root/'queue.sqlite3';self.q=SiteResearchQueue(self.db)
        for i in range(5):
            self.q.db.execute('INSERT INTO sites VALUES(?,?,?,?,?,?,0,0,NULL,NULL,NULL,NULL,0)',
                (f'site:{i}','Windsor','Walkerville','["42 Main St"]','numbered','pending'))
        self.calls=[]

    def tearDown(self):self.q.close();self.temp.cleanup()

    def fake(self,db,root,work,**kwargs):
        self.calls.append(kwargs);ids=kwargs['site_ids']
        (work/'api-usage.json').write_text(json.dumps({'requests_started':len(ids)*2,'responses':[]}))
        for sid in ids:self.q.db.execute('INSERT INTO research_results VALUES(?,?,0)',(sid,'{}'))
        return {'results':[{'site_id':sid,'state':'saved','estimated_token_usd':.1} for sid in ids],
            'lease_warning_files':[]}

    def execute(self,**kwargs):
        with patch('scripts.market_map.site_research_campaign.shutil.disk_usage') as disk, patch(
                'scripts.market_map.site_research_campaign.export_results',return_value={}):
            disk.return_value.free=10*1024**3
            return campaign(self.db,self.root,self.root/'out',batch_size=2,max_api_calls=100,
                runner=kwargs.pop('runner',self.fake),**kwargs)

    def test_multiple_batches_and_resume_do_not_repeat_sites(self):
        result=self.execute()
        self.assertEqual([len(x['site_ids']) for x in self.calls],[2,2,1])
        self.assertEqual(result['api_requests_started'],10)
        self.assertEqual(result['status'],'no_eligible_sites_remaining')
        self.execute();self.assertEqual(len(self.calls),3)

    def test_health_failure_prevents_next_batch(self):
        def failed(*args,**kwargs):
            (args[2]/'api-usage.json').write_text(json.dumps({'requests_started':2,'transport_errors':[{}, {}, {}]}))
            return {'results':[{'state':'retry_pending'} for _ in kwargs['site_ids']]}
        result=self.execute(runner=failed)
        self.assertEqual(len(result['batches']),1)
        self.assertEqual(result['status'],'batch_health_hold')

    def test_interrupted_batch_does_not_start_new_paid_work(self):
        out=self.root/'out';out.mkdir()
        (out/'campaign.json').write_text(json.dumps({'batches':[{'state':'running'}],
            'attempted_ids':['site:0'],'api_requests_started':2}))
        result=self.execute()
        self.assertEqual(result['status'],'interrupted_batch_requires_reconciliation')
        self.assertEqual(self.calls,[])

    def test_hold_and_unmapped_scopes_are_excluded(self):
        self.q.db.execute("UPDATE sites SET last_error='interrupted_request_uncertain' WHERE site_id='site:0'")
        self.q.db.execute("UPDATE sites SET district='UNMATCHED' WHERE site_id='site:1'")
        self.assertEqual([x[0] for x in eligible(self.db,{'site:2'})],['site:3','site:4'])


if __name__=='__main__':unittest.main()
