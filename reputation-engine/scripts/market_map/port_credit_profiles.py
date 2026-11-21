"""All actual public Port Credit organisation profiles; positive factual fields only."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re,shutil
from pathlib import Path
from urllib.parse import urlsplit
from lxml import html
from .transport import Transport,SourceBlocked,BudgetExceeded
from .construction_rosters import clean,sha,safe
from .gta_sources import save
from .gta_email_recovery import public_emails,hidden

HOST='nearme.portcredit.com';SOURCE='port-credit-bia-public-directory'
def parse_profile(body,url,index_name,stamp):
 root=html.fromstring(body);heads=root.xpath('//h2[@id="heading-business-directory"]')
 if len(heads)!=1 or not clean(heads[0].text_content()):raise SourceBlocked('Public organisation profile title missing; not an empty business record')
 name=clean(heads[0].text_content());fields={}
 for kind in ['Address','Phone','Email','Website','Social']:
  labels=root.xpath('//dl/dt[span[@id="'+kind+'"]]')
  if len(labels)>1:raise SourceBlocked('Ambiguous labelled public business field')
  if labels:
   node=labels[0].getnext()
   if node is None or node.tag!='dd':raise SourceBlocked('Label has no exact public field value')
   if not hidden(node):fields[kind]=node
 def text(kind):return clean(fields[kind].text_content()) if kind in fields else None
 address=text('Address');phones=text('Phone');webs=fields['Website'].xpath('.//a[starts-with(@href,"http")]/@href') if 'Website' in fields else []
 emails=[email for email,_ in public_emails(fields['Email'])] if 'Email' in fields else []
 socials=fields['Social'].xpath('.//a[starts-with(@href,"http")]/@href') if 'Social' in fields else []
 city=re.search(r'\bMississauga\b',address or '',re.I);province=re.search(r'\b(ON|Ontario)\b',address or '',re.I);postal=re.search(r'\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d)\b',address or '',re.I)
 facts={'profile_name_published':name,'index_name_published':index_name,'profile_name_differs_from_index':name!=index_name,'published_address':address,'published_business_phone':phones,'published_business_email_candidates':emails,'published_websites':webs,'published_business_social_urls':socials,'email_field_visible':bool('Email' in fields),'factual_fields_only':True}
 return {'source_id':SOURCE,'source_record_id':url,'source_record_id_basis':'Same exact publisher profile URL as frozen509-row index; this is a richer observation, not an additional company identity','source_url':url,'observed_at':stamp,'source_published_at':None,'name':name,'address':address,'city':city.group(0) if city else None,'province':province.group(1) if province else None,'country':'Canada' if re.search(r'\bCanada\b',address or '',re.I) else None,'postal_code':postal.group(1).upper() if postal else None,'phone':phones,'website':webs[0] if len(webs)==1 else None,'email':emails[0] if len(emails)==1 else None,'published_emails':emails,'categories':[],'record_type':'public_bia_organisation_profile_observation','entity_type':'organisation_candidate','eligibility':'research_only','campaign_ready':False,'rights_status':'limited_factual_review_only','mailbox_status':'not_checked','raw_payload':facts}

def collect(index_folder,inspection,output,*,transport=None,resume_partial=False):
 index_folder=Path(index_folder);inspection=Path(inspection);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen public-profile artifact changed')
  if m['status']=='completed':return m
  if not resume_partial:raise SourceBlocked('Partial profile manifest retained; use --resume-partial for a bounded reviewed retry')
  archive=output/('archived-partial-'+sha(manifest_path));archive.mkdir(exist_ok=True)
  for name,digest in m['files'].items():
   target=archive/name
   if not target.exists():shutil.copyfile(output/name,target)
   if sha(target)!=digest:raise SourceBlocked('Archived partial evidence verification failed')
  if not (archive/'manifest.json').exists():shutil.copyfile(manifest_path,archive/'manifest.json')
  if sha(archive/'manifest.json')!=sha(manifest_path):raise SourceBlocked('Archived whole partial manifest changed')
 index_manifest=json.loads((index_folder/'manifest.json').read_text());index_file=index_folder/'published-business-facts.jsonl.gz'
 if sha(index_file)!=index_manifest['files'][index_file.name]:raise SourceBlocked('Frozen public index source changed')
 indexed=list(map(json.loads,gzip.open(index_file,'rt',encoding='utf8')))
 urls={row['source_record_id']:row for row in indexed}
 if len(urls)!=len(indexed) or any(urlsplit(u).scheme!='https' or urlsplit(u).hostname!=HOST or not urlsplit(u).path.startswith('/Home/View/') for u in urls):raise SourceBlocked('Frozen index URL inventory malformed/outside exact public profile scope')
 t=transport or Transport(max_requests=600,max_bytes=50000000,max_response_bytes=2000000,timeout=30,retries=1,min_interval=.5,allowed_hosts=[HOST])
 state_path=output/'checkpoint.json';state=json.loads(state_path.read_text()) if state_path.exists() else {'profiles':{},'failures':{},'metrics':{'requests':0,'bytes_fetched':0,'elapsed_seconds':0}};old=state['metrics'].copy()
 def checkpoint():
  fresh=t.metrics();state['metrics']={**fresh,'requests':old['requests']+fresh['requests'],'bytes_fetched':old['bytes_fetched']+fresh['bytes_fetched'],'elapsed_seconds':round(old['elapsed_seconds']+fresh['elapsed_seconds'],3),'fresh_invocation':fresh};save(state_path,state)
 def acquire(url):
  key=hashlib.sha256(url.encode()).hexdigest();receipt_path=output/(key+'.receipt.json');saved=state['profiles'].get(url)
  if not saved and receipt_path.exists():saved=json.loads(receipt_path.read_text());state['profiles'][url]=saved;checkpoint()
  if saved:
   raw=output/saved['raw_file']
   if sha(raw)!=saved['gzip_sha256']:raise SourceBlocked('Saved profile evidence gzip changed')
   body=gzip.decompress(raw.read_bytes())
   if hashlib.sha256(body).hexdigest()!=saved['raw_sha256']:raise SourceBlocked('Saved whole profile bytes changed')
  else:
   if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before each public profile')
   sample=inspection/'port-credit-offered-public-profile-sample.response';reuse=False
   if sample.exists():
    receipt=next(r for r in json.loads((inspection/'inspection.json').read_text())['receipts'] if r['id']=='port-credit-offered-public-profile-sample')
    if receipt['url']==url:
     if sha(sample)!=receipt['sha256']:raise SourceBlocked('Saved sample source changed')
     body=sample.read_bytes();stamp=receipt['observed_at'];reuse=True
   if not reuse:response=t.fetch(url);body=response.body;stamp=t._stamp()
   raw=output/(key+'.private-evidence.html.gz');raw.write_bytes(gzip.compress(body))
   if gzip.decompress(raw.read_bytes())!=body:raise SourceBlocked('Lossless full profile bytes verification failed')
   saved={'url':url,'observed_at':stamp,'raw_file':raw.name,'raw_sha256':hashlib.sha256(body).hexdigest(),'gzip_sha256':sha(raw),'saved_sample_reused':reuse};save(receipt_path,saved);state['profiles'][url]=saved;checkpoint()
  return parse_profile(body,url,urls[url]['name'],saved['observed_at']),saved
 rows=[]
 try:
  for url in urls:
   try:row,receipt=acquire(url);rows.append(row);state['failures'].pop(url,None)
   except SourceBlocked as exc:
    if 'DNS lookup failed' in str(exc) or '/robots.txt' in str(exc):raise
    state['failures'][url]={'error':str(exc),'observed_at':t._stamp(),'profile_url':url};checkpoint();continue
   if len(rows)%25==0:print(json.dumps({'source':'port-credit-profiles','profiles':len(rows),'expected':len(urls),'failed':len(state['failures'])}),flush=True)
  with gzip.open(output/'published-business-profile-facts.jsonl.gz','wt',encoding='utf8') as stream:
   for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
  fields=['source_id','source_record_id','name','address','city','province','country','postal_code','phone','website','email','source_url','observed_at','eligibility','campaign_ready','mailbox_status']
  with gzip.open(output/'published-business-profile-facts.csv.gz','wt',encoding='utf8',newline='') as stream:
   writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
   for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
  save(output/'profile-url-inventory.json',{'expected':sorted(urls),'acquired':sorted(r['source_record_id'] for r in rows),'failures':state['failures']});checkpoint()
  m={'acquisition_id':'port-credit-public-profiles:'+sha(index_folder/'manifest.json'),'status':'completed' if not state['failures'] and len(rows)==len(urls) else 'partial','source_id':SOURCE,'publisher':'Port Credit BIA','source_url':'https://www.portcredit.com/directory/','index_manifest':str(index_folder/'manifest.json'),'index_manifest_sha256':sha(index_folder/'manifest.json'),'index_facts_sha256':sha(index_file),'reported_index_profile_urls':len(urls),'raw_factual_profile_rows':len(rows),'unique_source_ids':len({r['source_record_id'] for r in rows}),'failed_profile_urls':len(state['failures']),'all_index_urls_attempted':True,'all_public_profile_urls_acquired':len(rows)==len(urls),'source_inventory_exhausted':len(rows)==len(urls),'exhaustion_scope':'Every actually offered public profile URL from frozen509-row index; positive labelled business fields only, no offsite company network','not_additional_company_count':True,'published_email_associations':sum(len(r['published_emails']) for r in rows),'unique_published_email_strings':len({e for r in rows for e in r['published_emails']}),'rights_status':'limited_factual_review_only','rights_basis':'Actual public BIA home/index/widget/profile pages reviewed; no linked explicit commercial/automation prohibition found. Minimal factual internal research only, no open redistribution licence.','metrics':state['metrics'],'no_main_writes':True,'no_mailbox_checks_or_messages':True,'market_completeness_verified':False,'files':{p.name:sha(p) for p in output.iterdir() if p.is_file() and p.name not in {'checkpoint.json','manifest.json'}}};save(manifest_path,m);return m
 except Exception as exc:state['last_failure']={'error':str(exc),'observed_at':t._stamp()};checkpoint();raise
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--index',required=True,type=Path);p.add_argument('--inspection',required=True,type=Path);p.add_argument('--output',required=True,type=Path);p.add_argument('--resume-partial',action='store_true');a=p.parse_args();m=collect(a.index,a.inspection,a.output,resume_partial=a.resume_partial);print(json.dumps({k:v for k,v in m.items() if k!='files'},indent=2))
