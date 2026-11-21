"""Actual offered Toolset directory pages; selected source facts, no store writes."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re,shutil
from pathlib import Path
from urllib.parse import urljoin,urlsplit
from lxml import html
from .construction_rosters import clean,sha,safe
from .gta_sources import save
from .transport import Transport,SourceBlocked

URL='https://www.villageofislington.com/directory/'
SOURCE='islington-village-public-business-directory'
HOST='www.villageofislington.com'
def has_class(name):return 'contains(concat(" ",normalize-space(@class)," ")," '+name+' ")'

def parse_page(body,url=URL):
 root=html.fromstring(body);cards=[];markers=[]
 for node in root.xpath('//*['+has_class('tca-business-loop-item')+']'):
  links=node.xpath('.//h2/a[@href]')
  if len(links)!=1:raise SourceBlocked('Unexpected business card heading schema')
  link=links[0];profile=urljoin(url,link.get('href'))
  if urlsplit(profile).hostname!=HOST or not urlsplit(profile).path.startswith('/business/'):raise SourceBlocked('Business profile outside actual publisher scope')
  categories=[clean(x.text_content()) for x in node.xpath('.//*['+has_class('tca-categories')+']')]
  cards.append({'profile_url':profile,'name':clean(link.text_content()),'published_native_card_id':node.get('id'),'categories':categories})
 if not cards or len({r['profile_url'] for r in cards})!=len(cards):raise SourceBlocked('Missing or repeated business cards within page')
 for node in root.xpath('//*['+has_class('wpv-addon-maps-marker')+']'):
  links=node.xpath('.//h3/a[@href]');paragraphs=node.xpath('./p')
  if len(links)!=1 or len(paragraphs)!=1:raise SourceBlocked('Unexpected public map marker schema')
  profile=urljoin(url,links[0].get('href'))
  if urlsplit(profile).hostname!=HOST or not urlsplit(profile).path.startswith('/business/'):raise SourceBlocked('Map profile outside publisher scope')
  markers.append({'profile_url':profile,'name':clean(links[0].text_content()),'address':clean(paragraphs[0].text_content()),'latitude_published':node.get('data-markerlat'),'longitude_published':node.get('data-markerlon'),'published_map_marker_id':node.get('data-marker')})
 pages={}
 for link in root.xpath('//a['+has_class('js-wpv-pagination-link')+' or '+has_class('js-wpv-pagination-last-link')+']'):
  href=urljoin(url,link.get('href',''));match=re.search(r'(?:\?|&)wpv_paged=(\d+)(?:&|$)',href)
  first_link=bool(re.search(r'\?wpv_view_count=896$',href))
  if (not match and not first_link) or urlsplit(href).hostname!=HOST or urlsplit(href).path!='/directory/':raise SourceBlocked('Unexpected offered pagination route: '+href)
  pages[int(match.group(1)) if match else 1]=href
 current=root.xpath('//li['+has_class('wpv_page_current')+']/span/text()')
 if len(current)!=1 or not current[0].strip().isdigit():raise SourceBlocked('Current directory page identity missing')
 return {'cards':cards,'markers':markers,'pages':pages,'current_page':int(current[0].strip())}

def normalise(card,markers,stamp,evidence_url):
 matches=[m for m in markers if m['profile_url']==card['profile_url']]
 address=matches[0]['address'] if matches else None
 if len({m['address'] for m in matches})>1:address=None
 city_match=re.search(r'\b(Etobicoke|Toronto)\b',address or '',re.I)
 province_match=re.search(r'\b(ON|Ontario)\b',address or '',re.I)
 coordinates=set()
 for marker in matches:
  try:
   latitude=float(marker['latitude_published']);longitude=float(marker['longitude_published'])
   if -90<=latitude<=90 and -180<=longitude<=180:coordinates.add((latitude,longitude))
  except (TypeError,ValueError):pass
 coordinate=next(iter(coordinates)) if len(coordinates)==1 else (None,None)
 postal=re.search(r'\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d)\b',address or '',re.I)
 return {'source_id':SOURCE,'source_record_id':card['profile_url'],'source_record_id_basis':'Exact publisher organisation profile URL; native visible card ID retained as alias only',
  'source_url':card['profile_url'],'evidence_source_url':evidence_url,'observed_at':stamp,'name':card['name'],'address':address,
  'city':city_match.group(1) if city_match else None,'province':province_match.group(1) if province_match else None,'country':'Canada' if re.search(r'\bCanada\b',address or '',re.I) else None,
  'latitude':coordinate[0],'longitude':coordinate[1],'postal_code':postal.group(1).upper() if postal else None,'website':None,'phone':None,'email':None,'categories':card.get('categories',[]),
  'record_type':'public_bia_directory_listing','entity_type':'organisation_candidate','eligibility':'research_only','campaign_ready':False,
  'rights_status':'limited_factual_review_only','raw_payload':{'card':card,'public_map_markers':matches,'address_conflict':len({m['address'] for m in matches})>1,'missing_locality_not_filled_from_BIA_office':True}}

def collect(entry_folder,output,*,transport=None):
 entry_folder=Path(entry_folder);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen directory artifact changed')
  return m
 t=transport or Transport(max_requests=40,max_bytes=25000000,max_response_bytes=2000000,timeout=30,retries=1,allowed_hosts=[HOST])
 state_path=output/'checkpoint.json';state=json.loads(state_path.read_text()) if state_path.exists() else {'pages':{},'metrics':{'requests':0,'bytes_fetched':0,'elapsed_seconds':0}}
 old=state['metrics'].copy()
 def checkpoint():
  fresh=t.metrics();state['metrics']={**fresh,'requests':old['requests']+fresh['requests'],'bytes_fetched':old['bytes_fetched']+fresh['bytes_fetched'],'elapsed_seconds':round(old['elapsed_seconds']+fresh['elapsed_seconds'],3),'fresh_invocation':fresh};save(state_path,state)
 def acquire(number,url,reused=None):
  key=str(number);saved=state['pages'].get(key);receipt=output/('page-'+key+'.receipt.json')
  if not saved and receipt.exists():saved=json.loads(receipt.read_text());state['pages'][key]=saved;checkpoint()
  if saved:
   raw=output/saved['raw_file']
   if sha(raw)!=saved['gzip_sha256']:raise SourceBlocked('Saved directory gzip changed')
   body=gzip.decompress(raw.read_bytes())
   if hashlib.sha256(body).hexdigest()!=saved['raw_sha256']:raise SourceBlocked('Saved whole directory bytes changed')
  else:
   if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before every page')
   if reused:
    body=reused.read_bytes();inspection=json.loads((reused.parent/'inspection.json').read_text());evidence=next(x for x in inspection['receipts'] if x['url']==url)
    if hashlib.sha256(body).hexdigest()!=evidence['sha256']:raise SourceBlocked('Saved entry response changed')
    stamp=evidence['observed_at']
   else:body=t.fetch(url).body;stamp=t._stamp()
   raw=output/('page-'+key+'.private-evidence.html.gz');raw.write_bytes(gzip.compress(body))
   if gzip.decompress(raw.read_bytes())!=body:raise SourceBlocked('Whole response compression verification failed')
   saved={'url':url,'raw_file':raw.name,'gzip_sha256':sha(raw),'raw_sha256':hashlib.sha256(body).hexdigest(),'observed_at':stamp,'reused_saved_response':bool(reused)}
   save(receipt,saved);state['pages'][key]=saved;checkpoint()
  return parse_page(body,url),saved
 try:
  first,receipt=acquire(1,URL,entry_folder/'islington-offered-business-directory.response')
  expected=max(first['pages'],default=1)
  if expected>30 or set(first['pages'])!=set(range(2,expected+1)):raise SourceBlocked('Initial offered directory page inventory inconsistent')
  cards={};markers={};all_pages=[]
  for page in range(1,expected+1):
   parsed,receipt=acquire(page,URL if page==1 else first['pages'][page]);all_pages.append(parsed)
   if parsed['current_page']!=page:raise SourceBlocked('Offered pagination repeated another current-page identity')
   page_ids={r['profile_url'] for r in parsed['cards']}
   if page_ids.intersection(cards):raise SourceBlocked('Offered pages repeat source profiles; stop without full-source claim')
   for card in parsed['cards']:cards[card['profile_url']]={**card,'stamp':receipt['observed_at'],'evidence_url':receipt['url']}
   for marker in parsed['markers']:
    key=(marker['profile_url'],marker['address']);markers[key]=marker
   if max(set(parsed['pages'])|{parsed['current_page']})!=expected:raise SourceBlocked('Publisher pagination inventory changed')
   print(json.dumps({'source':SOURCE,'page':page,'pages':expected,'visible_card_ids':len(cards)}),flush=True)
  if all_pages[-1]['current_page']!=expected:raise SourceBlocked('Last-page proof missing')
  terminal,terminal_receipt=acquire('terminal',URL)
  if [r['profile_url'] for r in terminal['cards']]!=[r['profile_url'] for r in first['cards']] or terminal['pages']!=first['pages']:raise SourceBlocked('First-page/count inventory changed during traversal')
  rows=[normalise(card,list(markers.values()),card['stamp'],card['evidence_url']) for card in cards.values()]
  map_only={marker['profile_url']:marker for marker in markers.values() if marker['profile_url'] not in cards}
  # A map marker outside the visible inventory is retained separately, never silently discarded or claimed current.
  for marker in map_only.values():
   row=normalise({'name':marker['name'],'profile_url':marker['profile_url'],'categories':[],'published_native_card_id':None},[m for m in markers.values() if m['profile_url']==marker['profile_url']],terminal_receipt['observed_at'],URL)
   row['raw_payload']['map_only_not_visible_directory_card']=True;rows.append(row)
  with gzip.open(output/'public-directory-facts.jsonl.gz','wt',encoding='utf8') as stream:
   for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
  fields=['source_id','source_record_id','name','address','city','province','country','postal_code','website','phone','source_url','evidence_source_url','observed_at','eligibility','campaign_ready']
  with gzip.open(output/'public-directory-facts.csv.gz','wt',encoding='utf8',newline='') as stream:
   writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
   for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
  save(output/'profile-url-inventory.json',sorted(cards));checkpoint()
  m={'source_id':SOURCE,'publisher':'Village of Islington BIA','source_url':URL,'status':'completed','rights_status':'limited_factual_review_only','rights_basis':'Actual public homepage/directory/footer reviewed, no linked explicit commercial or automation prohibition found; ordinary robots-allowed factual internal research only, no open redistribution grant.',
    'record_unit':'Published business-directory card/profile observation, not verified legal company or current occupancy','visible_directory_cards':len(cards),'map_marker_observations':len(markers),'map_only_observations_retained':len(map_only),'raw_factual_rows':len(rows),'pages':expected,'publisher_reported_total':None,'source_inventory_exhausted':True,'exhaustion_scope':'Every actual offered visible directory page plus distinct public map-only observations; terminal current-page and first-page URL inventory recheck','source_market_complete':False,'market_completeness_verified':False,'missing_fields_not_filled':True,'narratives_people_media_not_enriched':True,'metrics':state['metrics'],'files':{p.name:sha(p) for p in output.iterdir() if p.is_file() and p.name!='checkpoint.json'}}
  save(manifest_path,m);return m
 except Exception as exc:state['last_failure']={'error':str(exc),'at':t._stamp()};checkpoint();raise

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inspection',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();print(json.dumps(collect(a.inspection,a.output),indent=2))
