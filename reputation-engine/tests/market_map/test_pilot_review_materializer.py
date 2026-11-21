import copy
import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path

spec=importlib.util.spec_from_file_location('materializer',Path(__file__).resolve().parents[2]/'scripts/market_map/materialize_pilot_review_decisions.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class ReviewMaterializerTests(unittest.TestCase):
 def setUp(self):
  self.now=datetime(2026,10,28,tzinfo=timezone.utc)
  self.c={'organisation_id':'one','organisation_name':'Company','email':'company@gmail.com','domain':'company.ca'}
  self.s={'organisation_id':'one','checked_at':self.now.isoformat(),'target_email_observed':True,'restriction_signals':[],'pages':[{'final_url':'https://company.ca/contact','http_status':200,'sha256':'a'*64,'target_email_observed':True,'page_identity_excerpt':'Company Contact London Ontario company@gmail.com','target_context':'Contact our office'}]}
  self.v={'checked_at':self.now.isoformat(),'validation':{'IsValid':{'ConfidenceVerdict':'HIGH'},'Evaluations':{'MailboxExists':{'ConfidenceVerdict':'MEDIUM'}}}}
  self.t={'technical_screen_status':'advance_to_identity_and_eligibility_review'}
  self.d={'organisation_id':'one','page_indexes':[0],'evidence_quotes':['Company','London Ontario'],'finding':'Official general business contact page lists Company with the selected address and London location.','proposed_contextual_paragraph':'If your team needs furniture moved, we would like to help.','sender_region':'london','reviewed_city':'London','reviewed_sector':'business_premises'}
 def run_review(self):return m.build_review(self.d,self.c,self.s,self.v,self.t,self.now)
 def test_business_webmail_is_preserved(self):
  self.assertEqual(self.run_review()['email'],'company@gmail.com')
 def test_evidence_quote_must_exist(self):
  self.d['evidence_quotes'].append('made up');self.assertRaises(ValueError,self.run_review)
 def test_saved_target_context_array_can_support_quote(self):
  self.s['pages'][0]['target_contexts']=['Serving a verified local branch']
  self.d['evidence_quotes'].append('verified local branch');self.run_review()
 def test_unselected_page_context_cannot_support_quote(self):
  self.s['pages'].append(dict(self.s['pages'][0],target_contexts=['Unselected location']))
  self.d['evidence_quotes'].append('Unselected location');self.assertRaises(ValueError,self.run_review)
 def test_restrictions_are_not_overridden(self):
  self.s['restriction_signals']=['no solicitation'];self.assertRaises(ValueError,self.run_review)
 def test_low_mailbox_is_not_overridden_by_high_overall(self):
  self.v['validation']['Evaluations']['MailboxExists']['ConfidenceVerdict']='LOW';self.assertRaises(ValueError,self.run_review)
 def test_stale_evidence_requires_refresh(self):
  self.s['checked_at']='2026-10-25T00:00:00Z';self.assertRaises(ValueError,self.run_review)
 def test_third_party_source_cannot_impersonate_official(self):
  self.s['pages'][0]['final_url']='https://unrelated.ca';self.assertRaises(ValueError,self.run_review)

 def test_ottawa_preserves_regional_market_and_verified_phone(self):
  self.c['catchment']='Ottawa and surrounding areas';self.d['sender_region']='ottawa';self.d['reviewed_city']='Kanata'
  r=self.run_review();self.assertEqual(r['market'],'ottawa');self.assertEqual(r['regional_phone'],'548-290-8695')
 def test_ottawa_cannot_be_routed_as_saturn(self):
  self.d['reviewed_city']='Ottawa';self.d['sender_region']='gta';self.assertRaises(ValueError,self.run_review)
 def test_saturn_city_cannot_use_ottawa_identity(self):
  self.d['sender_region']='ottawa';self.assertRaises(ValueError,self.run_review)

if __name__=='__main__':unittest.main()
