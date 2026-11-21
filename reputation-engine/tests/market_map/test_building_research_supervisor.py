"""Exercise real subprocesses and the actual queue without a live Codex request."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock

from scripts.market_map import building_research_supervisor as supervisor
from scripts.market_map import building_research_queue as queue
from scripts.market_map import trusted_source_capture as capture

FAKE = r'''import hashlib,json,os,subprocess,sys,time
from pathlib import Path
root=Path(ROOT_VALUE)
assert '--search' in sys.argv and '--approve-for-me' in sys.argv
assert '--sandbox' not in sys.argv  # --approve-for-me implies workspace-write; CLI rejects both.
assert '--dangerously-bypass-approvals-and-sandbox' not in sys.argv
task=Path(sys.argv[sys.argv.index('--cd')+1])
prompt=sys.stdin.read()
claim=json.loads((task/'claim.json').read_text())
worker=claim['worker'];bid=claim['records'][0]['building_id']
assert "reviewer="+repr(worker) in prompt
mode=(root/'mode').read_text() if (root/'mode').exists() else 'valid'
(task/'started.json').write_text(json.dumps({'at':time.time(),'pid':os.getpid(),'api_keys_present':any(x in os.environ for x in ['OPENAI_API_KEY','CODEX_API_KEY'])}))
if mode=='timeout':
 child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])
 (task/'child.pid').write_text(str(child.pid))
 time.sleep(60)
time.sleep(.2)
raw=task/'source.txt';raw.write_text('Primary test source: public operator at civic address; other occupants unknown.')
events=[dict(building_id=bid,stage=s,outcome='unresolved',reviewer=worker,checked_on='2026-10-29',scope='Bounded fixture source check',finding='Public site address supported; other tenants unknown',remaining_gaps=['Other tenants unknown'],source_url='https://example.org/contact',source_excerpt='public operator at civic address; other occupants unknown.',raw_evidence_reference=str(raw.relative_to(root)),source_sha256=hashlib.sha256(raw.read_bytes()).hexdigest(),outreach_eligible=False) for record in claim['records'] for bid in [record['building_id']] for s in (['address','occupants'] if record.get('research_phase')=='foundation_occupants' else ['address','occupants','contacts'])]
if mode=='invalid':events[0]['source_excerpt']='Invented primary evidence that does not occur in the fetched page.'
if mode=='additional':
 for event in events:event['additional_evidence_references']=[{'source_url':'https://example.org/directory','raw_evidence_reference':str(raw.relative_to(root))}]
if mode=='incomplete':events.pop()
if mode=='partial':
 blocked_id=claim['records'][-1]['building_id']
 events=[e for e in events if e['building_id']!=blocked_id]
 (task/'failure.json').write_text(json.dumps({'blocked':[{'building_id':blocked_id,'reason':'No usable primary source for this candidate'}]}))
(task/'events.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in events))
(task/'ended.json').write_text(json.dumps({'at':time.time()}))
print(json.dumps({'type':'turn.failed' if mode=='failed_turn' else 'turn.completed','usage':{'input_tokens':1234,'output_tokens':56,'cached_input_tokens':100}}),flush=True)
'''

class BuildingResearchSupervisorTests(unittest.TestCase):
 def test_replacement_engine_policy_prevents_legacy_claims(self):
  (self.state/'research-policy.json').write_text(json.dumps({'engine':'site_source_first'}))
  report=supervisor.run(self.args())
  self.assertEqual(report['state'],'replacement_engine_active')
  self.assertFalse((self.state/'worker-runs').exists())
 def test_final_evidence_retry_uses_stronger_model_and_keeps_gates(self):
  db=queue.connect(self.state/'research-queue.sqlite3');queue.seed(db,self.state/'buildings.jsonl')
  db.execute("UPDATE building_items SET attempts=2,reason='blocked: No usable primary source captured for candidate' WHERE building_id='building:0'");db.close()
  args=self.args(workers=1,batch_size=1);args.routed=True;args.research_model='gpt-6-luna';args.fallback_model='gpt-5.4'
  with mock.patch('scripts.market_map.routed_source_research.run',side_effect=self.routed_fixture):
   report=supervisor.run(args)
  self.assertEqual(report['results'][0]['research_model'],'gpt-5.4')
  self.assertTrue(report['results'][0]['fallback_applied'])
  task=next((self.state/'worker-runs').glob('*/worker-1'))
  self.assertTrue((task/'fallback-decision.json').exists())
  db=queue.connect(self.state/'research-queue.sqlite3')
  self.assertEqual(db.execute("SELECT attempts FROM building_items WHERE building_id='building:0'").fetchone()[0],3);db.close()
 def test_fallback_does_not_escalate_fresh_or_infrastructure_failure(self):
  db=queue.connect(self.state/'research-queue.sqlite3');queue.seed(db,self.state/'buildings.jsonl')
  records=[{'building_id':'building:0'}]
  self.assertEqual(supervisor.fallback_context(db,records,'gpt-6-luna','gpt-5.4'),[])
  db.execute("UPDATE building_items SET attempts=3,reason='database or disk is full' WHERE building_id='building:0'")
  self.assertEqual(supervisor.fallback_context(db,records,'gpt-6-luna','gpt-5.4'),[])
  db.execute("UPDATE building_items SET reason='blocked: missing evidence' WHERE building_id='building:0'")
  self.assertEqual(supervisor.fallback_context(db,records,'gpt-6-luna',None),[]);db.close()
 def test_low_disk_holds_before_claim_or_spend(self):
  with mock.patch.object(supervisor.shutil,'disk_usage',return_value=SimpleNamespace(free=100)):
   report=supervisor.run(self.args())
  self.assertEqual(report['state'],'disk_space_hold')
  self.assertFalse((self.state/'daily-starts.json').exists())
  self.assertFalse((self.state/'research-queue.sqlite3').exists())
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.root=Path(self.tmp.name).resolve();self.state=self.root/'state';self.state.mkdir()
  self.codex=self.root/'fake-codex';self.codex.write_text('#!'+sys.executable+'\n'+FAKE.replace('ROOT_VALUE',repr(str(self.root))));self.codex.chmod(0o700)
  self.patch=mock.patch.object(supervisor,'ROOT',self.root);self.patch.start();self.addCleanup(self.patch.stop)
  self.poll=mock.patch.object(supervisor,'POLL_SECONDS',.02);self.poll.start();self.addCleanup(self.poll.stop)
  self.grace=mock.patch.object(supervisor,'STOP_GRACE_SECONDS',.3);self.grace.start();self.addCleanup(self.grace.stop)
  self.network=mock.patch.object(capture,'fetch',side_effect=self.fake_fetch);self.network.start();self.addCleanup(self.network.stop)
  self.seed(6)
 def fake_fetch(self,url,**kwargs):
  body=(b'User-agent: *\nAllow: /\n' if url.endswith('/robots.txt') else b'<html>Primary test source: public operator at civic address; other occupants unknown.</html>')
  return body,dict(requested_url=url,final_url=url,status=200,content_type='text/html',retrieved_at='2026-10-29T18:00:00Z',body_sha256=hashlib.sha256(body).hexdigest(),body_bytes=len(body))
 def seed(self,n):
  rows=[dict(building_id=f'building:{i}',original_zoning_scope=True,investigation_status='not_individually_reviewed',candidate_addresses=[f'{i} Example St'],review_events=[],review_stages={}) for i in range(n)]
  (self.state/'buildings.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
 def args(self,workers=3,daily_limit=72,timeout=5,batch_size=1):
  return SimpleNamespace(state=self.state,codex=self.codex,workers=workers,daily_limit=daily_limit,timeout=timeout,dry_run=False,batch_size=batch_size)
 def status(self):
  db=queue.connect(self.state/'research-queue.sqlite3')
  try:return queue.status(db)
  finally:db.close()
 def test_three_real_fake_workers_submit_distinct_sourced_reviews(self):
  with mock.patch.dict(os.environ,{'OPENAI_API_KEY':'not-a-real-key','CODEX_API_KEY':'not-a-real-key'}):report=supervisor.run(self.args())
  self.assertEqual(report['state'],'finished');self.assertEqual(len(report['results']),3)
  self.assertTrue(all(r['state']=='submitted' for r in report['results']),report)
  self.assertEqual(len({r['building_id'] for r in report['results']}),3)
  rows=[json.loads(x) for x in (self.state/'review-events.jsonl').read_text().splitlines()]
  self.assertEqual(len(rows),9);self.assertTrue(all(r['outcome']=='unresolved' and not r['outreach_eligible'] for r in rows))
  dirs=list((self.state/'worker-runs').glob('*/worker-*'));intervals=[]
  for d in dirs:
   start=json.loads((d/'started.json').read_text());end=json.loads((d/'ended.json').read_text())
   self.assertFalse(start['api_keys_present']);intervals.append((start['at'],end['at']))
   self.assertEqual(json.loads((d/'process.json').read_text())['state'],'stopped')
  self.assertLess(max(x[0] for x in intervals),min(x[1] for x in intervals),'Workers should actually run concurrently')
  self.assertEqual(self.status()['states']['submitted'],3)
 def test_batch_prompt_is_self_contained_and_lists_each_assigned_id(self):
  records=[{'building_id':f'building:{i}','candidate_addresses':[f'{i} Example St']} for i in range(10)]
  prompt=supervisor.worker_prompt(records,self.state,'fixture-worker',timeout=600)
  for row in records:
   self.assertIn(row['building_id'],prompt)
   self.assertIn(row['candidate_addresses'][0],prompt)
  self.assertIn('up to 30 events',prompt)
  self.assertIn('600 seconds',prompt)
  self.assertNotIn('coverage-expansion-operating-playbook',prompt)
  self.assertIn('source_sha256',prompt)
  single=supervisor.worker_prompt(records[0],self.state,'fixture-worker')
  self.assertIn("building_id='building:0'",single)
  self.assertIn('up to 3 events',single)
 def test_three_workers_submit_ten_buildings_each_with_exact_stages(self):
  self.seed(35)
  report=supervisor.run(self.args(batch_size=10))
  self.assertEqual(report['state'],'finished')
  self.assertEqual(len(report['results']),3)
  self.assertTrue(all(r['state']=='submitted' for r in report['results']),report)
  claims=[json.loads(p.read_text()) for p in (self.state/'worker-runs').glob('*/worker-*/claim.json')]
  self.assertEqual(len(claims),3)
  self.assertEqual([len(c['records']) for c in claims],[10,10,10])
  ids=[r['building_id'] for c in claims for r in c['records']]
  self.assertEqual(len(set(ids)),30,'Concurrent workers must not share a building')
  self.assertEqual({i for r in report['results'] for i in r['building_ids']},set(ids))
  events=[json.loads(x) for x in (self.state/'review-events.jsonl').read_text().splitlines()]
  self.assertEqual(len(events),90)
  for bid in ids:
   group=[e for e in events if e['building_id']==bid]
   self.assertCountEqual([e['stage'] for e in group],['address','occupants','contacts'])
   owner=next(c['worker'] for c in claims if any(r['building_id']==bid for r in c['records']))
   self.assertTrue(all(e['reviewer']==owner for e in group))
  self.assertEqual(self.status()['states'],{'pending':5,'submitted':30})
  self.assertEqual(json.loads((self.state/'daily-starts.json').read_text())['starts'],3,'Budget counts subprocesses, not buildings')
 def test_incomplete_ten_building_submission_is_atomic(self):
  self.seed(12)
  (self.root/'mode').write_text('incomplete')
  report=supervisor.run(self.args(workers=1,batch_size=10))
  self.assertEqual(report['results'][0]['state'],'failed')
  self.assertEqual(self.status()['states'],{'pending':12})
  self.assertEqual(self.status()['pending_events'],0)
  self.assertEqual(self.status()['exported_events'],0)
  output=self.state/'review-events.jsonl'
  self.assertTrue(not output.exists() or not output.read_text().strip())
  db=queue.connect(self.state/'research-queue.sqlite3')
  try:
   attempted=db.execute('SELECT attempts,available_at FROM building_items WHERE attempts>0').fetchall()
   self.assertEqual(len(attempted),10)
   self.assertTrue(all(r['attempts']==1 and r['available_at']>time.time() for r in attempted))
  finally:db.close()
 def test_complete_subset_submitted_and_blocked_building_retried_later(self):
  self.seed(10)
  (self.root/'mode').write_text('partial')
  report=supervisor.run(self.args(workers=1,batch_size=10))
  self.assertEqual(self.status()['states'],{'pending':1,'submitted':9},report)
  self.assertEqual(self.status()['exported_events'],27)
  events=[json.loads(x) for x in (self.state/'review-events.jsonl').read_text().splitlines()]
  self.assertEqual(len({e['building_id'] for e in events}),9)
  for bid in {e['building_id'] for e in events}:
   self.assertCountEqual([e['stage'] for e in events if e['building_id']==bid],['address','occupants','contacts'])
  self.assertFalse((self.state/'PAUSED').exists(),'Valid partial progress must not trigger all-workers-failed pause')
  db=queue.connect(self.state/'research-queue.sqlite3')
  try:
   blocked=db.execute("SELECT available_at,attempts FROM building_items WHERE state='pending'").fetchone()
   self.assertEqual(blocked['attempts'],1)
   self.assertGreater(blocked['available_at'],time.time())
  finally:db.close()
 def test_batch_size_outside_bounds_rejected_before_side_effects(self):
  for size in [0,11,-1]:
   with self.subTest(batch_size=size):
    with self.assertRaises(ValueError):supervisor.run(self.args(batch_size=size))
  self.assertFalse((self.state/'daily-starts.json').exists())
  self.assertFalse((self.state/'research-queue.sqlite3').exists())
  self.assertFalse((self.state/'worker-runs').exists())
 def test_ten_batch_accepts_smaller_last_claim_without_inventing_work(self):
  self.seed(2)
  report=supervisor.run(self.args(workers=1,batch_size=10))
  self.assertEqual(report['results'][0]['state'],'submitted',report)
  self.assertEqual(len(report['results'][0]['building_ids']),2)
  self.assertEqual(self.status()['states'],{'submitted':2})
  self.assertEqual(self.status()['exported_events'],6)
 def test_export_uses_captured_bytes_and_captures_additional_references(self):
  (self.root/'mode').write_text('additional')
  report=supervisor.run(self.args(workers=1))
  self.assertEqual(report['results'][0]['state'],'submitted',report)
  events=[json.loads(x) for x in (self.state/'review-events.jsonl').read_text().splitlines()]
  for event in events:
   self.assertIn('trusted-source-cache/objects/',event['raw_evidence_reference'])
   self.assertIn('source.txt',event['worker_interpretation_reference'])
   self.assertEqual(event['semantic_support'],'excerpt_present_requires_relationship_review')
   for reference in [event]+event['additional_evidence_references']:
    body=(self.root/reference['raw_evidence_reference']).read_bytes()
    self.assertTrue(body.startswith(b'<html>'))
    self.assertEqual(reference['source_sha256'],hashlib.sha256(body).hexdigest())
  self.assertEqual(events[0]['additional_evidence_references'][0]['semantic_support'],'captured_requires_review')
 def test_unavailable_coordinator_capture_prevents_submission(self):
  with mock.patch.object(capture,'fetch',side_effect=ValueError('Source unavailable')):
   report=supervisor.run(self.args(workers=1))
  self.assertEqual(report['results'][0]['state'],'failed')
  self.assertEqual(self.status()['exported_events'],0)
 def test_run_freezes_full_playbook_across_workers(self):
  playbook=self.root/'playbook.txt';playbook.write_text('FULL ORIGINAL STANDARDS')
  original=supervisor.worker_prompt
  def mutate(record,taskdir,worker,timeout=720,playbook=None):
   (self.root/'playbook.txt').write_text('CHANGED DURING RUN')
   return original(record,taskdir,worker,timeout,playbook=playbook)
  with mock.patch.object(supervisor,'PLAYBOOK',playbook),mock.patch.object(supervisor,'worker_prompt',side_effect=mutate):
   report=supervisor.run(self.args())
  self.assertTrue(all(r['state']=='submitted' for r in report['results']))
  for path in (self.state/'worker-runs').glob('*/worker-*/prompt.txt'):
   self.assertIn('FULL ORIGINAL STANDARDS',path.read_text())
   self.assertNotIn('CHANGED DURING RUN',path.read_text())
  saved=next((self.state/'worker-runs').glob('*/playbook.txt'))
  self.assertEqual(saved.read_text(),'FULL ORIGINAL STANDARDS')
 def test_claim_receipt_write_failure_releases_lease(self):
  original=supervisor.write_json
  def fail_claim(path,value):
   if path.name=='claim.json':raise OSError('simulated claim receipt disk failure')
   return original(path,value)
  with mock.patch.object(supervisor,'write_json',side_effect=fail_claim):
   report=supervisor.run(self.args(workers=1))
  self.assertEqual(report['results'][0]['state'],'failed')
  self.assertEqual(self.status()['states'],{'pending':6})
  self.assertFalse(list((self.state/'worker-runs').glob('*/worker-*/started.json')))
 def test_admission_failure_keeps_completed_worker_token_usage(self):
  (self.root/'mode').write_text('invalid')
  report=supervisor.run(self.args(workers=1))
  result=report['results'][0]
  self.assertEqual(result['state'],'failed')
  self.assertEqual(result['usage'],{'input_tokens':1234,'output_tokens':56,'cached_input_tokens':100})
  saved=json.loads(next((self.state/'worker-runs').glob('*/worker-*/result.json')).read_text())
  self.assertEqual(saved['usage'],result['usage'])
  self.assertEqual(self.status()['exported_events'],0)
 def test_locked_supervisor_does_not_start_or_modify_budget(self):
  with (self.state/'supervisor.lock').open('a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   self.assertEqual(supervisor.run(self.args()),{'state':'already_running'})
  self.assertFalse((self.state/'daily-starts.json').exists());self.assertFalse((self.state/'worker-runs').exists())
 def test_programmatic_entrypoint_rejects_more_than_six_workers(self):
  with self.assertRaises(ValueError):supervisor.run(self.args(workers=7))
  self.assertFalse((self.state/'daily-starts.json').exists())
 def test_paused_does_not_claim_work(self):
  (self.state/'PAUSED').touch();self.assertEqual(supervisor.run(self.args()),{'state':'paused'})
  self.assertFalse((self.state/'research-queue.sqlite3').exists())
 def test_daily_cap_limits_actual_worker_starts_across_invocations(self):
  first=supervisor.run(self.args(daily_limit=2));self.assertEqual(len(first['results']),2)
  self.assertEqual(supervisor.run(self.args(daily_limit=2))['state'],'daily_start_limit')
  self.assertEqual(len(list((self.state/'worker-runs').glob('*/worker-*'))),2)
 def test_invented_excerpt_is_released_not_submitted(self):
  (self.root/'mode').write_text('invalid');r=supervisor.run(self.args(workers=1))
  self.assertEqual(r['results'][0]['state'],'failed');self.assertEqual(self.status()['states'],{'pending':6})
  self.assertEqual(self.status()['exported_events'],0)
  db=queue.connect(self.state/'research-queue.sqlite3');row=db.execute('SELECT attempts,available_at FROM building_items WHERE attempts>0').fetchone();db.close()
  self.assertEqual(row['attempts'],1);self.assertGreater(row['available_at'],time.time())
 def test_failed_terminal_turn_cannot_publish_even_valid_files(self):
  (self.root/'mode').write_text('failed_turn');r=supervisor.run(self.args(workers=1))
  self.assertEqual(r['results'][0]['state'],'failed');self.assertEqual(self.status()['exported_events'],0)
 def test_timeout_kills_worker_and_descendant_process_group(self):
  (self.root/'mode').write_text('timeout');r=supervisor.run(self.args(workers=1,timeout=.3))
  self.assertEqual(r['results'][0]['state'],'failed');self.assertIn('time budget',r['results'][0]['reason'])
  d=next((self.state/'worker-runs').glob('*/worker-*'));pid=json.loads((d/'started.json').read_text())['pid']
  self.assertFalse(supervisor.group_live(pid));self.assertTrue((d/'child.pid').exists());self.assertEqual(self.status()['exported_events'],0)
 def test_all_failed_workers_pause_future_starts(self):
  (self.root/'mode').write_text('invalid');r=supervisor.run(self.args(workers=3))
  self.assertTrue(all(x['state']=='failed' for x in r['results']))
  self.assertIn('All started',json.loads((self.state/'PAUSED').read_text())['reason'])
  self.assertEqual(supervisor.run(self.args())['state'],'paused')
  self.assertEqual(json.loads((self.state/'daily-starts.json').read_text())['starts'],3)
 def test_sigterm_coordinator_stops_workers_before_unlocking(self):
  (self.root/'mode').write_text('timeout')
  code="""import json,sys
from pathlib import Path
from types import SimpleNamespace
from scripts.market_map import building_research_supervisor as s
s.ROOT=Path(sys.argv[1]);s.POLL_SECONDS=.02;s.STOP_GRACE_SECONDS=.3
a=SimpleNamespace(state=s.ROOT/'state',codex=s.ROOT/'fake-codex',workers=1,daily_limit=72,timeout=30,dry_run=False)
print(json.dumps(s.run(a)))
"""
  proc=subprocess.Popen([sys.executable,'-c',code,str(self.root)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
   deadline=time.monotonic()+5;started=[]
   while not started and time.monotonic()<deadline:
    started=list((self.state/'worker-runs').glob('*/worker-*/child.pid'));time.sleep(.02)
   self.assertTrue(started,'Fake worker never started')
   os.kill(proc.pid,signal.SIGTERM);out,err=proc.communicate(timeout=10)
   self.assertEqual(proc.returncode,0,err)
   report=json.loads(out);self.assertEqual(report['results'][0]['state'],'failed')
   self.assertIn('Supervisor stopping',report['results'][0]['reason'])
   registry=json.loads((started[0].parent/'process.json').read_text())
   self.assertEqual(registry['state'],'stopped');self.assertFalse(supervisor.group_live(registry['identity']['pgid']))
   with (self.state/'supervisor.lock').open('a') as lock:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  finally:
   if proc.poll() is None:proc.kill();proc.communicate(timeout=5)
 def test_unknown_crash_launch_holds_before_new_claims(self):
  d=self.state/'worker-runs/old/worker-1';d.mkdir(parents=True);(d/'process.json').write_text(json.dumps({'state':'launching'}))
  r=supervisor.run(self.args());self.assertEqual(r['state'],'orphan_recovery_hold');self.assertFalse((self.state/'daily-starts.json').exists())
 def test_reused_pid_is_not_killed_or_reclaimed(self):
  d=self.state/'worker-runs/old/worker-1';d.mkdir(parents=True)
  ident=supervisor.process_identity(os.getpid());ident['started']='not-current-start-time'
  (d/'process.json').write_text(json.dumps({'state':'running','identity':ident}))
  with mock.patch.object(supervisor,'stop_group') as kill:
   self.assertEqual(supervisor.run(self.args())['state'],'orphan_recovery_hold');kill.assert_not_called()
 def test_verified_orphan_is_stopped_before_queue_runs(self):
  proc=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],start_new_session=True)
  self.addCleanup(lambda:supervisor.stop_process(proc))
  d=self.state/'worker-runs/old/worker-1';d.mkdir(parents=True)
  (d/'process.json').write_text(json.dumps({'state':'running','identity':supervisor.process_identity(proc.pid)}))
  held=supervisor.recover_orphans(self.state);self.assertEqual(held,[]);proc.wait(timeout=2)
  self.assertFalse(supervisor.group_live(proc.pid));self.assertEqual(json.loads((d/'process.json').read_text())['state'],'recovered_stopped')

 def routed_fixture(self, events, *args, **kwargs):
  return {'state':'staged_not_verified','corrected_events':[{k:e[k] for k in ('building_id','stage','finding','source_url','source_excerpt','remaining_gaps')} for e in events]}
 def test_six_routed_workers_claim_twelve_distinct_records(self):
  self.seed(12)
  args=self.args(workers=6,batch_size=2);args.routed=True;args.research_model='gpt-6-luna'
  with mock.patch('scripts.market_map.routed_source_research.run',side_effect=self.routed_fixture):
   report=supervisor.run(args)
  self.assertEqual(report['state'],'finished',report)
  self.assertEqual(len(report['results']),6)
  ids=[bid for r in report['results'] for bid in r['building_ids']]
  self.assertEqual(len(ids),12);self.assertEqual(len(set(ids)),12)
  self.assertEqual(self.status()['states'],{'submitted':12})
  self.assertEqual(len((self.state/'review-events.jsonl').read_text().splitlines()),36)
  windows=[]
  for d in (self.state/'worker-runs').glob('*/worker-*'):
   windows.append((json.loads((d/'started.json').read_text())['at'],json.loads((d/'ended.json').read_text())['at']))
  self.assertLess(max(x[0] for x in windows),min(x[1] for x in windows))
 def test_resumed_queue_policy_blocks_legacy_mode_before_claim(self):
  (self.state/'research-policy.json').write_text(json.dumps({'require_routed':True,'require_explicit_model':True}))
  self.assertEqual(supervisor.run(self.args())['state'],'policy_hold')
  args=self.args();args.routed=True
  self.assertEqual(supervisor.run(args)['state'],'policy_hold')
  self.assertFalse((self.state/'daily-starts.json').exists())
 def test_two_stage_routed_worker_admits_and_exports(self):
  db=queue.connect(self.state/'research-queue.sqlite3')
  queue.seed(db,self.state/'buildings.jsonl')
  db.execute("UPDATE building_items SET snapshot=json_set(snapshot,'$.research_phase','foundation_occupants')")
  db.close()
  args=self.args(workers=1,batch_size=1);args.routed=True;args.research_model='gpt-5.4'
  with mock.patch('scripts.market_map.routed_source_research.run',side_effect=self.routed_fixture):
   report=supervisor.run(args)
  self.assertEqual(report['results'][0]['state'],'submitted',report)
  rows=[json.loads(x) for x in (self.state/'review-events.jsonl').read_text().splitlines()]
  self.assertEqual(len(rows),2)
  self.assertEqual({x['stage'] for x in rows},{'address','occupants'})
 def test_routed_run_stages_evidence_without_semantic_promotion(self):
  args=self.args(workers=1,batch_size=2);args.routed=True;args.research_model='gpt-6-luna'
  with mock.patch('scripts.market_map.routed_source_research.run',side_effect=self.routed_fixture) as route:
   report=supervisor.run(args)
  self.assertEqual(report['state'],'finished',report)
  self.assertEqual(route.call_count,2)
  self.assertEqual(len(route.call_args.args[0]),3)
  self.assertTrue(route.call_args.args[4].strip())
  self.assertEqual(report['results'][0]['research_model'],'gpt-6-luna')
  prompt=next((self.state/'worker-runs').glob('*/worker-*/prompt.txt')).read_text()
  self.assertIn('SOURCE-FIRST ROUTED MODE',prompt)
  self.assertIn('source_excerpt may be empty',prompt)
  rows=[json.loads(x) for x in (self.state/'review-events.jsonl').read_text().splitlines()]
  self.assertTrue(all(x['outcome']=='unresolved' for x in rows))
  self.assertTrue(all(any('Routed extraction staged' in g for g in x['remaining_gaps']) for x in rows))
 def test_routed_one_candidate_failure_preserves_other_candidate(self):
  args=self.args(workers=1,batch_size=2);args.routed=True
  calls=[]
  def route(events,*a,**kw):
   calls.append(events)
   if len(calls)==1:raise RuntimeError('missing source')
   return self.routed_fixture(events,*a,**kw)
  with mock.patch('scripts.market_map.routed_source_research.run',side_effect=route):
   report=supervisor.run(args)
  self.assertEqual(report['state'],'finished',report)
  self.assertEqual(report['results'][0]['result']['buildings'],1)
  self.assertEqual(len((self.state/'review-events.jsonl').read_text().splitlines()),3)
  self.assertEqual(self.status()['states']['submitted'],1)
 def test_routed_incomplete_candidate_does_not_discard_complete_candidate(self):
  (self.root/'mode').write_text('incomplete')
  args=self.args(workers=1,batch_size=2);args.routed=True
  with mock.patch('scripts.market_map.routed_source_research.run',side_effect=self.routed_fixture):
   report=supervisor.run(args)
  self.assertEqual(report['state'],'finished',report)
  self.assertEqual(self.status()['states']['submitted'],1)
  self.assertEqual(len((self.state/'review-events.jsonl').read_text().splitlines()),3)
 def test_routed_failure_releases_claim_and_preserves_usage(self):
  args=self.args(workers=1);args.routed=True
  with mock.patch('scripts.market_map.routed_source_research.run',side_effect=RuntimeError('routing budget exceeded')):
   report=supervisor.run(args)
  self.assertEqual(report['state'],'paused_all_workers_failed')
  self.assertEqual(report['results'][0]['usage']['input_tokens'],1234)
  self.assertNotIn('submitted',self.status()['states'])
  self.assertEqual((self.state/'review-events.jsonl').read_text(),'')

if __name__=='__main__':unittest.main()
