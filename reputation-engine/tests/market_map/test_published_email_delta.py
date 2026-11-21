import unittest,tempfile,json,hashlib
from pathlib import Path
from scripts.market_map.published_email_delta import delta_rows,build
from scripts.market_map.transport import SourceBlocked
class EmailDeltaTests(unittest.TestCase):
 def test_reused_email_association_is_not_new_but_shared_mailbox_branches_remain_separate(self):
  old={'email':'business@fixture.test','source_id':'fixture-source','source_record_id':'branch-one'}
  other=dict(old,source_record_id='branch-two');another=dict(old,source_id='fixture-other-publisher')
  self.assertEqual(delta_rows([old,other,other,another],[old]),[other,another])
class DeltaReplayTests(unittest.TestCase):
 def test_prior_cohort_change_blocks_stale_union_even_when_delta_bytes_unchanged(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);prior=root/'prior.json';prior.write_text('{}');output=root/'delta';output.mkdir();data=output/'output.json';data.write_text('[]')
   digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
   manifest={'files':{'output.json':digest(data)},'source_artifacts':[],'source_fact_inputs':[],'prior_manifest':str(prior),'prior_manifest_sha256':digest(prior)};(output/'manifest.json').write_text(json.dumps(manifest))
   self.assertEqual(build(root,output),manifest);prior.write_text('changed')
   with self.assertRaises(SourceBlocked):build(root,output)
if __name__=='__main__':unittest.main()
