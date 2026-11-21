import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from datetime import datetime, timezone
from scripts.market_map import pilot_review_workqueue as q

class WorkqueueTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.path=self.root/'queue.sqlite3';self.db=q.connect(self.path)
  self.now=datetime(2026,10,28,tzinfo=timezone.utc).timestamp()
 def tearDown(self):self.db.close();self.tmp.cleanup()
 def seed(self,ids):
  for oid in ids:
   stamp=datetime.fromtimestamp(self.now,timezone.utc).isoformat()
   snap={'candidate':{'organisation_id':oid,'organisation_name':'Company','email':oid+'@company.ca','domain':'company.ca'},'source':{'organisation_id':oid,'checked_at':stamp,'target_email_observed':True,'restriction_signals':[],'pages':[{'final_url':'https://company.ca/contact','http_status':200,'sha256':'a'*64,'target_email_observed':True,'page_identity_excerpt':'Company London Ontario','target_context':'General business office'}]},'validation':{'checked_at':stamp,'validation':{'IsValid':{'ConfidenceVerdict':'HIGH'},'Evaluations':{k:{'ConfidenceVerdict':'HIGH'} for k in ['MailboxExists','HasValidSyntax','HasValidDnsRecords']}}},'technical':{'technical_screen_status':'advance_to_identity_and_eligibility_review'}}
   self.db.execute('INSERT INTO items VALUES(?,?,?,?,?,?,NULL,NULL,?)',(oid,oid+'@company.ca','pending_review','review required',json.dumps(snap),q.digest(snap),self.now))
  self.db.commit()
 def decision(self,row,kind='accept'):
  return {'organisation_id':row['organisation_id'],'snapshot_hash':row['snapshot_hash'],'decision':kind,'reason':'Wrong contact role on source page','page_indexes':[0],'evidence_quotes':['Company','London Ontario'],'finding':'Official contact page names Company and shows London Ontario with a general business contact role.','proposed_contextual_paragraph':'If your team needs furniture moved, we would like to help.','sender_region':'london','reviewed_city':'London','reviewed_sector':'business_premises'}
 def test_concurrent_claims_are_disjoint(self):
  self.seed([str(i) for i in range(20)])
  def run(owner):
   db=q.connect(self.path)
   try:return q.claim(db,owner,10,now=self.now)
   finally:db.close()
  with ThreadPoolExecutor(max_workers=2) as pool:a,b=list(pool.map(run,['a','b']))
  self.assertEqual(len(a['records']),10);self.assertEqual(len(b['records']),10)
  self.assertFalse({r['organisation_id'] for r in a['records']} & {r['organisation_id'] for r in b['records']})
 def test_expired_claim_cannot_submit_after_reassignment(self):
  self.seed(['one']);a=q.claim(self.db,'a',1,60,self.now);b=q.claim(self.db,'b',1,60,self.now+61)
  self.assertEqual(len(b['records']),1)
  with self.assertRaises(ValueError):q.submit(self.db,a['claim_id'],'a',[self.decision(a['records'][0])],self.now+62)
 def test_no_presence_only_approval(self):
  self.seed(['one']);a=q.claim(self.db,'a',1,now=self.now)
  with self.assertRaises(ValueError):q.submit(self.db,a['claim_id'],'a',[{'organisation_id':'one','snapshot_hash':a['records'][0]['snapshot_hash']}],self.now)
  self.assertEqual(q.status(self.db),{'claimed':1})
 def test_hold_persists_without_ready_batch(self):
  self.seed(['one']);a=q.claim(self.db,'a',1,now=self.now)
  q.submit(self.db,a['claim_id'],'a',[self.decision(a['records'][0],'hold')],self.now)
  self.assertEqual(q.publish_pending(self.db,self.root),[]);self.assertEqual(q.status(self.db),{'held':1})
 def test_publication_recovers_and_is_immutable(self):
  self.seed(['one']);a=q.claim(self.db,'a',1,now=self.now)
  q.submit(self.db,a['claim_id'],'a',[self.decision(a['records'][0])],self.now)
  self.assertFalse(list(self.root.glob('*.ready')))
  files=q.publish_pending(self.db,self.root);self.assertEqual(len(files),1)
  marker=json.loads(Path(files[0]+'.ready').read_text());self.assertEqual(marker['count'],1)
  self.assertEqual(q.publish_pending(self.db,self.root),[])
  with self.assertRaises(ValueError):q.immutable(Path(files[0]),'changed')
 def test_wrong_snapshot_rejected(self):
  self.seed(['one']);a=q.claim(self.db,'a',1,now=self.now);d=self.decision(a['records'][0]);d['snapshot_hash']='wrong'
  with self.assertRaises(ValueError):q.submit(self.db,a['claim_id'],'a',[d],self.now)
 def test_source_expiring_before_claim_is_not_assigned(self):
  self.seed(['one']);a=q.claim(self.db,'a',1,now=self.now+86401)
  self.assertEqual(a['records'],[]);self.assertEqual(q.status(self.db),{'needs_refresh':1})
 def test_invalid_second_decision_rolls_back_whole_submission(self):
  self.seed(['one','two']);a=q.claim(self.db,'a',2,now=self.now)
  ds=[self.decision(r) for r in a['records']];ds[1]['evidence_quotes']=['invented quote','London Ontario']
  with self.assertRaises(ValueError):q.submit(self.db,a['claim_id'],'a',ds,self.now)
  self.assertEqual(q.status(self.db),{'claimed':2})
  self.assertEqual(self.db.execute('SELECT count(*) FROM publications').fetchone()[0],0)
 def test_new_external_review_blocks_submission(self):
  self.seed(['one']);a=q.claim(self.db,'a',1,now=self.now)
  (self.root/'existing-source.jsonl').write_text(json.dumps({'organisation_id':'one'})+'\n')
  with self.assertRaises(ValueError):q.submit(self.db,a['claim_id'],'a',[self.decision(a['records'][0])],self.now,root=self.root)

if __name__=='__main__':unittest.main()
