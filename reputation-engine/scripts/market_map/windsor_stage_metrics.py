"""Read-only staged coverage metrics; reviewed never implies complete occupancy."""
import collections,csv,json,sqlite3
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/windsor-foundation-audit-20261030'

def run():
 rows=[json.loads(s) for s in (ROOT/'artifacts/windsor-building-ledger-20261029/buildings.jsonl').read_text().splitlines()]
 districts={r['building_id']:r['district'] for r in csv.DictReader((OUT/'district-building-manifest.csv').open())}
 db=sqlite3.connect('file:'+str(ROOT/'artifacts/windsor-building-ledger-20261029/research-queue.sqlite3')+'?mode=ro',uri=True)
 events=collections.defaultdict(dict)
 for (body,) in db.execute('select body from building_events order by rowid'):
  e=json.loads(body);events[e['building_id']][e['stage']]=e['outcome']
 states=dict(db.execute('select building_id,state from building_items'));db.close()
 def metrics(items):
  c=collections.Counter()
  for r in items:
   c['candidate_records']+=1
   c['with_candidate_address']+=bool(r.get('candidate_addresses'))
   c['with_zoning_code']+=bool(r.get('zoning_codes'))
   c['with_reported_place']+=bool(r.get('reported_places'))
   c['address_conflicts']+=r.get('address_matching_status')=='address_conflict'
   stages={**r.get('review_stages',{}),**events.get(r['building_id'],{})}
   c['any_research_record']+=bool(stages)
   for stage in ('address','occupants','contacts'):
    c[stage+'_reviewed_not_certified']+=stages.get(stage)=='reviewed'
    c[stage+'_unresolved']+=stages.get(stage)=='unresolved'
   c['occupant_inventory_unknown']+=r.get('occupant_completeness')=='unknown'
   c['queue_submitted_not_verified']+=states.get(r['building_id'])=='submitted'
  return dict(c)
 grouped={name:metrics([r for r in rows if districts[r['building_id']]==name]) for name in sorted(set(districts.values()))}
 report={'generated_at':datetime.now(timezone.utc).isoformat(),'assigned_district_records':metrics([r for r in rows if districts[r['building_id']] not in ('UNMATCHED','BOUNDARY_REVIEW')]),'districts':grouped,'fully_complete_certified_count':0,'limits':['No end-to-end completion certification exists; zero certified does not mean zero useful research.','Candidate address and reported place links are not verified occupancy.','Ledger review stages plus latest queue events; submitted is a workflow status, not completion.','Three unmatched records remain; user reports vacant land, not independently verified.']}
 (OUT/'stage-metrics.json').write_text(json.dumps(report,indent=2)+'\n')
 fields=['district']+list(next(iter(grouped.values())))
 with (OUT/'district-stage-metrics.csv').open('w') as f:
  w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows({'district':k,**v} for k,v in grouped.items())
 print(json.dumps(report['assigned_district_records'],indent=2));print('City Centre',json.dumps(grouped['City Centre']))
if __name__=='__main__':run()
