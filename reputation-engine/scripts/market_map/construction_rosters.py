"""Minimal factual construction-association observations; no store writes."""
from __future__ import annotations
import argparse
import csv
import gzip
import hashlib
import json
import re
from pathlib import Path
import shutil
import time
from lxml import html
from .chamber_rosters import parse_address_lines
from .gta_sources import save
from .transport import SourceBlocked
from .transport import Transport

MCA_URL='https://www.mcahamiltonniagara.org/directory.php'
RIGHTS='limited_factual_review_only'
BILD_URL='https://www.bildgta.ca/about/find-a-member/'
BILD_FORM='https://www.bildgta.ca/wp-admin/admin-ajax.php'
BILD_JS='https://www.bildgta.ca/wp-content/themes/bildgta-theme/js/bildgta.min.js?ver=1.0.1'

def clean(value):return ' '.join(value.split())
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def safe(value):
 value='' if value is None else str(value)
 return "'"+value if value.lstrip().startswith(('=','+','-','@')) else value

def parse_mcahn(body, *, observed_at, source_url=MCA_URL):
 root=html.fromstring(body);rows=[];sections={}
 for heading in root.xpath('//h3[@class="pagetitle"]'):
  kind=clean(heading.text_content())
  if kind not in ('Our Members','Associate Members'):continue
  if kind in sections:raise SourceBlocked('Duplicate business section')
  section=heading.getparent();count=0
  for paragraph in section.xpath('./p[b]'):
   names=paragraph.xpath('./b[1]')
   if not names:continue
   name=clean(names[0].text_content())
   if not name or name in ('T:','F:'):continue
   # Split visible lines, removing contact-person fields before retained data.
   fragment=html.fromstring(html.tostring(paragraph))
   for br in fragment.xpath('.//br'):br.tail='\n'+(br.tail or '')
   lines=[clean(x) for x in fragment.text_content().splitlines() if clean(x)]
   lines=[x for x in lines if not x.lower().startswith('contact:')]
   websites=paragraph.xpath('.//a[starts-with(@href,"http")]/@href')
   phone=[];fax=[];address=[];after_name=False
   for line in lines:
    if not after_name:
     if line==name:after_name=True
     continue
    if line.startswith(('T:','F:')):
     (phone if line.startswith('T:') else fax).append(line[2:].strip());continue
    if line.startswith(('www.','http','A division of','or','1-800')):continue
    address.append(line)
   parsed=parse_address_lines(address)
   count+=1;key=f'{kind}:{count}'
   facts={'name':name,'website':websites[0] if websites else None,'published_address_lines':address,
          'phone':'; '.join(phone) or None,'fax':'; '.join(fax) or None,'member_section':kind}
   rows.append({'source_id':'mcahn-public-member-directory','source_record_id':key,
     'source_record_id_basis':'derived publisher section and position; no native business identifier published',
     'source_url':source_url,'observed_at':observed_at,'name':name,'website':facts['website'],
     **parsed,'phone':facts['phone'],'email':None,'record_type':'association_member_listing',
     'entity_type':'organisation_candidate','member_section':kind,'rights_status':RIGHTS,
     'eligibility':'research_only','campaign_ready':False,'raw_payload':facts,
     'relationships':[{'relationship_type':'member_of','object_name':'Mechanical Contractors Association Hamilton Niagara',
       'source_url':source_url,'qualification':kind,'basis':'Explicit publisher directory section; not independently verified'}]})
  sections[kind]=count
 if set(sections)!= {'Our Members','Associate Members'} or not all(sections.values()):
  raise SourceBlocked('Expected complete business and associate sections missing')
 return rows,sections

def acquire_saved_mcahn(inspection, output):
 inspection=Path(inspection);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 raw=inspection/'mcahn-directory.response';receipt=json.loads((inspection/'inspection.json').read_text())
 evidence=next(r for r in receipt['receipts'] if r['id']=='mcahn-directory')
 if sha(raw)!=evidence['sha256']:raise SourceBlocked('Saved publisher response hash mismatch')
 manifest_path=output/'manifest.json'
 if manifest_path.exists():
  manifest=json.loads(manifest_path.read_text())
  if manifest['raw_source_sha256']!=sha(raw):raise SourceBlocked('Frozen input changed')
  for file,digest in manifest['files'].items():
   if sha(output/file)!=digest:raise SourceBlocked('Frozen output changed: '+file)
  return manifest
 rows,sections=parse_mcahn(raw.read_bytes(),observed_at=evidence['observed_at'])
 frozen=output/'publisher-directory.html.gz'
 with gzip.open(frozen,'wb') as stream:stream.write(raw.read_bytes())
 if hashlib.sha256(gzip.decompress(frozen.read_bytes())).hexdigest()!=sha(raw):raise SourceBlocked('Raw gzip verification failed')
 records=output/'business-member-facts.jsonl.gz'
 with gzip.open(records,'wt',encoding='utf8') as stream:
  for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
 fields=['source_id','source_record_id','name','website','address','city','province','postal_code','country','phone','member_section','source_url','observed_at','rights_status','eligibility','campaign_ready']
 csv_path=output/'construction-business-member-facts.csv.gz'
 with gzip.open(csv_path,'wt',encoding='utf8',newline='') as stream:
  writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
  for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
 manifest={'source_id':'mcahn-public-member-directory','source_url':MCA_URL,'publisher':'Mechanical Contractors Association Hamilton Niagara',
  'observed_at':evidence['observed_at'],'raw_source_sha256':sha(raw),'rows':len(rows),'business_sections':sections,
  'rights_status':RIGHTS,'rights_review':'Ordinary public directory and home reviewed; no linked terms/privacy or explicit commercial/automation prohibition found. Minimal factual internal research only; no open redistribution licence inferred.',
  'source_inventory_exhausted':True,'exhaustion_scope':'Both complete offered business-member sections in saved single HTML page; board/committees/person sections excluded',
  'record_unit':'Published association business-member listing, not legal company or verified site',
  'requests':0,'bytes_fetched':0,'cost':0,'metrics_basis':'Saved response reused; original inspection HTTP metrics retained separately, not recharged',
  'source_evidence':str(inspection/'inspection.json'),'files':{x.name:sha(x) for x in [frozen,records,csv_path]},'market_completeness_verified':False}
 save(manifest_path,manifest)
 (output/'README.md').write_text('Published construction business-member facts\n\n'+str(len(rows))+' member and associate listings from the two complete public business sections. Board members, contact-person names, biographies and media excluded. Raw addresses are retained; source city/region spellings are not corrected. Membership is a publisher claim, not a legal/company/site verification. Research only, no public redistribution grant or campaign eligibility. No new HTTP calls; original saved-response receipt retains collection costs.\n')
 return manifest

def parse_bild(body, *, source_page, observed_at, initial=False):
 if not body.strip():return []
 root=html.fromstring(body)
 if initial:
  containers=root.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," member-card-list ")]')
  if len(containers)!=1:raise SourceBlocked('Expected unfiltered BILD member list missing')
  root=containers[0]
 cards=root.xpath('descendant-or-self::div[contains(concat(" ",normalize-space(@class)," ")," max-card-width ")]')
 if not cards:raise SourceBlocked('Nonempty BILD response has no expected member cards')
 rows=[]
 for index,card in enumerate(cards,1):
  def field(cls):
   values=card.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," '+cls+' ")]')
   return clean(values[0].text_content()) if values else None
  facts={k:field(cls) for k,cls in [('name','title'),('city_raw','city'),('member_type','type'),('membership_since_raw','start_date')]}
  if not facts['name']:raise SourceBlocked('Member card name missing')
  links=card.xpath('./a/@href');facts['website']=links[0] if links else None
  city,separator,region=(facts['city_raw'] or '').rpartition(',')
  if not separator:city=facts['city_raw'];region=None
  identity=hashlib.sha256(json.dumps(facts,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
  rows.append({'source_id':'bild-public-member-directory','source_record_id':f'page-{source_page}:card-{index}',
   'source_record_id_basis':'captured publisher list position; no native member ID exposed',
   'factual_signature_sha256':identity,'source_url':BILD_URL,'source_response_page':source_page,'observed_at':observed_at,
   'name':facts['name'],'website':facts['website'],'city':city.strip() if city else None,
   'city_raw':facts['city_raw'],'province':region.strip() if region else None,'country':None,
   'address':None,'postal_code':None,'phone':None,'email':None,'categories':[facts['member_type']] if facts['member_type'] else [],
   'record_type':'association_member_listing','entity_type':'organisation_candidate',
   'rights_status':RIGHTS,'eligibility':'research_only','campaign_ready':False,'raw_payload':facts,
   'relationships':[{'relationship_type':'member_of','object_name':'Building Industry and Land Development Association',
    'source_url':BILD_URL,'qualification':facts['member_type'],'membership_since_raw':facts['membership_since_raw'],
    'basis':'Explicit public current-member company list; independent membership/site verification pending'}]})
 return rows

def bild_terminal(body):
 if not body.strip():return 'empty_response'
 # The actual public handler emits this exact CSS end marker, rather than an
 # empty body. Ignore inert injected scripts; never execute challenge code.
 root=html.fromstring(body)
 styles=root.xpath('//style/text()')
 marker=any(re.fullmatch(r'\s*\.load-more-member-cards\s*\{\s*display\s*:\s*none\s*;?\s*\}\s*',x) for x in styles)
 if not marker:return None
 if root.xpath('descendant-or-self::*[contains(concat(" ",normalize-space(@class)," ")," max-card-width ")]'):return None
 for element in root.xpath('//script|//style'):element.drop_tree()
 return 'publisher_css_hides_load_more' if not clean(root.text_content()) else None

def collect_bild(inspection, output, *, transport=None, max_pages=350, deadline_seconds=4200):
 """Follow the exact anonymous Load More POST documented in publisher client JS."""
 inspection=Path(inspection);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 start=time.monotonic();manifest_path=output/'manifest.json'
 if manifest_path.exists():
  manifest=json.loads(manifest_path.read_text())
  for name,digest in manifest['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Frozen BILD output changed: '+name)
  return manifest
 t=transport or Transport(max_requests=400,max_bytes=25000000,max_response_bytes=1000000,
             timeout=30,retries=1,min_interval=10,allowed_hosts=['www.bildgta.ca'])
 state_path=output/'checkpoint.json';state=json.loads(state_path.read_text()) if state_path.exists() else {'pages':[],'metrics':{'requests':0,'bytes_fetched':0,'elapsed_seconds':0}}
 prior_metrics=state['metrics'].copy()
 def checkpoint():
  fresh=t.metrics();state['metrics']={**fresh,'requests':prior_metrics['requests']+fresh['requests'],
   'bytes_fetched':prior_metrics['bytes_fetched']+fresh['bytes_fetched'],
   'elapsed_seconds':round(prior_metrics['elapsed_seconds']+fresh['elapsed_seconds'],3),'fresh_invocation':fresh}
  save(state_path,state)
 def persist_page(page,body,stamp,request):
  raw=output/f'page-{page:04d}.html.gz';temp=raw.with_suffix('.tmp')
  with gzip.open(temp,'wb') as stream:stream.write(body)
  if gzip.decompress(temp.read_bytes())!=body:raise SourceBlocked('Raw page compression failed')
  temp.replace(raw);receipt={'page':page,'raw_file':raw.name,'raw_sha256':hashlib.sha256(body).hexdigest(),
   'gzip_sha256':sha(raw),'observed_at':stamp,'request':request}
  save(output/f'page-{page:04d}.receipt.json',receipt)
  return receipt
 try:
  if not state['pages']:
   raw=inspection/'bild-member-directory.response';source=json.loads((inspection/'inspection.json').read_text())
   receipt=next(x for x in source['receipts'] if x['id']=='bild-member-directory')
   if sha(raw)!=receipt['sha256']:raise SourceBlocked('Saved BILD source hash mismatch')
   state['pages'].append(persist_page(0,raw.read_bytes(),receipt['observed_at'],{'method':'GET','url':BILD_URL,'saved_response_reused':True}));checkpoint()
  signatures=[];all_rows=[];terminal=False
  for page in range(max_pages+1):
   prior=next((x for x in state['pages'] if x['page']==page),None)
   orphan=output/f'page-{page:04d}.receipt.json'
   if prior is None and orphan.exists():prior=json.loads(orphan.read_text());state['pages'].append(prior);checkpoint()
   if prior:
    raw=output/prior['raw_file']
    if sha(raw)!=prior['gzip_sha256']:raise SourceBlocked('Saved BILD page changed')
    body=gzip.decompress(raw.read_bytes())
    if hashlib.sha256(body).hexdigest()!=prior['raw_sha256']:raise SourceBlocked('Saved BILD raw bytes changed')
   else:
    if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before each page')
    if time.monotonic()-start>deadline_seconds:raise RuntimeError('BILD deadline reached; checkpoint preserved')
    fields={'action':'findmemberposts','posts_per_page':'9','page':page,'site':''}
    response=t.fetch_public_form(BILD_FORM,fields,documentation_url=BILD_JS)
    body=response.body;prior=persist_page(page,body,t._stamp(),{'method':'POST','url':BILD_FORM,'fields':fields,'documentation_url':BILD_JS})
    state['pages'].append(prior);checkpoint()
   end_marker=bild_terminal(body) if page>0 else None
   if end_marker:
    terminal=True;state['terminal_page']=page;state['terminal_marker']=end_marker;break
   rows=parse_bild(body,source_page=page,observed_at=prior['observed_at'],initial=page==0)
   sig=tuple(x['factual_signature_sha256'] for x in rows)
   if sig in signatures:raise SourceBlocked('Pagination repeated an earlier page; completeness unproven')
   signatures.append(sig);all_rows.extend(rows)
   print(json.dumps({'source':'bild','page':page,'page_rows':len(rows),'accumulated_appearances':len(all_rows)}),flush=True)
  if not terminal:raise RuntimeError('BILD explicit page cap reached; checkpoint preserved')
  # Terminal first-page stability check is saved, so resume never loses its cost.
  recheck_path=output/'terminal-index-recheck.receipt.json'
  if not recheck_path.exists():
   response=t.fetch(BILD_URL);recheck=parse_bild(response.body,source_page=0,observed_at=t._stamp(),initial=True)
   save(recheck_path,{'raw_sha256':hashlib.sha256(response.body).hexdigest(),'observed_at':t._stamp(),
    'first_page_signatures':[x['factual_signature_sha256'] for x in recheck]})
   with gzip.open(output/'terminal-index-recheck.html.gz','wb') as stream:stream.write(response.body)
  recheck=json.loads(recheck_path.read_text())
  if tuple(recheck['first_page_signatures'])!=signatures[0]:raise SourceBlocked('BILD first-page changed during traversal; review snapshot')
  records=output/'business-member-facts.jsonl.gz'
  with gzip.open(records,'wt',encoding='utf8') as stream:
   for row in all_rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
  fields=['source_id','source_record_id','name','website','city_raw','city','province','source_url','observed_at','rights_status','eligibility','campaign_ready']
  with gzip.open(output/'construction-business-member-facts.csv.gz','wt',encoding='utf8',newline='') as stream:
   writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
   for row in all_rows:writer.writerow({k:safe(row.get(k)) for k in fields})
  checkpoint()
  manifest={'source_id':'bild-public-member-directory','publisher':'Building Industry and Land Development Association',
   'source_url':BILD_URL,'policy_url':'https://www.bildgta.ca/privacy-policy/','public_pagination_documentation_url':BILD_JS,
   'rights_status':RIGHTS,'raw_factual_rows':len(all_rows),'unique_factual_signatures':len({x['factual_signature_sha256'] for x in all_rows}),
   'native_member_ids_published':False,'terminal_page':state['terminal_page'],'terminal_marker':state['terminal_marker'],'source_inventory_exhausted':True,
   'exhaustion_scope':'Unfiltered public Find a Member initial nine and exact publisher Load More form through publisher terminal marker; terminal first-page signatures stable',
   'metrics':state['metrics'],'declared_limits':{'max_pages':max_pages,'deadline_seconds':deadline_seconds,'max_bytes':25000000,'min_free_bytes':2*1024**3,'per_host_delay_seconds':10},
   'market_completeness_verified':False,'files':{str(p.relative_to(output)):sha(p) for p in sorted(output.iterdir()) if p.is_file() and p.name!='checkpoint.json'}}
  save(manifest_path,manifest);return manifest
 except Exception as exc:
  state['last_failure']={'error':str(exc),'at':t._stamp()};checkpoint();raise

def qualify_snapshot_positions(output):
 """Keep HTML positions scoped to the exact captured snapshot on later refreshes."""
 output=Path(output);manifest=json.loads((output/'manifest.json').read_text())
 source=output/'business-member-facts.jsonl.gz'
 if manifest.get('raw_source_sha256'):
  snapshot=manifest['raw_source_sha256']
 else:
  state=json.loads((output/'checkpoint.json').read_text())
  snapshot=hashlib.sha256(json.dumps([(r['page'],r['raw_sha256']) for r in state['pages']],sort_keys=True).encode()).hexdigest()
 pointer=output/'preferred-normalization.json'
 if pointer.exists():
  proof=json.loads(pointer.read_text())
  if proof['input_records_sha256']!=sha(source) or proof['snapshot_sha256']!=snapshot:raise SourceBlocked('Preferred snapshot input changed')
  for name,digest in proof['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Preferred snapshot output changed')
  return proof
 folder=output/'derived-snapshot-identity';folder.mkdir(exist_ok=True)
 records=folder/'business-member-facts.jsonl.gz';csv_path=folder/'construction-business-member-facts.csv.gz'
 fields=['source_id','source_record_id','name','website','address','city','province','postal_code','country','phone','source_url','observed_at','rights_status','eligibility','campaign_ready']
 count=0
 with gzip.open(source,'rt',encoding='utf8') as reader,gzip.open(records,'wt',encoding='utf8') as writer,gzip.open(csv_path,'wt',encoding='utf8',newline='') as csv_stream:
  csv_writer=csv.DictWriter(csv_stream,fieldnames=fields);csv_writer.writeheader()
  for line in reader:
   row=json.loads(line);original=row['source_record_id'];row['original_source_position_key']=original
   row['source_record_id']='snapshot:'+snapshot+':'+original
   row['source_record_id_basis']='Exact captured public HTML snapshot SHA256 plus publisher list position; no persistent native/company identity inferred'
   writer.write(json.dumps(row,ensure_ascii=False)+'\n');csv_writer.writerow({k:safe(row.get(k)) for k in fields});count+=1
 proof={'normalization_version':'snapshot-qualified-html-position-v1','preferred_records':str(records.relative_to(output)),
  'preferred_csv':str(csv_path.relative_to(output)),'input_records_sha256':sha(source),'snapshot_sha256':snapshot,
  'rows':count,'business_facts_changed':0,'raw_source_records_unchanged':True,'requests':0,'bytes_fetched':0,
  'identity_scope':'Snapshot observations; list positions cannot identify companies across reordered/new snapshots',
  'files':{str(p.relative_to(output)):sha(p) for p in [records,csv_path]}}
 save(pointer,proof)
 with (output/'README.md').open('a') as stream:stream.write('\nUse preferred-normalization.json for promotion: record positions are qualified by the exact source snapshot hash. Original normalized observations remain frozen; all business facts/counts are unchanged. No persistent native member/company ID is invented.\n')
 return proof

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--inspection',required=True,type=Path);parser.add_argument('--output',required=True,type=Path);parser.add_argument('--source',choices=['mcahn','bild'],default='mcahn')
 args=parser.parse_args();print(json.dumps((collect_bild if args.source=='bild' else acquire_saved_mcahn)(args.inspection,args.output),indent=2))
