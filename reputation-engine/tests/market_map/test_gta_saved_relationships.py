import unittest
from scripts.market_map.gta_saved_relationships import extract_mcahn
from scripts.market_map.transport import SourceBlocked
class SavedPartnershipTests(unittest.TestCase):
 def test_explicit_statement_and_same_context_organisation_link_required(self):
  body=b'<section><h2>MCAHN is proud to partner with The Fixture Trade Association</h2><a href="https://fixture.test/">Visit Fixture Trade Association</a></section>'
  claims=extract_mcahn(body);self.assertEqual(len(claims),1);self.assertEqual(claims[0]['predicate'],'listed_partner_of');self.assertEqual(claims[0]['object_website'],'https://fixture.test/');self.assertEqual(claims[0]['status'],'source_reported_unverified')
 def test_name_and_applications_are_not_existing_partnership_evidence(self):
  self.assertEqual(extract_mcahn(b'<h3>Fixture Partners Inc.</h3><h3>Sponsorship Applications Are Open</h3>'),[])
  with self.assertRaises(SourceBlocked):extract_mcahn(b'<section><h2>MCAHN is proud to partner with Fixture Association</h2><a href="https://unrelated.test/">Different organisation</a></section>')
if __name__=='__main__':unittest.main()
