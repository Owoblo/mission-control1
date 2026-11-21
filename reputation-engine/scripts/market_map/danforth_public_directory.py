"""The exact anonymous public directory route documented by Danforth's client."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re,shutil
from pathlib import Path
from urllib.parse import urlencode
from .transport import Transport,SourceBlocked
from .construction_rosters import clean,sha,safe
from .chamber_rosters import parse_address_lines
from .gta_sources import save

DIRECTORY='https://dvbia.ca/directory'
FIELDS=['id','name','address','unit','website','phone','main_category','second_category','third_category']

def public_client_config(body,directory_script):
 text=body.decode('utf8');script=directory_script.decode('utf8')
 hosts=set(re.findall(r'https://[a-z0-9-]+\.supabase\.co',text))
 keys={x for x in re.findall(r'sb_publishable_[A-Za-z0-9_-]+',text) if len(x)>30}
 secrets={x for x in re.findall(r'sb_secret_[A-Za-z0-9_-]+',text) if len(x)>30}
 if len(hosts)!=1 or len(keys)!=1 or secrets:raise SourceBlocked('Expected exactly one frontend publishable project key and no secret/service credential')
 match=re.search(r'\.from\("businesses"\)\.select\("([a-z_,]+)"\)',script)
 if not match or not set(FIELDS).issubset(match.group(1).split(',')):raise SourceBlocked('Actual public client table/field projection not established')
 return hosts.pop(),keys.pop()

def normalize(raw,stamp):
 if not raw.get('id'):raise SourceBlocked('Native public directory row ID missing')
 name=clean(str(raw['name'])) if raw.get('name') else None
 parsed=parse_address_lines([raw['address']] if raw.get('address') else [])
 return {'source_id':'danforth-village-bia-public-directory','source_record_id':str(raw['id']),
  'source_record_id_basis':'Native row ID in the actual public directory businesses table',
  'source_url':DIRECTORY+'?b='+str(raw['id']),'evidence_source_url':DIRECTORY,'observed_at':stamp,
  'name':name,'website':raw.get('website') or None,'phone':raw.get('phone') or None,'email':None,
  **parsed,'unit':raw.get('unit') or None,'categories':[raw[x] for x in ['main_category','second_category','third_category'] if raw.get(x)],
  'raw_payload':raw,'record_type':'public_bia_business_directory_listing' if name else 'source_row_pending_name_review',
  'entity_type':'organisation_site_candidate' if name else 'source_observation_pending_review',
  'rights_status':'limited_factual_review_only','eligibility':'research_only','campaign_ready':False,
  'relationships':[{'relationship_type':'listed_in','object_name':'Danforth Village BIA public directory','source_url':DIRECTORY,
    'basis':'Explicit public directory row; source UI badge, current operation, legal identity and tenancy not independently verified'}]}

def collect(client_folder,route_folder,output,*,transport=None):
 client_folder=Path(client_folder);route_folder=Path(route_folder);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for f,digest in m['files'].items():
   if sha(output/f)!=digest:raise SourceBlocked('Frozen Danforth directory output changed')
  return m
 main=client_folder/'danforth-village-main-public-client.response';route=route_folder/'danforth-village-public-directory-client.response'
 project,key=public_client_config(main.read_bytes(),route.read_bytes());host=project.split('://')[1]
 t=transport or Transport(max_requests=50,max_bytes=10000000,max_response_bytes=1000000,timeout=30,retries=1,min_interval=.5,allowed_hosts=[host])
 allowed={host};state_path=output/'checkpoint.json';state=json.loads(state_path.read_text()) if state_path.exists() else {'pages':[],'metrics':{'requests':0,'bytes_fetched':0,'elapsed_seconds':0}}
 prior=state['metrics'].copy()
 def checkpoint():
  fresh=t.metrics();state['metrics']={**fresh,'requests':prior['requests']+fresh['requests'],'bytes_fetched':prior['bytes_fetched']+fresh['bytes_fetched'],'elapsed_seconds':round(prior['elapsed_seconds']+fresh['elapsed_seconds'],3),'fresh_invocation':fresh};save(state_path,state)
 def fetch(offset,limit=250,terminal=False):
  label='terminal' if terminal else f'offset-{offset:06d}';receipt_path=output/(label+'.receipt.json')
  saved=state.get('terminal') if terminal else next((x for x in state['pages'] if x['offset']==offset),None)
  if saved is None and receipt_path.exists():
   saved=json.loads(receipt_path.read_text())
   if terminal:state['terminal']=saved
   else:state['pages'].append(saved)
   checkpoint()
  if saved:
   raw=output/saved['raw_file']
   if sha(raw)!=saved['gzip_sha256']:raise SourceBlocked('Saved public response changed')
   body=gzip.decompress(raw.read_bytes())
   if hashlib.sha256(body).hexdigest()!=saved['raw_sha256']:raise SourceBlocked('Saved public response bytes changed')
   return json.loads(body),saved
  if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before every request')
  url=project+'/rest/v1/businesses?'+urlencode({'select':'id' if terminal else ','.join(FIELDS),'order':'id.asc','offset':offset,'limit':limit})
  # This is the same unsigned/publishable frontend context, with a smaller
  # positive field projection. No login, user JWT, secret or service-role key.
  t._guard(url,allowed);t._check_robots(url,allowed)
  response=t._request(url,allowed,{'apikey':key,'Prefer':'count=exact'},check_redirect_robots=True)
  if response.status not in (200,206):raise SourceBlocked('Public table HTTP '+str(response.status))
  data=response.json()
  if not isinstance(data,list) or any(not isinstance(x,dict) or set(x)-({'id'} if terminal else set(FIELDS)) for x in data):raise SourceBlocked('Public field projection returned unexpected fields; nothing archived')
  headers={k.lower():v for k,v in response.headers.items() if k.lower() in ['content-range','content-type','range-unit']}
  match=re.fullmatch(r'(?:\d+-\d+|\*)/(\d+)',headers.get('content-range',''))
  if not match:raise SourceBlocked('Exact publisher Content-Range count missing')
  raw=output/(label+'.selected-facts.json.gz');temp=raw.with_suffix('.tmp')
  with gzip.open(temp,'wb') as stream:stream.write(response.body)
  if gzip.decompress(temp.read_bytes())!=response.body:raise SourceBlocked('Public factual compression check failed')
  temp.replace(raw);saved={'offset':offset,'url':url,'request_header_names':['apikey','Prefer'],
   'public_credential_kind':'frontend sb_publishable key, unsigned anon/RLS context; value not recorded',
   'expected_count':int(match.group(1)),'raw_file':raw.name,'gzip_sha256':sha(raw),'raw_sha256':hashlib.sha256(response.body).hexdigest(),
   'headers':headers,'observed_at':t._stamp()}
  save(receipt_path,saved)
  if terminal:state['terminal']=saved
  else:state['pages'].append(saved)
  checkpoint();return data,saved
 try:
  rows=[];seen=set();expected=None;offset=0;first=None
  for page in range(40):
   data,proof=fetch(offset)
   if expected is None:expected=proof['expected_count'];first=data[0]['id'] if data else None
   if proof['expected_count']!=expected:raise SourceBlocked('Public directory count changed during traversal')
   if not data and offset<expected:raise SourceBlocked('Premature empty page; prior raw pages retained')
   for raw in data:
    row=normalize(raw,proof['observed_at'])
    if row['source_record_id'] in seen:raise SourceBlocked('Repeated native directory ID across pages')
    seen.add(row['source_record_id']);rows.append(row)
   offset+=len(data);print(json.dumps({'source':'danforth-village','rows':len(rows),'expected':expected}),flush=True)
   if offset>=expected:break
  if len(rows)!=expected:raise SourceBlocked('Native ID/count mismatch under declared page cap')
  terminal,proof=fetch(0,1,True)
  if proof['expected_count']!=expected or ([x['id'] for x in terminal] != ([first] if first is not None else [])):raise SourceBlocked('Terminal source count/first ID changed')
  with gzip.open(output/'public-business-facts.jsonl.gz','wt',encoding='utf8') as stream:
   for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
  fields=['source_id','source_record_id','name','website','address','unit','city','province','country','postal_code','phone','source_url','observed_at','rights_status','eligibility','campaign_ready']
  with gzip.open(output/'public-business-facts.csv.gz','wt',encoding='utf8',newline='') as stream:
   writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
   for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
  save(output/'native-public-business-ids.json',sorted(seen));checkpoint()
  m={'source_id':'danforth-village-bia-public-directory','publisher':'Danforth Village BIA','source_url':DIRECTORY,
   'public_client_main_sha256':sha(main),'public_directory_client_sha256':sha(route),'public_table_url':project+'/rest/v1/businesses',
   'credential_kind':'Publisher-shipped sb_publishable key in anonymous/RLS context only; no secret/user/service-role credential',
   'credential_value_not_recorded':True,'selected_fields':FIELDS,'contact_HST_licence_consent_email_narrative_fields_unrequested':True,
   'rights_status':'limited_factual_review_only','rights_basis':'Actual public directory/home/footer/client reviewed; no linked commercial/automation prohibition found. Selected public organisation facts for internal research; no open redistribution licence inferred.',
   'reported_row_count':expected,'raw_factual_rows':len(rows),'unique_native_ids':len(seen),'missing_name_rows_retained':sum(not x['name'] for x in rows),
   'source_inventory_exhausted':True,'exhaustion_scope':'Exact actual frontend public businesses table, positive safe-field projection, full Content-Range/ID pagination and terminal recheck',
   'source_UI_verification_badge_not_treated_as_independent_verification':True,'atomic_publisher_snapshot':False,
   'robots_receipt':t.robots_checked,'metrics':state['metrics'],'market_completeness_verified':False,'no_main_writes':True,
   'files':{p.name:sha(p) for p in output.iterdir() if p.is_file() and p.name!='checkpoint.json'}}
  save(manifest_path,m);(output/'README.md').write_text(f'{len(rows)} exact public Danforth Village directory IDs/factual rows captured through the actual unsigned frontend route, with exact Content-Range counts and terminal first-ID recheck. Only published business name/address/unit/website/phone/categories selected. Contact-person, email, HST/licence numbers, consent, narratives and media fields unrequested. The publisher-shipped publishable key is used in ordinary anon/RLS context, not secret/service-role/user authentication, and its value is never printed or written into manifests/URLs. No map-service/API calls or paid APIs. Source UI badge is not an independent verification. Unknown city stays unknown; all source observations remain research-only and not campaign-ready. Raw selected-fact JSON only, no people fields.\n');return m
 except Exception as exc:
  message=str(exc).replace(key,'[public key redacted]')
  state['last_failure']={'error':message,'at':t._stamp()};checkpoint()
  if key in str(exc):raise SourceBlocked(message) from None
  raise

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--client',required=True,type=Path);p.add_argument('--routes',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();print(json.dumps(collect(a.client,a.routes,a.output),indent=2))
