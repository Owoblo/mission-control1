import hashlib,unittest
from scripts.market_map.contact_attribution import assess_scoped_person_route
from contacts import extract
class ScopedAttributionTests(unittest.TestCase):
 def card(self,name='Jane Smith',title='Facilities Manager',email='jane@business.test'):
  return f'<div class="staff"><h2>{name}</h2><p>{title}</p><a href="mailto:{email}">Email</a></div>'
 def check(self,body,candidates=None):
  return assess_scoped_person_route('jane@business.test',candidates or [{'recipient_name':'Jane Smith','recipient_role':'Facilities Manager'}],body,'https://business.test/team',hashlib.sha256(body.encode()).hexdigest())
 def test_exact_card_and_hash_locators(self):
  body='<script>removed</script>'+self.card();r=self.check(body)
  self.assertTrue(r['role_supported']);e=r['scoped_matches'][0]['evidence'];self.assertEqual(e['page_content_sha256'],hashlib.sha256(body.encode()).hexdigest())
  self.assertTrue(e['email_occurrences']);self.assertEqual(e['source_dom_locator'],'/html/body/div')
 def test_swapped_roles_duplicate_people_and_shared_inbox_abstain(self):
  for body in [self.card(title='Sales Manager')+self.card('Bob Jones'),self.card()+self.card(),self.card(email='info@business.test'),self.card(title='Former Facilities Manager')]:self.assertFalse(self.check(body)['role_supported'])
 def test_legacy_text_and_multiple_named_candidates_remain_reviewable(self):
  reviews=[{'id':'a','name':'Office','city':'Windsor','pages':[{'url':'https://business.test','text':'Office Windsor Jane Smith Facilities Manager jane@business.test','emails':['jane@business.test']}]}]
  named=[{'to':'jane@business.test','recipient_name':'Jane Smith','recipient_role':'Facilities Manager'}]
  routes,_=extract(reviews,named);self.assertFalse(routes[0]['role_supported'])
  routes,_=extract(reviews,named+[dict(named[0],recipient_name='Janet Smith')]);self.assertEqual(len(routes[0]['person_candidates']),2);self.assertFalse(routes[0]['role_supported'])
 def test_hash_mismatch_rejected(self):
  with self.assertRaises(ValueError):assess_scoped_person_route('jane@business.test',[],self.card(),'https://business.test','bad')
