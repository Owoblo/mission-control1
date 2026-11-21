"""Publisher-offered York directory HTML, independently allowed from API host.

Follow actual municipality/All Businesses links; never query a blocked service,
fetch Google APIs, confuse a parcel with a listing, or infer legal companies.
"""
from __future__ import annotations
import argparse
from collections import Counter
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

BASE='https://ww4.yorkmaps.ca/locateit/BusinessDirectory/'
HOST='ww4.yorkmaps.ca'
MUNICIPALITIES={'Aurora','East Gwillimbury','Georgina','King','Markham','Newmarket','Richmond Hill','Vaughan','Whitchurch-Stouffville'}
SOURCE_ID='york-business-directory-2024'

def text(node):return ' '.join(node.text_content().split())
def guard_url(url):
 p=urlsplit(url)
 if p.scheme!='https' or p.hostname!=HOST or not p.path.startswith('/locateit/BusinessDirectory/') or not p.path.lower().endswith('.html') or p.query:raise SourceBlocked('Outside actual reviewed static directory route:'+url)
 return url

def root_links(body,url):
 d=html.fromstring(body);found={text(a):guard_url(urljoin(url,a.get('href'))) for a in d.xpath('//a[@href]') if text(a) in MUNICIPALITIES}
 if set(found)!=MUNICIPALITIES:raise SourceBlocked('Publisher municipality links incomplete; no regional completion claim')
 return found

def municipality_links(body,url,city):
 d=html.fromstring(body);head=d.xpath('//h1')
 if not head or city not in text(head[0]):raise SourceBlocked('Municipality heading does not match offered scope')
 all_links={guard_url(urljoin(url,a.get('href'))) for a in d.xpath('//a[@href]') if text(a)=='All Businesses'}
 if len(all_links)!=1:raise SourceBlocked('No unique publisher-offered All Businesses link')
 categories={}
 for a in d.xpath('//a[@href]'):
  m=re.fullmatch(r'(\d{2})/index\.html',a.get('href',''))
  if m:categories[m[1]]=text(a)
 return next(iter(all_links)),categories

def listings(body,url,city,categories,observed):
 d=html.fromstring(body);head=d.xpath('//h1')
 if not head or text(head[0])!='Businesses in '+city:raise SourceBlocked('All-businesses page has no matching published municipality header')
 if not re.search(r'Information based on\s*2024\s*survey',text(d),re.I):raise SourceBlocked('Published directory reference period differs from reviewed2024 release')
 anchors=d.xpath('//a[contains(concat(" ",normalize-space(@class)," ")," yrk-AddressListing ")]')
 if not anchors:raise SourceBlocked('No reviewed business listing anchors; no false zero inventory')
 rows=[]
 for ordinal,a in enumerate(anchors,1):
  profile=guard_url(urljoin(url,a.get('href','')));filename=urlsplit(profile).path.rsplit('/',1)[-1][:-5]
  if not filename.isdigit():raise SourceBlocked('Publisher listing filename identifier changed format')
  card=a
  while card.getparent() is not None and card.tag!='tr':card=card.getparent()
  if card.tag!='tr':raise SourceBlocked('Business-record row boundary missing')
  displayed=text(a);title=a.get('title','');prefix='Go to the business listing for '
  if title.startswith(prefix) and ', on ' in title:name,address=title[len(prefix):].rsplit(', on ',1);parse_status='publisher_title_fields'
  elif ' - ' in displayed:name,address=displayed.rsplit(' - ',1);parse_status='publisher_display_delimiter_review'
  else:name,address=displayed,None;parse_status='unparsed_address_hold'
  def field(cls):
   n=card.xpath('.//span[@class="'+cls+'"]');return text(n[0]) if n else None
  lat=field('yrk-latitude');lon=field('yrk-longitude');latitude=longitude=None
  try:
   if -90<=float(lat)<=90 and -180<=float(lon)<=180:latitude=float(lat);longitude=float(lon)
  except (TypeError,ValueError):pass
  code=urlsplit(profile).path.rsplit('/',2)[-2];category=categories.get(code)
  raw={'profile_url':profile,'publisher_profile_filename_id':filename,'displayed_listing':displayed,'title_attribute':title,'municipality_header':text(head[0]),'publisher_category_code':code,'publisher_category_label':category,'map_latitude':lat,'map_longitude':lon,'map_parcel_identifier':field('yrk-parcelId'),'street_view_latitude':field('yrk-streetLat'),'street_view_longitude':field('yrk-streetLong')}
  rows.append({'source_record_id':profile,'source_record_id_basis':'publisher_profile_url_not_parcel_id','publisher_profile_filename_id':filename,'name':value(name),'address':value(address),
    'city':city,'municipality_name':city,'city_raw':None,'source_city_basis':'explicit publisher municipality-specific All Businesses header; not association footer',
    'province':None,'country':None,'latitude':latitude,'longitude':longitude,'publisher_map_parcel_identifier':raw['map_parcel_identifier'],
    'coordinate_role':'publisher_business_map_point; accuracy unverified','street_view_point_role':'separate publisher street-view anchor; never substituted for business point',
    'categories':[category] if category else [],'publisher_category_code':code,'source_taxonomy':'York Region directory category; no NAICS version/6-digit code inferred',
    'observed_at':observed,'source_published_at':None,'source_reference_period':'2024 survey, per published all-businesses page','source_url':url,'profile_url':profile,
    'record_type':'surveyed_establishment_observation','entity_type':'organisation_site_candidate','physical_presence_verified':False,'legal_company_verified':False,
    'eligibility':'research_only','campaign_ready':False,'parse_status':parse_status,'source_row_ordinal':ordinal,'raw_payload':raw})
 return rows


def write_raw(folder,name,body):
 p=folder/name;temp=p.with_suffix(p.suffix+'.tmp')
 with gzip.open(temp,'wb') as f:f.write(body)
 with gzip.open(temp,'rb') as f:
  if hashlib.sha256(f.read()).digest()!=hashlib.sha256(body).digest():raise SourceBlocked('Lossless raw HTML gzip verification failed')
 temp.replace(p);return {'file':p.name,'original_bytes':len(body),'original_sha256':hashlib.sha256(body).hexdigest(),'gzip_bytes':p.stat().st_size,'gzip_sha256':sha(p)}


def collect(folder,*,root_index,inspection_root,licence_file,licence_text,transport=None):
 folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
 if (folder/'manifest.json').exists():
  m=json.loads((folder/'manifest.json').read_text())
  for filename,digest in m.get('evidence_files',{}).items():
   if sha(folder/filename)!=digest:raise SourceBlocked('Frozen licence/root evidence changed')
  for item in m['collections']:
   f=folder/item['folder'];proof=json.loads((f/'collection.json').read_text())
   for k in ['index_raw','all_raw']:
    if sha(f/proof[k]['file'])!=proof[k]['gzip_sha256']:raise SourceBlocked('Frozen publisher HTML changed')
   if sha(f/proof['records_file'])!=proof['records_sha256']:raise SourceBlocked('Frozen factual records changed')
  return m
 if shutil.disk_usage(folder).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 root_index=Path(root_index);root_body=root_index.read_bytes();cities=root_links(root_body,BASE+'index.html')
 licence_file,licence_text=Path(licence_file),Path(licence_text)
 if not licence_file.exists() or 'Use the Information commercially' not in licence_text.read_text():raise SourceBlocked('Reviewed commercial York open-data licence evidence required')
 cache={}
 for receipt_path in Path(inspection_root).rglob('inspection.json'):
  data=json.loads(receipt_path.read_text())
  for receipt in data.get('receipts',[]):
   path=receipt_path.parent/(receipt['id']+'.response')
   if receipt.get('url','').startswith(BASE) and path.exists() and receipt.get('sha256')==sha(path):cache[receipt['url']]=(path,receipt)
 t=transport or Transport(max_requests=100,max_bytes=95000000,max_response_bytes=25000000,timeout=40,retries=1,allowed_hosts=[HOST])
 evidence=folder/'evidence';evidence.mkdir(exist_ok=True)
 for name,path in [('york-open-data-licence.pdf',licence_file),('york-open-data-licence.txt',licence_text)]:
  target=evidence/name
  if not target.exists():shutil.copyfile(path,target)
  if sha(target)!=sha(path):raise SourceBlocked('Frozen licence evidence differs')
 if not (evidence/'publisher-root-index.html.gz').exists():write_raw(evidence,'publisher-root-index.html.gz',root_body)
 cp=folder/'checkpoint.json';state=json.loads(cp.read_text()) if cp.exists() else {'requests':0,'bytes_fetched':0,'elapsed_seconds':0,'collections':[],'observed_at':datetime.now(timezone.utc).isoformat()}
 if state.get('source_root_index_sha256',sha(root_index))!=sha(root_index):raise SourceBlocked('Publisher root scope differs; start reviewed new cohort')
 state['source_root_index_sha256']=sha(root_index)
 before=(t.requests,t.bytes_fetched);mark=time.monotonic()
 def charge():
  nonlocal before,mark
  state['requests']+=t.requests-before[0];state['bytes_fetched']+=t.bytes_fetched-before[1];before=(t.requests,t.bytes_fetched);now=time.monotonic();state['elapsed_seconds']+=now-mark;mark=now
 def get(url):
  guard_url(url)
  if url in cache:
   path,receipt=cache[url];return path.read_bytes(),receipt,True
  if shutil.disk_usage(folder).free<2*1024**3:raise BudgetExceeded('2GiB capacity pause; prior municipality artifacts preserved')
  response=t.fetch(url);return response.body,{'url':response.url,'observed_at':datetime.now(timezone.utc).isoformat(),'headers':{k:v for k,v in response.headers.items() if k.lower() in ['content-type','etag','last-modified']}},False
 def preserved(f,stem,url):
  receipt_path=f/(stem+'-response-receipt.json')
  if receipt_path.exists():
   receipt=json.loads(receipt_path.read_text());raw=receipt['raw']
   if receipt['url']!=url or sha(f/raw['file'])!=raw['gzip_sha256']:raise SourceBlocked('Saved raw source URL/hash differs')
   with gzip.open(f/raw['file'],'rb') as stream:body=stream.read()
   if hashlib.sha256(body).hexdigest()!=raw['original_sha256']:raise SourceBlocked('Saved decompressed source SHA differs')
   state['requests']=max(state['requests'],receipt['acquisition_requests']);state['bytes_fetched']=max(state['bytes_fetched'],receipt['acquisition_bytes_fetched']);state['elapsed_seconds']=max(state['elapsed_seconds'],receipt.get('acquisition_elapsed_seconds',0))
   return body,receipt['response_info'],True,raw
  body,info,reused=get(url);raw=write_raw(f,stem+'.html.gz',body);charge()
  atomic(receipt_path,{'url':url,'response_info':info,'reused_saved_inspection':reused,'raw':raw,'acquisition_requests':state['requests'],'acquisition_bytes_fetched':state['bytes_fetched'],'acquisition_elapsed_seconds':state['elapsed_seconds']});atomic(cp,state)
  return body,info,reused,raw
 summaries=[];all_ids=set();file_ids=Counter();raw_count=0;failed=[]
 for city,index_url in cities.items():
  slug=urlsplit(index_url).path.rstrip('/').split('/')[-2];f=folder/slug;f.mkdir(exist_ok=True);receipt_path=f/'collection.json'
  try:
   if receipt_path.exists():
    receipt=json.loads(receipt_path.read_text())
    for k in ['index_raw','all_raw']:
     if sha(f/receipt[k]['file'])!=receipt[k]['gzip_sha256']:raise SourceBlocked('Saved municipality raw hash differs')
    if sha(f/receipt['records_file'])!=receipt['records_sha256']:raise SourceBlocked('Saved municipality facts hash differs')
   else:
    index_body,index_info,reused_index,index_raw=preserved(f,'publisher-index',index_url);all_url,categories=municipality_links(index_body,index_url,city)
    all_body,all_info,reused_all,all_raw=preserved(f,'publisher-all-businesses',all_url);rows=listings(all_body,all_url,city,categories,all_info['observed_at'])
    path=f/'factual-establishment-observations.jsonl.gz'
    with gzip.open(path.with_suffix('.gz.tmp'),'wt',encoding='utf-8') as stream:
     for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
    path.with_suffix('.gz.tmp').replace(path);charge()
    receipt={'municipality':city,'index_url':index_url,'all_url':all_url,'index_raw':index_raw,'all_raw':all_raw,'index_response_receipt':index_info,'all_response_receipt':all_info,'reused_saved_index':reused_index,'reused_saved_all':reused_all,
     'raw_listing_appearances':len(rows),'unique_profile_urls':len({r['source_record_id'] for r in rows}),'reported_numeric_row_count':None,'count_basis':'Every reviewed listing anchor in publisher-offered All Businesses HTML; no separate publisher numeric total supplied',
     'records_file':path.name,'records_sha256':sha(path),'source_inventory_exhausted':True,'categories':categories,'reference_period':'2024 per page','acquisition_requests':state['requests'],'acquisition_bytes_fetched':state['bytes_fetched']}
    atomic(receipt_path,receipt);atomic(cp,state)
   state['requests']=max(state['requests'],receipt.get('acquisition_requests',0));state['bytes_fetched']=max(state['bytes_fetched'],receipt.get('acquisition_bytes_fetched',0))
   with gzip.open(f/receipt['records_file'],'rt') as stream:
    for line in stream:
     r=json.loads(line);all_ids.add(r['source_record_id']);file_ids[r['publisher_profile_filename_id']]+=1;raw_count+=1
   summaries.append({'municipality':city,'folder':slug,'raw_listing_appearances':receipt['raw_listing_appearances'],'unique_profile_urls':receipt['unique_profile_urls']});print(json.dumps(summaries[-1]),flush=True)
  except (SourceBlocked,BudgetExceeded,OSError,ValueError) as exc:
   charge();failed.append({'municipality':city,'url':index_url,'error':str(exc)});atomic(f/'blocked-status.json',failed[-1]);atomic(cp,state)
   if isinstance(exc,BudgetExceeded) or 'robots.txt' in str(exc) or 'challenge' in str(exc):break
 charge();atomic(cp,state)
 m={'source_id':SOURCE_ID,'publisher':'The Regional Municipality of York / YorkMaps','source_url':BASE+'index.html','status':'completed' if len(summaries)==len(cities) and not failed else 'partial' if summaries else 'blocked',
   'rights_status':'licensed_open','licence_url':'https://insights-york.opendata.arcgis.com/documents/york-region-open-data-licence/explore','licence_pdf_sha256':sha(licence_file),'licence_text_sha256':sha(licence_text),'root_offered_index_sha256':sha(root_index),'evidence_files':{str(p.relative_to(folder)):sha(p) for p in evidence.iterdir() if p.is_file()},
   'rights_basis':'Publisher static directory footer links York Open Data terms; the2024 directory catalogue item references the reviewed York Region Open Data Licence. No claim to third-party logos/media; only listed facts reused.',
   'attribution':"Contains public sector information made available under The Regional Municipality of York's Open Data Licence",'reference_period':'2024 survey, independently checked on each all-business page','observed_at':state['observed_at'],
   'collections':summaries,'municipalities_offered':len(cities),'municipalities_acquired':len(summaries),'raw_listing_appearances':raw_count,'unique_profile_urls':len(all_ids),'unique_profile_filename_ids':len(file_ids),'repeated_profile_filename_ids':sum(v>1 for v in file_ids.values()),
   'profile_url_inventory_sha256':hashlib.sha256(('\n'.join(sorted(all_ids))+'\n').encode()).hexdigest(),'identity_scope':'Official profile URL identifies a directory listing. Filename ID retained separately; map parcel ID is shared property context and never a company ID.',
   'source_inventory_exhausted':len(summaries)==len(cities) and not failed,'market_completeness_verified':False,'company_count':None,'atomic_publisher_snapshot':False,'blocked_or_partial':failed,
   'no_blocked_api_or_google_api_calls':True,'no_main_writes':True,'no_named_people_enrichment':True,'metrics':{'requests':state['requests'],'bytes_fetched':state['bytes_fetched'],'elapsed_seconds':round(state['elapsed_seconds'],6),'paid_service_calls':0,'model_api_calls':0,'estimated_cost':0,'cost_currency':None,'reused_inspection_request_costs_not_counted_again':True,'robots_checked':getattr(t,'robots_checked',{})},
   'declared_budget':{'requests_per_invocation':100,'bytes_per_invocation':95000000,'max_response_bytes':25000000,'minimum_free_bytes':2147483648},'scope_limitation':'Complete offered published2024 municipality lists, not a census of all/current businesses. Countries/provinces not printed at listing level remain unknown; municipality comes from the explicit page grouping.'}
 atomic(folder/('manifest.json' if m['status']=='completed' else 'partial-manifest.json'),m);return m

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--root-index',type=Path,required=True);p.add_argument('--inspection-root',type=Path,required=True);p.add_argument('--licence-file',type=Path,required=True);p.add_argument('--licence-text',type=Path,required=True);a=p.parse_args();print(json.dumps(collect(a.output,root_index=a.root_index,inspection_root=a.inspection_root,licence_file=a.licence_file,licence_text=a.licence_text)),flush=True)
if __name__=='__main__':main()
