"""Close Brock's rendered-card cap using its actual robots-linked sitemaps."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re,shutil
from pathlib import Path
from urllib.parse import urlsplit
from lxml import etree,html
from .transport import Transport,SourceBlocked
from .construction_rosters import clean,sha,safe
from .gta_sources import save

HOST='www.brockboardoftrade.com'
MEMBER_MAP='https://www.brockboardoftrade.com/dynamic-members_p_7c41d497_d6a9_42b0_9c1f_d017d234c57e_0_5000-sitemap.xml'
PARTNER_MAP='https://www.brockboardoftrade.com/dynamic-community-partners_p_393741c4_6fb9_4c8e_ad65_dadf5f5199f3_0_5000-sitemap.xml'

def sitemap_urls(body,kind):
 root=etree.fromstring(body,parser=etree.XMLParser(resolve_entities=False,no_network=True));urls=root.xpath('//*[local-name()="url"]/*[local-name()="loc"]/text()')
 prefix='https://'+HOST+('/members/' if kind=='member' else '/community-partners/')
 if not urls or len(set(urls))!=len(urls) or any(not u.startswith(prefix) for u in urls):raise SourceBlocked('Unexpected published organisation sitemap scope/duplicate URL')
 return urls

def parse_profile(body,url,kind,stamp):
 root=html.fromstring(body);main=root.xpath('//main')
 if len(main)!=1:raise SourceBlocked('Expected one public organisation profile main region')
 main=main[0];heads=main.xpath('.//h1')
 if len(heads)!=1 or not clean(heads[0].text_content()):raise SourceBlocked('Organisation profile title missing')
 name=clean(heads[0].text_content());web=[]
 for link in main.xpath('.//a[@href]'):
  href=link.get('href')
  if href.startswith(('https://','http://')) and urlsplit(href).hostname!=HOST:web.append(href)
 # Numeric-only visible contact lines; never a contact person's name or email.
 phones=[]
 for item in main.xpath('.//p'):
  text=clean(item.text_content())
  if re.fullmatch(r'[+\d(). /-]{7,35}',text) and sum(c.isdigit() for c in text)>=7:phones.append(text)
 facts={'name':name,'website':web[0] if web else None,'phone':phones[0] if phones else None,'profile_url':url,
        'public_profile_kind':kind,'original_response_sha256':hashlib.sha256(body).hexdigest()}
 source='brock-board-public-member-directory' if kind=='member' else 'brock-board-public-community-partners'
 return {'source_id':source,'source_record_id':url,'source_record_id_basis':'Exact publisher public organisation profile URL; persistent native UUID not assumed',
  'source_url':url,'evidence_source_url':url,'observed_at':stamp,'name':name,'website':facts['website'],'phone':facts['phone'],
  'address':None,'city':None,'province':None,'country':None,'postal_code':None,'email':None,'categories':[],
  'record_type':'association_member_listing' if kind=='member' else 'community_partner_listing','entity_type':'organisation_candidate',
  'eligibility':'research_only','campaign_ready':False,'rights_status':'limited_factual_review_only','raw_payload':facts,
  'relationships':[{'relationship_type':'member_of' if kind=='member' else 'listed_as_community_partner',
    'object_name':'Brock Board of Trade','source_url':url,'basis':'Published organisation profile collection; no financial sponsorship/ownership/current operation inferred'}]}

def collect(inspection,base_folder,output,*,transport=None):
 inspection=Path(inspection);base_folder=Path(base_folder);output=Path(output);output.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required')
 manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for f,digest in m['files'].items():
   if sha(output/f)!=digest:raise SourceBlocked('Frozen Brock completion artifact changed')
  return m
 maps={kind:sitemap_urls((inspection/(key+'.response')).read_bytes(),kind) for kind,key in [('member','brock-offered-business-member-sitemap'),('partner','brock-offered-community-partner-sitemap')]}
 baseline=json.loads((base_folder/'manifest.json').read_text());source=base_folder/'all-public-directory-observations.jsonl.gz'
 if sha(source)!=baseline['files'][source.name]:raise SourceBlocked('Base rendered-card facts changed')
 cached={r['source_url']:r for r in map(json.loads,gzip.open(source,'rt',encoding='utf8'))}
 if not set(cached).issubset(maps['member']):raise SourceBlocked('Published sitemap and captured member cards disagree; no guessed continuation')
 t=transport or Transport(max_requests=100,max_bytes=95000000,max_response_bytes=3000000,timeout=30,retries=1,min_interval=.5,allowed_hosts=[HOST])
 state_path=output/'checkpoint.json';state=json.loads(state_path.read_text()) if state_path.exists() else {'profiles':{},'rechecks':{},'metrics':{'requests':0,'bytes_fetched':0,'elapsed_seconds':0}}
 old=state['metrics'].copy()
 def checkpoint():
  fresh=t.metrics();state['metrics']={**fresh,'requests':old['requests']+fresh['requests'],'bytes_fetched':old['bytes_fetched']+fresh['bytes_fetched'],'elapsed_seconds':round(old['elapsed_seconds']+fresh['elapsed_seconds'],3),'fresh_invocation':fresh};save(state_path,state)
 try:
  rows={'member':[],'partner':[]}
  for kind,urls in maps.items():
   for url in urls:
    if kind=='member' and url in cached:
     row=dict(cached[url]);row['raw_payload']={**row['raw_payload'],'original_native_rendered_uuid':row['source_record_id']}
     row['evidence_source_url']='https://'+HOST+'/member-directory'
     row['source_record_id']=url;row['source_record_id_basis']='Exact publisher public organisation profile URL; original native rendered UUID retained as evidence'
     rows[kind].append(row);continue
    key=hashlib.sha256(url.encode()).hexdigest();receipt_path=output/(key+'.receipt.json');saved=state['profiles'].get(url)
    if saved is None and receipt_path.exists():saved=json.loads(receipt_path.read_text());state['profiles'][url]=saved;checkpoint()
    if saved:
     raw=output/saved['raw_file']
     if sha(raw)!=saved['gzip_sha256']:raise SourceBlocked('Saved private evidence response changed')
     body=gzip.decompress(raw.read_bytes())
     if hashlib.sha256(body).hexdigest()!=saved['raw_sha256']:raise SourceBlocked('Saved whole source bytes changed')
    else:
     if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before every profile')
     response=t.fetch(url);body=response.body;raw=output/(key+'.private-evidence.html.gz');temp=raw.with_suffix('.tmp')
     with gzip.open(temp,'wb') as stream:stream.write(body)
     if gzip.decompress(temp.read_bytes())!=body:raise SourceBlocked('Private evidence gzip verification failed')
     temp.replace(raw);saved={'url':url,'raw_file':raw.name,'gzip_sha256':sha(raw),'raw_sha256':hashlib.sha256(body).hexdigest(),'observed_at':t._stamp(),'evidence_private_only':True}
     save(receipt_path,saved);state['profiles'][url]=saved;checkpoint()
    row=parse_profile(body,url,kind,saved['observed_at']);rows[kind].append(row)
    print(json.dumps({'source':'brock-published-profiles','kind':kind,'captured':len(rows[kind]),'expected':len(urls)}),flush=True)
  for kind,url in [('member',MEMBER_MAP),('partner',PARTNER_MAP)]:
   if kind not in state['rechecks']:
    response=t.fetch(url);current=sitemap_urls(response.body,kind)
    state['rechecks'][kind]={'url':url,'urls':current,'raw_sha256':hashlib.sha256(response.body).hexdigest(),'observed_at':t._stamp()}
    with gzip.open(output/(kind+'-terminal-sitemap.xml.gz'),'wb') as stream:stream.write(response.body)
    checkpoint()
   if set(state['rechecks'][kind]['urls'])!=set(maps[kind]):raise SourceBlocked('Published sitemap profile set changed during traversal')
  for kind in ['member','partner']:
   if len(rows[kind])!=len(maps[kind]) or {r['source_record_id'] for r in rows[kind]}!=set(maps[kind]):raise SourceBlocked('Full source URL count/ID mismatch')
   with gzip.open(output/(kind+'-organisation-facts.jsonl.gz'),'wt',encoding='utf8') as stream:
    for row in rows[kind]:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
   fields=['source_id','source_record_id','name','website','phone','address','city','province','country','source_url','observed_at','record_type','rights_status','eligibility','campaign_ready']
   with gzip.open(output/(kind+'-organisation-facts.csv.gz'),'wt',encoding='utf8',newline='') as stream:
    writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
    for row in rows[kind]:writer.writerow({k:safe(row.get(k)) for k in fields})
  save(output/'published-profile-url-inventories.json',maps);checkpoint()
  m={'status':'completed','source_ids':['brock-board-public-member-directory','brock-board-public-community-partners'],
   'source_url':'https://'+HOST+'/sitemap.xml','publisher':'Brock Board of Trade',
   'rights_status':'limited_factual_review_only','rights_basis':'Ordinary publicly offered business/community organisation profiles, actual directory/footer/robots/sitemaps reviewed; no explicit commercial/automation ban found. Internal selected factual research only, no open redistribution grant.',
   'member_profile_urls':len(maps['member']),'member_factual_rows':len(rows['member']),'reused_rendered_member_cards':len(cached),
   'additional_member_profile_rows':len(rows['member'])-len(cached),'community_partner_profile_rows':len(rows['partner']),
   'all_sitemap_profile_urls_reconciled':True,'both_terminal_sitemap_URL_sets_stable':True,'personal_user_author_profile_sitemaps_not_requested':True,
   'source_inventory_exhausted':True,'exhaustion_scope':'All organisation URLs in the two actual publisher-offered dynamic business-member/community-partner sitemaps; no claim about private/unlisted memberships',
   'missing_row_locality_not_filled':True,'named_contact_and_email_narrative_media_fields_excluded':True,'raw_HTML_evidence_private_only':True,
   'existing_100_card_base':str(base_folder/'manifest.json'),'base_manifest_sha256':sha(base_folder/'manifest.json'),
   'base_facts_sha256':sha(source),'metrics':state['metrics'],'market_completeness_verified':False,'no_main_writes':True,
   'files':{p.name:sha(p) for p in output.iterdir() if p.is_file() and p.name!='checkpoint.json'}}
  save(manifest_path,m);(output/'README.md').write_text(f'{len(rows["member"])} published business-member profiles ({len(cached)} saved cards reused and{len(rows["member"])-len(cached)} additional profiles) plus{len(rows["partner"])} separately published community-partner profiles. All exact sitemap URLs reconciled and rechecked; no private/unlisted membership coverage claim. Use full publisher profile URL as source record key; original100UUID observations remain frozen and should not be promoted as an additional cohort. Community partner listing does not assert financial sponsorship. Selected organisation facts exclude names of contacts, email, narrative and media. Raw HTML receipts are private evidence only, not a public redistribution grant. Missing locality remains unknown. No MAIN writes/campaign eligibility.\n');return m
 except Exception as exc:
  state['last_failure']={'error':str(exc),'at':t._stamp()};checkpoint();raise

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inspection',required=True,type=Path);p.add_argument('--base',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();print(json.dumps(collect(a.inspection,a.base,a.output),indent=2))
