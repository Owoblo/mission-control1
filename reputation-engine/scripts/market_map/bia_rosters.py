"""Minimal first-party BIA directory observations, preserving source uncertainty.

Public names/profile links and explicit factual fields only; no narrative copying,
people enrichment, membership/ownership inference, main database or paid API.
"""
from __future__ import annotations
import argparse
import csv
from datetime import datetime,timezone
import gzip
import hashlib
import json
from pathlib import Path
import shutil
from urllib.parse import urljoin,urlsplit
from lxml import html
from .transport import Transport,SourceBlocked,BudgetExceeded
from .toronto_full import atomic,sha

PARSER='bia-facts/1'
SPECS={
 'bloor-west':{'name':'Bloor West Village BIA','url':'https://www.bloorwestvillagebia.com/directory/','host':'www.bloorwestvillagebia.com','kind':'bloor','saved':'bloor-west-directory.response','policy':'https://www.bloorwestvillagebia.com/privacy-policy/'},
 'downtown-yonge':{'name':'Downtown Yonge BIA','url':'https://downtownyonge.com/business-directory/','host':'downtownyonge.com','kind':'yonge','saved':'downtown-yonge-directory.response','policy':None},
}

def text(node):return ' '.join(node.text_content().split())

def parse_page(body,spec,page_url):
 try:doc=html.fromstring(body)
 except (ValueError,TypeError) as exc:raise SourceBlocked('Invalid directory HTML') from exc
 records=[]
 if spec['kind']=='bloor':
  for a in doc.xpath('//a[contains(concat(" ",normalize-space(@class)," ")," business-item-link ")]'):
   title=a.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," business-item-title ")]')
   if not title:continue
   profile=urljoin(page_url,a.get('href',''));name=text(title[0])
   if urlsplit(profile).hostname!=spec['host'] or not urlsplit(profile).path.startswith('/directory/'):raise SourceBlocked('Directory profile outside reviewed scope')
   category=a.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," business-item-more-info ")]')
   records.append({'name':name,'profile_url':profile,'source_record_id':profile,'published_category_text':text(category[0]) if category else None,'address':None,'website':None,'phone':None})
 elif spec['kind']=='yonge':
  for a in doc.xpath('//h3[contains(concat(" ",normalize-space(@class)," ")," geodir-entry-title ")]/a[@href]'):
   card=a
   while card.getparent() is not None and 'card' not in (card.get('class') or '').split():card=card.getparent()
   if 'card' not in (card.get('class') or '').split():raise SourceBlocked('Business card boundary missing; footer data cannot be used')
   profile=urljoin(page_url,a.get('href',''));name=text(a)
   if urlsplit(profile).hostname!=spec['host'] or not urlsplit(profile).path.startswith('/places/'):raise SourceBlocked('Directory profile outside reviewed scope')
   street=card.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," geodir-field-street ")]')
   phones=card.xpath('.//a[starts-with(@href,"tel:")]/@href');web=card.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," geodir-field-website ")]//a/@href')
   cats=sorted({text(n) for n in card.xpath('.//a[contains(@href,"/places/category/")]') if text(n)})
   address=text(street[0]).removeprefix('Address:').strip() if street else None
   records.append({'name':name,'profile_url':profile,'source_record_id':profile,'published_categories':cats,'address':address,'website':web[0] if web else None,'phone':phones[0][4:] if phones else None})
 else:raise ValueError('Unknown directory parser')
 if not records:raise SourceBlocked('No reviewed business-card selectors found; never import footer/board')
 if len({r['source_record_id'] for r in records})!=len(records):raise SourceBlocked('Repeated business profile in one source page')
 next_urls=sorted({urljoin(page_url,a.get('href')) for a in doc.xpath('//a[@href]') if 'Older posts'==text(a)})
 if len(next_urls)>1:raise SourceBlocked('Conflicting directory next pages')
 for url in next_urls:
  if urlsplit(url).hostname!=spec['host'] or not urlsplit(url).path.startswith(urlsplit(spec['url']).path):raise SourceBlocked('Pagination outside reviewed public directory')
 return records,next_urls[0] if next_urls else None


def collect_one(key,folder,*,inspection_folder,transport=None,max_new_pages=200):
 if not 1<=max_new_pages<=1000:raise ValueError('Invalid new-page budget')
 spec=SPECS[key];folder=Path(folder)/key;folder.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(folder).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before source acquisition')
 if (folder/'manifest.json').exists():
  m=json.loads((folder/'manifest.json').read_text())
  if sha(folder/m['records_file'])!=m['records_sha256']:raise SourceBlocked('Frozen factual roster differs')
  return m
 state_path=folder/'checkpoint.json';state=json.loads(state_path.read_text()) if state_path.exists() else {'source_key':key,'next_url':spec['url'],'pages':[],'observed_at':datetime.now(timezone.utc).isoformat(),'requests':0,'bytes_fetched':0,'status':'pending'}
 if state['source_key']!=key:raise SourceBlocked('Checkpoint source differs')
 t=transport or Transport(max_requests=200,max_bytes=25000000,max_response_bytes=5000000,timeout=30,retries=1,allowed_hosts=[spec['host']])
 before=(t.requests,t.bytes_fetched);seen=set();records=[]
 def charge():
  nonlocal before
  state['requests']+=t.requests-before[0];state['bytes_fetched']+=t.bytes_fetched-before[1];before=(t.requests,t.bytes_fetched)
 for filename in state['pages']:
  page=json.loads((folder/filename).read_text());records.extend(page['records']);seen.update(r['source_record_id'] for r in page['records'])
 pages_before=len(state['pages'])
 try:
  while state['next_url']:
   if shutil.disk_usage(folder).free<2*1024**3:raise BudgetExceeded('Source paused by2GiB free-space guard; previous pages are durable')
   if len(state['pages'])-pages_before>=max_new_pages:raise BudgetExceeded('Explicit per-invocation page bound; source cursor remains resumable')
   url=state['next_url'];cached=Path(inspection_folder)/spec['saved']
   if not state['pages'] and cached.exists():body=cached.read_bytes();reused=True
   else:body=t.fetch(url).body;reused=False
   rows,next_url=parse_page(body,spec,url)
   if any(r['source_record_id'] in seen for r in rows):raise SourceBlocked('Non-advancing directory pagination; previous pages retained')
   page_id=len(state['pages'])+1;filename=f'page-{page_id:04d}-facts.json'
   for r in rows:
    r.update({'source_url':url,'observed_at':state['observed_at'],'record_type':'directory_listing_candidate','entity_type':'business_candidate','city':None,'province':None,'country':None,'collection_context_city':'Toronto','physical_presence_verified':False,'association_membership_verified':False,'directory_publisher':spec['name'],'directory_listing_relationship':'listed_in_publisher_directory','eligibility':'research_only','campaign_ready':False,'supporting_excerpt':r['name']})
   atomic(folder/filename,{'source_page_url':url,'original_response_sha256':hashlib.sha256(body).hexdigest(),'response_bytes':len(body),'reused_saved_inspection':reused,'records':rows,'next_url':next_url,'rights_scope':'Minimal factual directory fields only; no article/narrative/media licence inferred'})
   state['pages'].append(filename);state['next_url']=next_url;records.extend(rows);seen.update(r['source_record_id'] for r in rows);state['status']='running' if next_url else 'completed';state.pop('error',None);charge();atomic(state_path,state)
 except (SourceBlocked,BudgetExceeded,OSError) as exc:state['status']='partial' if records else 'blocked';state['error']=str(exc)
 charge();atomic(state_path,state)
 path=folder/'factual-directory-observations.jsonl.gz'
 with gzip.open(path.with_suffix('.gz.tmp'),'wt',encoding='utf-8') as f:
  for r in records:f.write(json.dumps(r,ensure_ascii=False)+'\n')
 path.with_suffix('.gz.tmp').replace(path)
 manifest={'source_id':'bia-'+key+'-public-directory','publisher':spec['name'],'source_url':spec['url'],'rights_status':'limited_factual_review_only','policy_url':spec['policy'],'parser_version':PARSER,'status':state['status'],'observed_at':state['observed_at'],'acquired_raw_factual_observations':len(records),'unique_profile_ids':len(seen),'source_inventory_exhausted':state['status']=='completed','market_completeness_verified':False,'records_file':path.name,'records_sha256':sha(path),'original_narratives_and_media_reused':False,'pages':len(state['pages']),'checkpoint_file':state_path.name,'metrics':{'requests':state['requests'],'bytes_fetched':state['bytes_fetched'],'estimated_cost':0,'cost_currency':None,'paid_service_calls':0,'model_api_calls':0,'reused_initial_page_costs':'Existing inspection metrics are separate; no fresh requests charged for saved response'},'no_main_writes':True,'limitation':'A public directory listing is not confirmed membership, a verified company, property occupancy or current operation; unprinted city/province/country remain unknown'}
 atomic(folder/('manifest.json' if state['status']=='completed' else 'partial-manifest.json'),manifest);return manifest


def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--inspection-folder',type=Path,required=True);p.add_argument('--sources',choices=sorted(SPECS),nargs='+',default=list(SPECS));p.add_argument('--api-downtown-yonge',action='store_true');p.add_argument('--index-path',type=Path);a=p.parse_args()
 if a.api_downtown_yonge:
  print(json.dumps(collect_public_api(a.output,index_path=a.index_path)),flush=True);return
 for key in a.sources:
  m=collect_one(key,a.output,inspection_folder=a.inspection_folder);print(json.dumps(m),flush=True)



API_FIELDS=('id','link','title','post_category','street','country','region','city','zip','latitude','longitude','tel','website','date','date_gmt','modified','modified_gmt')
API_URL='https://downtownyonge.com/wp-json/geodir/v2/places'

def api_facts(raw,url,observed):
    if not isinstance(raw,dict) or not isinstance(raw.get('id'),int) or not raw.get('link'):
        raise SourceBlocked('Public API listing lacks native ID/permalink')
    if urlsplit(raw['link']).hostname!='downtownyonge.com' or not urlsplit(raw['link']).path.startswith('/places/'):
        raise SourceBlocked('API profile outside reviewed listing scope')
    title=raw.get('title',{})
    from html import unescape
    if isinstance(title,dict) and title.get('raw') is not None:name=unescape(str(title['raw'])).strip()
    else:
        rendered=title.get('rendered') if isinstance(title,dict) else title
        name=text(html.fromstring('<span>'+str(rendered or '')+'</span>'))
    selected={k:raw[k] for k in API_FIELDS if k in raw}
    return {'source_record_id':raw['link'],'provider_record_id':str(raw['id']),'name':name or None,
        'source_url':url,'profile_url':raw['link'],'address':raw.get('street'),'city':raw.get('city'),
        'province':raw.get('region'),'country':raw.get('country'),'postal_code':raw.get('zip'),
        'latitude':raw.get('latitude'),'longitude':raw.get('longitude'),'website':raw.get('website'),'phone':raw.get('tel'),
        'published_categories':raw.get('post_category',[]),'source_published_at':raw.get('date_gmt') or raw.get('date'),
        'source_modified_at':raw.get('modified_gmt') or raw.get('modified'),'observed_at':observed,
        'record_type':'directory_listing_candidate','entity_type':'business_candidate','directory_publisher':'Downtown Yonge BIA',
        'association_membership_verified':False,'physical_presence_verified':False,'eligibility':'research_only','campaign_ready':False,
        'raw_payload':selected,'name_validity_status':'source_name_present' if name else 'source_name_missing_hold'}


def collect_public_api(folder,*,index_path,transport=None):
    from urllib.parse import urlencode
    folder=Path(folder)/'downtown-yonge-public-api';folder.mkdir(parents=True,exist_ok=True)
    if (folder/'manifest.json').exists():
        m=json.loads((folder/'manifest.json').read_text())
        if sha(folder/m['records_file'])!=m['records_sha256']:raise SourceBlocked('Frozen API factual source differs')
        return m
    if shutil.disk_usage(folder).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
    index=json.loads(Path(index_path).read_text());route=index.get('routes',{}).get('/geodir/v2/places')
    if not route or not any('GET' in e.get('methods',[]) and e.get('args',{}).get('per_page',{}).get('maximum')==100 for e in route.get('endpoints',[])):
        raise SourceBlocked('Expected explicit publisher public API schema not verified')
    checkpoint=folder/'checkpoint.json';state=json.loads(checkpoint.read_text()) if checkpoint.exists() else {'next_page':1,'pages':[],'expected_count':None,'observed_at':datetime.now(timezone.utc).isoformat(),'requests':0,'bytes_fetched':0,'status':'pending'}
    t=transport or Transport(max_requests=200,max_bytes=25000000,max_response_bytes=5000000,timeout=30,retries=1,allowed_hosts=['downtownyonge.com'])
    before=(t.requests,t.bytes_fetched)
    def charge():
        nonlocal before
        state['requests']+=t.requests-before[0];state['bytes_fetched']+=t.bytes_fetched-before[1];before=(t.requests,t.bytes_fetched)
    rows=[];seen=set()
    for filename in state['pages']:
        page=json.loads((folder/filename).read_text())
        for row in page['rows']:
            if row['provider_record_id'] in seen:raise SourceBlocked('Saved API pages repeat native IDs')
            rows.append(row);seen.add(row['provider_record_id'])
    try:
        while state['expected_count'] is None or len(rows)<state['expected_count']:
            if shutil.disk_usage(folder).free<2*1024**3:raise BudgetExceeded('2GiB capacity hold; API cursor durable')
            params={'per_page':100,'page':state['next_page'],'context':'view','_fields':','.join(API_FIELDS)}
            url=API_URL+'?'+urlencode(params);response=t.fetch(url);data=response.json()
            if not isinstance(data,list):raise SourceBlocked('Public API returned no factual listing list')
            headers={k.lower():v for k,v in response.headers.items()}
            if 'x-wp-total' not in headers or 'x-wp-totalpages' not in headers:raise SourceBlocked('Publisher count headers missing; no false complete source')
            expected=int(headers['x-wp-total']);page_count=int(headers['x-wp-totalpages'])
            if state['expected_count'] is not None and expected!=state['expected_count']:raise SourceBlocked('Publisher count changed; retain partial observation cohort')
            state['expected_count']=expected
            if page_count!=(expected+99)//100:raise SourceBlocked('Publisher page/count header mismatch')
            parsed=[api_facts(r,url,state['observed_at']) for r in data]
            ids=[r['provider_record_id'] for r in parsed]
            if len(set(ids))!=len(ids) or any(i in seen for i in ids):raise SourceBlocked('Public API pages repeat native listing IDs')
            expected_page=min(100,expected-len(rows))
            if len(parsed)!=expected_page:raise SourceBlocked('Public API page stopped before declared count')
            filename=f'page-{state["next_page"]:04d}-facts.json'
            atomic(folder/filename,{'url':url,'response_sha256':hashlib.sha256(response.body).hexdigest(),'publisher_total':expected,'rows':parsed,'fields_requested':API_FIELDS})
            state['pages'].append(filename);rows.extend(parsed);seen.update(ids);state['next_page']+=1
            state['status']='completed' if len(rows)==expected else 'running';state.pop('error',None);charge();atomic(checkpoint,state)
            print(json.dumps({'source':'downtown-yonge-public-api','pages':len(state['pages']),'rows':len(rows),'publisher_total':expected}),flush=True)
        # Recheck count at the end; no claim of an atomic publisher snapshot.
        response=t.fetch(API_URL+'?per_page=1&_fields=id');headers={k.lower():v for k,v in response.headers.items()}
        if int(headers.get('x-wp-total',-1))!=state['expected_count']:raise SourceBlocked('Publisher total drifted after API pagination')
        state['final_count_rechecked']=True;state['status']='completed';state.pop('error',None)
    except (SourceBlocked,BudgetExceeded,OSError,ValueError) as exc:state['status']='partial' if rows else 'blocked';state['error']=str(exc)
    charge();atomic(checkpoint,state)
    path=folder/'factual-directory-observations.jsonl.gz'
    with gzip.open(path.with_suffix('.gz.tmp'),'wt',encoding='utf-8') as f:
        for row in rows:f.write(json.dumps(row,ensure_ascii=False)+'\n')
    path.with_suffix('.gz.tmp').replace(path)
    m={'source_id':'bia-downtown-yonge-public-directory','publisher':'Downtown Yonge BIA','source_url':API_URL,'original_directory_url':SPECS['downtown-yonge']['url'],
       'rights_status':'limited_factual_review_only','parser_version':'bia-public-facts-api/1','status':state['status'],'observed_at':state['observed_at'],
       'acquired_raw_factual_observations':len(rows),'unique_native_ids':len(seen),'reported_row_count':state['expected_count'],'pages':len(state['pages']),
       'source_inventory_exhausted':state['status']=='completed' and state.get('final_count_rechecked',False),'market_completeness_verified':False,
       'records_file':path.name,'records_sha256':sha(path),'native_id_sorted_sha256':hashlib.sha256(('\n'.join(sorted(seen))+'\n').encode()).hexdigest(),
       'publisher_api_index':str(index_path),'publisher_api_index_sha256':sha(Path(index_path)),'public_fields_selected':list(API_FIELDS),'narratives_media_people_fields_excluded':True,
       'final_count_rechecked':state.get('final_count_rechecked',False),'atomic_publisher_snapshot':False,'snapshot_limitation':'Count stable across pages and at end; source may edit individual facts during the observation window',
       'metrics':{'requests':state['requests'],'bytes_fetched':state['bytes_fetched'],'estimated_cost':0,'cost_currency':None,'paid_service_calls':0,'model_api_calls':0},
       'record_unit':'public business-directory listing; no legal-company, owner, membership or current-operation verification','no_main_writes':True}
    atomic(folder/('manifest.json' if state['status']=='completed' else 'partial-manifest.json'),m);return m


if __name__=='__main__':main()
