"""Facts from actual static BIA rosters. Snapshot keys do not claim native identities."""
from __future__ import annotations
import argparse,copy,csv,gzip,hashlib,json,re
from pathlib import Path
from lxml import html
from .construction_rosters import clean,sha,safe
from .gta_sources import save
from .transport import SourceBlocked

def literal(value):return clean(value.replace('\u200b','').replace('\ufeff',''))
def lines(node):
 parts=[]
 def walk(x):
  if x.text:parts.append(x.text)
  for child in x:
   if child.tag=='br':parts.append('\n')
   else:walk(child)
   if child.tail:parts.append(child.tail)
 walk(node);return [literal(line) for line in ''.join(parts).split('\n')]

def parse_bloor(body):
 root=html.fromstring(body);regions=root.xpath('//div[contains(concat(" ",normalize-space(@class)," ")," entry-content ")]')
 if len(regions)!=1:raise SourceBlocked('Expected single Bloor Annex roster region')
 region=regions[0];records=[]
 for ordinal,node in enumerate(region.xpath('./p[strong]'),1):
  names=node.xpath('./strong')
  if len(names)!=1:raise SourceBlocked('Unexpected Bloor business name schema')
  name=literal(names[0].text_content());copy_node=copy.deepcopy(node);copy_node.xpath('./strong')[0].drop_tree()
  values=[x for x in lines(copy_node) if x];webs=list(dict.fromkeys(a.get('href') for a in node.xpath('.//a[@href]') if a.get('href').startswith(('http://','https://'))))
  web_labels={literal(a.text_content()) for a in node.xpath('.//a[@href]')};phone=next((re.sub(r'^T:\s*','',x) for x in values if x.startswith('T:') and re.sub(r'^T:\s*','',x)),None)
  address=[];other=[]
  for value in values:
   if value.startswith('T:') or value in web_labels:continue
   if re.match(r'^(?:\+?\d[\d ()-]{5,}|https?://|www\.)',value) and not re.search(r'\b(?:Bloor|Brunswick|Madison|Walmer|Spadina|Station)\b',value):
    if phone is None and re.match(r'^\+?\d[\d ()-]{7,}',value):phone=value
    else:other.append(value)
   elif value.startswith('Located within '):other.append(value)
   else:address.append(value)
  records.append({'name':name,'address_lines':address,'phone':phone,'published_websites':webs,'other_factual_lines':other,'source_ordinal':ordinal,'source_native_id':None})
 if not records or len(region.xpath('./p[strong]'))!=len(records):raise SourceBlocked('Empty/inconsistent static Bloor roster')
 return records

def parse_college(body):
 root=html.fromstring(body);regions=[n for n in root.xpath('//div[contains(concat(" ",normalize-space(@class)," ")," paragraph ")]') if len(n.xpath('.//strong'))>20]
 if len(regions)!=1:raise SourceBlocked('Expected single College Promenade A-Z roster paragraph')
 region=regions[0];groups=[];group=[]
 for line in lines(region)+['']:
  if line:group.append(line)
  elif group:groups.append(group);group=[]
 records=[]
 for ordinal,values in enumerate(groups,1):
  if len(values)<2:raise SourceBlocked('A-Z business block missing its address line: '+str(values))
  name=values[0];phone=next((x for x in values[1:] if re.fullmatch(r'[+\d ()-]{7,}(?:\s*(?:ext|x)\.?\s*\d+)?',x,re.I)),None)
  address=[x for x in values[1:] if x!=phone]
  if not re.match(r'^\d',address[0]):raise SourceBlocked('A-Z business/address boundary ambiguous: '+str(values))
  urls=list(dict.fromkeys(a.get('href') for a in region.xpath('.//a[@href]') if literal(a.text_content())==name and a.get('href').startswith(('http://','https://'))))
  records.append({'name':name,'address_lines':address,'phone':phone,'published_websites':urls,'other_factual_lines':[],'source_ordinal':ordinal,'source_native_id':None})
 if not records:raise SourceBlocked('Empty static College roster')
 return records

def build(inspection,output,kind):
 inspection=Path(inspection);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if (output/'manifest.json').exists():
  manifest=json.loads((output/'manifest.json').read_text())
  for name,digest in manifest['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen factual snapshot changed')
  return manifest
 key='bloor-annex-offered-business-directory' if kind=='bloor' else 'college-promenade-offered-complete-list'
 source=inspection/(key+'.response');body=source.read_bytes();receipt=next(x for x in json.loads((inspection/'inspection.json').read_text())['receipts'] if x['id']==key)
 if hashlib.sha256(body).hexdigest()!=receipt['sha256']:raise SourceBlocked('Saved source response hash mismatch')
 parser=parse_bloor if kind=='bloor' else parse_college;facts=parser(body);rows=[];source_id='bloor-annex-public-directory' if kind=='bloor' else 'college-promenade-public-az-directory'
 for fact in facts:
  address=', '.join(fact['address_lines']) or None;postal=re.search(r'\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d)\b',address or '',re.I)
  rows.append({'source_id':source_id,'source_record_id':'snapshot:'+receipt['sha256']+':'+str(fact['source_ordinal']),'source_record_id_basis':'Exact source snapshot SHA256 plus published position; no persistent native/company ID invented','source_url':receipt['url'],'observed_at':receipt['observed_at'],'name':fact['name'],'address':address,'phone':fact['phone'],'website':fact['published_websites'][0] if len(fact['published_websites'])==1 else None,'city':'Toronto' if re.search(r'\bToronto\b',address or '',re.I) else None,'province':'ON' if re.search(r'\bON\b',address or '') else None,'country':None,'postal_code':postal.group(1).upper() if postal else None,'categories':[],'record_type':'public_bia_directory_listing','entity_type':'organisation_candidate','eligibility':'research_only','campaign_ready':False,'rights_status':'limited_factual_review_only','raw_payload':fact})
 with gzip.open(output/'published-business-facts.jsonl.gz','wt',encoding='utf8') as stream:
  for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
 fields=['source_id','source_record_id','name','address','city','province','country','postal_code','phone','website','source_url','observed_at','eligibility','campaign_ready']
 with gzip.open(output/'published-business-facts.csv.gz','wt',encoding='utf8',newline='') as stream:
  writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
  for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
 save(output/'source-observation-keys.json',[r['source_record_id'] for r in rows])
 manifest={'source_id':source_id,'publisher':'Bloor Annex BIA' if kind=='bloor' else 'College Promenade BIA','source_url':receipt['url'],'source_evidence':str(source),'source_sha256':receipt['sha256'],'observed_at':receipt['observed_at'],'raw_factual_rows':len(rows),'publisher_reported_total':None,'source_inventory_exhausted':True,'exhaustion_scope':'All business paragraphs in actual unpaginated public Bloor Annex Business Directory' if kind=='bloor' else 'All blocks in actually offered Complete List A-Z page; separate25-row featured/blog view not added as duplicate companies','record_unit':'Published factual roster entry, not verified legal company/site/current operation','rights_status':'limited_factual_review_only','rights_basis':'Actual public homepage/directory/footer reviewed; no linked explicit commercial/automation prohibition found. Internal minimal factual research only; no open redistribution licence inferred.','no_contact_people_narratives_media_enriched':True,'missing_location_not_filled_from_publisher_office':True,'snapshot_positions_not_native_company_ids':True,'metrics':{'requests':0,'bytes_fetched':0,'paid_service_calls':0,'basis':'Saved guarded inspection response reused; original HTTP counts stay with inspection acquisition'},'market_completeness_verified':False,'no_main_writes':True,'files':{p.name:sha(p) for p in output.iterdir() if p.is_file()}}
 save(output/'manifest.json',manifest);return manifest

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inspection',required=True,type=Path);p.add_argument('--output',required=True,type=Path);p.add_argument('--kind',required=True,choices=['bloor','college']);a=p.parse_args();print(json.dumps(build(a.inspection,a.output,a.kind),indent=2))
