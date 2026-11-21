"""Additive, offline fresh-cohort preparation. Never approves, admits, verifies or sends.

Writes an immutable snapshot; original pilot and growing collector files remain untouched.
Mailbox history is an advisory snapshot: absence of matches is never clearance.
"""
import argparse, collections, hashlib, json, re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

def sha(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()

def host(value):
    return (urlparse(value if '://' in value else 'https://'+value).hostname or '').lower().removeprefix('www.')

def read_observations(path):
    rows={}; trailing=0
    if not path.exists(): return rows,trailing
    with path.open('rb') as f:
        for line in f:
            try: row=json.loads(line)
            except json.JSONDecodeError:
                if not line.endswith(b'\n'): trailing+=1; break
                raise
            rows[row['organisation_id']]=row
    return rows,trailing

def history_addresses(index):
    addresses=set()
    for market in index.get('markets',[]):
        for message in market.get('messages',[]):
            addresses.update(str(a).lower() for a in message.get('addresses',[]))
    return addresses

def prepare(candidate,source,original,seen,history,allowed,now):
    c=candidate; oid=c['organisation_id'];email=c.get('email','').strip().lower();domain=host(c.get('domain',''))
    blockers=[]; tasks=['live_crm_identity_and_suppression_check','fresh_both_mailbox_history_check','individual_identity_role_geography_context_review','mailbox_validation','reviewed_copy_and_sender_check']
    if oid in original['ids'] or email in original['emails']:blockers.append('original_pilot_identity_or_email')
    if email in seen:blockers.append('duplicate_shared_inbox')
    seen.add(email)
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email):blockers.append('invalid_email_syntax')
    if c.get('catchment') not in allowed or not c.get('city'):blockers.append('service_area_mapping_review')
    if domain in original['domains']:blockers.append('existing_domain_branch_or_parent_review')
    if email in history or any(a.rsplit('@',1)[-1]==domain for a in history):blockers.append('historical_mailbox_correspondence_review')
    if any(c.get(k) is True for k in ('suppressed','do_not_contact','unsubscribed')):blockers.append('explicit_suppression')
    if 'ottawa' in c.get('catchment','').lower():tasks.append('ottawa_sender_adapter_review')
    valid_source=False
    if not source: tasks.append('collect_official_source')
    else:
        if source.get('email','').lower()!=email or source.get('organisation_id')!=oid:blockers.append('source_recipient_identity_mismatch')
        elif source.get('restriction_signals'):blockers.append('publication_restriction_review')
        else:
            valid_source=any(p.get('http_status')==200 and p.get('sha256') and p.get('target_email_observed') and host(p.get('final_url',''))==domain for p in source.get('pages',[]))
            if not valid_source:tasks.append('source_binding_or_browser_recovery')
            try:age=(now-datetime.fromisoformat(source['checked_at'].replace('Z','+00:00'))).total_seconds()
            except (KeyError,ValueError,TypeError):age=float('inf')
            if not -60<=age<=86400:tasks.append('refresh_source');valid_source=False
    stage='held_for_research' if blockers else ('awaiting_mailbox_and_individual_review' if valid_source else 'awaiting_source_recovery')
    return dict(organisation_id=oid,email=email,candidate_sha256=sha(c),source_sha256=sha(source) if source else None,stage=stage,blockers=blockers,required_tasks=tasks,source_binding_observed=valid_source,campaign_ready=False,send_authorized=False,branch_context_status='unverified_no_brand_collapse_or_independent_operator_claim',history_clearance=False)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--cohort',default='artifacts/partnership-next-day-research-20261028');ap.add_argument('--pilot',default='artifacts/partnership-pilot-3000-20261027');ap.add_argument('--output',required=True);args=ap.parse_args()
    out=Path(args.output)
    if out.exists(): raise SystemExit('Output already exists; use a new immutable snapshot path')
    cohort=Path(args.cohort);pilot=Path(args.pilot);now=datetime.now(timezone.utc)
    candidate_bytes=(cohort/'candidates.json').read_bytes();candidates=json.loads(candidate_bytes); prior=json.loads((pilot/'candidates.json').read_text())
    original={'ids':{r['organisation_id'] for r in prior},'emails':{r['email'].lower() for r in prior},'domains':{host(r['domain']) for r in prior}}
    allowed={r['catchment'] for r in prior}; sources,trailing=read_observations(cohort/'source-observations.jsonl')
    hp=pilot/'mailbox-address-index.json'; history_index=json.loads(hp.read_text()) if hp.exists() else {}; history=history_addresses(history_index)
    seen=set();tasks=[prepare(c,sources.get(c['organisation_id']),original,seen,history,allowed,now) for c in candidates]
    counts=collections.Counter(t['stage'] for t in tasks);blockers=collections.Counter(b for t in tasks for b in t['blockers']);work=collections.Counter(x for t in tasks for x in t['required_tasks'])
    out.mkdir(parents=True)
    def write(name,rows): (out/name).write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
    (out/'candidates.json').write_bytes(candidate_bytes)
    write('source-refresh.jsonl',[sources[c['organisation_id']] for c in candidates if c['organisation_id'] in sources]);write('preparation-work.jsonl',tasks)
    eligible={t['organisation_id'] for t in tasks if t['stage']=='awaiting_mailbox_and_individual_review'}
    write('mailbox-validation-needed.jsonl',[c for c in candidates if c['organisation_id'] in eligible])
    write('individual-review-previews.jsonl',[{'candidate':c,'source':sources[c['organisation_id']],'state':'preview_only_mailbox_validation_pending','campaign_ready':False} for c in candidates if c['organisation_id'] in eligible])
    manifest=dict(created_at=now.isoformat(),candidates=len(candidates),stages=dict(counts),blockers=dict(blockers),tasks=dict(work),source_observations=len(sources),ignored_incomplete_tail=trailing,campaign_ready=0,mailbox_validation_performed=0,sent=0,candidate_sha256=hashlib.sha256(candidate_bytes).hexdigest(),history_snapshot={'completedAt':history_index.get('completedAt'),'sha256':sha(history_index),'absence_is_clearance':False},cities=dict(collections.Counter(c['city'] for c in candidates)),sectors=dict(collections.Counter(c['sector'] for c in candidates)),limitations=['Existing admission runner only accepts original pilot IDs; additive adapter still required.','No live CRM check; all rows require live identity/suppression/history checks.','No mailbox validation; publication is not deliverability.','Upstream one-per-domain cohort cannot establish independent franchise coverage.','Review previews cannot be submitted or published until mailbox and technical checks pass.'])
    manifest['files']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.iterdir() if p.is_file()}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({k:v for k,v in manifest.items() if k not in ('cities','sectors','files')}))
if __name__=='__main__':main()
