"""Follow only Mount Pleasant's actual offered next-page links."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re,shutil
from pathlib import Path
from urllib.parse import urljoin,urlsplit,parse_qs
from lxml import html
from .transport import Transport,SourceBlocked
from .construction_rosters import clean,sha,safe
from .gta_sources import save

URL='https://mountpleasantvillage.ca/directory/'
SOURCE='mount-pleasant-village-public-directory'
HOST='mountpleasantvillage.ca'
def cls(name):return 'contains(concat(" ",normalize-space(@class)," ")," '+name+' ")'
def parse_page(body,url):
 root=html.fromstring(body);rows=[]
 for link in root.xpath('//a['+cls('business-name-directory')+']'):
  profile=urljoin(url,link.get('href',''));parent=link.getparent();address=parent.xpath('./p['+cls('business-address')+']')
  if urlsplit(profile).hostname!=HOST or not urlsplit(profile).path.startswith('/listing/') or len(address)!=1:raise SourceBlocked('Unexpected Mount Pleasant card schema')
  rows.append({'name':clean(link.text_content()),'profile_url':profile,'address':clean(address[0].text_content())})
 if not rows or len({r['profile_url'] for r in rows})!=len(rows):raise SourceBlocked('Missing/repeated public directory profile cards')
 next_urls=set(urljoin(url,n.get('href','')) for n in root.xpath('//a['+cls('js-wpv-pagination-next-link')+']'))
 if len(next_urls)>1:raise SourceBlocked('Inconsistent native next-page links')
 next_url=next(iter(next_urls)) if next_urls else None
 if next_url and (urlsplit(next_url).hostname!=HOST or urlsplit(next_url).path!='/directory/' or not parse_qs(urlsplit(next_url).query).get('wpv_paged',[''])[0].isdigit()):raise SourceBlocked('Offered next-page route outside directory scope')
 return rows,next_url

def normalise(fact,stamp,url):
 return {'source_id':SOURCE,'source_record_id':fact['profile_url'],'source_record_id_basis':'Exact actual publisher organisation profile URL, no legal company ID inferred','source_url':fact['profile_url'],'evidence_source_url':url,'observed_at':stamp,'name':fact['name'],'address':fact['address'],'city':None,'province':None,'country':None,'postal_code':None,'website':None,'phone':None,'email':None,'categories':[],'record_type':'public_bia_directory_listing','entity_type':'organisation_candidate','eligibility':'research_only','campaign_ready':False,'rights_status':'limited_factual_review_only','raw_payload':fact}

def collect(inspection,output,*,transport=None):
 inspection=Path(inspection);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen directory artifact changed')
  return m
 t=transport or Transport(max_requests=40,max_bytes=25000000,max_response_bytes=2000000,timeout=30,retries=1,allowed_hosts=[HOST])
 checkpoint_path=output/'checkpoint.json';state=json.loads(checkpoint_path.read_text()) if checkpoint_path.exists() else {'pages':{},'metrics':{'requests':0,'bytes_fetched':0,'elapsed_seconds':0}}
 old=state['metrics'].copy()
 def checkpoint():
  fresh=t.metrics();state['metrics']={**fresh,'requests':old['requests']+fresh['requests'],'bytes_fetched':old['bytes_fetched']+fresh['bytes_fetched'],'elapsed_seconds':round(old['elapsed_seconds']+fresh['elapsed_seconds'],3),'fresh_invocation':fresh};save(checkpoint_path,state)
 def acquire(key,url):
  saved=state['pages'].get(key);receipt=output/(key+'.receipt.json')
  if not saved and receipt.exists():saved=json.loads(receipt.read_text());state['pages'][key]=saved;checkpoint()
  if saved:
   raw=output/saved['raw_file']
   if sha(raw)!=saved['gzip_sha256']:raise SourceBlocked('Saved gzip hash changed')
   body=gzip.decompress(raw.read_bytes())
   if hashlib.sha256(body).hexdigest()!=saved['raw_sha256']:raise SourceBlocked('Saved whole source hash changed')
  else:
   if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before each page')
   if key=='page-001':
    file=inspection/'mount-pleasant-offered-directory.response';body=file.read_bytes();r=next(r for r in json.loads((inspection/'inspection.json').read_text())['receipts'] if r['id']=='mount-pleasant-offered-directory')
    if hashlib.sha256(body).hexdigest()!=r['sha256']:raise SourceBlocked('Saved entry source bytes changed')
    stamp=r['observed_at']
   else:body=t.fetch(url).body;stamp=t._stamp()
   raw=output/(key+'.private-evidence.html.gz');raw.write_bytes(gzip.compress(body))
   if gzip.decompress(raw.read_bytes())!=body:raise SourceBlocked('Lossless evidence verification failed')
   saved={'url':url,'observed_at':stamp,'raw_file':raw.name,'raw_sha256':hashlib.sha256(body).hexdigest(),'gzip_sha256':sha(raw),'saved_entry_reused':key=='page-001'};save(receipt,saved);state['pages'][key]=saved;checkpoint()
  return parse_page(body,url),saved
 try:
  rows=[];ids=set();page=1;url=URL;first_ids=None
  while url:
   if page>30:raise SourceBlocked('Declared30page cap reached; preserve prior pages as partial')
   (facts,next_url),r=acquire('page-%03d'%page,url)
   page_ids=[x['profile_url'] for x in facts]
   if ids.intersection(page_ids):raise SourceBlocked('Offered pagination repeats captured source IDs')
   if first_ids is None:first_ids=page_ids
   for fact in facts:rows.append(normalise(fact,r['observed_at'],url));ids.add(fact['profile_url'])
   if next_url and int(parse_qs(urlsplit(next_url).query)['wpv_paged'][0])!=page+1:raise SourceBlocked('Native next-page sequence skipped or regressed')
   print(json.dumps({'source':SOURCE,'page':page,'rows':len(rows),'next':bool(next_url)}),flush=True);url=next_url;page+=1
  (recheck,_),r=acquire('terminal-first-page',URL)
  if [x['profile_url'] for x in recheck]!=first_ids:raise SourceBlocked('First-page identity inventory changed during traversal')
  with gzip.open(output/'published-business-facts.jsonl.gz','wt',encoding='utf8') as stream:
   for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
  fields=['source_id','source_record_id','name','address','city','province','country','website','phone','source_url','evidence_source_url','observed_at','eligibility','campaign_ready']
  with gzip.open(output/'published-business-facts.csv.gz','wt',encoding='utf8',newline='') as stream:
   writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
   for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
  save(output/'profile-url-inventory.json',sorted(ids));checkpoint()
  m={'source_id':SOURCE,'publisher':'Mount Pleasant Village BIA','source_url':URL,'rights_status':'limited_factual_review_only','rights_basis':'Actual directory/home/footer and linked privacy policy reviewed; no explicit linked commercial/automation prohibition found. Minimal factual internal research only, no open redistribution grant.','policy_url':'https://mountpleasantvillage.ca/privacy-policy/','raw_factual_rows':len(rows),'unique_profile_urls':len(ids),'pages':page-1,'publisher_reported_total':None,'publisher_static_header_categories':'62 shops,99 services,20 restaurants; header is context, not asserted current unique inventory total','source_inventory_exhausted':True,'exhaustion_scope':'All actual native Next pages until Next absent, no repeated URL IDs, terminal first-page identity recheck; individual profile fields not enriched','record_unit':'Public BIA directory name/address/profile observation, not verified legal company/current site','missing_locality_not_filled_from_BIA_office':True,'market_completeness_verified':False,'no_main_writes':True,'metrics':state['metrics'],'files':{p.name:sha(p) for p in output.iterdir() if p.is_file() and p.name!='checkpoint.json'}}
  save(manifest_path,m);return m
 except Exception as exc:state['last_failure']={'error':str(exc),'at':t._stamp()};checkpoint();raise

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inspection',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();print(json.dumps(collect(a.inspection,a.output),indent=2))
