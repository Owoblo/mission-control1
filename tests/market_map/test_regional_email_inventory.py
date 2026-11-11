import unittest
from scripts.market_map.cloud.regional_email_inventory import inventory,pilot_candidates
class InventoryTests(unittest.TestCase):
 def receipt(self,name,email,phone='5195550123'):
  return {'records':[{'organization':name,'source_record_id':name,'municipality':'Windsor','phone_base':phone}],'pages':[{'url':'https://example.ca/team','emails':[{'email':email}]}]}
 def test_same_email_deduplicated_across_pages(self):
  rows=inventory([self.receipt('Firm',' INFO@example.ca '),self.receipt('Firm','info@example.ca')]);self.assertEqual(len(rows),2);self.assertFalse(rows[0]['send_ready']);self.assertEqual(rows[0]['validation_priority'],'association_review_first')
 def test_shared_mailbox_requires_identity_review(self):
  r=inventory([self.receipt('A','info@example.ca'),self.receipt('B','info@example.ca')])[0];self.assertIn('shared_email_organization_review',r['holds']);self.assertEqual(r['validation_priority'],'association_review_first')
 def test_other_domain_is_not_rejected_or_assumed_owned(self):
  r=inventory([self.receipt('Firm','person@gmail.com')])[0];self.assertIn('different_email_domain_review',r['holds']);self.assertEqual(r['phone_link_status'],'possible_account_routes_not_resolved_person_aliases')
 def test_national_staff_list_needs_role_and_branch_evidence(self):
  rows=inventory([self.receipt('Firm',e) for e in ['alice@example.ca','bob@example.ca','australiapressoffice@example.ca']])
  self.assertTrue(all(r['validation_priority']=='association_review_first' for r in rows))
  self.assertEqual(pilot_candidates(rows),[])
 def test_validation_selection_prefers_general_route_and_diversifies(self):
  rows=[{'email':e,'website_hosts':[h],'validation_priority':'first_party_single_organization','occurrence_supported_candidate':True} for e,h in [('alice@one.ca','one.ca'),('info@one.ca','one.ca'),('info@two.ca','two.ca')]]
  self.assertEqual([r['email'] for r in pilot_candidates(rows)],['info@one.ca','info@two.ca'])
 def test_url_prefix_is_preserved_but_held_from_validation(self):
  rows=inventory([self.receipt('Firm','//info@example.ca'),self.receipt('Firm','info@example.ca')])
  held=next(r for r in rows if r['email'].startswith('//'))
  self.assertIn('email_extraction_requires_review',held['holds'])
  self.assertEqual(held['validation_priority'],'association_review_first')
  self.assertEqual(pilot_candidates(rows),[])
 def test_stale_priority_cannot_admit_prefix_artifact(self):
  self.assertEqual(pilot_candidates([{'email':'//info@example.ca','website_hosts':['example.ca'],'validation_priority':'first_party_single_organization'}]),[])
 def test_legitimate_internal_slash_is_not_globally_removed(self):
  rows=inventory([self.receipt('Firm','sales/support@example.ca')])
  self.assertEqual(rows[0]['email'],'sales/support@example.ca')
  self.assertNotIn('email_extraction_requires_review',rows[0]['holds'])
if __name__=='__main__':unittest.main()
