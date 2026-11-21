import unittest
from scripts.market_map.apbot_public_emails import extract_members,verify_public_display_contract
from scripts.market_map.transport import SourceBlocked
class CompanyEmailTests(unittest.TestCase):
 def test_only_approved_company_ids_no_contact_names_and_hidden_email_honoured(self):
  data={'members':[{'id':'fixture-company','name':'Fixture Organisation','email':'business@fixture.test','contactName':'UNRELATED PERSON','hideAddressFromDirectory':True},{'id':'fixture-hidden','name':'Hidden Fixture','email':'hidden@fixture.test','hideEmailFromDirectory':True},{'id':'fixture-individual','name':'EXCLUDED PERSON','email':'person@fixture.test'}]}
  rows,holds=extract_members(data,{'fixture-company','fixture-hidden'});self.assertEqual(len(rows),1);self.assertEqual(rows[0]['email'],'business@fixture.test');self.assertNotIn('UNRELATED PERSON',str(rows));self.assertNotIn('EXCLUDED PERSON',str(rows));self.assertEqual(holds[0]['source_record_id'],'fixture-hidden')
 def test_shared_mailbox_keeps_two_business_source_associations(self):
  rows,_=extract_members({'members':[{'id':'one','name':'Fixture branch one','email':'office@fixture.test'},{'id':'two','name':'Fixture branch two','email':'office@fixture.test'}]},{'one','two'});self.assertEqual(len(rows),2);self.assertEqual(len({r['email'] for r in rows}),1)
 def test_private_unproven_client_and_missing_company_inventory_block(self):
  with self.assertRaises(SourceBlocked):verify_public_display_contract('data.email exists but no public renderer')
  with self.assertRaises(SourceBlocked):extract_members({'members':[]},{'fixture-company'})
 def test_nonbusiness_role_and_placeholders_not_guessed_into_contacts(self):
  rows,holds=extract_members({'members':[{'id':'fixture','name':'Fixture','email':'privacy.officer@fixture.test, test@example.com'}]},{'fixture'});self.assertEqual(rows,[]);self.assertEqual(len(holds),1)
if __name__=='__main__':unittest.main()
