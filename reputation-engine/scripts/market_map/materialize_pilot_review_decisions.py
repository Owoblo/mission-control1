"""Materialize explicit evidence-reviewed decisions; never sends or admits a recipient.

The input is a reviewer-authored JSON array, not raw candidates. Completed outputs
are immutable and a .ready marker is published only after all rows validate.
"""
import argparse, ast, hashlib, json, re, unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

PHONES = {'windsor':'226-887-0667','waterloo':'226-241-9853','london':'548-639-1428','gta':'437-465-0584','ottawa':'548-290-8695'}

# Read the existing canonical Ottawa locality list; fail closed if its format changes.
_ottawa_module=(Path(__file__).resolve().parents[2]/'lib/partnership-core/ottawa.mjs').read_text()
_ottawa_match=re.search(r'const locations=(\[[^;]+\]);',_ottawa_module)
if not _ottawa_match: raise RuntimeError('Canonical Ottawa locality list unavailable')
_ottawa_locations=ast.literal_eval(_ottawa_match.group(1))
def is_ottawa(city):
    def norm(value):return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',str(value)).encode('ascii','ignore').decode().lower())
    return norm(city) in {norm(c) for c in _ottawa_locations}

def build_review(decision, candidate, source, validation, technical, now):
    if decision['organisation_id'] != candidate['organisation_id'] or source['organisation_id'] != candidate['organisation_id']:
        raise ValueError('Identity mismatch')
    if technical.get('technical_screen_status') != 'advance_to_identity_and_eligibility_review':
        raise ValueError('Technical review incomplete')
    v = validation.get('validation', {})
    if v.get('IsValid', {}).get('ConfidenceVerdict') != 'HIGH' or v.get('Evaluations', {}).get('MailboxExists', {}).get('ConfidenceVerdict') == 'LOW':
        raise ValueError('Mailbox quality does not qualify')
    for stamp in [source.get('checked_at'), validation.get('checked_at')]:
        age = now.timestamp() - datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp()
        if age < -60 or age > 86400:
            raise ValueError('Source or validation requires refresh')
    if source.get('restriction_signals') or not source.get('target_email_observed'):
        raise ValueError('Source restriction or missing publication')
    pages = [source['pages'][i] for i in decision['page_indexes']]
    if not pages or not any(p.get('target_email_observed') for p in pages):
        raise ValueError('Selected evidence has no publication')
    for p in pages:
        host = (urlsplit(p.get('final_url') or p.get('requested_url') or '').hostname or '').removeprefix('www.')
        if host != candidate['domain'].removeprefix('www.') or p.get('http_status') != 200 or not p.get('sha256'):
            raise ValueError('Official page evidence required')
    text = ' '.join((p.get('page_identity_excerpt') or '')+' '+(p.get('target_context') or '')+' '+' '.join(v for v in p.get('target_contexts',[]) if isinstance(v,str)) for p in pages)
    for quote in decision['evidence_quotes']:
        if not quote.strip() or quote.casefold() not in text.casefold():
            raise ValueError('Evidence quote absent from selected pages')
    if len(decision['evidence_quotes']) < 2 or len(decision['finding']) < 60:
        raise ValueError('Identity, role and geography rationale required')
    if not decision['proposed_contextual_paragraph'].startswith('If ') or '{{' in decision['proposed_contextual_paragraph']:
        raise ValueError('Reviewed conditional copy required')
    region = decision['sender_region']
    if region not in PHONES or (region == 'ottawa') != is_ottawa(decision['reviewed_city']):
        raise ValueError('Unsupported regional sender')
    return dict(organisation_id=candidate['organisation_id'], organisation_name=candidate['organisation_name'],
        email=candidate['email'], reviewed_at=now.isoformat(), reviewed_city=decision['reviewed_city'],
        sender_region=region, regional_phone=PHONES[region], market='ottawa' if region=='ottawa' else 'saturn', reviewed_sector=decision['reviewed_sector'],
        identity_email_binding='pass', role_relevance='pass_for_conditional_context', finding=decision['finding'],
        proposed_contextual_paragraph=decision['proposed_contextual_paragraph'],
        sources=[dict(p,url=p.get('final_url') or p['requested_url']) for p in pages],
        review_method='automated_evidence_rules_v1', additional_review_method='individual_saved_source_context_review',
        evidence_quotes=decision['evidence_quotes'], branch_context=decision.get('branch_context'),
        source_record_sha256=hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest(),
        requires_parent_account_review=False)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--decisions',required=True);ap.add_argument('--output',required=True);ap.add_argument('--publish-ready',action='store_true');a=ap.parse_args()
    p=Path('artifacts/partnership-pilot-3000-20261027');output=Path(a.output)
    if output.parent != p or not re.fullmatch(r'additional-reviewed-parallel-\d+-round\d+-source\.jsonl',output.name):
        raise ValueError('Expected supervisor-compatible output in pilot artifact directory')
    if output.exists() or Path(str(output)+'.ready').exists():raise ValueError('Immutable output exists')
    def lines(name,key):return {r[key]:r for r in map(json.loads,(p/name).read_text().splitlines())}
    c={r['organisation_id']:r for r in json.loads((p/'candidates.json').read_text())}
    s=lines('source-refresh.jsonl','organisation_id');v=lines('ses-mailbox-validation.jsonl','email');t=lines('role-inclusive-review.jsonl','organisation_id')
    prior=set()
    for f in p.glob('*source.jsonl'):
        for line in f.read_text().splitlines():
            if line.strip():prior.add(json.loads(line).get('organisation_id'))
    for f in [p/'first-reviewed-admission.json',*p.glob('additional-reviewed-*.json')]:
        for r in json.loads(f.read_text()).get('records',[]):prior.add(r.get('organisation_id'))
    decisions=json.loads(Path(a.decisions).read_text());now=datetime.now(timezone.utc);rows=[];emails=set()
    for d in decisions:
        oid=d['organisation_id'];email=c[oid]['email'].lower()
        if oid in prior or email in emails:raise ValueError('Previously reviewed or duplicate recipient: '+oid)
        rows.append(build_review(d,c[oid],s[oid],v[email],t[oid],now));prior.add(oid);emails.add(email)
    body=''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows)
    with output.open('x') as f:f.write(body)
    marker={'complete':True,'count':len(rows),'sha256':hashlib.sha256(body.encode()).hexdigest(),'reviewed_at':now.isoformat(),'source_decisions':a.decisions,'scope':'Source review only; live admission still required'}
    if a.publish_ready:
        with Path(str(output)+'.ready').open('x') as f:json.dump(marker,f,indent=2)
    print(json.dumps(marker))

if __name__=='__main__':main()
