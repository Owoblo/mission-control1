import unittest
from scripts.market_map.cloud.regional_dns_diagnostic import candidates,diagnose
class DnsDiagnosticTests(unittest.TestCase):
 def receipt(self):return {'host':'example.test','pages':[],'records':[{'source_record_id':'a'}],'errors':[{'url':'https://www.example.test/contact','error':'DNS lookup failed: www.example.test'}]}
 def test_scope_is_bounded_and_only_failed_seed_hosts(self):
  r=self.receipt();self.assertEqual(len(candidates([r,r],1)),1)
  r['errors'][0]['error']='DNS lookup failed: elsewhere.test';self.assertEqual(candidates([r]),[])
 def test_same_apex_variant_is_evidence_not_verification(self):
  row=candidates([self.receipt()])[0];r=diagnose(row,lambda h:{'state':'public_dns' if h=='example.test' else 'dns_error'})
  self.assertEqual(r['state'],'www_variant_resolves_needs_source_review');self.assertFalse(r['website_identity_verified']);self.assertEqual(r['http_requests'],0)
 def test_non_public_and_timeout_never_recommend_fetch(self):
  row=candidates([self.receipt()])[0]
  for state in ['non_public_or_empty','resolver_timeout','dns_error']:
   self.assertEqual(diagnose(row,lambda h:{'state':state})['state'],'still_unresolved_or_non_public')
if __name__=='__main__':unittest.main()
