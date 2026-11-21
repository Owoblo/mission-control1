import unittest,tempfile,json,gzip,hashlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from scripts.market_map.port_credit_profiles import parse_profile,collect
from scripts.market_map.transport import SourceBlocked
class ProfileTests(unittest.TestCase):
 def test_labelled_business_email_and_website_not_footer_or_contact_person(self):
  body=b'<h2 id="heading-business-directory">Fixture Business</h2><dl><dt><span id="Address">Address:</span></dt><dd>10 Fiction Rd Mississauga ON L5G 1G5 Canada</dd><dt><span id="Email">Email:</span></dt><dd><a href="mailto:store@fixture.test">Email</a></dd><dt><span id="Website">Website:</span></dt><dd><a href="https://fixture.test">Site</a></dd><dt><span id="ContactPerson">Owner</span></dt><dd>UNRELATED PERSON</dd></dl><footer>webmaster@developer.test</footer>'
  row=parse_profile(body,'https://fixture.test/profile','Old source name','fixture');self.assertEqual(row['published_emails'],['store@fixture.test']);self.assertEqual(row['website'],'https://fixture.test');self.assertNotIn('UNRELATED PERSON',str(row));self.assertTrue(row['raw_payload']['profile_name_differs_from_index']);self.assertFalse(row['campaign_ready']);self.assertEqual(row['mailbox_status'],'not_checked')
 def test_hidden_contact_and_error_page_are_not_email_or_complete_business(self):
  row=parse_profile(b'<h2 id="heading-business-directory">Fixture</h2><dl><dt><span id="Email">Email</span></dt><dd data-hidden-contact="true"><a href="mailto:hidden@fixture.test">Email</a></dd></dl>','https://fixture.test','Fixture','fixture');self.assertEqual(row['published_emails'],[])
  with self.assertRaises(SourceBlocked):parse_profile(b'<html>Missing record</html>','https://fixture.test','Fixture','fixture')
class ProfileResumeTests(unittest.TestCase):
 def test_transient_partial_resume_preserves_old_snapshot_and_only_charges_new_attempt(self):
  urls=['https://nearme.portcredit.com/Home/View/fixture-one','https://nearme.portcredit.com/Home/View/fixture-two']
  class FakeTransport:
   def __init__(self,fail=False):self.requests=0;self.fail=fail
   def _stamp(self):return 'fixture-observed'
   def metrics(self):return {'requests':self.requests,'bytes_fetched':0,'elapsed_seconds':0}
   def fetch(self,url):
    self.requests+=1
    if self.fail and url==urls[1]:raise SourceBlocked('Network retrieval failed: timeout')
    return SimpleNamespace(body=b'<h2 id="heading-business-directory">Fixture business</h2>')
  with tempfile.TemporaryDirectory() as tmp,patch('scripts.market_map.port_credit_profiles.shutil.disk_usage',return_value=SimpleNamespace(free=4*1024**3)):
   root=Path(tmp);index=root/'index';index.mkdir();path=index/'published-business-facts.jsonl.gz'
   path.write_bytes(gzip.compress(''.join(json.dumps({'source_record_id':u,'name':'Fixture business'})+'\n' for u in urls).encode()))
   (index/'manifest.json').write_text(json.dumps({'files':{path.name:hashlib.sha256(path.read_bytes()).hexdigest()}}))
   out=root/'output';first=collect(index,root/'empty-inspection',out,transport=FakeTransport(True));self.assertEqual(first['status'],'partial');self.assertEqual(first['raw_factual_profile_rows'],1)
   second_transport=FakeTransport();second=collect(index,root/'empty-inspection',out,transport=second_transport,resume_partial=True);self.assertEqual(second['status'],'completed');self.assertEqual(second['raw_factual_profile_rows'],2);self.assertEqual(second_transport.requests,1);self.assertEqual(second['metrics']['requests'],3)
   archives=list(out.glob('archived-partial-*/manifest.json'));self.assertEqual(len(archives),1);old=json.loads(archives[0].read_text());self.assertEqual(old['raw_factual_profile_rows'],1)
   for name,digest in old['files'].items():self.assertEqual(hashlib.sha256((archives[0].parent/name).read_bytes()).hexdigest(),digest)
   replay=FakeTransport();self.assertEqual(collect(index,root/'empty-inspection',out,transport=replay),second);self.assertEqual(replay.requests,0)

if __name__=='__main__':unittest.main()
