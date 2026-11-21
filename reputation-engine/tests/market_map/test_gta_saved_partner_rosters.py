import unittest
from scripts.market_map.gta_saved_partner_rosters import claims_from_rows
from scripts.market_map.transport import SourceBlocked
class PartnerRosterTests(unittest.TestCase):
 def row(self):return {'source_id':'brock-board-public-community-partners','record_type':'community_partner_listing','name':'Fixture Association','website':None,'relationships':[{'relationship_type':'listed_as_community_partner','object_name':'Brock Board of Trade'}],'source_record_id':'https://fixture.test/community-partners/fixture','source_url':'https://fixture.test/community-partners/fixture','observed_at':'fixture','rights_status':'limited_factual_review_only'}
 def test_missing_target_website_remains_unknown_and_claim_not_financial_sponsor(self):
  claim=claims_from_rows([self.row()])[0];self.assertIsNone(claim['object_website']);self.assertEqual(claim['predicate'],'listed_partner_of');self.assertEqual(claim['status'],'source_reported_unverified');self.assertTrue(claim['financial_sponsorship_contract_value_current_term_not_inferred'])
 def test_generic_member_listing_is_not_reclassified_as_partner(self):
  row=self.row();row['relationships']=[{'relationship_type':'member_of','object_name':'Brock Board of Trade'}]
  with self.assertRaises(SourceBlocked):claims_from_rows([row])
if __name__=='__main__':unittest.main()
