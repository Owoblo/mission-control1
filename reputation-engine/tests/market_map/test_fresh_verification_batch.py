import unittest
from scripts.market_map.prepare_fresh_verification_batch import select
from scripts.market_map.prepare_fresh_review_supply import sha
class BatchSelectionTests(unittest.TestCase):
 def fixture(self):
  c=dict(organisation_id='one',email='info@example.ca',city='Guelph',organisation_name='Example',catchment='Waterloo');s={'pages':[]};t=dict(stage='awaiting_mailbox_and_individual_review',blockers=[],candidate_sha256=sha(c),source_sha256=sha(s));return c,s,t
 def test_tampered_candidate_rejected(self):
  c,s,t=self.fixture();c['email']='other@example.ca'
  with self.assertRaises(ValueError):select([c],{'one':s},{'one':t})
 def test_restriction_hold_never_selected(self):
  c,s,t=self.fixture();t['blockers']=['publication_restriction_review'];self.assertEqual(select([c],{'one':s},{'one':t}),[])
 def test_ottawa_excluded(self):
  c,s,t=self.fixture();c['catchment']='Ottawa';t['candidate_sha256']=sha(c);self.assertEqual(select([c],{'one':s},{'one':t}),[])
 def test_prior_id_and_shared_email_excluded(self):
  c,s,t=self.fixture();self.assertEqual(select([c],{'one':s},{'one':t},excluded_ids={'one'}),[]);self.assertEqual(select([c],{'one':s},{'one':t},excluded_emails={'INFO@EXAMPLE.CA'}),[])
 def test_unbounded_request_rejected(self):
  with self.assertRaises(ValueError):select([],{}, {},101)
if __name__=='__main__':unittest.main()
