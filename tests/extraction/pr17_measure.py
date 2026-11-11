"""Generate local synthetic measurements and a blocked real-corpus release decision."""
import argparse,hashlib,importlib.util,json,sys,time,random
from pathlib import Path
import tempfile
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT));sys.dont_write_bytecode=True

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args();out=Path(a.output).resolve()
 if out.exists() or not out.is_relative_to(Path(tempfile.gettempdir()).resolve()):p.error('new temporary output required')
 from scripts.market_map.offline_guard import OfflineGuard
 guard=OfflineGuard(out);guard.install();out.mkdir()
 from scripts.market_map.extraction_benchmark import benchmark,score_extraction,score_attribution
 from scripts.market_map.release_evaluation import evaluate,wilson
 from scripts.market_map.release_corpus import load_corpus
 for name,folder in [('frozen','fixtures'),('extended','tranche3_fixtures')]:
  fixture=ROOT/'tests/extraction'/folder;run=benchmark(fixture/'manifest.json',fixture/'labels.jsonl')
  labels={r['id']:r for r in map(json.loads,(fixture/'labels.jsonl').read_text().splitlines())};ids=sorted(labels)
  rng=random.Random(170017);draws={k:[] for k in ['email','phone','phone_kind','attribution']}
  per={i:{**score_extraction({i:run['predictions'][i]},{i:labels[i]}),'attribution':score_attribution({i:run['predictions'][i]},{i:labels[i]})} for i in ids}
  for _ in range(400):
   chosen=[rng.choice(ids) for i in ids]
   for key in draws:
    tp,fp,fn=[sum(per[i][key][k] for i in chosen) for k in ['tp','fp','fn']]
    if 2*tp+fp+fn:draws[key].append(2*tp/(2*tp+fp+fn))
  for key in draws:
   score=run['attribution'] if key=='attribution' else run['extraction'][key]
   score.update(precision_wilson95=wilson(score['tp'],score['tp']+score['fp']),recall_wilson95=wilson(score['tp'],score['tp']+score['fn']))
   values=sorted(draws[key]);score['f1_page_bootstrap95']=[values[int(.025*(len(values)-1))],values[int(.975*(len(values)-1))]] if values else None
  run['interval_scope']='Synthetic page-resampling diagnostic only; shared hosts/templates are not independent, so these are not population intervals. 400 draws, seed 170017.'
  baseline_path=ROOT/'tests/extraction/tranche5_results/PR-16'/('frozen-candidate.json' if name=='frozen' else 'candidate.json')
  baseline=json.loads(baseline_path.read_text());baseline=baseline if name=='frozen' else baseline['accuracy']
  if (baseline['manifest_sha256'],baseline['labels_sha256'])!=(run['manifest_sha256'],run['labels_sha256']):raise ValueError('legacy baseline labels changed')
  def identity(e):return json.dumps([e.get('page_id'),e['channel'],e['outcome'],e['value']],sort_keys=True)
  before={identity(e) for e in baseline['errors']}
  run['prediction_changes']=[{'capture_id':i,'before':baseline['predictions'][i],'after':run['predictions'][i]} for i in ids if baseline['predictions'][i]!=run['predictions'][i]]
  run['baseline_artifact']=str(baseline_path.relative_to(ROOT))
  for e in run['errors']:
   e.update(regression_status='pre_existing' if identity(e) in before else 'new',stage_responsible='normalization' if e['category']=='Unsupported format' else None,proposed_fix='Retain unsupported Unicode local parts; separately review EAI support without ASCII substitution.' if e['category']=='Unsupported format' else 'Inspect linked diagnostics; upstream cause unverified.')
  (out/(name+'.json')).write_text(json.dumps(run,indent=2,ensure_ascii=False)+'\n')
 spec=importlib.util.spec_from_file_location('ops',ROOT/'tests/extraction/test_release_operations.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 work=out/'workload';work.mkdir();start=time.monotonic();result=module.workload(work);result['elapsed_seconds']=time.monotonic()-start
 (out/'workload.json').write_text(json.dumps(result,indent=2)+'\n')
 # No fabricated real captures, permission attestations or reviewers.
 (out/'labels.json').write_text('[]\n');manifest={'schema_version':1,'corpus_kind':'real','version':'pending-approved-corpus/1','label_version':'pending-independent-labels/1','labels_file':'labels.json','labels_sha256':hashlib.sha256((out/'labels.json').read_bytes()).hexdigest(),'captures':[]}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');m,l,b=load_corpus(out/'manifest.json')
 blocked=evaluate(m,l,{})
 (out/'release-evaluation.json').write_text(json.dumps(blocked,indent=2)+'\n')
 if guard.violations:raise RuntimeError(guard.violations)
 print(json.dumps({'real_captures':0,'broad_production':blocked['release']['broad_production'],'workload':result}))
if __name__=='__main__':main()
