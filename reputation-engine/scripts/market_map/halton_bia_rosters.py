"""Full ordinary public pagination of Halton BIA business facts."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re,shutil
from pathlib import Path
from urllib.parse import urlencode
import math
from lxml import html
from .transport import Transport,SourceBlocked
from .construction_rosters import clean,sha,safe
from .chamber_rosters import parse_address_lines
from .gta_sources import save

URL='https://downtownmilton.com/directory/'
API_SPECS={
 'milton':{'host':'downtownmilton.com','endpoint':'https://downtownmilton.com/wp-json/directorist/v1/listings',
  'format':'directorist',
  'directory_url':URL,'source_id':'downtown-milton-bia-public-directory','publisher':'Downtown Milton BIA',
  'fields':'id,name,permalink,address,phone,website,categories,latitude,longitude'},
 'burlington':{'host':'burlingtondowntown.ca','endpoint':'https://burlingtondowntown.ca/wp-json/wp/v2/business-directory',
  'directory_url':'https://burlingtondowntown.ca/business-directory-listing-alt/',
  'source_id':'burlington-downtown-bia-public-directory','publisher':'Burlington Downtown Business Association',
  'fields':'id,title,link,business-category','taxonomy':'https://burlingtondowntown.ca/wp-json/wp/v2/business-category'},
 'emery':{'host':'emeryvillagebia.ca','endpoint':'https://emeryvillagebia.ca/wp-json/directorist/v1/listings',
  'format':'directorist','directory_url':'https://emeryvillagebia.ca/localdirectory/',
  'source_id':'emery-village-bia-public-api-directory','publisher':'Emery Village BIA public published-listing API',
  'fields':'id,name,permalink,address,phone,website,categories,latitude,longitude'},
}

def normalize_api_row(raw,source,stamp,taxonomy=None):
 spec=API_SPECS[source]
 def text(value):
  if isinstance(value,dict):value=value.get('rendered')
  return clean(html.fromstring('<span>'+str(value)+'</span>').text_content()) if value else None
 name=text(raw.get('name') or raw.get('title'));profile=raw.get('permalink') or raw.get('link');native=raw.get('id')
 if not isinstance(native,int) or not name or not isinstance(profile,str) or not profile.startswith('https://'+spec['host']+'/'):
  raise SourceBlocked('Missing native listing ID/name or unexpected public profile URL')
 directorist=spec.get('format')=='directorist'
 category=raw.get('categories') if directorist else raw.get('business-category',[])
 labels=[text(x.get('name')) for x in category] if directorist else [(taxonomy or {}).get(x) for x in category]
 labels=[x for x in labels if x]
 latitude=longitude=None
 if directorist:
  try:
   lat=float(raw.get('latitude'));lon=float(raw.get('longitude'))
   if math.isfinite(lat) and math.isfinite(lon) and -90<=lat<=90 and -180<=lon<=180:latitude,longitude=lat,lon
  except (TypeError,ValueError):pass
 return {'source_id':spec['source_id'],'source_record_id':str(native),'source_record_id_basis':'Native published public API listing ID',
  'source_url':profile,'observed_at':stamp,'name':name,'website':raw.get('website') if directorist else None,
  **parse_address_lines([raw['address']] if directorist and raw.get('address') else []),
  'phone':raw.get('phone') if directorist else None,'email':None,'categories':labels,
  'latitude':latitude,'longitude':longitude,'coordinate_role':'publisher_listing_map_point' if latitude is not None else None,
  'raw_payload':raw,'record_type':'bia_business_directory_listing','entity_type':'organisation_site_candidate',
  'rights_status':'limited_factual_review_only','eligibility':'research_only','campaign_ready':False,
  'relationships':[{'relationship_type':'listed_in','object_name':spec['publisher']+' public directory','source_url':spec['directory_url'],
    'basis':'Published directory listing; membership/tenancy/current operation not independently verified'}]}

def collect_public_api(source,output,*,transport=None,max_pages=40):
 spec=API_SPECS[source];output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for file,digest in m['files'].items():
   if sha(output/file)!=digest:raise SourceBlocked('Frozen public API artifact changed')
  return m
 t=transport or Transport(max_requests=50,max_bytes=25000000,max_response_bytes=2000000,timeout=30,retries=1,min_interval=.5,allowed_hosts=[spec['host']])
 state_path=output/'checkpoint.json';state=json.loads(state_path.read_text()) if state_path.exists() else {'responses':{},'metrics':{'requests':0,'bytes_fetched':0,'elapsed_seconds':0}}
 old=state['metrics'].copy()
 def checkpoint():
  fresh=t.metrics();state['metrics']={**fresh,'requests':old['requests']+fresh['requests'],'bytes_fetched':old['bytes_fetched']+fresh['bytes_fetched'],'elapsed_seconds':round(old['elapsed_seconds']+fresh['elapsed_seconds'],3),'fresh_invocation':fresh};save(state_path,state)
 def fetch(key,url):
  receipt_path=output/(key+'.receipt.json');saved=state['responses'].get(key)
  if saved is None and receipt_path.exists():saved=json.loads(receipt_path.read_text());state['responses'][key]=saved;checkpoint()
  if saved:
   path=output/saved['raw_file']
   if sha(path)!=saved['gzip_sha256']:raise SourceBlocked('Saved API response changed')
   body=gzip.decompress(path.read_bytes())
   if hashlib.sha256(body).hexdigest()!=saved['raw_sha256']:raise SourceBlocked('Saved API bytes changed')
   return json.loads(body),saved
  if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before each request')
  response=t.fetch(url);data=response.json()
  if not isinstance(data,list):raise SourceBlocked('Public listing response must be an array')
  raw=output/(key+'.json.gz');temp=raw.with_suffix('.tmp')
  with gzip.open(temp,'wb') as stream:stream.write(response.body)
  if gzip.decompress(temp.read_bytes())!=response.body:raise SourceBlocked('API response compression failed')
  temp.replace(raw);receipt={'url':url,'raw_file':raw.name,'gzip_sha256':sha(raw),'raw_sha256':hashlib.sha256(response.body).hexdigest(),
   'observed_at':t._stamp(),'headers':{k.lower():v for k,v in response.headers.items() if k.lower() in ('x-wp-total','x-wp-totalpages','content-type')}}
  save(receipt_path,receipt);state['responses'][key]=receipt;checkpoint();return data,receipt
 def url(page,per_page=100,fields=None):return spec['endpoint']+'?'+urlencode({'context':'view','status':'publish','per_page':per_page,'page':page,'order':'asc','orderby':'id','_fields':fields or spec['fields']})
 try:
  taxonomy={}
  if spec.get('taxonomy'):
   categories,proof=fetch('published-category-labels',spec['taxonomy']+'?'+urlencode({'context':'view','per_page':100,'_fields':'id,name,count'}))
   if int(proof['headers'].get('x-wp-totalpages','1'))>1:raise SourceBlocked('Taxonomy pagination exceeds declared single-page schema; extend explicitly')
   taxonomy={x['id']:x['name'] for x in categories}
  rows=[];seen=set();expected=None;last=1;page=1;first=None
  while page<=last:
   if page>max_pages:raise RuntimeError('Declared public API page cap reached; raw checkpoint preserved')
   data,proof=fetch(f'page-{page:03d}',url(page))
   try:total=int(proof['headers']['x-wp-total']);pages=int(proof['headers']['x-wp-totalpages'])
   except (KeyError,ValueError) as exc:raise SourceBlocked('Publisher count/page headers missing') from exc
   if expected is None:expected=total;last=pages;first=[x['id'] for x in data]
   if total!=expected or pages!=last:raise SourceBlocked('Publisher count changed during traversal')
   for raw in data:
    # Reject unexpected extra fields rather than retaining people/narratives.
    if set(raw)-set(spec['fields'].split(',')):raise SourceBlocked('Public field projection unexpectedly returned extra fields')
    row=normalize_api_row(raw,source,proof['observed_at'],taxonomy)
    if row['source_record_id'] in seen:raise SourceBlocked('Duplicate native ID across API pages')
    seen.add(row['source_record_id']);rows.append(row)
   print(json.dumps({'source':source,'page':page,'expected':expected,'rows':len(data),'accumulated':len(rows)}),flush=True);page+=1
  if len(rows)!=expected:raise SourceBlocked(f'API count mismatch {len(rows)}/{expected}')
  terminal,proof=fetch('terminal-count-and-first-id',url(1,1,'id'))
  if int(proof['headers']['x-wp-total'])!=expected or [x['id'] for x in terminal]!=first[:1]:raise SourceBlocked('Terminal source count/first ID changed')
  with gzip.open(output/'public-business-facts.jsonl.gz','wt',encoding='utf8') as stream:
   for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
  fields=['source_id','source_record_id','name','website','address','city','province','postal_code','country','phone','latitude','longitude','source_url','observed_at','rights_status','eligibility','campaign_ready']
  with gzip.open(output/'public-business-facts.csv.gz','wt',encoding='utf8',newline='') as stream:
   writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
   for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
  save(output/'native-published-listing-ids.json',sorted(seen,key=int));checkpoint()
  m={'source_id':spec['source_id'],'publisher':spec['publisher'],'source_url':spec['endpoint'],'directory_url':spec['directory_url'],
   'api_index_url':'https://'+spec['host']+'/wp-json/','public_fields_selected':spec['fields'].split(','),'status_filter':'publish','context':'view',
   'rights_status':'limited_factual_review_only','rights_basis':'Actual public directory/footer and linked API index reviewed; no linked explicit commercial/automation prohibition found. Minimal factual internal research only, no redistribution licence inferred.',
   'reported_row_count':expected,'raw_factual_rows':len(rows),'unique_native_ids':len(seen),
   'native_id_inventory_sha256':sha(output/'native-published-listing-ids.json'),'pages':last,'terminal_count_and_first_id_rechecked':True,
   'source_inventory_exhausted':True,'exhaustion_scope':'Complete published public API collection; no author/contact-person/content/private-status fields requested',
   'record_unit':'Public published BIA business listing; not independent legal company or verified operating site',
   'geography_inference':'Source locality only when explicit row address supplies it; BIA scope does not fill missing city/address',
   'market_completeness_verified':False,'no_main_writes':True,'metrics':state['metrics'],
   'files':{p.name:sha(p) for p in output.iterdir() if p.is_file() and p.name!='checkpoint.json'}}
  save(manifest_path,m);(output/'README.md').write_text(f'{len(rows)} published {spec["publisher"]} public API listings, exact native IDs/count/pagination and terminal count/first-ID verified. Public GET context=view and status=publish only; selected business factual fields, no named contacts/narratives/media. Missing locality/website remains unknown; source listing categories are not guessed industries. Internal research only, no public redistribution licence or complete market claim.\n');return m
 except Exception as exc:
  state['last_failure']={'error':str(exc),'at':t._stamp()};checkpoint();raise

def parse_milton(body,observed_at):
 root=html.fromstring(body);counts=[x.text_content() for x in root.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," directorist-header-found-title ")]')]
 match=re.search(r'([\d,]+)\s+Items?\s+Found',' '.join(counts),re.I)
 if not match:raise SourceBlocked('Publisher item count missing')
 expected=int(match.group(1).replace(',',''));rows=[]
 cards=root.xpath('//div[contains(concat(" ",normalize-space(@class)," ")," directorist-listing-single__content ")]')
 for card in cards:
  titles=card.xpath('.//h2[contains(@class,"directorist-listing-title")]/a[@href]')
  if len(titles)!=1:raise SourceBlocked('Expected exactly one business title/profile')
  title=titles[0];profile=title.get('href');name=clean(title.text_content())
  if not profile.startswith(URL) or not name:raise SourceBlocked('Unexpected business profile or blank name')
  address=card.xpath('.//li[contains(@class,"directorist-listing-card-address")]')
  address=clean(address[0].text_content()) if address else None
  phones=card.xpath('.//li[contains(@class,"directorist-listing-card-phone")]//a[starts-with(@href,"tel:")]')
  phone=clean(phones[0].text_content()) if phones else None
  categories=[clean(x.text_content()) for x in card.xpath('.//div[contains(@class,"directorist-listing-category")]/a')]
  facts={'name':name,'profile_url':profile,'published_address':address,'phone':phone,'categories':categories}
  rows.append({'source_id':'downtown-milton-bia-public-directory','source_record_id':profile,'source_url':profile,
   'observed_at':observed_at,'name':name,'website':None,**parse_address_lines([address] if address else []),
   'phone':phone,'email':None,'categories':categories,'raw_payload':facts,
   'record_type':'bia_business_directory_listing','entity_type':'organisation_site_candidate',
   'rights_status':'limited_factual_review_only','eligibility':'research_only','campaign_ready':False,
   'relationships':[{'relationship_type':'listed_in','object_name':'Downtown Milton BIA public directory','source_url':URL,
      'basis':'Explicit public business listing; membership/tenancy/occupancy not independently established'}]})
 if expected and not rows:raise SourceBlocked('Nonempty directory count but no parsed cards')
 numbers=[int(x) for x in root.xpath('//a[contains(@class,"page-numbers")]/text()') if x.strip().isdigit()]
 last=max(numbers+[1])
 return rows,expected,last

def collect(inspection,output,*,transport=None,max_pages=50):
 inspection=Path(inspection);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen BIA output changed')
  return m
 t=transport or Transport(max_requests=60,max_bytes=15000000,max_response_bytes=2000000,timeout=30,retries=1,min_interval=.5,allowed_hosts=['downtownmilton.com'])
 path=output/'checkpoint.json';state=json.loads(path.read_text()) if path.exists() else {'pages':[],'metrics':{'requests':0,'bytes_fetched':0,'elapsed_seconds':0}}
 old=state['metrics'].copy()
 def checkpoint():
  fresh=t.metrics();state['metrics']={**fresh,'requests':old['requests']+fresh['requests'],'bytes_fetched':old['bytes_fetched']+fresh['bytes_fetched'],'elapsed_seconds':round(old['elapsed_seconds']+fresh['elapsed_seconds'],3),'fresh_invocation':fresh};save(path,state)
 def store_page(page,body,stamp,url):
  raw=output/f'page-{page:03d}.html.gz';tmp=raw.with_suffix('.tmp')
  with gzip.open(tmp,'wb') as stream:stream.write(body)
  if gzip.decompress(tmp.read_bytes())!=body:raise SourceBlocked('Raw gzip verification failed')
  tmp.replace(raw);receipt={'page':page,'url':url,'observed_at':stamp,'raw_file':raw.name,'raw_sha256':hashlib.sha256(body).hexdigest(),'gzip_sha256':sha(raw)}
  save(output/f'page-{page:03d}.receipt.json',receipt);return receipt
 try:
  if not state['pages']:
   raw=inspection/'milton-downtown-bia-directory.response';receipts=json.loads((inspection/'inspection.json').read_text());proof=next(x for x in receipts['receipts'] if x['id']=='milton-downtown-bia-directory')
   if sha(raw)!=proof['sha256']:raise SourceBlocked('Saved BIA source hash mismatch')
   state['pages'].append(store_page(1,raw.read_bytes(),proof['observed_at'],URL));checkpoint()
  all_rows=[];seen=set();expected=None;last=1;page=1;first_ids=None
  while page<=last:
   if page>max_pages:raise RuntimeError('Explicit page cap reached; raw checkpoint preserved')
   saved=next((x for x in state['pages'] if x['page']==page),None);orphan=output/f'page-{page:03d}.receipt.json'
   if saved is None and orphan.exists():saved=json.loads(orphan.read_text());state['pages'].append(saved);checkpoint()
   if saved:
    if sha(output/saved['raw_file'])!=saved['gzip_sha256']:raise SourceBlocked('Saved page changed')
    body=gzip.decompress((output/saved['raw_file']).read_bytes())
    if hashlib.sha256(body).hexdigest()!=saved['raw_sha256']:raise SourceBlocked('Saved raw bytes changed')
   else:
    if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before each page')
    url=URL+f'page/{page}/';response=t.fetch(url);body=response.body;saved=store_page(page,body,t._stamp(),url);state['pages'].append(saved);checkpoint()
   rows,count,advertised_last=parse_milton(body,saved['observed_at'])
   if expected is None:expected=count;last=advertised_last;first_ids=[x['source_record_id'] for x in rows]
   if count!=expected:raise SourceBlocked('Publisher item count changed during traversal')
   for row in rows:
    if row['source_record_id'] in seen:raise SourceBlocked('Duplicate/repeated profile across directory pages')
    seen.add(row['source_record_id']);all_rows.append(row)
   print(json.dumps({'source':'downtown-milton','page':page,'last_page':last,'rows':len(rows),'accumulated':len(all_rows)}),flush=True);page+=1
  if len(all_rows)!=expected:raise SourceBlocked(f'Count mismatch {len(all_rows)}/{expected}; raw retained')
  terminal=output/'terminal-recheck.json'
  if terminal.exists():recheck=json.loads(terminal.read_text())
  else:
   response=t.fetch(URL);rows,count,advertised_last=parse_milton(response.body,t._stamp())
   with gzip.open(output/'terminal-first-page.html.gz','wb') as stream:stream.write(response.body)
   recheck={'observed_at':t._stamp(),'count':count,'last_page':advertised_last,'first_page_ids':[x['source_record_id'] for x in rows],'raw_sha256':hashlib.sha256(response.body).hexdigest()};save(terminal,recheck);checkpoint()
  if recheck['count']!=expected or recheck['first_page_ids']!=first_ids:raise SourceBlocked('Terminal count/first-page ID recheck changed')
  with gzip.open(output/'public-business-facts.jsonl.gz','wt',encoding='utf8') as stream:
   for row in all_rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
  fields=['source_id','source_record_id','name','website','address','city','province','postal_code','country','phone','source_url','observed_at','rights_status','eligibility','campaign_ready']
  with gzip.open(output/'public-business-facts.csv.gz','wt',encoding='utf8',newline='') as stream:
   writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
   for row in all_rows:writer.writerow({k:safe(row.get(k)) for k in fields})
  save(output/'source-profile-url-inventory.json',sorted(seen));checkpoint()
  m={'source_id':'downtown-milton-bia-public-directory','publisher':'Downtown Milton Business Improvement Area','source_url':URL,
   'rights_status':'limited_factual_review_only','rights_review':'Actual public directory/footer reviewed; no linked restrictive policy or explicit commercial/automation prohibition found. Minimal factual internal research only; no open redistribution grant inferred.',
   'reported_row_count':expected,'raw_factual_rows':len(all_rows),'unique_profile_urls':len(seen),'offered_pages':last,
   'source_inventory_exhausted':True,'exhaustion_scope':'All offered ordinary directory pages plus terminal count/first-page IDs recheck',
   'record_unit':'Public BIA business-directory listing; not independently verified company/tenancy/current operation',
   'metrics':state['metrics'],'source_evidence':str(inspection/'inspection.json'),'source_count_not_market_complete':True,'market_completeness_verified':False,
   'files':{p.name:sha(p) for p in output.iterdir() if p.is_file() and p.name!='checkpoint.json'}}
  save(manifest_path,m);(output/'README.md').write_text(f'{len(all_rows)} published Downtown Milton BIA business listings, fully reconciled to the publisher item count across{last} offered pages. Selected business facts only; descriptions/media/named contacts excluded. Country/province/city only when explicitly printed; source addresses unchanged. No outreach/campaign eligibility or complete Milton market claim. Minimal factual internal research; no public redistribution licence inferred.\n');return m
 except Exception as exc:
  state['last_failure']={'error':str(exc),'at':t._stamp()};checkpoint();raise

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inspection',type=Path);p.add_argument('--output',required=True,type=Path);p.add_argument('--source',choices=sorted(API_SPECS));a=p.parse_args()
 if not a.source and not a.inspection:p.error('--inspection required for ordinary HTML collector')
 print(json.dumps(collect_public_api(a.source,a.output) if a.source else collect(a.inspection,a.output),indent=2))
