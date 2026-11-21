"""Full ordinary public chamber pagination, minimal business facts only."""
from __future__ import annotations
import argparse
from copy import deepcopy
from datetime import datetime,timezone
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import time
from urllib.parse import urljoin,urlsplit
from lxml import html
from .transport import Transport,SourceBlocked,BudgetExceeded
from .toronto_full import atomic,sha,value

BASE='https://www.hamiltonchamber.ca/directory/'
HOST='www.hamiltonchamber.ca'

def text(n):return ' '.join(n.text_content().split())
def lines(n):
 n=deepcopy(n)
 for br in n.xpath('.//br'):br.tail='\n'+(br.tail or '')
 return [s.strip() for s in n.text_content().splitlines() if s.strip()]

REGIONS=set("ON|Ontario|Ont|QC|Quebec|Québec|BC|British Columbia|AB|Alberta|SK|Saskatchewan|MB|Manitoba|NB|New Brunswick|NS|Nova Scotia|PE|Prince Edward Island|NL|Newfoundland and Labrador|YT|Yukon|NT|Northwest Territories|NU|Nunavut|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|New York|Ohio|Missouri|Michigan|California|Pennsylvania|Massachusetts|New Jersey|Florida|Texas".casefold().split('|'))
POSTAL=r'[A-Z]\d[A-Z][ -]?\d[A-Z]\d|\d{5}(?:-\d{4})?'

def parse_address_lines(addresses):
    """Derive locality only beside an explicit recognized region, preserving raw lines."""
    addresses=[' '.join(str(x).split()) for x in addresses if str(x).strip()]
    result={'address':' | '.join(addresses) or None,'city':None,'province':None,'country':None,'postal_code':None,'address_parse_status':'unparsed_published_address_hold' if addresses else 'address_unpublished'}
    for line in addresses:
        if re.fullmatch(POSTAL,line,re.I):result['postal_code']=line
        if line.casefold() in {'canada','usa','united states','united states of america','u.s.a.'}:result['country']=line
    for i in range(len(addresses)-1,-1,-1):
        line=addresses[i]
        if ',' in line and line.rsplit(',',1)[-1].strip().casefold() in {'canada','usa','united states','united states of america','u.s.a.'}:
            line,country=line.rsplit(',',1);result['country']=country.strip()
        postal=re.search(r'(?:,?\s+)('+POSTAL+r')$',line,re.I)
        if postal:result['postal_code']=postal[1];line=line[:postal.start()].strip().rstrip(',')
        candidate=region=None;embedded_street=None
        if ',' in line:
            before,region=line.rsplit(',',1);region=region.strip()
            if region.casefold().replace('.','') not in REGIONS:continue
            if ',' in before:embedded_street,candidate=before.rsplit(',',1)
            else:candidate=before
        else:
            for possible in sorted(REGIONS,key=len,reverse=True):
                match=re.fullmatch(r'(.+?)\s+('+re.escape(possible)+r'\.?)',line,re.I)
                if match:candidate,region=match[1],match[2];break
        candidate=candidate.strip() if candidate else None
        if not candidate or candidate.casefold().replace('.','') in REGIONS or re.match(r'^(?:\d|#|suite\b|unit\b|p\.?\s*o\.?\s*box\b)',candidate,re.I) or len(re.sub(r'[^A-Za-z]','',candidate))<2:continue
        result.update({'city':candidate,'province':region,'address':' '.join(addresses[:i]+([embedded_street.strip()] if embedded_street else [])) or None,'address_parse_status':'explicit_published_locality_and_recognized_region'})
        return result
    return result

def parse(body,url,observed):
 try:d=html.fromstring(body)
 except (ValueError,TypeError) as exc:raise SourceBlocked('Invalid directory HTML') from exc
 rows=[]
 for card in d.xpath('//div[contains(concat(" ",normalize-space(@class)," ")," member ") and contains(concat(" ",normalize-space(@class)," ")," post-content ")]'):
  a=card.xpath('.//h1/a[contains(@href,"/member/")]')
  if len(a)!=1:raise SourceBlocked('Public member card lacks one source profile')
  profile=urljoin(url,a[0].get('href'))
  if urlsplit(profile).hostname!=HOST or not urlsplit(profile).path.startswith('/member/'):raise SourceBlocked('Member profile outside reviewed publisher scope')
  cats=card.xpath('.//h1/small');web=card.xpath('.//li[contains(concat(" ",normalize-space(@class)," ")," member-links-website ")]/a/@href')
  left=card.xpath('.//div[contains(concat(" ",normalize-space(@class)," ")," member-content-left ")]')
  phones=[];addresses=[];emails=[]
  for p in left[0].xpath('./p') if left else []:
   if p.xpath('.//b[normalize-space()="Contact"]'):
    # The same paragraph also prints a person's name. Retain only complete
    # phone-number lines, never the paragraph or named contact text.
    phones.extend(x for x in lines(p) if re.fullmatch(r'(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?:\s*(?:x|ext\.?)[ ]*\d+)?',x,re.I))
   elif not p.xpath('.//a') and text(p):addresses.extend(lines(p))
  parsed_address=parse_address_lines(addresses);city=parsed_address['city'];province=parsed_address['province'];postal=parsed_address['postal_code'];street=parsed_address['address']
  facts={'name':value(text(a[0])),'published_name_raw':text(a[0]),'source_record_id':profile,'profile_url':profile,'website':web[0] if web else None,'published_categories':[text(x) for x in cats if text(x)],'address':street,'published_address_lines':addresses,'city':city,'province':province,'country':parsed_address['country'],'postal_code':postal,'address_parse_status':parsed_address['address_parse_status'],'phone':phones[0] if phones else None,'published_business_phone_lines':phones}
  rows.append({**facts,'raw_payload':facts.copy(),'source_url':url,'observed_at':observed,'record_type':'public_member_directory_observation','entity_type':'business_candidate','relationship_claim':{'predicate':'member_of','object_name':'Hamilton Chamber of Commerce','status':'source_reported_directory_listing'},'membership_independently_verified':False,'physical_presence_verified':False,'eligibility':'research_only','campaign_ready':False})
 if not rows:raise SourceBlocked('No reviewed member cards; footer/board contacts never become organisations')
 if len({r['source_record_id'] for r in rows})!=len(rows):raise SourceBlocked('Duplicate profile IDs within source page')
 nexts={urljoin(url,a.get('href')) for a in d.xpath('//a[@href]') if text(a)=='Next' and '/directory/page/' in a.get('href','')}
 if len(nexts)>1:raise SourceBlocked('Conflicting next-page links')
 nxt=next(iter(nexts)) if nexts else None
 if nxt and (urlsplit(nxt).hostname!=HOST or not urlsplit(nxt).path.startswith('/directory/page/') or nxt==url):raise SourceBlocked('Non-advancing/out-of-scope public pagination')
 pages=[int(m[1]) for a in d.xpath('//a[@href]') if (m:=re.search(r'/directory/page/(\d+)/',a.get('href','')))]
 pages.extend(int(text(n)) for n in d.xpath('//*[@aria-current="page"]') if text(n).isdigit())
 return rows,nxt,max(pages) if pages else None


def collect(folder,*,saved_entry,policy_paths,transport=None):
 folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
 if (folder/'manifest.json').exists():
  m=json.loads((folder/'manifest.json').read_text())
  if sha(folder/m['records_file'])!=m['records_sha256']:raise SourceBlocked('Frozen chamber facts changed')
  return m
 if shutil.disk_usage(folder).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 policy_paths=[Path(p) for p in policy_paths]
 if not policy_paths or not all(p.exists() for p in policy_paths):raise SourceBlocked('Reviewed publisher policy artifacts required')
 t=transport or Transport(max_requests=200,max_bytes=25000000,max_response_bytes=5000000,timeout=30,retries=1,allowed_hosts=[HOST])
 cp=folder/'checkpoint.json';state=json.loads(cp.read_text()) if cp.exists() else {'observed_at':datetime.now(timezone.utc).isoformat(),'next_url':BASE,'pages':[],'requests':0,'bytes_fetched':0,'status':'pending'}
 before=(t.requests,t.bytes_fetched);meter_mark=time.monotonic()
 def charge():
  nonlocal before,meter_mark
  state['requests']+=t.requests-before[0];state['bytes_fetched']+=t.bytes_fetched-before[1];before=(t.requests,t.bytes_fetched);now=time.monotonic();state['elapsed_seconds']=round(float(state.get('elapsed_seconds',0))+now-meter_mark,6);meter_mark=now
 rows=[];seen=set()
 for file in state['pages']:
  d=json.loads((folder/file).read_text());rows.extend(d['rows']);seen.update(r['source_record_id'] for r in d['rows'])
 if len(rows)!=len(seen):raise SourceBlocked('Saved source pages repeat profile IDs')
 try:
  while state['next_url']:
   if shutil.disk_usage(folder).free<2*1024**3:raise BudgetExceeded('2GiB capacity pause; previous public pages durable')
   url=state['next_url'];orphan=f'page-{len(state["pages"])+1:04d}-facts.json'
   if (folder/orphan).exists():
    recovered=json.loads((folder/orphan).read_text());batch=recovered['rows']
    if recovered['source_url']!=url or any(r['source_record_id'] in seen for r in batch):raise SourceBlocked('Orphan page/cursor identity mismatch')
    if not state['pages'] and batch:state['observed_at']=batch[0]['observed_at']
    rows.extend(batch);seen.update(r['source_record_id'] for r in batch);state['pages'].append(orphan);state['next_url']=recovered['next_url'];state.setdefault('reported_page_count',recovered.get('reported_last_page'));state['requests']=max(state['requests'],recovered.get('acquisition_requests',0));state['bytes_fetched']=max(state['bytes_fetched'],recovered.get('acquisition_bytes_fetched',0));atomic(cp,state);continue
   if not state['pages'] and Path(saved_entry).exists():
    body=Path(saved_entry).read_bytes();reused=True;receipt_path=Path(saved_entry).parent/'inspection.json';entry_receipt=json.loads(receipt_path.read_text()) if receipt_path.exists() else {};state['reused_entry_receipt']=next((r for r in entry_receipt.get('receipts',[]) if r.get('sha256')==hashlib.sha256(body).hexdigest()),None)
   else:body=t.fetch(url).body;reused=False
   fetched_at=(state.get('reused_entry_receipt') or {}).get('observed_at') if reused else datetime.now(timezone.utc).isoformat()
   batch,nxt,last_page=parse(body,url,fetched_at or state['observed_at'])
   if any(r['source_record_id'] in seen for r in batch):raise SourceBlocked('Repeated source IDs across pages; no false complete inventory')
   if state.get('reported_page_count') and last_page and last_page!=state['reported_page_count']:raise SourceBlocked('Publisher page count changed during crawl')
   state.setdefault('reported_page_count',last_page)
   charge();filename=f'page-{len(state["pages"])+1:04d}-facts.json';atomic(folder/filename,{'source_url':url,'response_sha256':hashlib.sha256(body).hexdigest(),'response_bytes':len(body),'reused_saved_entry':reused,'rows':batch,'next_url':nxt,'reported_last_page':last_page,'acquisition_requests':state['requests'],'acquisition_bytes_fetched':state['bytes_fetched']})
   state['pages'].append(filename);rows.extend(batch);seen.update(r['source_record_id'] for r in batch);state['next_url']=nxt;state['status']='running' if nxt else 'completed';state.pop('error',None);atomic(cp,state)
   print(json.dumps({'source':'hamilton-chamber','pages':len(state['pages']),'factual_rows':len(rows),'next_url':nxt}),flush=True)
  if state.get('reported_page_count') and len(state['pages'])!=state['reported_page_count']:raise SourceBlocked('Traversed page count differs from publisher pagination')
  first=t.fetch(BASE);final,_,pages=parse(first.body,BASE,state['observed_at']);saved=json.loads((folder/state['pages'][0]).read_text())['rows']
  if {r['source_record_id'] for r in final}!={r['source_record_id'] for r in saved} or pages!=state.get('reported_page_count'):raise SourceBlocked('First-page ID/page-count changed during crawl')
  state['status']='completed';state['terminal_first_page_rechecked']=True
 except (SourceBlocked,BudgetExceeded,OSError) as exc:state['status']='partial' if rows else 'blocked';state['error']=str(exc)
 charge();state['finished_at']=datetime.now(timezone.utc).isoformat();state['last_transport_receipt']=t.metrics() if hasattr(t,'metrics') else None;atomic(cp,state)
 path=folder/'member-directory-factual-observations.jsonl.gz'
 with gzip.open(path.with_suffix('.gz.tmp'),'wt',encoding='utf-8') as f:
  for r in rows:f.write(json.dumps(r,ensure_ascii=False)+'\n')
 path.with_suffix('.gz.tmp').replace(path)
 m={'source_id':'hamilton-chamber-public-member-directory','publisher':'Hamilton Chamber of Commerce','source_url':BASE,'rights_status':'limited_factual_review_only','policy_artifacts':{str(p):sha(p) for p in policy_paths},'status':state['status'],'observed_at':state['observed_at'],'raw_factual_rows':len(rows),'unique_profile_ids':len(seen),'reported_page_count':state.get('reported_page_count'),'pages_traversed':len(state['pages']),'source_inventory_exhausted':state['status']=='completed','reported_row_count':None,'count_basis':'Every ordinary public index page plus terminal first-page ID/page-count recheck; no exact source row total published','market_completeness_verified':False,'records_file':path.name,'records_sha256':sha(path),'named_contacts_narratives_media_excluded':True,'company_count':None,'no_main_writes':True,'atomic_publisher_snapshot':False,'reused_entry_receipt':state.get('reused_entry_receipt'),'robots_receipt':(state.get('last_transport_receipt') or {}).get('robots_checked'),'finished_at':state.get('finished_at'),'metrics':{'elapsed_seconds':state.get('elapsed_seconds'),'requests':state['requests'],'bytes_fetched':state['bytes_fetched'],'paid_service_calls':0,'model_api_calls':0,'estimated_cost':0,'cost_currency':None},'scope_limitation':'Members can publish addresses outside Hamilton. Membership listing does not establish local physical presence, legal identity, buying authority or outreach consent.'}
 atomic(folder/('manifest.json' if state['status']=='completed' else 'partial-manifest.json'),m);return m

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True,type=Path);p.add_argument('--saved-entry',required=True,type=Path);p.add_argument('--policy-paths',nargs='+',required=True,type=Path);a=p.parse_args();print(json.dumps(collect(a.output,saved_entry=a.saved_entry,policy_paths=a.policy_paths)),flush=True)



def build_preferred_view(folder):
    """Repair only unsupported parsed address fields; frozen source observations stay intact."""
    import csv
    from collections import Counter
    folder=Path(folder);m=json.loads((folder/'manifest.json').read_text());source=folder/m['records_file']
    if sha(source)!=m['records_sha256']:raise SourceBlocked('Original frozen chamber facts differ')
    derived=folder/'derived-parser2';derived.mkdir(exist_ok=True)
    if (derived/'independent-verification.json').exists():
        frozen=json.loads((derived/'independent-verification.json').read_text())
        if frozen['original_source_records_sha256']!=m['records_sha256'] or sha(folder/frozen['records_file'])!=frozen['records_sha256'] or sha(folder/frozen['csv_file'])!=frozen['csv_sha256']:raise SourceBlocked('Frozen preferred normalization differs; use a reviewed new parser cohort')
        return frozen
    rows=[];repairs=[]
    with gzip.open(source,'rt') as stream:
        for line in stream:
            old=json.loads(line);row=dict(old);address=parse_address_lines(old['published_address_lines']);before={k:old.get(k) for k in ['address','city','province','country','postal_code']};after={k:address[k] for k in before}
            row.update(address);row['normalization_parser_version']='hamilton-chamber-facts/2';row['source_record_reference']={'original_records_sha256':m['records_sha256'],'source_record_id':old['source_record_id'],'original_parsed_fields':before}
            row['raw_payload']={k:old.get(k) for k in ['name','profile_url','website','published_categories','published_address_lines','published_business_phone_lines']}
            if before!=after:repairs.append({'source_record_id':old['source_record_id'],'published_address_lines':old['published_address_lines'],'before_derived_fields':before,'after_derived_fields':after,'reason':address['address_parse_status']})
            rows.append(row)
    if len(rows)!=m['raw_factual_rows'] or len({r['source_record_id'] for r in rows})!=len(rows):raise SourceBlocked('Source row/profile count differs before parser repair')
    records=derived/'member-directory-observations.jsonl.gz'
    with gzip.open(records,'wt',encoding='utf-8') as stream:
        for r in rows:stream.write(json.dumps(r,ensure_ascii=False)+'\n')
    fields=['source_record_id','record_type','name','address','city','province','country','postal_code','address_parse_status','phone','website','published_categories','published_address_lines','observed_at','source_url','profile_url','eligibility','campaign_ready']
    csv_path=derived/'hamilton-chamber-public-business-facts.csv.gz'
    with gzip.open(csv_path,'wt',encoding='utf-8',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
        for r in rows:
            value={k:r.get(k) for k in fields}
            for key,item in value.items():
                if isinstance(item,list):value[key]=json.dumps(item,ensure_ascii=False)
                elif isinstance(item,str) and item.lstrip().startswith(('=','+','-','@')):value[key]="'"+item
            writer.writerow(value)
    cities=Counter(r['city'] or '(unpublished or held)' for r in rows)
    with (derived/'city-summary.csv').open('w',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(['derived_city_from_published_address','source_listings']);writer.writerows(sorted(cities.items(),key=lambda x:(-x[1],x[0])))
    proof={'status':'passed','parser_version':'hamilton-chamber-facts/2','source_records':len(rows),'unique_profile_ids':len(rows),'original_source_records_sha256':m['records_sha256'],'original_source_observations_unchanged':True,'records_file':str(records.relative_to(folder)),'records_sha256':sha(records),'csv_file':str(csv_path.relative_to(folder)),'csv_sha256':sha(csv_path),'derived_address_rows_changed':len(repairs),'all_published_address_lines_preserved':True,'city_derivation_requires_explicit_recognized_region':True,'fresh_requests':0,'fresh_bytes_fetched':0,'no_main_writes':True,'company_count':None,'city_counts':dict(cities)}
    atomic(derived/'independent-verification.json',proof);atomic(derived/'address-parser-repair-audit.json',{'source_id':m['source_id'],'repairs':repairs})
    atomic(folder/'preferred-normalization.json',{'source_id':m['source_id'],'preferred_records_file':proof['records_file'],'preferred_csv_file':proof['csv_file'],'records_sha256':proof['records_sha256'],'parser_version':proof['parser_version'],'source_records':len(rows),'original_source_manifest_retained':True,'reason':'Parser1 treated some street/unit comma lines as locality. Parser2 derives city only beside recognized explicit region and holds ambiguity; no publisher address line/source identity changed.','original_acquisition_requests':m['metrics']['requests'],'new_parser_repair_requests':0,'acquisition_id':'hamilton-chamber:'+m['records_sha256']})
    return proof


if __name__=='__main__':main()
