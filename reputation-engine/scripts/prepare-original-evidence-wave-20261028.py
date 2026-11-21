"""Evidence-bound original-pilot review wave; live admission remains separate.

This only publishes a review batch for the existing supervisor. It does not
create CRM contacts or send email. Every row remains subject to the canonical
mailbox, CRM history, suppression, copy and sender checks on admission.
"""
import argparse, hashlib, json, re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

P=Path('artifacts/partnership-pilot-3000-20261027')
ROLES={'info','hello','contact','office','admin','enquiries','inquiries','enquiry','inquiry','general'}
SPECIAL=re.compile(r'(^|[._-])(hr|career|jobs?|recruit|resume|press|media|privacy|legal|support|webmaster|donat|volunteer|billing|accounts?|feedback|noreply|no-reply|admission|registration)([._-]|$)',re.I)
PAGE_HOLD=re.compile(r'/privacy|/terms|/careers?|/jobs?|/employment|/apply|/media|/press|/support|/donat|/volunteer',re.I)
PARENT=re.compile(r'franchise|subsidiary|division of|owned by|operated by|managed by|part of.{0,30}group|formerly|now known as',re.I)
PHONES={'gta':'437-465-0584','windsor':'226-887-0667','waterloo':'226-241-9853','london':'548-639-1428'}

def norm(s):return re.sub('[^a-z0-9]','',str(s).lower())
def host(url):return (urlsplit(url).hostname or '').lower().removeprefix('www.')
def rows(path):return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]
def region(c):
    city=norm(c['city']);catch=c['catchment'].lower()
    if 'ottawa' in catch:return None
    if 'windsor' in catch or 'chatham' in catch:return 'windsor'
    if 'kitchener' in catch and 'woodstock' not in catch:return 'waterloo'
    if 'kitchener' in catch and city in {norm(x) for x in ['Kitchener','Waterloo','Cambridge','Guelph','Elmira','Woolwich','Fergus','Elora','Breslau','Ayr','Puslinch','Centre Wellington']}:return 'waterloo'
    if 'london' in catch or 'sarnia' in catch or 'woodstock' in catch:return 'london'
    if 'toronto' in catch:return 'gta'
    return None
def paragraph(c):
    sector=c['sector'].lower();city=c['city']
    if any(x in sector for x in ('clean','janitorial','restoration')):
        first='If one of your cleaning or restoration jobs needs furniture moved or unwanted items cleared out, we would like to be the team you can call for help.'
    elif any(x in sector for x in ('property','realt','real_estate','home_stag','condominium')):
        first='If a client or property handover needs furniture moved or unwanted items cleared out, we would like to be the team you can call and trust.'
    elif any(x in sector for x in ('furniture','interior','cabinet','kitchen','upholstery','countertop','appliance')):
        first='If a project needs furniture or other bulky items collected or delivered, we would like to be the team you can call for help.'
    elif any(x in sector for x in ('construction','renovation','builder','painting','flooring','drywall')):
        first='If a project needs furniture moved out of the way or unwanted items cleared, we would like to be the team you can call for help.'
    elif any(x in sector for x in ('office','law','finance','insurance','b2b','employment','consult')):
        first='If your team or clients need help with a move or clearing out unwanted items, we would like to be the team you can call and trust.'
    else:
        first='If your team ever needs furniture moved or unwanted items cleared out, we would like to be the team you can call for help.'
    return first+' I wanted to see how we could work together across '+city+' and the surrounding areas.'

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--publish',action='store_true');ap.add_argument('--cross-page',action='store_true');ap.add_argument('--limit',type=int,default=300);args=ap.parse_args()
    if args.publish:
        raise SystemExit('Publishing disabled after 2026-10-28 QA: source/name/city matching admitted role-specific and misattributed mailboxes. Manual role and entity review is required before any new ready marker.')
    candidates=json.loads((P/'candidates.json').read_text());sources={r['organisation_id']:r for r in rows(P/'source-refresh.jsonl')};technical={r['organisation_id']:r for r in rows(P/'role-inclusive-review.jsonl')};validations={r['email'].lower():r for r in rows(P/'ses-mailbox-validation.jsonl')}
    excluded=set()
    for path in P.glob('*source.jsonl'):
        excluded.update(r['organisation_id'] for r in rows(path) if r.get('organisation_id'))
    for path in [P/'first-reviewed-admission.json',*P.glob('additional-reviewed-*.json')]:
        try:excluded.update(r['organisation_id'] for r in json.loads(path.read_text()).get('records',[]) if r.get('organisation_id'))
        except json.JSONDecodeError:pass
    counters={}; out=[]; used_emails=set()
    def bump(k):counters[k]=counters.get(k,0)+1
    now=datetime.now(timezone.utc)
    for c in candidates:
        oid=c['organisation_id'];email=c['email'].strip().lower();sender_region=region(c)
        if oid in excluded or email in used_emails:continue
        if not sender_region:continue
        s=sources.get(oid);t=technical.get(oid);v=validations.get(email)
        if not s or not t or not v or not s.get('target_email_observed') or s.get('restriction_signals'):continue
        bump('source_and_receipt_present')
        if t.get('technical_screen_status')!='advance_to_identity_and_eligibility_review':continue
        bump('technical_advance')
        try:
            if any(not -60<=(now-datetime.fromisoformat(x.replace('Z','+00:00'))).total_seconds()<=86400 for x in (s['checked_at'],v['checked_at'])):continue
        except (KeyError,ValueError):continue
        ev=v.get('validation') or {};e=ev.get('Evaluations') or {}
        if e.get('HasValidSyntax',{}).get('ConfidenceVerdict')!='HIGH' or e.get('HasValidDnsRecords',{}).get('ConfidenceVerdict')!='HIGH' or ev.get('IsValid',{}).get('ConfidenceVerdict')!='HIGH' or e.get('MailboxExists',{}).get('ConfidenceVerdict') not in ('HIGH','MEDIUM'):continue
        if e.get('IsDisposable',{}).get('ConfidenceVerdict')=='HIGH' or e.get('IsRandomInput',{}).get('ConfidenceVerdict')=='HIGH':continue
        bump('mailbox_automatic')
        local=email.split('@')[0];role='general' if local in ROLES else 'published_business_contact'
        if SPECIAL.search(local):continue
        name=re.sub(r'\b(incorporated|limited|inc|ltd|llc|corp)\b\.?','',c['organisation_name'],flags=re.I).strip()
        if len(norm(name))<7:continue
        matched=None;eligible_pages=[]
        for p in s.get('pages',[]):
            url=p.get('final_url') or p.get('requested_url') or ''
            if p.get('http_status')!=200 or not p.get('sha256') or host(url)!=c['domain'].lower().removeprefix('www.') or PAGE_HOLD.search(url):continue
            text=' '.join([p.get('page_identity_excerpt') or '',p.get('target_context') or '',*(x for x in p.get('target_contexts',[]) if isinstance(x,str))])
            eligible_pages.append((p,url,text))
            if not p.get('target_email_observed'):continue
            if email not in text.lower() or norm(name) not in norm(text) or norm(c['city']) not in norm(text):continue
            if 'retail_franchises' in c['sector'] or PARENT.search(c['organisation_name']) or PARENT.search((p.get('page_identity_excerpt') or '')[:300]):continue
            matched=[(p,url,text)];break
        if not matched and args.cross_page and 'retail_franchises' not in c['sector'] and not PARENT.search(c['organisation_name']):
            email_pages=[r for r in eligible_pages if r[0].get('target_email_observed') and email in r[2].lower()]
            name_pages=[r for r in eligible_pages if norm(name) in norm(r[2]) and not PARENT.search((r[0].get('page_identity_excerpt') or '')[:300])]
            city_pages=[r for r in eligible_pages if norm(c['city']) in norm(r[2])]
            if email_pages and name_pages and city_pages:
                matched=[]
                for row in (email_pages[0],name_pages[0],city_pages[0]):
                    if row[0]['sha256'] not in {x[0]['sha256'] for x in matched}:matched.append(row)
        if not matched:continue
        bump('identity_city_email_same_page')
        p,url,text=matched[0]
        same_domain=email.split('@')[-1]==c['domain'].lower().removeprefix('www.')
        # Public Gmail/Yahoo contacts can be genuine small-business addresses,
        # but require a postal address on the same official page for binding.
        postal=any(re.search(r'\b[KLMNP]\d[A-Z][ -]?\d[A-Z]\d\b',x[2],re.I) for x in matched)
        if not same_domain and not postal:continue
        bump('same_domain' if same_domain else 'off_domain_published_with_postal')
        bump(role)
        evidence=[dict(row[0],url=row[1]) for row in matched]
        finding=('Automated saved-source review: official website '+('page contains' if len(matched)==1 else 'pages together contain')+' the selected published business contact email, normalized full business name, and exact locality; '+('same-domain mailbox' if same_domain else 'off-domain mailbox with Ontario postal address on the same official site')+'; mailbox syntax, DNS, overall validity and existence confidence checked; no detected source restriction or parent-brand signal. No named owner or current moving need inferred.')
        out.append(dict(organisation_id=oid,organisation_name=c['organisation_name'],email=c['email'],reviewed_at=now.isoformat(),reviewed_city=c['city'],sender_region=sender_region,regional_phone=PHONES[sender_region],market='saturn',reviewed_sector=c['sector'],identity_email_binding='pass',role_relevance='pass_for_conditional_context',finding=finding,proposed_contextual_paragraph=paragraph(c),sources=evidence,review_method='automated_evidence_rules_v1',source_record_sha256=hashlib.sha256(json.dumps(s,sort_keys=True).encode()).hexdigest(),requires_parent_account_review=False))
        used_emails.add(email)
        if len(out)>=args.limit:break
    summary={'at':now.isoformat(),'selected':len(out),'counts':counters,'sample':[{'name':r['organisation_name'],'city':r['reviewed_city'],'sector':r['reviewed_sector']} for r in out[:15]],'admission_required':True,'sent':0}
    if args.publish and out:
        path=P/('additional-reviewed-parallel-910-round2-source.jsonl' if args.cross_page else 'additional-reviewed-parallel-910-round1-source.jsonl');marker=Path(str(path)+'.ready')
        if path.exists() or marker.exists():raise ValueError('Review batch already exists; no overwrite')
        body=''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in out)
        path.write_text(body)
        marker.write_text(json.dumps({'complete':True,'count':len(out),'sha256':hashlib.sha256(body.encode()).hexdigest(),'reviewed_at':now.isoformat(),'scope':'Automated source evidence review only; live admission required'},indent=2))
        summary['path']=str(path)
    print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
