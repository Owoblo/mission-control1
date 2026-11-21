"""Ordinary publisher HTML directory pagination, not private/member endpoints."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re,shutil
from pathlib import Path
from urllib.parse import urljoin,urlsplit,parse_qs
from lxml import html
from .transport import Transport,SourceBlocked
from .construction_rosters import clean,sha,safe
from .gta_sources import save

SPECS={
 'port_credit':{'source_id':'port-credit-bia-public-directory','publisher':'Port Credit BIA','host':'nearme.portcredit.com','url':'https://nearme.portcredit.com/?Page=1&SearchTab=&FromForm=True&Name=&Keywords=&CategoriesOpen=True#resultsArea','entry_key':'port-credit-offered-public-directory-widget','page_param':'Page'},
 'kerr':{'source_id':'kerr-village-public-directory','publisher':'Kerr Village BIA','host':'www.kerr-village.ca','url':'https://www.kerr-village.ca/business-directory/find-a-business/','entry_key':'kerr-village-offered-business-directory','page_param':'currentPage'}}
def cls(name):return 'contains(concat(" ",normalize-space(@class)," ")," '+name+' ")'

def parse_page(body,url,kind):
 root=html.fromstring(body);spec=SPECS[kind];facts=[]
 if kind=='port_credit':
  for block in root.xpath('//div['+cls('Desktop-View')+']'):
   links=block.xpath('.//h4/a['+cls('result-link')+']')
   if not links:continue
   addresses=block.xpath('.//div['+cls('result-address')+']')
   if len(links)!=1 or len(addresses)>1:raise SourceBlocked('Unexpected Port Credit listing schema')
   link=links[0];profile=urljoin(url,link.get('href',''))
   if urlsplit(profile).hostname!=spec['host'] or not urlsplit(profile).path.startswith('/Home/View/'):raise SourceBlocked('Profile outside offered public directory scope')
   address=clean(addresses[0].text_content()) if addresses else None
   facts.append({'source_record_id':profile,'profile_url':profile,'name':clean(link.text_content()),'address':address,'phone':None,'native_id_basis':'Actual publisher public profile URL'})
  pages={int(re.sub(r'\D','',n.text_content())) for n in root.xpath('//*['+cls('pagination-pageof')+']')}
  current=root.xpath('//input[@name="Page"]/@value')
  if len(pages)!=1 or len(current)!=1 or not current[0].isdigit():raise SourceBlocked('Publisher current/last-page header missing')
  current=int(current[0]);last=next(iter(pages));next_urls={urljoin(url,a.get('href')) for a in root.xpath('//a[@title="Next Page"]')}
  if len(next_urls)>1:raise SourceBlocked('Inconsistent next-page links')
  next_url=next(iter(next_urls)) if next_urls else None
 else:
  for link in root.xpath('//div['+cls('info')+']/a[h2]'):
   profile=urljoin(url,link.get('href',''));query=parse_qs(urlsplit(profile).query);native=query.get('businessId',[])
   if len(native)!=1 or not native[0].isdigit() or urlsplit(profile).hostname!=spec['host']:continue
   info=link.getparent();addresses=info.xpath('./address');phone=info.xpath('./div[label[contains(text(),"Phone:")]]')
   if len(addresses)>1 or len(phone)>1:raise SourceBlocked('Unexpected Kerr listing schema')
   facts.append({'source_record_id':native[0],'profile_url':profile,'name':clean(link.text_content()),'address':re.sub(r'^Address:\s*','',clean(addresses[0].text_content())) if addresses else None,'phone':re.sub(r'^Phone:\s*','',clean(phone[0].text_content())) if phone else None,'native_id_basis':'Published native businessId URL parameter'})
  pages={}
  for a in root.xpath('//a[@href]'):
   href=urljoin(url,a.get('href'));parts=urlsplit(href);values=parse_qs(parts.query).get('currentPage',[])
   if parts.hostname==spec['host'] and parts.path=='/business-directory/find-a-business/' and len(values)==1 and values[0].isdigit():pages[int(values[0])]=href
  current=int(parse_qs(urlsplit(url).query).get('currentPage',['1'])[0]);last=None;next_url=pages.get(current+1)
  active=[int(parse_qs(urlsplit(urljoin(url,a.get('href'))).query)['currentPage'][0]) for a in root.xpath('//a['+cls('active')+'][contains(@href,"currentPage=")]')]
  if pages and active!=[current]:raise SourceBlocked('Native active-page identity does not match requested page')
 if not facts or len({f['source_record_id'] for f in facts})!=len(facts):raise SourceBlocked('Missing or duplicate native listing IDs within page')
 if next_url and (urlsplit(next_url).hostname!=spec['host'] or int(parse_qs(urlsplit(next_url).query)[spec['page_param']][0])!=current+1):raise SourceBlocked('Offered pagination outside current source sequence')
 if last is not None and current<last and not next_url:raise SourceBlocked('Reported later pages exist but native next route is missing')
 return {'facts':facts,'current':current,'last':last,'next_url':next_url}

def normalise(fact,spec,stamp,url):
 address=fact['address'];city=re.search(r'\b(Mississauga|Oakville)\b',address or '',re.I);province=re.search(r'\b(ON|Ontario)\b',address or '',re.I);postal=re.search(r'\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d)\b',address or '',re.I)
 return {'source_id':spec['source_id'],'source_record_id':fact['source_record_id'],'source_record_id_basis':fact['native_id_basis'],'source_url':fact['profile_url'],'evidence_source_url':url,'observed_at':stamp,'name':fact['name'],'address':address,'city':city.group(1) if city else None,'province':province.group(1) if province else None,'country':'Canada' if re.search(r'\bCanada\b',address or '',re.I) else None,'postal_code':postal.group(1).upper() if postal else None,'phone':fact['phone'],'website':None,'email':None,'categories':[],'record_type':'public_bia_directory_listing','entity_type':'organisation_candidate','eligibility':'research_only','campaign_ready':False,'rights_status':'limited_factual_review_only','raw_payload':fact}

def collect(inspection,output,kind,*,transport=None):
 inspection=Path(inspection);output=Path(output);output.mkdir(parents=True,exist_ok=True);spec=SPECS[kind]
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen source artifacts changed')
  return m
 t=transport or Transport(max_requests=120,max_bytes=25000000,max_response_bytes=2000000,timeout=30,retries=1,min_interval=.5,allowed_hosts=[spec['host']])
 state_path=output/'checkpoint.json';state=json.loads(state_path.read_text()) if state_path.exists() else {'pages':{},'metrics':{'requests':0,'bytes_fetched':0,'elapsed_seconds':0}};old=state['metrics'].copy()
 def checkpoint():
  fresh=t.metrics();state['metrics']={**fresh,'requests':old['requests']+fresh['requests'],'bytes_fetched':old['bytes_fetched']+fresh['bytes_fetched'],'elapsed_seconds':round(old['elapsed_seconds']+fresh['elapsed_seconds'],3),'fresh_invocation':fresh};save(state_path,state)
 def acquire(key,url):
  saved=state['pages'].get(key);receipt=output/(key+'.receipt.json')
  if not saved and receipt.exists():saved=json.loads(receipt.read_text());state['pages'][key]=saved;checkpoint()
  if saved:
   raw=output/saved['raw_file']
   if sha(raw)!=saved['gzip_sha256']:raise SourceBlocked('Saved compressed source changed')
   body=gzip.decompress(raw.read_bytes())
   if hashlib.sha256(body).hexdigest()!=saved['raw_sha256']:raise SourceBlocked('Saved whole response changed')
  else:
   if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before every page')
   if key=='page-001':
    body=(inspection/(spec['entry_key']+'.response')).read_bytes();r=next(r for r in json.loads((inspection/'inspection.json').read_text())['receipts'] if r['id']==spec['entry_key'])
    if hashlib.sha256(body).hexdigest()!=r['sha256']:raise SourceBlocked('Saved inspected response changed')
    stamp=r['observed_at']
   else:body=t.fetch(url).body;stamp=t._stamp()
   raw=output/(key+'.private-evidence.html.gz');raw.write_bytes(gzip.compress(body))
   if gzip.decompress(raw.read_bytes())!=body:raise SourceBlocked('Lossless source gzip verification failed')
   saved={'url':url,'observed_at':stamp,'raw_file':raw.name,'raw_sha256':hashlib.sha256(body).hexdigest(),'gzip_sha256':sha(raw),'saved_entry_reused':key=='page-001'};save(receipt,saved);state['pages'][key]=saved;checkpoint()
  return parse_page(body,url,kind),saved
 try:
  rows=[];ids=set();page=1;url=spec['url'];last=None;first_ids=None
  while url:
   if page>100:raise SourceBlocked('Declared100page resource cap reached; prior pages preserved as partial')
   data,r=acquire('page-%03d'%page,url)
   if data['current']!=page:raise SourceBlocked('Publisher current-page identity repeated/regressed')
   if last is None:last=data['last']
   if data['last']!=last:raise SourceBlocked('Publisher page-count inventory changed during traversal')
   page_ids=[x['source_record_id'] for x in data['facts']]
   if ids.intersection(page_ids):raise SourceBlocked('Native IDs repeated across different pages')
   if first_ids is None:first_ids=page_ids
   for fact in data['facts']:rows.append(normalise(fact,spec,r['observed_at'],url));ids.add(fact['source_record_id'])
   print(json.dumps({'source':kind,'page':page,'expected_pages':last,'rows':len(rows)}),flush=True);url=data['next_url'];page+=1
  if last is not None and page-1!=last:raise SourceBlocked('Terminal publisher page-count mismatch')
  terminal,_=acquire('terminal-first-page',spec['url'])
  if terminal['last']!=last or [x['source_record_id'] for x in terminal['facts']]!=first_ids:raise SourceBlocked('First-page count/native-ID inventory changed during traversal')
  with gzip.open(output/'published-business-facts.jsonl.gz','wt',encoding='utf8') as stream:
   for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
  fields=['source_id','source_record_id','name','address','city','province','country','postal_code','phone','website','source_url','evidence_source_url','observed_at','eligibility','campaign_ready']
  with gzip.open(output/'published-business-facts.csv.gz','wt',encoding='utf8',newline='') as stream:
   writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
   for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
  save(output/'native-source-id-inventory.json',sorted(ids));checkpoint()
  m={'source_id':spec['source_id'],'publisher':spec['publisher'],'source_url':spec['url'],'raw_factual_rows':len(rows),'unique_source_ids':len(ids),'publisher_reported_page_count':last,'native_numbered_link_window_not_treated_as_total_pages':kind=='kerr','publisher_reported_row_count':None,'pages':page-1,'all_native_pages_reconciled':True,'terminal_first_page_count_ids_stable':True,'desktop_mobile_views_not_extra_businesses':kind=='port_credit','source_inventory_exhausted':True,'exhaustion_scope':'All actually offered public directory pages, final current/last page and first-page count/ID recheck; individual profile fields not enriched','record_unit':'Published BIA directory business/site profile observation, not verified legal company/current operation/tenant','rights_status':'limited_factual_review_only','rights_basis':'Actual public BIA homepage/directory/footer and offered widget reviewed; no linked explicit commercial/automation prohibition found. Minimal factual internal research only, no open redistribution grant.','missing_fields_not_filled_from_BIA_office':True,'market_completeness_verified':False,'no_main_writes':True,'metrics':state['metrics'],'files':{p.name:sha(p) for p in output.iterdir() if p.is_file() and p.name!='checkpoint.json'}};save(manifest_path,m);return m
 except Exception as exc:state['last_failure']={'error':str(exc),'at':t._stamp()};checkpoint();raise

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inspection',required=True,type=Path);p.add_argument('--output',required=True,type=Path);p.add_argument('--kind',required=True,choices=sorted(SPECS));a=p.parse_args();print(json.dumps(collect(a.inspection,a.output,a.kind),indent=2))
