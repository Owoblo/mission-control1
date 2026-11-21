import importlib.util,unittest
spec=importlib.util.spec_from_file_location('qualifier','scripts/qualify-pilot-source-backlog-20261027.py');q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)
class QualificationTests(unittest.TestCase):
 def setUp(self):
  self.c=dict(organisation_name='Example Furniture Ltd',email='info@example.ca',domain='example.ca',city='Kitchener',catchment='waterloo')
  self.page=dict(final_url='https://example.ca/contact',target_email_observed=True,page_identity_excerpt='Example Furniture Contact Us',target_context='Example Furniture 12 Main St Kitchener ON N2G 1A1 info@example.ca')
  self.s=dict(target_email_observed=True,restriction_signals=[],pages=[self.page])
 def test_clear_bound_general_contact(self):self.assertIsNotNone(q.qualify(self.c,self.s))
 def test_wrong_locality(self):self.c['city']='London';self.assertIsNone(q.qualify(self.c,self.s))
 def test_parent_mailbox(self):self.c['email']='info@parent.ca';self.assertIsNone(q.qualify(self.c,self.s))
 def test_employment_role(self):self.c['email']='careers@example.ca';self.assertIsNone(q.qualify(self.c,self.s))
 def test_third_party_page(self):self.page['final_url']='https://directory.ca/example';self.assertIsNone(q.qualify(self.c,self.s))
 def test_parent_operator(self):self.page['target_context']+=' Operated by Parent Group';self.assertIsNone(q.qualify(self.c,self.s))
 def test_restriction(self):self.s['restriction_signals']=['no unsolicited'];self.assertIsNone(q.qualify(self.c,self.s))
 def test_same_city_is_not_business_identity(self):self.c['organisation_name']='Another Company';self.assertIsNone(q.qualify(self.c,self.s))
if __name__=='__main__':unittest.main()
