"""Inspect actual anonymous directory client and read-only pagination form."""
from __future__ import annotations
import argparse,json,re,gzip,hashlib,shutil,csv
from pathlib import Path
from lxml import html
from .transport import Transport,SourceBlocked
from .construction_rosters import clean,sha,safe
from .gta_email_recovery import public_emails
from .gta_sources import save

URL='https://villageofstreetsville.com/directory/'
ENDPOINT='https://villageofstreetsville.com/wp-admin/admin-ajax.php'
HOST='villageofstreetsville.com'
def cls(name):return 'contains(concat(" ",normalize-space(@class)," ")," '+name+' ")'
def client_arguments(body,client):
 if not all(x in client for x in ['t.action="w2dc_controller_request"','e.ajax_action="paginator"','$.post(w2dc_js_objects.ajaxurl,e,']):raise SourceBlocked('Actual public client pagination contract missing')
 root=html.fromstring(body);args=[]
 pattern=r"w2dc_controller_args_array\['([a-f0-9]{32})'\]\s*=\s*(\{[^;]+\});"
 for script in root.xpath('//script'):
  for match in re.finditer(pattern,script.text or ''):
   value=json.loads(match.group(2))
   if value.get('base_url')==URL and value.get('perpage')==48:args.append((match.group(1),value))
 if len(args)!=1:raise SourceBlocked('Expected exact public main-directory controller absent/ambiguous')
 hash_value,values=args[0]
 # These values are the public frontend controller's own non-authentication query parameters.
 fields={k:v for k,v in values.items() if isinstance(v,(str,int,float)) and not isinstance(v,bool)}
 fields.update({'hash':hash_value,'action':'w2dc_controller_request','ajax_action':'paginator','paged':1})
 nodes=root.xpath('//*[@id="w2dc-controller-'+hash_value+'"]//article['+cls('w2dc-listing')+']')
 fields['existing_listings']=','.join(reversed([n.get('id','').replace('post-','',1) for n in nodes]))+','
 return fields,hash_value

def parse_facts(body,controller_hash=None):
 root=html.fromstring(body)
 if controller_hash:
  regions=root.xpath('//*[@id="w2dc-controller-'+controller_hash+'"]')
  if len(regions)!=1:raise SourceBlocked('Expected publisher directory result region missing')
  root=regions[0]
 rows=[]
 for node in root.xpath('.//article['+cls('w2dc-listing')+']'):
  native=node.get('id','');links=node.xpath('.//header['+cls('w2dc-listing-header')+']/h2/a[@href]')
  if not re.fullmatch(r'post-\d+',native) or len(links)!=1:raise SourceBlocked('Unexpected native directory card schema')
  link=links[0];streets=node.xpath('.//*[@itemprop="streetAddress"]/text()');localities=node.xpath('.//*[@itemprop="addressLocality"]/text()');postals=node.xpath('.//*[@itemprop="postalCode"]/text()');addresses=node.xpath('.//address');phones=node.xpath('.//meta[@itemprop="telephone"]/@content');webs=node.xpath('.//div['+cls('w2dc-field-output-block-website')+']//a[@href]/@href');dates=node.xpath('.//em['+cls('w2dc-listing-date')+']/@datetime');points=node.xpath('.//*[@data-coordinate-lat and @data-coordinate-lng]')
  rows.append({'source_record_id':native[5:],'name':clean(link.text_content()),'profile_url':link.get('href'),'address':clean(addresses[0].text_content()) if len(addresses)==1 else None,'street_published':clean(streets[0]) if len(streets)==1 else None,'locality_published':clean(localities[0]) if len(localities)==1 else None,'postal_code':clean(postals[0]) if len(postals)==1 else None,'phone':clean(phones[0]) if len(phones)==1 else None,'website':webs[0] if len(webs)==1 else None,'categories':[clean(a.text_content()) for a in node.xpath('.//div['+cls('w2dc-field-output-block-categories')+']//a')],'published_datetime':dates[0] if len(dates)==1 else None,'latitude_published':points[0].get('data-coordinate-lat') if len(points)==1 else None,'longitude_published':points[0].get('data-coordinate-lng') if len(points)==1 else None})
 if not rows or len({x['source_record_id'] for x in rows})!=len(rows):raise SourceBlocked('Missing/repeated directory business IDs')
 return rows

def probe(inspection,client_folder,output):
 inspection=Path(inspection);client_folder=Path(client_folder);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 source=inspection/'streetsville-offered-business-directory.response';client=client_folder/'streetsville-native-client-bundle-26.response'
 for folder,file in [(inspection,source),(client_folder,client)]:
  receipt=next(x for x in json.loads((folder/'inspection.json').read_text())['receipts'] if file.name==x['id']+'.response')
  if sha(file)!=receipt['sha256']:raise SourceBlocked('Source/client receipt changed')
 fields,hash_value=client_arguments(source.read_bytes(),client.read_text());before=parse_facts(source.read_bytes(),hash_value)
 saved=output/'current-page-public-form-response.json.gz'
 if saved.exists():return json.loads((output/'probe.json').read_text())
 t=Transport(max_requests=5,max_bytes=5000000,max_response_bytes=2000000,timeout=30,retries=1,allowed_hosts=[HOST])
 try:
  response=t.fetch_public_form(ENDPOINT,fields,documentation_url=URL)
  saved.write_bytes(gzip.compress(response.body))
  if gzip.decompress(saved.read_bytes())!=response.body:raise SourceBlocked('Whole response gzip verification failed')
  data=response.json()
  if not isinstance(data,dict) or data.get('hash')!=hash_value or not isinstance(data.get('html'),str):raise SourceBlocked('Unexpected public directory form response schema')
  after=parse_facts(data['html'],hash_value)
  if [r['source_record_id'] for r in before]!=[r['source_record_id'] for r in after]:raise SourceBlocked('Public client request did not reproduce current visible directory IDs')
  result={'status':'public_read_form_current_page_reproduced','source_url':URL,'endpoint':ENDPOINT,'documentation_source_sha256':sha(source),'actual_client_sha256':sha(client),'selected_factual_rows':len(after),'native_ids_identical_to_visible_page':True,'request_fields':fields,'response_keys':sorted(data),'raw_response_file':saved.name,'gzip_sha256':sha(saved),'raw_whole_sha256':hashlib.sha256(response.body).hexdigest(),'metrics':t.metrics(),'business_rows_promoted':0,'market_completeness_verified':False};save(output/'probe.json',result);return result
 except Exception as exc:save(output/'failure.json',{'error':str(exc),'metrics':t.metrics(),'no_bypass':True,'rows_acquired_complete':False});raise
def export_saved_index(inspection,client_folder,output):
 inspection=Path(inspection);client_folder=Path(client_folder);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if (output/'manifest.json').exists():
  m=json.loads((output/'manifest.json').read_text())
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen partial source facts changed')
  return m
 source=inspection/'streetsville-offered-business-directory.response';receipt=next(r for r in json.loads((inspection/'inspection.json').read_text())['receipts'] if r['id']=='streetsville-offered-business-directory')
 if sha(source)!=receipt['sha256']:raise SourceBlocked('Original ordinary index bytes changed')
 fields,controller_hash=client_arguments(source.read_bytes(),(client_folder/'streetsville-native-client-bundle-26.response').read_text());facts=parse_facts(source.read_bytes(),controller_hash);tree=html.fromstring(source.read_bytes());rows=[]
 for fact in facts:
  node=tree.xpath('//*[@id="w2dc-controller-'+controller_hash+'"]//article[@id="post-'+fact['source_record_id']+'"]')[0];emails=[e for e,_ in public_emails(node)];locality=fact['locality_published'];city=locality[:-8].rstrip(', ') if locality and locality.endswith(', Canada') else locality;country='Canada' if locality and locality.endswith(', Canada') else None
  province=re.search(r'\b(ON|ONT|Ontario)\b',fact['street_published'] or '',re.I);latitude=longitude=None
  try:
   lat=float(fact['latitude_published']);lon=float(fact['longitude_published'])
   if -90<=lat<=90 and -180<=lon<=180:latitude,longitude=lat,lon
  except (TypeError,ValueError):pass
  rows.append({'source_id':'streetsville-bia-public-directory','source_record_id':fact['source_record_id'],'source_record_id_basis':'Actual published native post-ID in the public main directory card','source_url':fact['profile_url'],'evidence_source_url':URL,'observed_at':receipt['observed_at'],'source_published_at':fact['published_datetime'],'source_publication_precision':'Publisher local datetime, timezone not specified; not opening/current-operation date','name':fact['name'],'address':fact['address'],'city':city,'city_raw':locality,'province':province.group(1) if province else None,'country':country,'postal_code':fact['postal_code'],'latitude':latitude,'longitude':longitude,'phone':fact['phone'],'website':fact['website'],'email':emails[0] if len(emails)==1 else None,'published_emails':emails,'categories':fact['categories'],'record_type':'public_bia_directory_listing','entity_type':'organisation_candidate','eligibility':'research_only','campaign_ready':False,'rights_status':'limited_factual_review_only','raw_payload':fact})
 with gzip.open(output/'public-main-index-business-facts.jsonl.gz','wt',encoding='utf8') as stream:
  for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
 fields=['source_id','source_record_id','name','address','city','province','country','postal_code','phone','website','email','source_url','observed_at','eligibility','campaign_ready']
 with gzip.open(output/'public-main-index-business-facts.csv.gz','wt',encoding='utf8',newline='') as stream:
  writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
  for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
 m={'status':'partial','source_id':'streetsville-bia-public-directory','publisher':'Streetsville BIA','source_url':URL,'raw_factual_rows':len(rows),'unique_native_main_index_ids':len({r['source_record_id'] for r in rows}),'source_inventory_exhausted':False,'publisher_reported_unique_business_total':None,'scope':'Actual rendered first main index only; duplicate sidebar appearances excluded. Broader category/pagination inventory remains unresolved, no complete district claim.','blocked_route':ENDPOINT,'block_reason':'Actually shipped public directory client documents anonymous pagination, but robots disallows its POST endpoint. No POST or bypass performed. Independently allowed ordinary HTML remains factual research source.','rights_status':'limited_factual_review_only','source_evidence':str(source),'source_original_sha256':sha(source),'original_observed_at':receipt['observed_at'],'published_email_associations':sum(len(r['published_emails']) for r in rows),'record_unit':'Published native main-index organisation/site listing, not verified legal company/current operation/occupancy','metrics':{'network_requests':0,'paid_service_calls':0,'main_writes':0,'basis':'Saved allowed ordinary source reused; original inspection costs retained separately'},'market_completeness_verified':False,'files':{p.name:sha(p) for p in output.iterdir() if p.is_file()}};save(output/'manifest.json',m);return m

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inspection',required=True,type=Path);p.add_argument('--client',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();result=probe(a.inspection,a.client,a.output);print(json.dumps({k:v for k,v in result.items() if k!='request_fields'},indent=2))
