import sys,unittest
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/discovery_v2'))
from contacts import assess
class ContactTests(unittest.TestCase):
 def setUp(self):
  self.now=datetime(2026,9,15,tzinfo=timezone.utc)
  self.route={'route_id':'test','email':'info@example.org','checked_at':self.now.isoformat(),'organization_site_supported':True,'role_supported':False,'route_type':'team_inbox'}
  self.validation={'email':'info@example.org','checked_at':self.now.isoformat(),'provider':'aws_ses','overall':'HIGH','mailbox':'MEDIUM','raw':{'Evaluations':{k:{'ConfidenceVerdict':'HIGH'} for k in ['HasValidSyntax','HasValidDnsRecords']}}}
 def check(self,**kw):return assess(kw.pop('route',self.route),kw.pop('validation',self.validation),kw.pop('crm',[]),now=self.now,**kw)
 def test_basic_pass_does_not_claim_mailbox_or_send(self):
  r=self.check();self.assertEqual(r['minimum_status'],'basic_candidate');self.assertEqual(r['mailbox_status'],'uncertain');self.assertFalse(r['auto_send']);self.assertNotEqual(r['status'],'verified_eligible')
 def test_suppression_and_bounce_override_technical_pass(self):
  self.assertEqual(self.check(crm=[{'id':'x','do_not_contact':True}])['minimum_status'],'held')
  self.assertEqual(self.check(outcomes=[{'bounced':True}])['minimum_status'],'held')
 def test_existing_thread_and_missing_crm_require_review(self):
  self.assertEqual(self.check(crm=None)['minimum_status'],'needs_review')
  self.assertEqual(self.check(crm=[{'id':'x','last_touch_at':'today'}])['minimum_status'],'needs_review')
 def test_stale_mismatched_and_missing_dns_cannot_pass(self):
  for v in [{**self.validation,'checked_at':'2020-01-01T00:00:00Z'},{**self.validation,'email':'other@example.org'},{**self.validation,'raw':{}}]:
   self.assertNotEqual(self.check(validation=v)['minimum_status'],'basic_candidate')
 def test_named_role_must_have_evidence(self):
  self.assertEqual(self.check(route={**self.route,'route_type':'named_person'})['minimum_status'],'needs_review')
 def test_risk_and_invalid_dns_block(self):
  for field,verdict in [('IsDisposable','HIGH'),('HasValidDnsRecords','LOW')]:
   self.validation['raw']['Evaluations'][field]={'ConfidenceVerdict':verdict}
   self.assertEqual(self.check()['minimum_status'],'held')
 def test_dns_fallback_never_proves_mailbox(self):
  dns={'domain':'example.org','checked_at':self.now.isoformat(),'state':'mx_present'}
  r=self.check(validation=None,dns=dns)
  self.assertEqual(r['minimum_status'],'basic_candidate');self.assertEqual(r['mailbox_status'],'unchecked')
  for state in ['null_mx','domain_not_found','unknown','no_mx']:
   self.assertNotEqual(self.check(validation=None,dns={**dns,'state':state})['minimum_status'],'basic_candidate')
  self.assertNotEqual(self.check(validation=None,dns={**dns,'domain':'another.org'})['minimum_status'],'basic_candidate')
 def test_dns_cannot_override_failed_provider(self):
  self.validation['mailbox']='LOW'
  self.assertEqual(self.check(dns={'domain':'example.org','checked_at':self.now.isoformat(),'state':'mx_present'})['minimum_status'],'held')
 def test_legacy_crm_suppression_fields(self):
  for fields in [{'stage':'closed_lost'},{'decision':'opted_out'},{'email_status':'complained'}]:
   self.assertEqual(self.check(crm=[{'id':'x',**fields}])['minimum_status'],'held')
if __name__=='__main__':unittest.main()
