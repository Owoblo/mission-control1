import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from scripts.market_map.city_research_coordinator import coordinate, provision
from scripts.market_map.site_research_queue import SiteResearchQueue
from scripts.market_map.site_research_campaign import eligible
from scripts.market_map.site_research_campaign import campaign
from unittest.mock import patch


class CityCoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.cities=[]
        for name in ('Windsor','Tecumseh'):
            q=SiteResearchQueue(self.root/(name+'.db'))
            q.db.execute('INSERT INTO sites VALUES(?,?,?,?,?,?,0,0,NULL,NULL,NULL,NULL,0)',
                ('site:'+name,name,'D','["1 Main St"]','numbered','pending'));q.close()
            self.cities.append({'name':name,'geography_id':name,'configured_labels':[name],
                'status':'ready','db':name+'.db','output':name+'/campaign','districts':['D']})
        self.manifest=self.root/'manifest.json';self.write_manifest()
        self.calls=[]

    def write_manifest(self):self.manifest.write_text(json.dumps({'cities':self.cities,'configured_labels':['Windsor','Tecumseh']}))
    def tearDown(self):self.tmp.cleanup()

    def fake(self,db,root,work,**kw):
        self.calls.append(kw);work.mkdir(parents=True,exist_ok=True)
        result={'status':'no_eligible_sites_remaining','attempted_ids':['one'],'api_requests_started':3}
        (work/'campaign.json').write_text(json.dumps(result));return result

    def execute(self,**kw):return coordinate(self.root,self.manifest,self.root/'out',campaign_fn=kw.pop('campaign_fn',self.fake),**kw)

    def test_handoff_and_shared_budget(self):
        result=self.execute(max_api_calls=20,max_sites=10)
        self.assertEqual([c['municipality'] for c in self.calls],['Windsor','Tecumseh'])
        self.assertEqual(self.calls[1]['max_api_calls'],17)
        self.assertEqual(self.calls[1]['max_sites'],9)
        self.assertFalse(result['cities'][0]['market_complete'])
        self.assertEqual(result['cities'][0]['state'],'eligible_pass_exhausted_with_gaps')

    def test_technical_hold_never_advances(self):
        def failed(*a,**kw):self.calls.append(kw);return {'status':'batch_health_hold'}
        result=self.execute(campaign_fn=failed)
        self.assertEqual(len(self.calls),1);self.assertEqual(result['state'],'batch_health_hold')

    def test_global_budget_does_not_reset_per_city(self):
        result=self.execute(max_api_calls=5)
        self.assertEqual(len(self.calls),1);self.assertEqual(result['state'],'global_budget_reached')

    def test_bounded_turn_advances_at_site_quota_without_claiming_completion(self):
        def capped(db,root,work,**kw):
            self.calls.append(kw);work.mkdir(parents=True,exist_ok=True)
            result={'status':'site_limit_reached','attempted_ids':['one'],'api_requests_started':3}
            (work/'campaign.json').write_text(json.dumps(result));return result
        result=self.execute(campaign_fn=capped,sites_per_city_turn=1,max_sites=10,max_api_calls=20)
        self.assertEqual([c['municipality'] for c in self.calls],['Windsor','Tecumseh'])
        self.assertTrue(all(c['max_sites']==1 and c['max_api_calls']==4 for c in self.calls))
        self.assertEqual(result['state'],'bounded_city_turns_completed_with_gaps')
        self.assertTrue(all(not c['market_complete'] for c in result['cities']))

    def test_bounded_turn_does_not_bypass_health_or_global_budget(self):
        def hold(*a,**kw): self.calls.append(kw);return {'status':'api_credit_hold'}
        self.assertEqual(self.execute(campaign_fn=hold,sites_per_city_turn=1)['state'],'api_credit_hold')
        self.assertEqual(len(self.calls),1)
        self.calls=[]
        result=self.execute(sites_per_city_turn=1,max_api_calls=5)
        self.assertEqual(len(self.calls),1)
        self.assertEqual(result['state'],'global_budget_reached')

    def test_invalid_turn_quota_rejected_before_work(self):
        for quota in [-1,101,True,1.5]:
            with self.assertRaises(ValueError): self.execute(sites_per_city_turn=quota)
        self.assertEqual(self.calls,[])

    def test_missing_foundation_is_visible_not_empty_success(self):
        self.cities[1]['status']='foundation_required';self.write_manifest()
        result=self.execute();self.assertEqual(len(self.calls),1)
        self.assertEqual(result['cities'][1]['state'],'foundation_required')

    def test_city_query_is_explicit(self):
        self.assertEqual(eligible(self.root/'Tecumseh.db',set(),'Tecumseh',['D']),[('site:Tecumseh','D')])
        self.assertEqual(eligible(self.root/'Tecumseh.db',set(),'Windsor',['D']),[])

    def test_actual_campaign_passes_non_windsor_scope_to_runner(self):
        def runner(db,root,work,**kw):
            self.assertEqual(kw['municipality'],'Tecumseh')
            self.assertEqual(kw['site_ids'],['site:Tecumseh'])
            q=SiteResearchQueue(db)
            q.db.execute('INSERT INTO research_results VALUES(?,?,0)',('site:Tecumseh',json.dumps({'gaps':['Windsor branch must stay Windsor']})));q.close()
            (work/'api-usage.json').write_text(json.dumps({'requests_started':2}))
            return {'results':[{'state':'saved'}]}
        with patch('scripts.market_map.site_research_campaign.shutil.disk_usage') as disk:
            disk.return_value.free=10*1024**3
            result=campaign(self.root/'Tecumseh.db',self.root,self.root/'actual-campaign',
                municipality='Tecumseh',districts=['D'],runner=runner)
        self.assertEqual(result['status'],'no_eligible_sites_remaining')
        self.assertIn('Tecumseh',(self.root/'actual-campaign/index.html').read_text())
        self.assertIn('Windsor branch must stay Windsor',(self.root/'actual-campaign/index.html').read_text())

    def test_seed_hash_and_idempotence(self):
        city={'name':'Next','geography_id':'geo:next','db':'next.db','districts':['grid:1'],
              'seed':'next.json'}
        seed={'municipality':'Next','canonical_geography_id':'geo:next','sites':[{
            'municipality':'Next','district':'grid:1','site_id':'site:next','addresses':['1 Main St'],
            'category':'candidate','members':[{'building_id':'building:1'}]}]}
        p=self.root/'next.json';p.write_text(json.dumps(seed));city['seed_sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
        provision(self.root,city);provision(self.root,city)
        q=SiteResearchQueue(self.root/'next.db');self.assertEqual(q.db.execute('SELECT count(*) FROM sites').fetchone()[0],1);q.close()
        p.write_text('{}')
        with self.assertRaisesRegex(ValueError,'hash mismatch'):provision(self.root,city)

    def test_existing_health_hold_is_not_restarted(self):
        p=self.root/'Windsor/campaign';p.mkdir(parents=True)
        (p/'campaign.json').write_text(json.dumps({'status':'batch_health_hold','api_requests_started':3,'attempted_ids':['one']}))
        result=self.execute();self.assertEqual(self.calls,[]);self.assertEqual(result['state'],'city_requires_attention')

    def test_duplicate_city_and_path_escape_refused(self):
        self.cities[1]['geography_id']='Windsor';self.write_manifest()
        with self.assertRaisesRegex(ValueError,'Duplicate'):self.execute()
        with self.assertRaisesRegex(ValueError,'outside'):provision(self.root,{'db':'../escape'})


if __name__=='__main__':unittest.main()
