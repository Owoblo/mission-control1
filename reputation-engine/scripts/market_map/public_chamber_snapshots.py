"""Selected public company facts from publisher-rendered chamber snapshots."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re
from pathlib import Path
from urllib.parse import quote
from lxml import html
from .gta_sources import save
from .transport import SourceBlocked
from .construction_rosters import safe,sha

APBOT='https://www.apboardoftrade.com/member-directory'
INDIVIDUAL=re.compile(r'(?:^|-)(?:independent|individual|personal|retired|retiree|student|youth)(?:-|$)|(?:^|-)young-professionals?(?:-|$)')

def initial_data(body):
 root=html.fromstring(body);found=[]
 for script in root.xpath('//script[not(@src)]/text()'):
  if not script.startswith('self.__next_f.push('):continue
  try:flight=json.loads(script[len('self.__next_f.push('):-1])
  except (ValueError,TypeError):continue
  value=flight[1] if len(flight)>1 else None
  if not isinstance(value,str):continue
  index=value.find('{"initialData":')
  if index>=0:
   try:found.append(json.JSONDecoder().raw_decode(value[index:])[0]['initialData'])
   except (ValueError,KeyError,TypeError) as exc:raise SourceBlocked('Malformed public member payload') from exc
 if len(found)!=1 or not isinstance(found[0].get('members'),list):raise SourceBlocked('Expected one complete public member payload')
 return found[0]

def parse_apbot(body, *, observed_at):
 data=initial_data(body);members=data['members'];categories={x['id']:x['name'] for x in data['categories']}
 ids=set();rows=[];inventory=[]
 for member in members:
  native=member.get('id')
  if not native or native in ids:raise SourceBlocked('Missing/duplicate publisher member ID')
  ids.add(native)
  membership=((member.get('cmpExtension') or {}).get('membership') or {}).get('membershipTypeName') or ''
  slug=re.sub(r'[^a-z0-9]+','-',membership.strip().lower().replace('&',' and ').replace("'",'').replace('’','')).strip('-')
  # This exact membership-name test is printed in the public display client.
  individual=bool(INDIVIDUAL.search(slug))
  inventory.append({'source_record_id':native,'record_disposition':'excluded_explicit_individual_member' if individual else 'company_member_factual_observation'})
  if individual:continue
  if not member.get('name'):raise SourceBlocked('Blank company member name')
  # Public UI suppresses address and map markers unless this flag is strictly false.
  visible=member.get('hideAddressFromDirectory') is False
  address=(member.get('address') or {}) if visible else {}
  coordinates=(member.get('coordinates') or {}) if visible else {}
  lat=coordinates.get('latitude');lon=coordinates.get('longitude')
  if not isinstance(lat,(int,float)) or not isinstance(lon,(int,float)) or not -90<=lat<=90 or not -180<=lon<=180:lat=lon=None
  category_ids=member.get('categoryId') or []
  if not isinstance(category_ids,list):category_ids=[category_ids]
  labels=[categories[k] for k in category_ids if isinstance(k,str) and k in categories]
  facts={'id':native,'name':member['name'],'website':member.get('website'),
   'phone':member.get('phoneNumber'),'toll_free_phone':member.get('tollFreePhoneNumber'),
   'category_ids':category_ids,'categories':labels,'membership_type_published':membership,
   'address_display_allowed':visible,'address':address.get('streetAddress'),'city':address.get('city'),
   'province':address.get('province'),'postal_code':address.get('postalCode'),'latitude':lat,'longitude':lon}
  rows.append({'source_id':'ajax-pickering-board-public-directory','source_record_id':native,
   'source_record_id_basis':'Publisher public member UUID; no legal-company identity claim',
   'source_url':APBOT+'?member='+quote(native,safe=''),'observed_at':observed_at,
   **{k:facts[k] for k in ['name','website','phone','address','city','province','postal_code','latitude','longitude']},
   'country':None,'email':None,'categories':labels,
   'record_type':'association_company_member_listing','entity_type':'organisation_candidate',
   'eligibility':'research_only','campaign_ready':False,'rights_status':'limited_factual_review_only',
   'raw_payload':facts,'relationships':[{'relationship_type':'member_of','object_name':data['chamber']['name'],
    'source_url':APBOT,'basis':'Publisher current public member directory; independent verification pending'}]})
 return rows,inventory

def acquire_saved_apbot(inspection, output):
 inspection=Path(inspection);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 source=inspection/'ajax-pickering-board-directory.response';receipts=json.loads((inspection/'inspection.json').read_text())
 receipt=next(x for x in receipts['receipts'] if x['id']=='ajax-pickering-board-directory')
 if sha(source)!=receipt['sha256']:raise SourceBlocked('Saved public response changed')
 manifest_path=output/'manifest.json'
 if manifest_path.exists():
  manifest=json.loads(manifest_path.read_text())
  if manifest['source_response_sha256']!=sha(source):raise SourceBlocked('Frozen source changed')
  for name,digest in manifest['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen output changed')
  return manifest
 rows,inventory=parse_apbot(source.read_bytes(),observed_at=receipt['observed_at'])
 with gzip.open(output/'public-company-member-facts.jsonl.gz','wt',encoding='utf8') as stream:
  for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
 fields=['source_id','source_record_id','name','website','address','city','province','postal_code','country','phone','latitude','longitude','source_url','observed_at','rights_status','eligibility','campaign_ready']
 with gzip.open(output/'public-company-member-facts.csv.gz','wt',encoding='utf8',newline='') as stream:
  writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
  for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
 save(output/'public-member-id-inventory.json',inventory)
 manifest={'source_id':'ajax-pickering-board-public-directory','publisher':'Ajax-Pickering Board of Trade',
  'source_url':APBOT,'source_response_sha256':sha(source),'source_evidence':str(inspection/'inspection.json'),
  'observed_at':receipt['observed_at'],'public_member_payload_rows':len(inventory),'unique_native_member_ids':len(inventory),
  'company_member_factual_rows':len(rows),'explicit_individual_members_excluded':len(inventory)-len(rows),
  'hidden_address_company_rows':sum(not r['raw_payload']['address_display_allowed'] for r in rows),
  'hidden_addresses_or_coordinates_copied':0,'named_contact_or_email_fields_copied':0,
  'source_inventory_exhausted':True,'exhaustion_scope':'All native member IDs in actually rendered public initialData payload; no private/member API called',
  'rights_status':'limited_factual_review_only','rights_review':'Public entry/home/footer reviewed; no linked restrictive terms or explicit commercial/automation ban found. Minimal published company facts only; no redistribution licence inferred.',
  'display_rule_evidence':'../gta-regional-source-acquisition/apbot-public-display-review/inspection.json',
  'requests':0,'bytes_fetched':0,'cost':0,'metrics_basis':'Existing saved public response reused; original inspection metrics separate, not recharged',
  'record_unit':'Published company-member listing, not verified legal company/current site',
  'market_completeness_verified':False,'files':{p.name:sha(p) for p in output.iterdir() if p.is_file()}}
 save(manifest_path,manifest)
 (output/'README.md').write_text('Public Ajax-Pickering Board company-member facts\n\nThe saved anonymous public directory contained '+str(len(inventory))+' native member IDs. '+str(len(rows))+' company/organisation member cards retained; '+str(len(inventory)-len(rows))+' explicitly individual membership records excluded without copying their names. Address and coordinate fields copied only when the exact public client flag hideAddressFromDirectory is false. Contact-person names, email, biographies, API keys and internal lifecycle settings excluded. Publisher member relationships are source claims; no current operation/legal identity/municipal coverage verification or outreach eligibility. Minimal factual internal research only; original private HTTP receipt retained separately.\n')
 return manifest

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inspection',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();print(json.dumps(acquire_saved_apbot(a.inspection,a.output),indent=2))
