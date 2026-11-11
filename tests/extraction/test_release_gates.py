import copy,hashlib,json,tempfile,unittest
from pathlib import Path
from scripts.market_map.release_corpus import load_corpus,clusters
from scripts.market_map.release_evaluation import compare,evaluate,delta,wilson,gates


def sample():
    p={'id':'p','url':'https://business.test/contact','sha256':'a'*64,'file':'page.html','split':'holdout','domain_group':'business.test','template_family':'custom','business_ids':['office'],'sector':'realtor_brokerage','language':'en','company_scope':'single','source_kind':'static','markup':'simple'}
    obs={'id':'g1','channel':'email','status':'supported','raw':'desk@business.test','normalized':'desk@business.test','locator':'/p','ownership':'unknown','owners':[]}
    gold={'id':'p','observations':[obs],'entities':[]}
    actual={**obs,'status':'accepted','method':'text','version':'fixture/1','source_url':p['url'],'capture_sha256':p['sha256']}
    return {'corpus_kind':'synthetic','labels_sha256':'b'*64,'captures':[p]}, {'p':gold},{'p':{'capture_sha256':p['sha256'],'versions':{'test':'1'},'observations':[actual],'entities':[]}}

class ReleaseTests(unittest.TestCase):
 def test_hand_scored_precision_recall_and_intervals(self):
  m,l,p=sample();p['p']['observations'].append({**p['p']['observations'][0],'id':'2','normalized':'wrong@business.test'})
  r=compare(m,l,p);self.assertEqual(r['metrics']['email']['precision'],.5);self.assertEqual(r['metrics']['email']['recall'],1);self.assertAlmostEqual(r['metrics']['email']['f1'],2/3)
  self.assertIsNone(wilson(0,0));self.assertAlmostEqual(wilson(100,100)[0],.9630065,places=6)
 def test_unknown_is_not_credited_as_correct_owner(self):
  m,l,p=sample();p['p']['observations'][0]['owners']=[{'type':'organization','id':'wrong'}]
  r=compare(m,l,p);self.assertEqual(r['wrong_owner_edges'],1);self.assertEqual(r['metrics']['organization']['fp'],1);self.assertEqual(r['end_to_end']['correct_contacts'],0)
 def test_fax_extension_and_normalization_independent(self):
  m,l,p=sample();o={'id':'fax','channel':'phone','normalized':'+15195550123','raw':'5195550123','locator':'/p','status':'supported','kind':'fax','extension':'22','owners':[],'ownership':'unknown'}
  l['p']['observations']=[o];p['p']['observations']=[{**o,'status':'accepted','kind':'phone','extension':None}]
  r=compare(m,l,p);self.assertEqual(r['metrics']['phone']['tp'],1);self.assertEqual(r['fax_as_phone'],1);self.assertEqual(r['extension_accuracy']['accuracy'],0);self.assertEqual(r['metrics']['extension']['fn'],1);self.assertEqual(r['metrics']['phone_kind']['fp'],1)
 def test_missing_provenance_not_hidden_by_duplicate(self):
  m,l,p=sample();p['p']['observations'].append({**p['p']['observations'][0],'id':'2','locator':None})
  r=compare(m,l,p);self.assertEqual(r['metrics']['provenance']['recall'],.5)
 def test_false_merges_splits_and_unassigned(self):
  m,l,p=sample();l['p']['entities']=[{'record_id':'a','entity_id':'one'},{'record_id':'b','entity_id':'two'},{'record_id':'c','entity_id':'two'}]
  p['p']['entities']=[{'record_id':'a','entity_id':'x'},{'record_id':'b','entity_id':'x'}]
  r=compare(m,l,p);self.assertEqual(r['entity_resolution'],{'false_merges':1,'false_splits':1,'unassigned_records':1})
 def test_empty_and_perfect_synthetic_never_release(self):
  m,l,p=sample();r=evaluate(m,l,p);self.assertEqual(r['release']['broad_production'],'NO_GO')
  m['captures']=[];r=evaluate(m,{},{});self.assertIsNone(r['all']['metrics']['email']['precision']);self.assertEqual(r['release']['bounded_live_pilot'],'NO_GO')
 def test_changed_labels_baseline_rejected_and_error_age(self):
  m,l,p=sample();p['p']['observations']=[];baseline=evaluate(m,l,p);r=evaluate(m,l,p,baseline=baseline);self.assertTrue(all(e['regression_status']=='pre_existing' for e in r['all']['errors']))
  m['labels_sha256']='new'
  with self.assertRaises(ValueError):evaluate(m,l,p,baseline=baseline)
 def test_bootstrap_reproducible_and_template_connected(self):
  m,l,p=sample()
  for i in range(3):
   page={**m['captures'][0],'id':str(i),'domain_group':str(i),'template_family':'shared' if i<2 else 'independent','business_ids':[str(i)]};m['captures'].append(page);l[str(i)]=copy.deepcopy(l['p']);p[str(i)]=copy.deepcopy(p['p'])
  self.assertEqual(len(set(clusters(m['captures']).values())),3);self.assertEqual(compare(m,l,p),compare(m,l,p))
 def corpus(self,root):
  m,l,p=sample();page=m['captures'][0];(root/'page.html').write_text('<p>desk@business.test</p>');page['sha256']=hashlib.sha256((root/'page.html').read_bytes()).hexdigest()
  (root/'approval.txt').write_text('Synthetic test attestation only');h=hashlib.sha256((root/'approval.txt').read_bytes()).hexdigest()
  page.update(captured_at='2026-01-01T00:00:00+00:00',permission={'owner_approved':True,'retention_allowed':True,'evaluation_allowed':True,'approved_by':'fixture-owner','retain_until':'2099-01-01T00:00:00+00:00','evidence_file':'approval.txt','evidence_sha256':h})
  l['p'].update(exhaustive=True,label_version='1',review={'annotators':['a','b'],'independent':True,'adjudicated':True,'adjudicator':'c','evidence_file':'approval.txt','evidence_sha256':h})
  (root/'labels.json').write_text(json.dumps(list(l.values())));m.update(schema_version=1,version='1',label_version='1',labels_file='labels.json',labels_sha256=hashlib.sha256((root/'labels.json').read_bytes()).hexdigest());return m
 def test_import_requires_permission_hash_labels_and_group_separation(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);m=self.corpus(root);path=root/'manifest.json';path.write_text(json.dumps(m));self.assertEqual(len(load_corpus(path)[2]),1)
   for update in ['permission','hash','split','review','escape']:
    c=copy.deepcopy(m)
    if update=='permission':c['captures'][0]['permission']['owner_approved']=False
    if update=='hash':c['captures'][0]['sha256']='bad'
    if update=='split':
     c['captures'].append({**c['captures'][0],'id':'q','split':'development'})
     labels=json.loads((root/'labels.json').read_text());labels.append({**labels[0],'id':'q'});(root/'duplicate.json').write_text(json.dumps(labels));c['labels_file']='duplicate.json';c['labels_sha256']=hashlib.sha256((root/'duplicate.json').read_bytes()).hexdigest()
    if update=='review':
     labels=json.loads((root/'labels.json').read_text());labels[0]['review']['independent']=False;(root/'badreview.json').write_text(json.dumps(labels));c['labels_file']='badreview.json';c['labels_sha256']=hashlib.sha256((root/'badreview.json').read_bytes()).hexdigest()
    if update=='escape':c['captures'][0]['file']='../outside'
    path.write_text(json.dumps(c))
    with self.assertRaises(ValueError,msg=update):load_corpus(path)

 def test_cross_page_false_merge_and_yield_interval(self):
  m,l,p=sample();m['captures'].append({**m['captures'][0],'id':'q','domain_group':'other','template_family':'other','business_ids':['other']})
  l['q']=copy.deepcopy(l['p']);p['q']=copy.deepcopy(p['p'])
  l['p']['entities']=[{'record_id':'a','entity_id':'one'}];l['q']['entities']=[{'record_id':'b','entity_id':'two'}]
  p['p']['entities']=[{'record_id':'a','entity_id':'wrongmerge'}];p['q']['entities']=[{'record_id':'b','entity_id':'wrongmerge'}]
  r=compare(m,l,p);self.assertEqual(r['entity_resolution']['false_merges'],1);self.assertEqual(r['end_to_end']['contacts_per_business_cluster_bootstrap95'],[0,0])
 def test_current_replay_never_uses_gold_to_assign_owner(self):
  from scripts.market_map.release_replay import replay
  m,l,p=sample();body=b'<p>desk@business.test</p>';m['captures'][0].update(sha256=hashlib.sha256(body).hexdigest(),captured_at='2026-01-01')
  r=replay(m,{'p':body});self.assertTrue(r['p']['observations']);self.assertTrue(all(not o['owners'] for o in r['p']['observations']))
  m['captures'][0]['source_kind']='document'
  with self.assertRaises(ValueError):replay(m,{'p':b'%PDF'})
  m['captures'][0]['sha256']=hashlib.sha256(b'%PDF').hexdigest();r=replay(m,{'p':b'%PDF'});self.assertEqual(r['p']['observations'],[]);self.assertEqual(r['p']['diagnostics'][0]['status'],'unsupported')

 def test_diagnostic_cause_is_not_invented_for_missing_contacts(self):
  m,l,p=sample();p['p']['observations']=[]
  r=compare(m,l,p);e=next(e for e in r['errors'] if e['metric']=='email');self.assertIsNone(e['stage_responsible'])
  p['p']['diagnostics']=[{'candidate_value':'desk@business.test','status':'unsupported','reason':'fixture'}]
  r=compare(m,l,p);e=next(e for e in r['errors'] if e['metric']=='email');self.assertEqual(e['stage_responsible'],'normalization');self.assertEqual(e['category'],'Unsupported format')
 def test_accepted_contact_yield_counts_unique_businesses_including_zero_results(self):
  m,l,p=sample();m['captures'][0]['business_ids']=['office','empty']
  e={'type':'organization','id':'org','business_id':'office'};l['p']['observations'][0]['owners']=[e];l['p']['observations'][0]['ownership']='supported';p['p']['observations'][0]['owners']=[e]
  r=compare(m,l,p);self.assertEqual(r['end_to_end']['contacts_per_business'],.5);self.assertEqual(r['end_to_end']['input_businesses'],2)
