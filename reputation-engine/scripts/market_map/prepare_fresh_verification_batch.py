"""Freeze at most 100 source-bound non-Ottawa rows for bounded mailbox checking.
Ranking prioritizes saved locality/name context; it never proves identity or eligibility.
"""
import argparse, hashlib, json
from pathlib import Path
from scripts.market_map.prepare_fresh_review_supply import sha

def select(candidates,sources,tasks,limit=100,excluded_ids=(),excluded_emails=()):
    if not 1<=limit<=100:raise ValueError('Bounded batch must be 1..100')
    selected=[];ids=set(excluded_ids);emails={e.lower() for e in excluded_emails}
    for c in candidates:
        oid=c['organisation_id'];t=tasks.get(oid,{});s=sources.get(oid,{})
        if t.get('stage')!='awaiting_mailbox_and_individual_review' or t.get('blockers') or 'ottawa' in c.get('catchment','').lower():continue
        if t.get('candidate_sha256')!=sha(c) or t.get('source_sha256')!=sha(s):raise ValueError('Preparation snapshot mismatch')
        email=c['email'].lower()
        if oid in ids or email in emails:continue
        ids.add(oid);emails.add(email)
        text=' '.join((p.get('page_identity_excerpt') or '')+' '+(p.get('target_context') or '') for p in s.get('pages',[])).lower()
        score=10*int(c['city'].lower() in text)+5*int(c['organisation_name'].lower() in text)+2*int(email in text)+int(any(p.get('mailto_target_observed') for p in s.get('pages',[])))
        selected.append((score,oid,c,s))
    return sorted(selected,key=lambda r:(-r[0],r[1]))[:limit]

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--preparation',required=True);ap.add_argument('--output',required=True);ap.add_argument('--limit',type=int,default=100);a=ap.parse_args()
    source=Path(a.preparation);out=Path(a.output)
    if out.exists():raise ValueError('Immutable batch already exists')
    manifest=json.loads((source/'manifest.json').read_text())
    for name in ('candidates.json','source-refresh.jsonl','preparation-work.jsonl'):
        if hashlib.sha256((source/name).read_bytes()).hexdigest()!=manifest['files'][name]:raise ValueError('Manifest hash mismatch '+name)
    rows=json.loads((source/'candidates.json').read_text());sources={r['organisation_id']:r for r in map(json.loads,(source/'source-refresh.jsonl').read_text().splitlines())};tasks={r['organisation_id']:r for r in map(json.loads,(source/'preparation-work.jsonl').read_text().splitlines())}
    excluded_ids=set();excluded_emails=set();prior_batches=[]
    for prior_manifest in sorted(out.parent.glob('*/batch-manifest.json')):
        prior=json.loads(prior_manifest.read_text()); prior_bytes=(prior_manifest.parent/'candidates.json').read_bytes()
        if hashlib.sha256(prior_bytes).hexdigest()!=prior['files']['candidates.json']:raise ValueError('Prior batch hash mismatch')
        previous=json.loads(prior_bytes);excluded_ids.update(r['organisation_id'] for r in previous);excluded_emails.update(r['email'].lower() for r in previous)
        prior_batches.append({'manifest':str(prior_manifest),'sha256':hashlib.sha256(prior_manifest.read_bytes()).hexdigest()})
    selected=select(rows,sources,tasks,a.limit,excluded_ids,excluded_emails);out.mkdir(parents=True)
    (out/'candidates.json').write_text(json.dumps([r[2] for r in selected],indent=2))
    (out/'source-refresh.jsonl').write_text(''.join(json.dumps(r[3])+'\n' for r in selected))
    batch={'schema':'fresh-cohort-bounded-v1','parent_preparation':str(source),'parent_manifest_sha256':hashlib.sha256((source/'manifest.json').read_bytes()).hexdigest(),'count':len(selected),'excluded_prior_batches':prior_batches,'excluded_prior_ids':len(excluded_ids),'maximum_new_paid_requests':a.limit,'campaign_ready':0,'send_authorized':False,'ranking':'Saved locality, full business name and email presence; not identity approval','files':{name:hashlib.sha256((out/name).read_bytes()).hexdigest() for name in ('candidates.json','source-refresh.jsonl')}}
    (out/'batch-manifest.json').write_text(json.dumps(batch,indent=2));print(json.dumps(batch))
if __name__=='__main__':main()
