"""Targeted missing-route recovery for the current queue; no sending or CRM writes."""
import datetime,fcntl,hashlib,json,os,re,sys
from pathlib import Path
ROOT=Path('/data/research');BASE=ROOT/'artifacts/partnership-enrichment-20261118';OUT=BASE/'route-recovery';sys.path.insert(0,str(ROOT))
import scripts.market_map
scripts.market_map.__path__.insert(0,str(BASE/'lib'))
from scripts.market_map.site_research_ai import SiteResearchAI,DISCOVERY_SCHEMA,_object,STRING,_select_source_text
from scripts.market_map.site_research_runner import BudgetTransport
from scripts.market_map.trusted_source_capture import capture,normalized_text
from scripts.market_map.contact_page import parse_contact_page
from scripts.market_map.research_model_benchmark import estimated_cost,RATES
from urllib.parse import urlsplit
ROW=_object({k:STRING for k in ['kind','value','person_name','person_role','ownership','source_url','identity_quote','route_quote']})
SCHEMA=_object({'routes':{'type':'array','items':ROW},'gaps':{'type':'array','items':STRING}})
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(p,d):
 p.parent.mkdir(parents=True,exist_ok=True);t=p.with_suffix(p.suffix+'.tmp');t.write_text(json.dumps(d,ensure_ascii=False,indent=2));t.replace(p)
def norm(s):return ' '.join(str(s or '').split()).casefold()
def observed(r):
 out=set()
 for x in r.get('output',[]):
  a=x.get('action',{});out.update(s['url']for s in a.get('sources',[])if s.get('url'))
  if a.get('url'):out.add(a['url'])
  for c in x.get('content',[]):out.update(a['url']for a in c.get('annotations',[])if a.get('url'))
 return out
def main():
 OUT.mkdir(exist_ok=True);lock=(OUT/'worker.lock').open('a+b');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 q=json.loads((BASE/'prepared-outreach-queue.json').read_text());tasks=[a for a in q['items']if a.get('draft')and not(a.get('corrected_preview',{}).get('to')or a.get('proposed_recipient'))]
 if len(tasks)!=13:raise ValueError('Frozen 13 missing-route account scope required')
 status={'state':'running','pid':os.getpid(),'at':now(),'accounts':13,'completed':0,'accounts_with_supported_email':0,'max_api_attempts':26,'max_source_attempts':52,'estimated_reservation_cap_usd':8,'source_attempts':0,'messages_sent':0,'crm_mutations':0};save(OUT/'status.json',status)
 budget=BudgetTransport(ROOT,OUT,max_calls=26,concurrency=1,start_interval=1);reserved=[];results=[]
 def call(body):
  estimate=len(json.dumps(body).encode())*RATES[body['model']][0]/1e6+body['max_output_tokens']*RATES[body['model']][2]/1e6+body.get('max_tool_calls',0)*.01
  if sum(reserved)+estimate>8:raise RuntimeError('Cost reservation cap')
  reserved.append(estimate);save(OUT/'cost-reservations.json',{'reserved_estimated_usd':sum(reserved),'requests':reserved});return budget(body)
 try:
  for a in tasks:
   if (BASE/'STOP').exists()or(OUT/'STOP').exists():raise RuntimeError('Operator STOP')
   folder=OUT/a['key'].split(':')[-1];folder.mkdir(exist_ok=True)
   if (folder/'result.json').exists():raise RuntimeError('Prior route result; explicit reconciliation required, no automatic replay')
   ai=SiteResearchAI(ROOT,folder/'ai',call=call,max_calls=2,max_http_attempts=2,retries=0,max_tool_calls=3)
   payload={'organization':a['organization'],'address':a['business_address'],'known_source_pages':a['source_pages_reviewed'],'current_hold':a['identity_review_condition'],'known_phones':[r['value']for r in a['routes']if r['type']=='phone']}
   found,response=ai._stage('gpt-5.4','route_recovery','Find a current publicly published professional EMAIL or named relevant office/operations/facilities/vendor route for this already-known business. Search own contact/team/staff pages, official brand/branch locators, sector/regulatory registers, business associations, supplier dealer profiles and current professional public profiles. A general inbox is useful but inspect named relevant routes too. Resolve branch/city and corrected address; do not invent or guess emails, domains or names. Exclude publisher/platform support, media, recruitment, privacy, patient booking and personal residential contacts. Return at most four actual discovered source URLs. If nothing attributable is published, report the gap. No outreach or signal-feed work.',payload,DISCOVERY_SCHEMA,search=True)
   urls=observed(response);pages=[];errors=[]
   for s in found['sources'][:4]:
    if s['url']not in urls:errors.append({'url':s['url'],'hold':'search_url_not_observed'});continue
    if status['source_attempts']>=52:break
    status['source_attempts']+=1;save(OUT/'status.json',status)
    try:
     r=capture(s['url'],folder/'sources',ROOT,private_directory=folder/'sources/private-evidence',max_bytes=2*1024**2,timeout=12);body=(ROOT/r['body_path']).read_bytes();digest=hashlib.sha256(body).hexdigest()
     if digest!=r['body_sha256']:raise ValueError('Source hash mismatch')
     if 'pdf'in r.get('content_type',''):errors.append({'url':s['url'],'hold':'pdf_contact_extraction_not_implemented'});continue
     pg=parse_contact_page(body,{'url':s['url'],'sha256':digest,'captured_at':r.get('retrieved_at')or now()});text=normalized_text(body,preserve_case=True)
     pages.append({'url':s['url'],'sha256':digest,'captured_at':r.get('retrieved_at')or now(),'body_path':r['body_path'],'text':text,'emails':pg['emails'],'phones':pg['phones']})
    except Exception as e:errors.append({'url':s['url'],'hold':str(e)[:250]})
   routes=[];gaps=found['gaps']
   if pages:
    packet=[]
    for p in pages:
     text,_=_select_source_text(p['text'],[a['organization'],a['business_address']],6000);packet.append({'url':p['url'],'text':text,'published_emails':[e['email']for e in p['emails']],'published_phones':[e['phone']for e in p['phones']if e.get('kind')!='fax']})
    extracted,_=ai._stage('gpt-6-luna','route_attribution','Attribute current professional contact routes to THIS business/branch and relevant named roles from captured evidence. Every route must be explicitly published: use decoded emails supplied by the parser if source shows a protected display. Include exact identity and contact quotes. Distinguish general/company/team/named_person/unknown ownership. Never assign source publisher, platform, unrelated branch or privacy/media/patient/careers routes to this business. Historical contacts remain gaps. No invented names or email patterns. Return empty routes when no supported route exists.',{'account':payload,'sources':packet},SCHEMA)
    gaps+=extracted['gaps']
    for route in extracted['routes']:
     pg=next((p for p in pages if p['url']==route['source_url']),None);reasons=[]
     if not pg:reasons.append('source_missing')
     else:
      if len(norm(route['identity_quote']))<12 or norm(route['identity_quote'])not in norm(pg['text']):reasons.append('identity_quote_not_literal')
      if len(norm(route['route_quote']))<5 or norm(route['route_quote'])not in norm(pg['text']):reasons.append('route_quote_not_literal')
      values=[e.get('email')for e in pg['emails']]if route['kind']=='email'else [e.get('phone')for e in pg['phones']if e.get('kind')!='fax']
      if route['value']not in values:reasons.append('contact_not_in_scoped_parser_evidence')
     if route['kind']=='email'and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',route['value']):reasons.append('invalid_email_syntax')
     routes.append({**route,'evidence_gate':'source_supported_candidate_requires_identity_review'if not reasons else 'held','hold_reasons':reasons,'send_ready':False})
   row={'key':a['key'],'organization':a['organization'],'routes':routes,'gaps':gaps,'source_errors':errors,'sources':pages,'at':now(),'send_ready':False};save(folder/'result.json',row);results.append(row)
   status.update(completed=len(results),accounts_with_supported_email=sum(any(r['kind']=='email'and not r['hold_reasons']for r in x['routes'])for x in results),updated_at=now(),api_attempts=budget.data['requests_started']);save(OUT/'status.json',status)
  save(OUT/'results.json',{'at':now(),'accounts':results,'messages_sent':0});status.update(state='completed_with_explicit_route_holds',finished_at=now(),estimated_token_usd=sum(estimated_cost(r['model'],r.get('usage',{}))for r in budget.data['responses']));save(OUT/'status.json',status)
 except Exception as e:status.update(state='technical_or_budget_hold',error=str(e)[:500],updated_at=now());save(OUT/'status.json',status);raise
if __name__=='__main__':main()
