"""Selected facts from actual public rural Durham directory HTML snapshots."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re
from pathlib import Path
from urllib.parse import urljoin,urlsplit
from lxml import html
from .construction_rosters import clean,sha,safe
from .gta_sources import save
from .transport import SourceBlocked

SPECS={
 'brock':{'receipt':'brock-board-public-directory','source_id':'brock-board-public-member-directory','publisher':'Brock Board of Trade','url':'https://www.brockboardoftrade.com/member-directory'},
 'bowmanville':{'receipt':'bowmanville-bia-directory','source_id':'bowmanville-bia-public-directory','publisher':'Bowmanville BIA','url':'https://bowmanville.com/directory/'},
}

def base(spec,native,name,profile,stamp,facts):
 return {'source_id':spec['source_id'],'source_record_id':native,'source_record_id_basis':'Native rendered publisher directory record ID, scoped to source',
  'source_url':profile,'observed_at':stamp,'name':name,'website':None,'address':None,'city':None,'province':None,'country':None,'postal_code':None,'phone':None,'email':None,
  'categories':[],'record_type':'public_directory_listing','entity_type':'organisation_candidate',
  'organisation_name_usable':True,'rights_status':'limited_factual_review_only','eligibility':'research_only','campaign_ready':False,'raw_payload':facts}

def parse_brock(body,stamp):
 spec=SPECS['brock'];root=html.fromstring(body);rows=[];ids=set()
 for card in root.xpath('//*[@role="listitem" and contains(@class,"wixui-repeater__item")][.//h2]'):
  headings=card.xpath('.//h2');links=card.xpath('.//a[contains(@href,"/members/")]/@href');native=(card.get('id') or '').split('__')[-1]
  if len(headings)!=1 or not links or not re.fullmatch(r'[a-f0-9-]{36}',native):raise SourceBlocked('Unexpected public member card schema')
  if native in ids:raise SourceBlocked('Duplicate rendered member UUID')
  ids.add(native);name=clean(headings[0].text_content());web=card.xpath('.//h3//a[starts-with(@href,"http")]/@href')
  if not name:raise SourceBlocked('Blank public member name')
  profile=links[0];facts={'native_member_uuid':native,'name':name,'profile_url':profile,'website':web[0] if web else None}
  row=base(spec,native,name,profile,stamp,facts);row['website']=facts['website'];row['record_type']='association_member_listing'
  row['relationships']=[{'relationship_type':'member_of','object_name':spec['publisher'],'source_url':spec['url'],'basis':'Explicit public member directory; independent membership/site verification pending'}]
  rows.append(row)
 if not rows:raise SourceBlocked('Expected public member cards missing')
 return rows

def parse_bowmanville(body,stamp):
 spec=SPECS['bowmanville'];root=html.fromstring(body);rows=[];ids=set()
 for card in root.xpath('//*[@id="companies"]/div[@data-id]'):
  names=card.xpath('.//h3[contains(concat(" ",normalize-space(@class)," ")," company ")]')
  links=card.xpath('.//div[contains(@class,"directory-listing")]/a/@href')
  if len(names)!=1 or len(links)!=1:raise SourceBlocked('Unexpected public directory company card schema')
  native=card.get('data-id');name=clean(names[0].text_content());profile=urljoin(spec['url'],links[0])
  if not native or native in ids or not name:raise SourceBlocked('Blank/duplicate publisher listing ID or name')
  ids.add(native)
  address=card.xpath('.//div[contains(concat(" ",normalize-space(@class)," ")," address ")]');phone=card.xpath('.//div[contains(concat(" ",normalize-space(@class)," ")," phone ")]')
  address=clean(address[0].text_content()) if address else None;phone=clean(phone[0].text_content()) if phone else None
  status=re.match(r'^\(([^)]+)\)\s*(.*)$',name);marker=status.group(1) if status else None;remainder=status.group(2) if status else name
  placeholder=bool(marker and any(x in marker.lower() for x in ['vacant','displaced','closed']) and re.match(r'^(?:\d|2nd\b)',remainder,re.I))
  facts={'native_listing_id':native,'name':name,'profile_url':profile,'published_street_address':address,'phone':phone,
    'published_status_marker':marker,'category_css_code':card.get('data-type'),'category_profile_slug':urlsplit(profile).path.strip('/').split('/')[1]}
  row=base(spec,native,name,profile,stamp,facts);row['address']=address;row['phone']=phone
  row['categories']=[facts['category_profile_slug']];row['published_listing_status']=marker
  row['organisation_name_usable']=not placeholder;row['entity_type']='property_status_observation' if placeholder else 'organisation_or_site_candidate'
  row['record_type']='property_status_placeholder' if placeholder else 'bia_business_directory_listing'
  row['published_directory_scope']='Downtown Bowmanville BIA; street-only row address does not independently establish municipality'
  row['relationships']=[{'relationship_type':'listed_in','object_name':spec['publisher']+' directory','source_url':spec['url'],'basis':'Published directory inclusion; no current tenancy/operation/legal identity inference'}]
  rows.append(row)
 if not rows:raise SourceBlocked('Expected complete embedded company list missing')
 return rows

def acquire_saved(source,inspection,output):
 spec=SPECS[source];inspection=Path(inspection);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 raw=inspection/(spec['receipt']+'.response');receipts=json.loads((inspection/'inspection.json').read_text());receipt=next(x for x in receipts['receipts'] if x['id']==spec['receipt'])
 if sha(raw)!=receipt['sha256']:raise SourceBlocked('Saved public directory source changed')
 manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  if m['source_response_sha256']!=sha(raw):raise SourceBlocked('Frozen source changed')
  for f,digest in m['files'].items():
   if sha(output/f)!=digest:raise SourceBlocked('Frozen factual output changed')
  return m
 rows=(parse_brock if source=='brock' else parse_bowmanville)(raw.read_bytes(),receipt['observed_at'])
 candidates=[r for r in rows if r['organisation_name_usable']]
 for file,records in [('all-public-directory-observations.jsonl.gz',rows),('organisation-research-candidates.jsonl.gz',candidates)]:
  with gzip.open(output/file,'wt',encoding='utf8') as stream:
   for row in records:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
 fields=['source_id','source_record_id','name','website','address','city','province','country','postal_code','phone','record_type','organisation_name_usable','source_url','observed_at','rights_status','eligibility','campaign_ready']
 with gzip.open(output/'all-public-directory-facts.csv.gz','wt',encoding='utf8',newline='') as stream:
  writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
  for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
 save(output/'native-rendered-record-id-inventory.json',sorted(r['source_record_id'] for r in rows))
 complete=source=='bowmanville'
 m={'source_id':spec['source_id'],'publisher':spec['publisher'],'source_url':spec['url'],'source_response_sha256':sha(raw),'source_observed_at':receipt['observed_at'],
  'rights_status':'limited_factual_review_only','rights_review':'Actual public directory/footer reviewed; no linked explicit commercial/automation restriction found. Minimal factual internal research only; no open redistribution grant inferred.',
  'acquired_raw_factual_rows':len(rows),'organisation_research_candidates':len(candidates),'property_status_placeholders_retained':len(rows)-len(candidates),
  'unique_native_rendered_ids':len(rows),'publisher_reported_total':None,'source_inventory_exhausted':complete,
  'exhaustion_scope':f'All{len(rows)}embedded public company cards; actual linked public script clones #companies into visible directory without fetching a second roster' if complete else f'All{len(rows)}rendered public member cards captured; no published total or pagination control found, upstream/full membership exhaustion unproven',
  'status':'completed' if complete else 'partial_source_total_unverified','count_is_not_verified_company_count':True,
  'missing_locality_not_filled_from_source_footer':True,'narratives_media_named_contact_fields_excluded':True,
  'record_unit':'Publisher member/business/place-status listing, not legal company or independently verified operating site',
  'category_basis':'Literal source profile category slug; raw CSS category codes retained because public filter code/labels are inconsistent' if complete else 'No category printed in card; not inferred from narrative',
  'metrics':{'requests':0,'bytes_fetched':0,'paid_service_calls':0,'basis':'Saved response reused; original source inspection HTTP metrics retained separately, not recharged'},
  'source_evidence':str(inspection/'inspection.json'),'no_main_writes':True,'market_completeness_verified':False,
  'files':{p.name:sha(p) for p in output.iterdir() if p.is_file()}}
 save(manifest_path,m);(output/'README.md').write_text(f'{len(rows)} actual published directory observations captured, {len(candidates)} usable named organisation/site research candidates and {len(rows)-len(candidates)} explicit property-status placeholders. All source statuses/addresses retained; no current operation or company identity claim. Country/city/website missing in source remains unknown; source footer never fills location. No descriptions/photos/contact-person names copied. Minimal factual internal research, no public redistribution grant.\n\n'+m['exhaustion_scope']+'\n');return m

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',choices=sorted(SPECS),required=True);p.add_argument('--inspection',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();print(json.dumps(acquire_saved(a.source,a.inspection,a.output),indent=2))
