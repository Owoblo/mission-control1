"""Replay existing collector evidence into V2 and replan after each source family."""
import argparse,json
from pathlib import Path
from engine import Engine

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--input',type=Path,required=True);ap.add_argument('--config',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);a=ap.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 cfg=json.loads(a.config.read_text());engine=Engine(a.output/'evidence.sqlite');groups={}
 for line in a.input.read_text().splitlines():
  r=json.loads(line);source=r.get('source_city','unknown');groups.setdefault(source,[]).append(r)
 checkpoints=[]
 for source,rows in sorted(groups.items()):
  if source not in cfg['sources']:continue
  spec=cfg['sources'][source];result=engine.ingest(source=source,family=spec['family'],scope=spec['scope'],category='*',rows=rows,captured_at=max((r.get('checked_at','') for r in rows),default='') or None)
  plan=engine.plan(cfg['cells'],cfg['families'],cfg['task_limit']);checkpoints.append({'source':source,'ingestion':result,'next_tasks':plan['next_tasks'][:3]})
 report=engine.plan(cfg['cells'],cfg['families'],cfg['task_limit']);report['checkpoints']=checkpoints;report['entity_count']=engine.db.execute('SELECT COUNT(*) FROM entities').fetchone()[0];report['observation_count']=engine.db.execute('SELECT COUNT(*) FROM observations').fetchone()[0]
 report['source_overlap']=[dict(r) for r in engine.db.execute("SELECT a.source AS source_a,b.source AS source_b,COUNT(DISTINCT x.entity_id) AS shared_site_candidates FROM observations x JOIN observations y ON x.entity_id=y.entity_id JOIN runs a ON a.id=x.run_id JOIN runs b ON b.id=y.run_id WHERE a.source<b.source AND a.kind='discovery' AND b.kind='discovery' GROUP BY a.source,b.source")]
 report['cost_note']='Costs in this replay are incremental import/API costs only (zero); original collection labour/network costs are not known.'
 report['confidence_sample']=[{'entity_id':r[0],'dimensions':engine.confidence(r[0])} for r in engine.db.execute('SELECT id FROM entities ORDER BY id LIMIT 3')]
 (a.output/'report.json').write_text(json.dumps(report,indent=2));lines=['# Discovery Engine V2 — next research actions','','This is an evidence-based research queue. No new emails or texts are sent by this runner. Broad directory runs do not complete individual industry/community cells.','',f"Resolved site candidates: {report['entity_count']}; source observations: {report['observation_count']}.",'','## Next actions','']
 for t in report['next_tasks']:lines.append(f"- **{t['scope']} / {t['category']} / {t['family']}** — {t['reason']}")
 lines+=['','## Coverage limitations','','No census-completeness percentage is calculated. Density anomalies require a suitable peer or registry denominator; none is configured. Confidence is dimensional and evidence-backed, not a numerical accuracy claim.']
 (a.output/'NEXT-ACTIONS.md').write_text('\n'.join(lines)+'\n');print(json.dumps({'entities':report['entity_count'],'observations':report['observation_count'],'proposed_tasks':report['proposed_count'],'sources':[c['ingestion'] for c in checkpoints]}))
if __name__=='__main__':main()
