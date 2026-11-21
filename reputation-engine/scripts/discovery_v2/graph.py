"""Provenance statements and deterministic coverage challenge report.
Statements describe what a source said; they never silently become canonical truth.
"""
import argparse,json
from pathlib import Path
from engine import Engine,key
SCHEMA='''
CREATE TABLE IF NOT EXISTS statements(id TEXT PRIMARY KEY, subject_id TEXT REFERENCES entities(id), predicate TEXT, value_json TEXT, observation_id TEXT REFERENCES observations(id), observed_at TEXT, valid_at TEXT, epistemic_status TEXT);
CREATE TABLE IF NOT EXISTS resolution_reviews(id TEXT PRIMARY KEY, left_id TEXT REFERENCES entities(id), right_id TEXT REFERENCES entities(id), decision TEXT CHECK(decision IN ('same_site','different_site','same_parent','uncertain')), evidence_json TEXT, reviewer TEXT, recorded_at TEXT);
CREATE INDEX IF NOT EXISTS statements_subject ON statements(subject_id,predicate);
'''
FIELDS={'name':'name_observed','city':'locality_observed','address':'address_observed','website':'website_observed','categories':'category_label_observed','published_emails':'email_route_observed','published_phones':'phone_route_observed','external_id':'external_identifier_observed','source_provenance':'provider_provenance_observed','provider_existence_confidence':'provider_existence_confidence_observed','raw_taxonomy':'source_taxonomy_observed','coordinates':'coordinates_observed'}
def materialize(engine):
 db=engine.db;db.executescript(SCHEMA);before=db.execute('SELECT COUNT(*) FROM statements').fetchone()[0]
 with db:
  for o in db.execute('SELECT * FROM observations').fetchall():
   payload=json.loads(o['payload'])
   for field,predicate in FIELDS.items():
    value=payload.get(field)
    if value in (None,'',[]):continue
    db.execute('INSERT OR IGNORE INTO statements VALUES(?,?,?,?,?,?,?,?)',(key(o['id'],predicate,value),o['entity_id'],predicate,json.dumps(value,sort_keys=True),o['id'],o['captured_at'],None,'source_assertion'))
 return db.execute('SELECT COUNT(*) FROM statements').fetchone()[0]-before

def audit(engine,cfg):
 db=engine.db;findings=[];curves=[]
 for cell in cfg['cells']:
  scope,category=cell['scope'],cell['category'];runs=db.execute("SELECT * FROM runs WHERE scope=? AND category=? AND kind='discovery' ORDER BY captured_at,id",(scope,category)).fetchall();families={r['family'] for r in runs}
  missing=sorted(set(cfg['families'])-families)
  if missing:findings.append({'kind':'missing_source_families','scope':scope,'category':category,'evidence':missing,'next_action':'Attempt a configured independent source family; do not call this market complete'})
  if len(families)<2:findings.append({'kind':'independence_gap','scope':scope,'category':category,'evidence':sorted(families),'next_action':'Add corroborating discovery; website follow-up does not count as an independent family'})
  cumulative=set()
  for r in runs:
   members={x[0] for x in db.execute('SELECT entity_id FROM observations WHERE run_id=?',(r['id'],))};result=json.loads(r['result']);curves.append({'scope':scope,'category':category,'run':r['id'],'source':r['source'],'at':r['captured_at'],'distinct_observed':len(members),'new_in_scope':len(members-cumulative),'cumulative_observed':len(cumulative|members),'coverage_complete':result.get('coverage_complete',False)});cumulative|=members
   if not result.get('coverage_complete',False):findings.append({'kind':'bounded_or_unknown_source_coverage','scope':scope,'run':r['id'],'next_action':'Inspect pagination/caps and source scope; imported profiles do not establish a completed census'})
   if result['invalid_rows']:findings.append({'kind':'unusable_source_rows','run':r['id'],'count':result['invalid_rows'],'next_action':'Repair parser/fetch/identity evidence before treating missing rows as absent businesses'})
 conflicts=[dict(r) for r in db.execute("SELECT DISTINCT entity_id,observation_id,reason FROM claims WHERE status='conflicting'")]
 if conflicts:findings.append({'kind':'identity_conflicts','evidence':conflicts,'next_action':'Resolve from source evidence; preserve both statements'})
 return {'findings':findings,'discovery_curves':curves,'statement_count':db.execute('SELECT COUNT(*) FROM statements').fetchone()[0],'limitations':['This is a rules-based coverage critic, not a model or statistical completeness estimate.','No reference density or longitudinal core/shell model is fitted. A missed observation is not a closure.','Source families are not yet reconciled for copied/syndicated origins.','Resolution review schema exists; no learned resolver or automatic merge from review labels is enabled.']}
def main():
 p=argparse.ArgumentParser();p.add_argument('--database',type=Path,required=True);p.add_argument('--config',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();e=Engine(a.database);added=materialize(e);report=audit(e,json.loads(a.config.read_text()));a.output.mkdir(parents=True,exist_ok=True);(a.output/'coverage-critic.json').write_text(json.dumps(report,indent=2));lines=['# Commercial graph — evidence and coverage review','',f"{report['statement_count']} source statements. {len(report['findings'])} research gaps flagged.",'','## Findings','']
 for f in report['findings']:lines.append(f"- **{f['kind']}** ({f.get('scope',f.get('run','identity'))}): {f['next_action']}")
 (a.output/'COVERAGE-REVIEW.md').write_text('\n'.join(lines)+'\n');print(json.dumps({'new_statements':added,'total_statements':report['statement_count'],'findings':len(report['findings'])}))
if __name__=='__main__':main()
