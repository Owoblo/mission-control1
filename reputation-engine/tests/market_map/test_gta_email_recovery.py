import tempfile,unittest,json,hashlib,gzip
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from lxml import html
from scripts.market_map.gta_email_recovery import public_emails,bindings,build
from scripts.market_map.transport import SourceBlocked

class EmailRecoveryTests(unittest.TestCase):
 def test_only_public_business_mailto_and_visible_fields_not_queries_hidden_or_scripts(self):
  node=html.fromstring(b'<div><a href="mailto:hello@fixture.test?body=other@unrelated.test">Email</a><p>desk@fixture.test</p><div data-hidden-contact="true"><a href="mailto:hidden@fixture.test">Hidden</a></div><script>secret@fixture.test</script><style>dev@fixture.test</style><p>privacy@fixture.test</p><div class="desc">Partner contact unrelated@partner.test</div></div>')
  self.assertEqual(public_emails(node),[('desk@fixture.test','public_business_visible_text'),('hello@fixture.test','public_business_mailto')])
 def test_streetsville_record_boundary_excludes_footer_and_keeps_shared_mailbox_branches(self):
  body=b'<div class="w2dc-index-page"><article id="post-1" class="w2dc-listing"><header class="w2dc-listing-header"><h2><a>Fixture Branch</a></h2></header><a href="mailto:business@fixture.test">Email</a></article><article id="post-2" class="w2dc-listing"><header class="w2dc-listing-header"><h2><a>Fixture Branch</a></h2></header><a href="mailto:business@fixture.test">Email</a></article></div><footer><a href="mailto:developer@agency.test">Site developer</a></footer>'
  rows=bindings(body,'streetsville','https://fixture.test/directory','fixture-sha');self.assertEqual([r[1] for r in rows],['1','2']);self.assertTrue(all(public_emails(r[0])==[('business@fixture.test','public_business_mailto')] for r in rows))
 def test_alder_snapshot_identity_does_not_invent_native_company_id(self):
  body=b'<div class="fusion-text"><h3>Fixture Shop</h3><p><a href="mailto:shop@fixture.test">Contact</a></p></div>'
  row=bindings(body,'aldershot','https://fixture.test/?wvcat=shop','abcd')[0];self.assertEqual(row[1],'snapshot:abcd:shop:1:1');self.assertEqual(row[2],'Fixture Shop')
 def test_actual_build_hashes_counts_and_replay_tamper_guard(self):
  with tempfile.TemporaryDirectory() as tmp,patch('scripts.market_map.gta_email_recovery.shutil.disk_usage',return_value=SimpleNamespace(free=4*1024**3)):
   root=Path(tmp);folder=root/'gta-regional-source-acquisition/west-north-gta-bia-directory-inspection';folder.mkdir(parents=True)
   body=b'<div class="w2dc-index-page"><article class="w2dc-listing" id="post-7"><header class="w2dc-listing-header"><h2><a>Fixture Organisation</a></h2></header><a href="mailto:shop@fixture.test">Email</a></article></div><footer><a href="mailto:webmaster@developer.test">Developer</a></footer>'
   path=folder/'streetsville-offered-business-directory.response';path.write_bytes(body);(folder/'inspection.json').write_text(json.dumps({'receipts':[{'id':'streetsville-offered-business-directory','url':'https://fixture.test/directory','sha256':hashlib.sha256(body).hexdigest(),'observed_at':'2026-10-27T00:00:00Z'}]}))
   out=root/'output';m=build(root,out);self.assertEqual(m['source_associations'],1);self.assertEqual(m['unique_published_email_strings'],1);self.assertEqual(m['original_HTML_artifacts_checked'],1);self.assertEqual(m['metrics']['network_requests'],0)
   rows=list(map(json.loads,gzip.open(out/'source-published-business-email-associations.jsonl.gz','rt')));self.assertEqual(rows[0]['mailbox_status'],'not_checked');self.assertFalse(rows[0]['campaign_ready']);self.assertEqual(build(root,out),m)
   path.write_bytes(body+b'changed')
   with self.assertRaises(SourceBlocked):build(root,out)

if __name__=='__main__':unittest.main()
