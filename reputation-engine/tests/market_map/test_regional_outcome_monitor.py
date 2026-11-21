import copy,unittest
from scripts.market_map.contact_readiness_ledger import ContactLedger
from scripts.market_map.cloud.regional_outcome_monitor import build_report
class OutcomeTests(unittest.TestCase):
 def setUp(self):
  self.ledger=ContactLedger(':memory:')
  self.manifest={'campaign_keys':['campaign'],'routes':[{'phone':'+15195550123','campaign_key':'campaign','verified_at':'2026-11-04T23:00:00Z','evidence_artifact':'fixture'}]}
  self.s={'checked_at':'2026-11-05T15:05:00Z','contacts':[{'id':'a','phone':'+15195550123','partner_company_id':'org'}],'touches':[],'jobs':[{'id':'j','contact_id':'a','sms_payload':{'campaign_key':'campaign','to':'+15195550123'},'status':'pending','created_at':'2026-11-04T23:01:00Z'}],'providers':{}}
 def tearDown(self):self.ledger.close()
 def report(self):return build_report(self.s,self.manifest,self.ledger,'2026-11-05')
 def test_pending_is_not_sent_and_repeat_import_is_idempotent(self):
  for _ in range(2):
   r=self.report();self.assertEqual(r['cohort']['currently_pending'],1);self.assertEqual(r['cohort']['provider_accepted'],0)
  self.assertEqual(self.ledger.scorecard('2026-11-04')['stages']['queued'],1)
 def test_acceptance_is_not_delivery(self):
  self.s['jobs'][0].update(status='sent',provider_sid='SMtest',sent_at='2026-11-05T15:00:00Z')
  r=self.report();self.assertEqual(r['new_verified_unique_contacts_provider_accepted'],1);self.assertEqual(r['cohort']['provider_confirmed_delivered_as_of_check'],0)
  self.s['providers']['SMtest']={'status':'delivered'};self.assertEqual(self.report()['cohort']['provider_confirmed_delivered_as_of_check'],1)
 def test_inbound_is_not_assumed_human(self):
  self.s['touches']=[{'contact_id':'a','direction':'inbound'}]
  r=self.report();self.assertEqual(r['cohort']['inbound_contacts_needing_human_or_auto_reply_classification'],1);self.assertIsNone(r['stages']['human_reply'])
 def test_changed_identity_held(self):
  self.s['contacts'][0]['phone']='+15195550999';r=self.report();self.assertEqual(r['cohort']['registered_contacts'],0);self.assertEqual(len(r['identity_holds']),1)
 def test_missing_acceptance_time_not_invented(self):
  self.s['jobs'][0].update(provider_sid='SMtest');r=self.report();self.assertEqual(r['cohort']['provider_accepted'],1);self.assertEqual(r['stages']['provider_accepted'],0)
 def test_owner_hold_reports_cancelled_not_pending(self):
  self.manifest['owner_send_hold']=True;self.s['jobs'][0]['status']='cancelled'
  r=self.report();self.assertTrue(r['owner_send_hold']);self.assertEqual(r['cancelled_contacts_as_of_check'],1);self.assertEqual(r['cohort']['currently_pending'],0)
 def test_shared_number_excluded(self):
  self.s['contacts'].append({**self.s['contacts'][0],'id':'b'})
  self.s['jobs'].append({**self.s['jobs'][0],'id':'j2','contact_id':'b'})
  r=self.report();self.assertEqual(r['cohort']['registered_contacts'],0);self.assertEqual(r['identity_conflicts_excluded'],2)
if __name__=='__main__':unittest.main()
