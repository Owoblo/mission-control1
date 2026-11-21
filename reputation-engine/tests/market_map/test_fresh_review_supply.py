import unittest
from datetime import datetime,timezone
from scripts.market_map.prepare_fresh_review_supply import prepare
class FreshSupplyTests(unittest.TestCase):
 def setUp(self):
  self.now=datetime.now(timezone.utc);self.c=dict(organisation_id='new',email='info@example.ca',domain='example.ca',city='Guelph',catchment='waterloo')
  self.s=dict(organisation_id='new',email='info@example.ca',checked_at=self.now.isoformat(),pages=[dict(http_status=200,sha256='abc',target_email_observed=True,final_url='https://example.ca/contact')])
  self.original=dict(ids=set(),emails=set(),domains=set())
 def runrow(self,**kw):return prepare(kw.get('c',self.c),kw.get('s',self.s),kw.get('original',self.original),kw.get('seen',set()),kw.get('history',set()),{'waterloo'},self.now)
 def test_publication_never_clearance(self):
  r=self.runrow();self.assertEqual(r['stage'],'awaiting_mailbox_and_individual_review');self.assertFalse(r['campaign_ready']);self.assertFalse(r['history_clearance']);self.assertIn('mailbox_validation',r['required_tasks'])
 def test_shared_inbox_not_branch_bypass(self):self.assertIn('duplicate_shared_inbox',self.runrow(seen={'info@example.ca'})['blockers'])
 def test_prior_domain_preserved_for_branch_review(self):self.assertIn('existing_domain_branch_or_parent_review',self.runrow(original=dict(ids=set(),emails=set(),domains={'example.ca'}))['blockers'])
 def test_history_matches_other_inbox(self):self.assertIn('historical_mailbox_correspondence_review',self.runrow(history={'owner@example.ca'})['blockers'])
 def test_wrong_source_cannot_advance(self):
  r=self.runrow(s={**self.s,'email':'other@example.ca'});self.assertFalse(r['source_binding_observed']);self.assertEqual(r['stage'],'held_for_research')
 def test_unsupported_area(self):self.assertIn('service_area_mapping_review',self.runrow(c={**self.c,'catchment':'unknown'})['blockers'])
 def test_restriction_preserved(self):self.assertIn('publication_restriction_review',self.runrow(s={**self.s,'restriction_signals':['no solicitation']})['blockers'])
if __name__=='__main__':unittest.main()
