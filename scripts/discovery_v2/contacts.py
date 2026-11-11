"""Evidence-based contact qualification. No messages, inferred names or stage promotion."""
import argparse,csv,json,re,sqlite3
from pathlib import Path
from datetime import datetime,timezone
from engine import key,host,norm,stamp
EMAIL=re.compile(r'^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$')
EXCLUDED=re.compile(r'career|privacy|recruit|emergency|accessibility|abuse|noreply|no-reply|donotreply',re.I)
TEAM={'info','hello','contact','office','admin','inquiries','enquiries','reception','sales','general','team','management','operations','procurement','purchasing','contactus','mail','business'}
def age(at,now):
 try:return (now-datetime.fromisoformat(at.replace('Z','+00:00'))).total_seconds()/86400
 except (ValueError,AttributeError,TypeError):return float('inf')
def mailbox_status(v,now):
 if not v:return 'unchecked'
 if not 0<=age(v.get('checked_at'),now)<=7:return 'stale'
 if v.get('status') in ('hold_risk','hold_low_confidence','invalid') or v.get('overall')=='LOW' or v.get('mailbox')=='LOW':return 'invalid_or_risky'
 if v.get('provider')=='aws_ses' and v.get('overall')=='HIGH' and v.get('mailbox')=='HIGH':return 'verified'
 return 'uncertain'
def basic_check(route,validation,now,dns=None):
 """Minimum technical evidence; never claims mailbox existence or send permission."""
 if not EMAIL.fullmatch(route.get('email','')):return 'invalid'
 if not validation:
  if not dns or dns.get('domain')!=route['email'].split('@')[1]:return 'unchecked'
  if not 0<=age(dns.get('checked_at'),now)<=1:return 'stale'
  if dns.get('state') in ('null_mx','domain_not_found'):return 'invalid'
  return 'basic_pass' if dns.get('state')=='mx_present' else 'uncertain'
 if validation.get('email','').lower()!=route['email'].lower():return 'unchecked'
 if not 0<=age(validation.get('checked_at'),now)<=7:return 'stale'
 ev=validation.get('raw',{}).get('Evaluations',{})
 verdict=lambda name:ev.get(name,{}).get('ConfidenceVerdict')
 if mailbox_status(validation,now)=='invalid_or_risky' or any(verdict(k)=='HIGH' for k in ['IsDisposable','IsRandomInput']):return 'invalid_or_risky'
 if any(verdict(k)=='LOW' for k in ['HasValidSyntax','HasValidDnsRecords']):return 'invalid'
 if all(verdict(k)=='HIGH' for k in ['HasValidSyntax','HasValidDnsRecords']):return 'basic_pass'
 return 'uncertain'

def assess(route,validation=None,crm=None,outcomes=(),now=None,dns=None):
 now=now or datetime.now(timezone.utc)
 if validation and validation.get('email','').lower()!=route['email'].lower():validation=None
 mailbox=mailbox_status(validation,now);reasons=[]
 basic=basic_check(route,validation,now,dns)
 # Missing CRM evidence is distinct from an empty checked CRM match list.
 if crm is None:reasons.append('crm_check_missing')
 matches=crm or []
 if len(matches)>1:reasons.append('ambiguous_crm_matches')
 if any(c.get('do_not_contact') or c.get('cross_channel_suppressed_at') or c.get('email_unsubscribed_at') or c.get('email_last_bounced_at') or c.get('email_status') in ['bounced','complained','unsubscribed'] or c.get('decision') in ['opted_out','rejected'] or c.get('stage') in ['declined','lost','do_not_contact','dnc','closed_lost'] for c in matches):reasons.append('suppressed_or_restricted')
 if any(o.get('bounced') or o.get('complained') for o in outcomes):reasons.append('delivery_failure_or_complaint')
 if any(c.get('last_touch_at') or c.get('last_inbound_at') for c in matches):reasons.append('existing_relationship_review')
 if route.get('source_restriction'):reasons.append('publication_restriction')
 if not route.get('organization_site_supported'):reasons.append('organization_site_review')
 if not route.get('role_supported'):reasons.append('recipient_role_review')
 if not 0<=age(route.get('checked_at'),now)<=30:reasons.append('publication_stale')
 if mailbox!='verified':reasons.append('mailbox_'+mailbox)
 ready=not reasons
 # Team inboxes may be used to ask who handles the work. Role ownership remains unknown.
 blockers=[r for r in reasons if not r.startswith('mailbox_') and r!='recipient_role_review']
 if basic!='basic_pass':blockers.append('technical_'+basic)
 if route.get('route_type')!='team_inbox' and not route.get('role_supported'):blockers.append('recipient_role_review')
 minimum='basic_candidate' if not blockers else 'held' if basic in ('invalid','invalid_or_risky') or any(r in blockers for r in ['suppressed_or_restricted','delivery_failure_or_complaint','publication_restriction']) else 'needs_review'
 return {'route_id':route['route_id'],'email':route['email'],'status':'verified_eligible' if ready else 'held' if any(x in reasons for x in ['suppressed_or_restricted','delivery_failure_or_complaint','publication_restriction']) or mailbox=='invalid_or_risky' else 'needs_enrichment','mailbox_status':mailbox,'basic_check':basic,'minimum_status':minimum,'minimum_blockers':blockers,'company_site_status':'supported' if route.get('organization_site_supported') else 'uncertain','role_status':'supported' if route.get('role_supported') else 'uncertain','delivery_observed':any(o.get('delivered') and not o.get('bounced') for o in outcomes),'reasons':reasons,'crm_contact_ids':[c['id'] for c in matches],'assessed_at':now.isoformat(),'auto_send':False,'crm_stage_change':None}
def extract(reviews,named,evidence=None):
 routes={};holds=[];named_by_email={}
 for candidate in named:
  if candidate.get('recipient_name') and '—' not in candidate['recipient_name']:named_by_email.setdefault(candidate['to'].lower(),[]).append(candidate)
 for r in reviews:
  pages=r.get('pages',[]);alltext=' '.join(p.get('text','') for p in pages);restriction=bool(re.search(r'no solicit|unsolicited (commercial|sales|marketing)|do not (send|contact).*?(sales|marketing)',alltext,re.I))
  for page in pages:
   url=page.get('resolved_url') or page.get('url','');domain=host(url)
   if EXCLUDED.search(url):continue
   for raw in page.get('emails',[]):
    email=raw.lower().strip().rstrip('.,;');local=email.split('@')[0]
    if not EMAIL.fullmatch(email) or EXCLUDED.search(local) or domain in ('wix.com','example.com','mysite.com'):continue
    ed=email.split('@')[1]
    if domain!=ed and not domain.endswith('.'+ed):continue
    candidates=named_by_email.get(email,[]);person=candidates[0] if len(candidates)==1 else None;text=page.get('text','');team=local in TEAM
    support={'role_supported':False,'reason':'scoped_capture_evidence_needed','candidate_people':candidates,'scoped_matches':[]}
    if candidates and evidence and url in evidence:
     from scripts.market_map.contact_attribution import assess_scoped_person_route
     capture=evidence[url];support=assess_scoped_person_route(email,candidates,capture['body'],url,capture['sha256'])
    name_supported=support['role_supported']
    if not candidates and not team:holds.append({'company':r.get('name'),'email':email,'source':url,'reason':'named_person_identity_research'});continue
    company=r.get('name') or r.get('account_name','');city=r.get('city','');site=bool(city and norm(city) in norm(alltext) and norm(company) in norm(alltext))
    ix=text.lower().find(email);excerpt=text[max(0,ix-180):ix+len(email)+180] if ix>=0 else 'Published mailto link; purpose review required'
    route={'route_id':key(r['id'],email),'source_record_id':r['id'],'company':company,'city':city,'website':r.get('website'),'email':email,'recipient_name':person['recipient_name'] if person else None,'recipient_role':person.get('recipient_role') if person else 'Published business team; responsibility unconfirmed','route_type':'named_person' if candidates else 'team_inbox','person_candidates':candidates,'scoped_role_evidence':support,'publication_url':url,'publication_excerpt':excerpt,'checked_at':r.get('site_checked_at') or r.get('checked_at'),'organization_site_supported':site,'role_supported':name_supported,'source_restriction':restriction}
    old=routes.get(route['route_id'])
    if old is None or (route['role_supported'],route['organization_site_supported'])>(old['role_supported'],old['organization_site_supported']):routes[route['route_id']]=route
 return list(routes.values()),holds

def main():
 p=argparse.ArgumentParser();p.add_argument('--evidence-manifest',type=Path);p.add_argument('--run',type=Path,required=True);p.add_argument('--windsor',type=Path,required=True);p.add_argument('--crm',type=Path);p.add_argument('--database',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 reviews=[json.loads(s) for s in (a.run/'company-site-reviews.jsonl').read_text().splitlines()];named=json.loads((a.windsor/'send-release/published-company-expanded-release.json').read_text())['initial'];evidence=None
 if a.evidence_manifest:
  import hashlib
  manifest=json.loads(a.evidence_manifest.read_text());evidence={}
  for entry in manifest['pages']:
   file=(a.evidence_manifest.parent/entry['file']).resolve()
   if not file.is_relative_to(a.evidence_manifest.parent.resolve()):raise ValueError('capture outside manifest directory')
   body=file.read_bytes()
   if hashlib.sha256(body).hexdigest()!=entry['sha256']:raise ValueError('capture hash mismatch')
   if entry['url'] in evidence:raise ValueError('duplicate capture URL')
   evidence[entry['url']]={'body':body,'sha256':entry['sha256']}
 routes,holds=extract(reviews,named,evidence)
 validations={r['email']:r for r in map(json.loads,(a.windsor/'email-verification/aws-validation-results.jsonl').read_text().splitlines())};delivery=json.loads((a.windsor/'send-release/delivery-results.json').read_text());crm=json.loads(a.crm.read_text()) if a.crm else None;by_email={};event_email={}
 for c in (crm or {}).get('contacts',[]):by_email.setdefault(str(c.get('email','')).lower(),[]).append(c)
 for r in delivery['results']:event_email.setdefault(r['to'].lower(),[]).append(r)
 dns_path=a.output/'dns-evidence.jsonl';dns_by_domain={r['domain']:r for r in map(json.loads,dns_path.read_text().splitlines())} if dns_path.exists() else {}
 assessments=[assess(r,validations.get(r['email']),by_email.get(r['email'],[]) if crm and 0<=age(crm.get('at'),datetime.now(timezone.utc))<=1 else None,event_email.get(r['email'],[]),dns=dns_by_domain.get(r['email'].split('@')[1])) for r in routes]
 # Durable route/evidence snapshots. An assessment is not an overwrite of the CRM.
 db=sqlite3.connect(a.database);db.executescript('CREATE TABLE IF NOT EXISTS contact_routes(id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE IF NOT EXISTS contact_assessments(id TEXT PRIMARY KEY,route_id TEXT,payload TEXT);')
 with db:
  for r,x in zip(routes,assessments):
   db.execute('INSERT INTO contact_routes VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',(r['route_id'],json.dumps(r)));db.execute('INSERT INTO contact_assessments VALUES(?,?,?)',(key(x),r['route_id'],json.dumps({**x,'validation_evidence':validations.get(r['email']),'dns_evidence':dns_by_domain.get(r['email'].split('@')[1]),'delivery_evidence':event_email.get(r['email'],[])})))
 from collections import Counter
 report={'at':stamp(),'source_site_reviews':len(reviews),'route_records':len(routes),'unique_emails':len({r['email'] for r in routes}),'named_people':sum(r['route_type']=='named_person' for r in routes),'named_role_supported':sum(r['role_supported'] for r in routes),'status_counts':dict(Counter(x['status'] for x in assessments)),'minimum_counts':dict(Counter(x['minimum_status'] for x in assessments)),'basic_check_counts':dict(Counter(x['basic_check'] for x in assessments)),'mailbox_counts':dict(Counter(x['mailbox_status'] for x in assessments)),'reasons':dict(Counter(reason for x in assessments for reason in x['reasons'])),'crm_snapshot':crm.get('at') if crm else None,'deployment':'held_by_owner'}
 # Every unresolved route gets a durable, reproducible next action; no automatic outreach.
 tasks=[]
 for r,x in zip(routes,assessments):
  if x['minimum_status']=='held':action='Keep this address held; research an alternative official contact route'
  elif 'existing_relationship_review' in x['minimum_blockers']:action='Review existing conversation and inbound replies before drafting any follow-up'
  elif x['minimum_status']=='basic_candidate':action='Review source context and company-wide history; prepare a relevant introduction or routing question'
  elif 'organization_site_review' in x['minimum_blockers']:action='Confirm organization identity and local branch or service-area relevance from official evidence'
  else:action='Resolve: '+', '.join(x['minimum_blockers'])
  tasks.append({'source_key':'contact-qualification:'+r['route_id'],'route_id':r['route_id'],'company':r['company'],'email':r['email'],'city':r['city'],'status':'prepared','next_action':action,'source':r['publication_url'],'source_excerpt':r['publication_excerpt'],'minimum_status':x['minimum_status'],'mailbox_status':x['mailbox_status'],'crm_contact_ids':x['crm_contact_ids'],'auto_send':False})
 (a.output/'next-actions.json').write_text(json.dumps(tasks,indent=2))
 for name,data in [('routes.json',routes),('assessments.json',assessments),('named-research-holds.json',holds),('summary.json',report)]: (a.output/name).write_text(json.dumps(data,indent=2))
 with (a.output/'contact-review.csv').open('w') as f:
  w=csv.writer(f);w.writerow(['company','city','email','name','role','mailbox_status','qualification','next_checks','source'])
  for r,x in zip(routes,assessments):w.writerow([r['company'],r['city'],r['email'],r['recipient_name'],r['recipient_role'],x['mailbox_status'],x['status'],'; '.join(x['reasons']),r['publication_url']])
 with (a.output/'basic-candidates.csv').open('w') as f:
  w=csv.writer(f);w.writerow(['company','city','email','route_type','name','source','mailbox_status','status'])
  seen=set()
  for r,x in zip(routes,assessments):
   if x['minimum_status']!='basic_candidate' or r['email'] in seen:continue
   seen.add(r['email'])
   cells=[r['company'],r['city'],r['email'],r['route_type'],r['recipient_name'],r['publication_url'],x['mailbox_status'],'basic_candidate_not_mailbox_verified']
   w.writerow([("'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v) for v in cells])
 print(json.dumps(report))
if __name__=='__main__':main()
