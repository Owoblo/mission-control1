import unittest
from scripts.market_map.durham_saved_emails import extract_row
class SavedLicensedEmailsTests(unittest.TestCase):
 def test_explicit_no_public_flag_excludes_contact(self):
  self.assertEqual(extract_row({'ShowOnPublic':False,'Web_Address':'private@fixture.test'}),[])
 def test_website_query_tracking_is_not_a_company_email_and_literal_field_is(self):
  self.assertEqual(extract_row({'ShowOnPublic':None,'Web_Address':'https://fixture.test/?email=person@unrelated.test'}),[])
  self.assertEqual(extract_row({'ShowOnPublic':None,'Web_Address':'business@fixture.test'}),[('business@fixture.test','Web_Address')])
 def test_literal_business_contact_in_source_description_not_guessed(self):
  self.assertEqual(extract_row({'ShowOnPublic':True,'Business_Description':'Fixture clinic contact clinic@fixture.test'}),[('clinic@fixture.test','Business_Description')])
if __name__=='__main__':unittest.main()
