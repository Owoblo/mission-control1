"""Complete the six actually offered Aldershot category inventories, preserving positions."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re,shutil
from pathlib import Path
from urllib.parse import urlsplit,parse_qs,urljoin
from lxml import html
from .transport import Transport,SourceBlocked
from .construction_rosters import clean,sha,safe
from .gta_sources import save
from .gta_email_recovery import public_emails
from .neighbourhood_bia_snapshots import lines

SOURCE='aldershot-bia-public-category-directory';HOST='aldershotbia.com'
CATEGORIES={'eat':'eat','health':'health-wellness','salon':'salon-spa','services':'services','shop':'shop','community':'community'}
def cls(name):return 'contains(concat(" ",normalize-space(@class)," ")," '+name+' ")'
def parse_page(body,url):
 root=html.fromstring(body);category=parse_qs(urlsplit(url).query).get('wvcat',[])
 if len(category)!=1 or category[0] not in CATEGORIES.values():raise SourceBlocked('Outside six publisher-offered main category scopes')
 category=category[0];page=int(parse_qs(urlsplit(url).query).get('wpv_paged',['1'])[0]);facts=[]
 for ordinal,node in enumerate(root.xpath('//div['+cls('fusion-text')+'][h3]'),1):
  heads=node.xpath('./h3')
  if len(heads)!=1 or not clean(heads[0].text_content()):raise SourceBlocked('Expected single business heading')
  websites=list(dict.fromkeys(a.get('href') for a in node.xpath('./p/a[@href]') if clean(a.text_content())=='Visit Website' or (clean(a.text_content()) and a.get('href').startswith(('http://','https://')) and urlsplit(a.get('href')).hostname not in {'www.instagram.com','instagram.com','www.facebook.com','facebook.com','twitter.com','www.linkedin.com','linkedin.com'})));values=[]
  for p in node.xpath('./p'):
   for value in lines(p):
    if value and value!='Visit Website' and '@' not in value:values.append(value)
  phone=[v for v in values if re.fullmatch(r'[+\d(). /-]{7,35}',v) and sum(c.isdigit() for c in v)>=7]
  addresses=[v for v in values if v not in phone and re.match(r'^(?:#?\d|[A-Za-z][-/]\d|P\.?O\.?\s+Box)',v,re.I)]
  facts.append({'name':clean(heads[0].text_content()),'address_lines':addresses,'published_phone_lines':phone,'published_websites':websites,'published_emails':[email for email,_ in public_emails(node)],'source_ordinal':ordinal,'publisher_category_filter':category})
 if not facts:raise SourceBlocked('Missing public category business cards; no false zero inventory')
 current=root.xpath('//li['+cls('wpv_page_current')+']/span/text()')
 if current and (len(current)!=1 or current[0].strip()!=str(page)):raise SourceBlocked('Native current-page marker mismatches requested page')
 next_urls={urljoin(url,a.get('href')) for a in root.xpath('//a['+cls('js-wpv-pagination-next-link')+']')}
 if len(next_urls)>1:raise SourceBlocked('Inconsistent native category Next links')
 next_url=next(iter(next_urls)) if next_urls else None
 if next_url:
  q=parse_qs(urlsplit(next_url).query)
  if urlsplit(next_url).hostname!=HOST or q.get('wvcat')!=[category] or q.get('wpv_paged')!=[str(page+1)]:raise SourceBlocked('Native next-page scope/sequence changed')
 later=[a for a in root.xpath('//a[contains(@href,"wpv_paged=")]') if int(parse_qs(urlsplit(urljoin(url,a.get('href'))).query)['wpv_paged'][0])>page]
 if later and not next_url:raise SourceBlocked('Offered later category pages lack usable Next link')
 return facts,next_url,page

def normalise(fact,url,digest,stamp,page):
 address=', '.join(fact['address_lines']) or None;city=re.search(r'\bBurlington\b',address or '',re.I);province=re.search(r'\b(ON|Ontario)\b',address or '',re.I);postal=re.search(r'\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d)\b',address or '',re.I)
 return {'source_id':SOURCE,'source_record_id':'snapshot:'+digest+':'+fact['publisher_category_filter']+':'+str(page)+':'+str(fact['source_ordinal']),'source_record_id_basis':'Exact captured category/page source SHA256 and published position, no persistent native/company ID available','source_url':url,'observed_at':stamp,'name':fact['name'],'address':address,'city':city.group(0) if city else None,'province':province.group(1) if province else None,'country':None,'postal_code':postal.group(1).upper() if postal else None,'phone':fact['published_phone_lines'][0] if fact['published_phone_lines'] else None,'website':fact['published_websites'][0] if len(fact['published_websites'])==1 else None,'email':fact['published_emails'][0] if len(fact['published_emails'])==1 else None,'published_emails':fact['published_emails'],'categories':[fact['publisher_category_filter']],'source_taxonomy':'Publisher wvcat main-category filter, no NAICS version or company size inferred','record_type':'public_bia_category_directory_observation','entity_type':'organisation_candidate','eligibility':'research_only','campaign_ready':False,'rights_status':'limited_factual_review_only','raw_payload':fact}

def collect(inspection_root,output,*,transport=None):
 inspection_root=Path(inspection_root);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen Aldershot artifact changed')
  return m
 t=transport or Transport(max_requests=100,max_bytes=80000000,max_response_bytes=5000000,timeout=30,retries=1,min_interval=.5,allowed_hosts=[HOST])
 state_path=output/'checkpoint.json';state=json.loads(state_path.read_text()) if state_path.exists() else {'pages':{},'metrics':{'requests':0,'bytes_fetched':0,'elapsed_seconds':0}};old=state['metrics'].copy()
 def checkpoint():
  fresh=t.metrics();state['metrics']={**fresh,'requests':old['requests']+fresh['requests'],'bytes_fetched':old['bytes_fetched']+fresh['bytes_fetched'],'elapsed_seconds':round(old['elapsed_seconds']+fresh['elapsed_seconds'],3),'fresh_invocation':fresh};save(state_path,state)
 def acquire(key,url,reuse=None):
  receipt_path=output/(key+'.receipt.json');saved=state['pages'].get(key)
  if not saved and receipt_path.exists():saved=json.loads(receipt_path.read_text());state['pages'][key]=saved;checkpoint()
  if saved:
   raw=output/saved['raw_file']
   if sha(raw)!=saved['gzip_sha256']:raise SourceBlocked('Saved raw gzip changed')
   body=gzip.decompress(raw.read_bytes())
   if hashlib.sha256(body).hexdigest()!=saved['raw_sha256']:raise SourceBlocked('Whole raw SHA256 changed')
  else:
   if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before every category page')
   if reuse:
    folder,source_key=reuse;source=folder/(source_key+'.response');r=next(r for r in json.loads((folder/'inspection.json').read_text())['receipts'] if r['id']==source_key);body=source.read_bytes()
    if sha(source)!=r['sha256']:raise SourceBlocked('Saved source inspection changed')
    stamp=r['observed_at'];actual_url=r.get('response_url',r['url'])
   else:response=t.fetch(url);body=response.body;stamp=t._stamp();actual_url=response.url
   raw=output/(key+'.private-evidence.html.gz');raw.write_bytes(gzip.compress(body))
   if gzip.decompress(raw.read_bytes())!=body:raise SourceBlocked('Whole response gzip verification failed')
   saved={'url':actual_url,'observed_at':stamp,'raw_file':raw.name,'raw_sha256':hashlib.sha256(body).hexdigest(),'gzip_sha256':sha(raw),'saved_inspection_reused':bool(reuse)};save(receipt_path,saved);state['pages'][key]=saved;checkpoint()
  return parse_page(body,saved['url']),saved
 try:
  rows=[];summaries={}
  for key,category in CATEGORIES.items():
   folder=inspection_root/('west-north-gta-bia-native-client-inspection' if key=='eat' else 'aldershot-native-category-entry-inspection');source_key='aldershot-offered-'+key+'-category'
   page=1;url='https://'+HOST+'/business-directory/?wvcat='+category;first=None;fingerprints=set();count=0
   while url:
    if page>30:raise SourceBlocked('Declared30pages per main category reached; raw pages resumably preserved')
    (facts,next_url,current),r=acquire(category+'-%03d'%page,url,(folder,source_key) if page==1 else None)
    if current!=page:raise SourceBlocked('Category current-page mismatch')
    fingerprint=hashlib.sha256(json.dumps(facts,sort_keys=True).encode()).hexdigest()
    if fingerprint in fingerprints:raise SourceBlocked('Entire category page repeated instead of advancing')
    fingerprints.add(fingerprint)
    if first is None:first=facts
    for fact in facts:rows.append(normalise(fact,r['url'],r['raw_sha256'],r['observed_at'],page));count+=1
    print(json.dumps({'source':'aldershot','category':category,'page':page,'category_observations':count,'next':bool(next_url)}),flush=True);url=next_url;page+=1
   (recheck,_,_),_=acquire(category+'-terminal-first-page','https://'+HOST+'/business-directory/?wvcat='+category)
   if recheck!=first:raise SourceBlocked('Category first-page factual inventory changed during traversal')
   summaries[category]={'pages':page-1,'source_observations':count,'native_next_exhausted':True,'first_page_rechecked':True}
  with gzip.open(output/'published-category-business-observations.jsonl.gz','wt',encoding='utf8') as stream:
   for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
  fields=['source_id','source_record_id','name','address','city','province','country','postal_code','phone','website','email','source_url','observed_at','eligibility','campaign_ready']
  with gzip.open(output/'published-category-business-observations.csv.gz','wt',encoding='utf8',newline='') as stream:
   writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
   for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
  save(output/'category-summary.json',summaries);checkpoint()
  m={'source_id':SOURCE,'publisher':'Aldershot Village BIA','source_url':'https://aldershotbia.com/business-directory/','raw_factual_rows':len(rows),'unique_snapshot_observation_keys':len({r['source_record_id'] for r in rows}),'categories':summaries,'source_inventory_exhausted':True,'exhaustion_scope':'All native Next pages under all six actually offered main category filters, each terminal first-page factual inventory rechecked. Unfiltered landing page renders no roster; no inaccessible/private/unlisted inventory claim.','publisher_reported_unique_business_total':None,'unique_company_count':None,'cross_category_repeated_business_observations_retained':True,'snapshot_keys_not_persistent_native_ids':True,'published_email_source_associations':sum(len(r['published_emails']) for r in rows),'record_unit':'Published category/page/position business observation, may overlap another category; not independent legal company/current occupancy','rights_status':'limited_factual_review_only','rights_basis':'Actual public homepage/directory/category pages/footer reviewed; no linked explicit automation/commercial prohibition found. Minimal factual internal research only, no open redistribution licence inferred.','no_main_writes':True,'market_completeness_verified':False,'metrics':state['metrics'],'files':{p.name:sha(p) for p in output.iterdir() if p.is_file() and p.name!='checkpoint.json'}};save(manifest_path,m);return m
 except Exception as exc:state['last_failure']={'error':str(exc),'at':t._stamp()};checkpoint();raise
def repair_saved(folder):
 folder=Path(folder);pointer=folder/'preferred-normalization.json'
 if pointer.exists():
  p=json.loads(pointer.read_text())
  if sha(folder/p['records_file'])!=p['records_sha256']:raise SourceBlocked('Preferred parser repair changed')
  if p.get('parser_version')=='2026-10-27.3':return p
 m=json.loads((folder/'manifest.json').read_text());old_file=folder/'published-category-business-observations.jsonl.gz'
 if sha(old_file)!=m['files'][old_file.name]:raise SourceBlocked('Original factual capture changed')
 old_rows={r['source_record_id']:r for r in map(json.loads,gzip.open(old_file,'rt',encoding='utf8'))};rows=[]
 for category,summary in m['categories'].items():
  for page in range(1,summary['pages']+1):
   receipt=json.loads((folder/(category+'-%03d.receipt.json'%page)).read_text());path=folder/receipt['raw_file']
   if sha(path)!=receipt['gzip_sha256']:raise SourceBlocked('Frozen source bytes changed')
   body=gzip.decompress(path.read_bytes())
   if hashlib.sha256(body).hexdigest()!=receipt['raw_sha256']:raise SourceBlocked('Frozen whole source changed')
   facts,_,current=parse_page(body,receipt['url'])
   for fact in facts:rows.append(normalise(fact,receipt['url'],receipt['raw_sha256'],receipt['observed_at'],current))
 if len(rows)!=len(old_rows) or {r['source_record_id'] for r in rows}!=set(old_rows):raise SourceBlocked('Parser repair changed source identities/counts')
 changes=[]
 for row in rows:
  old=old_rows[row['source_record_id']]
  if row['name']!=old['name'] or row['published_emails']!=old['published_emails']:raise SourceBlocked('Unexpected name/email repair drift')
  changed={k:{'before':old.get(k),'after':row.get(k)} for k in ['address','city','province','country','postal_code','website'] if old.get(k)!=row.get(k)}
  if changed:changes.append({'source_record_id':row['source_record_id'],'fields':changed})
 derived=folder/'derived-parser3';derived.mkdir(exist_ok=True);records=derived/old_file.name
 with gzip.open(records,'wt',encoding='utf8') as stream:
  for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
 fields=['source_id','source_record_id','name','address','city','province','country','postal_code','phone','website','email','source_url','observed_at','eligibility','campaign_ready']
 csv_path=derived/'published-category-business-observations.csv.gz'
 with gzip.open(csv_path,'wt',encoding='utf8',newline='') as stream:
  writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
  for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
 save(derived/'field-repair-review.json',{'rows':len(rows),'changes':changes,'fresh_network_requests':0,'original_capture_manifest_sha256':sha(folder/'manifest.json')})
 p={'parser_version':'2026-10-27.3','records_file':str(records.relative_to(folder)),'records_sha256':sha(records),'csv_file':str(csv_path.relative_to(folder)),'csv_sha256':sha(csv_path),'original_records_sha256':sha(old_file),'rows':len(rows),'repaired_rows':len(changes),'fresh_network_requests':0,'scope':'Recover actual published unit-prefix address lines and literal website links; source identities/names/emails unchanged; original capture immutable'};save(pointer,p);return p

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inspection',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();m=collect(a.inspection,a.output);print(json.dumps({k:v for k,v in m.items() if k!='files'},indent=2))
