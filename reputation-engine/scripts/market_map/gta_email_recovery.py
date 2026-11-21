"""Offline recovery of explicitly published business emails in reviewed HTML.

No network, guessing, SMTP, named-contact enrichment, store writes or eligibility changes.
"""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re,shutil
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlsplit,urljoin,unquote,parse_qs
from lxml import html
from .construction_rosters import clean,sha,safe
from .gta_sources import save
from .transport import SourceBlocked

VERSION='2026-10-27.1'
EMAIL=re.compile(r'(?<![\w.+-])([A-Za-z0-9.!#$%&\'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63})(?![\w.-])')
PLACEHOLDERS={'name@domain.com','your@email.com','email@example.com','test@example.com','you@example.com'}
def cls(name):return 'contains(concat(" ",normalize-space(@class)," ")," '+name+' ")'
def hidden(node):
 for item in [node]+list(node.iterancestors()):
  if not isinstance(item.tag,str):continue
  style=re.sub(r'\s+','',(item.get('style') or '').lower());classes=set((item.get('class') or '').lower().split())
  if 'hidden' in item.attrib or item.get('aria-hidden','').lower()=='true' or 'display:none' in style or 'visibility:hidden' in style or classes.intersection({'hidden','w2dc-display-none','sr-only','screen-reader-text'}):return True
  for key in ['data-hide-email','data-hidden-contact','data-email-hidden']:
   if item.get(key,'').lower() in {'true','1','yes'}:return True
 return False

def unrelated_context(node):
 for item in [node]+list(node.iterancestors()):
  if not isinstance(item.tag,str):continue
  classes=set((item.get('class') or '').lower().split())
  if item.tag in {'footer','script','style','noscript'} or item.get('itemprop')=='description' or classes.intersection({'desc','description','bio','narrative','w2dc-field-output-block-content_field'}):return True
 return False

def valid_email(value):
 value=value.strip().strip('.,;')
 if not EMAIL.fullmatch(value) or value.casefold() in PLACEHOLDERS:return None
 local,domain=value.rsplit('@',1)
 if domain.casefold() in {'example.com','example.org','example.net'} or local.casefold().split('+',1)[0] in {'privacy','dpo','webmaster','noreply','no-reply','donotreply','developer','postmaster','abuse','telemetry'}:return None
 return local+'@'+domain.lower()

def public_emails(node):
 """Only public business-container mailto destinations or visible literal text."""
 result={}
 for anchor in node.xpath('.//a[@href]'):
  if hidden(anchor) or unrelated_context(anchor):continue
  href=anchor.get('href','')
  if not href.lower().startswith('mailto:'):continue
  # Query subject/body/cc/bcc are not additional business email fields.
  for value in re.split('[,;]',unquote(href[7:].split('?',1)[0])):
   email=valid_email(value)
   if email:result[email]='public_business_mailto'
 fragment=html.fromstring(html.tostring(node))
 for item in list(fragment.xpath('.//script|.//style|.//noscript|.//*[@hidden or @aria-hidden="true"]')):
  if item.getparent() is not None:item.drop_tree()
 for item in list(fragment.iterdescendants()):
  if (hidden(item) or unrelated_context(item)) and item.getparent() is not None:item.drop_tree()
 text=' '.join(' '.join(fragment.itertext()).split())
 for match in EMAIL.finditer(text):
  email=valid_email(match.group(1))
  if email:result.setdefault(email,'public_business_visible_text')
 return sorted(result.items())

def bindings(body,kind,url,digest):
 """Yield exact publisher business contexts; never scan a whole page into one company."""
 root=html.fromstring(body);rows=[]
 if kind=='aldershot':
  category=parse_qs(urlsplit(url).query).get('wvcat',['unknown'])[0];page=parse_qs(urlsplit(url).query).get('wpv_paged',['1'])[0]
  nodes=root.xpath('//div['+cls('fusion-text')+'][h3]')
  for ordinal,node in enumerate(nodes,1):
   names=node.xpath('./h3')
   if len(names)!=1:raise SourceBlocked('Ambiguous Aldershot business heading')
   name=clean(names[0].text_content())
   rows.append((node,'snapshot:'+digest+':'+category+':'+page+':'+str(ordinal),name,'aldershot-bia-public-category-directory'))
 elif kind=='streetsville':
  regions=root.xpath('//div['+cls('w2dc-index-page')+']')
  if len(regions)!=1:raise SourceBlocked('Expected one actual main Streetsville directory region')
  for node in regions[0].xpath('.//article['+cls('w2dc-listing')+']'):
   heading=node.xpath('.//header['+cls('w2dc-listing-header')+']/h2/a')
   native=node.get('id','')
   if len(heading)!=1 or not re.fullmatch(r'post-\d+',native):raise SourceBlocked('Unexpected native public business card')
   rows.append((node,native[5:],clean(heading[0].text_content()),'streetsville-bia-public-directory'))
 elif kind=='brock':
  mains=root.xpath('//main');heads=root.xpath('//main//h1')
  if len(mains)!=1 or len(heads)!=1:raise SourceBlocked('Expected one organisation profile main/title')
  name=clean(heads[0].text_content());sections=[x for x in heads[0].iterancestors() if x.tag=='section']
  # The nearest profile section contains its public email; unrelated footer sections stay out.
  node=sections[0] if sections else mains[0]
  source='brock-board-public-community-partners' if '/community-partners/' in urlsplit(url).path else 'brock-board-public-member-directory'
  rows.append((node,url,name,source))
 elif kind=='york':
  for link in root.xpath('//a['+cls('yrk-AddressListing')+']'):
   node=link
   while node.getparent() is not None and node.tag!='tr':node=node.getparent()
   if node.tag!='tr':raise SourceBlocked('York business-record boundary missing')
   title=link.get('title','');prefix='Go to the business listing for '
   name=title[len(prefix):].rsplit(', on ',1)[0] if title.startswith(prefix) and ', on ' in title else clean(link.text_content()).rsplit(' - ',1)[0]
   rows.append((node,urljoin(url,link.get('href')),name,'york-business-directory-2024'))
 elif kind=='kerr':
  for link in root.xpath('//div['+cls('info')+']/a[h2]'):
   native=parse_qs(urlsplit(link.get('href','')).query).get('businessId',[])
   if len(native)==1 and native[0].isdigit():rows.append((link.getparent(),native[0],clean(link.text_content()),'kerr-village-public-directory'))
 elif kind=='islington':
  for node in root.xpath('//*['+cls('tca-business-loop-item')+']'):
   heads=node.xpath('.//h2/a')
   if len(heads)==1:rows.append((node,heads[0].get('href'),clean(heads[0].text_content()),'islington-village-public-business-directory'))
 elif kind=='port_credit':
  for node in root.xpath('//div['+cls('Desktop-View')+']'):
   heads=node.xpath('.//h4/a['+cls('result-link')+']')
   if len(heads)==1:rows.append((node,urljoin(url,heads[0].get('href')),clean(heads[0].text_content()),'port-credit-bia-public-directory'))
 elif kind=='mount':
  for link in root.xpath('//a['+cls('business-name-directory')+']'):rows.append((link.getparent(),link.get('href'),clean(link.text_content()),'mount-pleasant-village-public-directory'))
 elif kind=='bloor':
  for ordinal,node in enumerate(root.xpath('//div['+cls('entry-content')+']/p[strong]'),1):rows.append((node,'snapshot:'+digest+':'+str(ordinal),clean(node.xpath('./strong')[0].text_content()),'bloor-annex-public-directory'))
 elif kind=='college':
  # Current saved A-Z roster contains no business email tokens. Do not bind its entire120-entry paragraph to one organisation.
  nodes=[n for n in root.xpath('//div['+cls('paragraph')+']') if len(n.xpath('.//strong'))>20]
  if len(nodes)!=1:raise SourceBlocked('College A-Z roster region changed')
  if public_emails(nodes[0]):raise SourceBlocked('College email needs explicit individual block-boundary parser before association')
 elif kind=='bild':
  # Existing factual cards contain names/site/contact-phone only; never recover footer/policy/developer addresses.
  nodes=root.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," member-card ")]')
  for ordinal,node in enumerate(nodes,1):
   heads=node.xpath('.//h2|.//h3|.//h4')
   if len(heads)==1:rows.append((node,'snapshot:'+digest+':'+str(ordinal),clean(heads[0].text_content()),'bild-public-member-directory'))
 else:raise SourceBlocked('Unreviewed source parser kind')
 return rows

def sources(root):
 root=Path(root);gta=root/'gta-regional-source-acquisition'
 for folder,key,kind in [
  ('west-north-gta-bia-native-client-inspection','aldershot-offered-eat-category','aldershot'),
  *[('aldershot-native-category-entry-inspection','aldershot-offered-'+name+'-category','aldershot') for name in ['health','salon','services','shop','community']],
  ('west-north-gta-bia-directory-inspection','streetsville-offered-business-directory','streetsville'),
  ('toronto-neighbourhood-bia-directory-inspection','bloor-annex-offered-business-directory','bloor'),
  ('toronto-remaining-bia-directory-inspection','college-promenade-offered-complete-list','college')]:
  path=gta/folder/(key+'.response')
  if not path.exists():continue
  inspection=json.loads((path.parent/'inspection.json').read_text());receipt=next(r for r in inspection['receipts'] if r['id']==key)
  if sha(path)!=receipt['sha256']:raise SourceBlocked('Saved inspected source hash changed: '+str(path))
  yield {'path':path,'kind':kind,'url':receipt.get('response_url',receipt['url']),'observed_at':receipt['observed_at'],'whole_sha256':receipt['sha256'],'artifact_sha256':receipt['sha256'],'rights_status':'limited_factual_review_only'}
 for folder,kind in [('brock-published-profile-acquisition','brock'),('kerr-village-bia-factual-acquisition','kerr'),('islington-bia-factual-acquisition','islington'),('port-credit-bia-factual-acquisition','port_credit'),('mount-pleasant-bia-factual-acquisition','mount'),('bild-construction-factual-acquisition','bild')]:
  f=root/folder
  if not (f/'manifest.json').exists():continue
  m=json.loads((f/'manifest.json').read_text())
  if m.get('rights_status')!='limited_factual_review_only':raise SourceBlocked('Unreviewed source rights status')
  for receipt_path in sorted(f.glob('*.receipt.json')):
   receipt=json.loads(receipt_path.read_text());name=receipt.get('raw_file')
   if not name or not name.endswith('.html.gz'):continue
   path=f/name
   if m.get('files',{}).get(name)!=sha(path) or sha(path)!=receipt['gzip_sha256']:raise SourceBlocked('Frozen compressed evidence hash changed')
   yield {'path':path,'kind':kind,'url':receipt.get('url',m['source_url']),'observed_at':receipt['observed_at'],'whole_sha256':receipt['raw_sha256'],'artifact_sha256':receipt['gzip_sha256'],'rights_status':m['rights_status']}
 # York's licensed municipality all-business files have explicit record-row boundaries.
 f=root/'york-2024-publisher-html-acquisition';m=json.loads((f/'manifest.json').read_text()) if (f/'manifest.json').exists() else {}
 for collection in m.get('collections',[]):
  directory=f/collection['folder'];proof=json.loads((directory/'collection.json').read_text());receipt=json.loads((directory/'publisher-all-businesses-response-receipt.json').read_text());raw=proof['all_raw'];path=directory/raw['file']
  if sha(path)!=raw['gzip_sha256']:raise SourceBlocked('Frozen licensed York source changed')
  yield {'path':path,'kind':'york','url':receipt['url'],'observed_at':receipt['response_info']['observed_at'],'whole_sha256':raw['original_sha256'],'artifact_sha256':raw['gzip_sha256'],'rights_status':'licensed_open'}

def build(root,output,*,max_output_bytes=10000000):
 root=Path(root);output=Path(output);output.mkdir(parents=True,exist_ok=True);manifest_path=output/'manifest.json'
 if manifest_path.exists():
  m=json.loads(manifest_path.read_text())
  for source in m['inputs']:
   if sha(Path(source['source_artifact']))!=source['source_artifact_sha256']:raise SourceBlocked('Replayed source artifact changed')
  for name,digest in m['files'].items():
   if sha(output/name)!=digest:raise SourceBlocked('Replayed email output changed')
  return m
 if shutil.disk_usage(output).free<2*1024**3:raise RuntimeError('Minimum2GiB free required before small offline recovery output')
 associations={};inputs=[];context_count=0;all_mailtos=0;business_mailtos=0
 for source in sources(root):
  path=source['path'];body=gzip.decompress(path.read_bytes()) if path.name.endswith('.gz') else path.read_bytes()
  if hashlib.sha256(body).hexdigest()!=source['whole_sha256']:raise SourceBlocked('Whole decompressed source hash mismatch')
  contexts=bindings(body,source['kind'],source['url'],source['whole_sha256']);context_count+=len(contexts);all_mailtos+=len(html.fromstring(body).xpath('//a[starts-with(@href,"mailto:")]'))
  count=0
  for node,record_id,name,source_id in contexts:
   if hidden(node):continue
   for email,method in public_emails(node):
    key=(email,source_id,record_id);business_mailtos+=1;count+=1
    if key in associations:continue
    associations[key]={'email':email,'source_url':source['url'],'observed_at':source['observed_at'],'source_id':source_id,'source_record_id':record_id,'organisation_name':name,'extraction_method':method,'source_artifact_sha256':source['artifact_sha256'],'source_original_whole_sha256':source['whole_sha256'],'source_artifact':str(path),'identity_status':'source_published_candidate','mailbox_status':'not_checked','outreach_eligibility':'research_only','rights_status':source['rights_status'],'campaign_ready':False,'contact_person_or_buying_authority_not_inferred':True}
  inputs.append({'source_artifact':str(path),'source_artifact_sha256':source['artifact_sha256'],'source_original_whole_sha256':source['whole_sha256'],'source_url':source['url'],'observed_at':source['observed_at'],'source_kind':source['kind'],'business_record_contexts_checked':len(contexts),'published_email_occurrences_in_contexts':count,'rights_status':source['rights_status']})
 rows=sorted(associations.values(),key=lambda r:(r['source_id'],r['source_record_id'],r['email']));serialized=''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows).encode('utf8')
 if len(serialized)>max_output_bytes//2:raise SourceBlocked('Declared tiny email output budget exceeded before publishing outputs')
 (output/'source-published-business-email-associations.jsonl.gz').write_bytes(gzip.compress(serialized))
 fields=['email','organisation_name','source_id','source_record_id','source_url','observed_at','extraction_method','identity_status','mailbox_status','outreach_eligibility','rights_status','source_artifact_sha256']
 with gzip.open(output/'source-published-business-email-associations.csv.gz','wt',encoding='utf8',newline='') as stream:
  writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
  for row in rows:writer.writerow({k:safe(row.get(k)) for k in fields})
 counts=Counter(r['source_id'] for r in rows);save(output/'source-summary.json',{'source_associations':dict(counts),'unique_published_email_strings':len({r['email'] for r in rows}),'normalization':'Only domain lowercased; local-part spelling preserved, no mailbox identity/deliverability asserted'})
 files={p.name:sha(p) for p in output.iterdir() if p.is_file()}
 m={'version':VERSION,'created_at':datetime.now(timezone.utc).isoformat(),'source_associations':len(rows),'unique_published_email_strings':len({r['email'] for r in rows}),'original_HTML_artifacts_checked':len(inputs),'distinct_source_page_URLs':len({r['source_url'] for r in inputs}),'business_record_contexts_checked':context_count,'all_document_mailto_occurrences':all_mailtos,'business_context_email_occurrences':business_mailtos,'inputs':inputs,'files':files,'metrics':{'network_requests':0,'paid_service_calls':0,'mailbox_checks':0,'messages_sent':0,'main_writes':0},'maximum_total_outputs_bytes':max_output_bytes,'output_scope':'Bounded declared saved-source corpus only, not an exhaustive email census; original restricted/unproven-visibility sources excluded','excluded_routes_or_fields':['Forest Hill/TABIA and other explicit reuse holds','APBOT raw hidden-contact/visibility-unproven payload fields','Danforth private/unrequested contact fields','footer/developer/privacy/telemetry contacts outside organisation record contexts','mailto query subject/body/cc/bcc','scripts/style/hidden-contact fields','unfetched offsite/company profiles'],'no_main_or_campaign_eligibility_changes':True,'market_completeness_verified':False}
 save(manifest_path,m)
 if sum(p.stat().st_size for p in output.iterdir() if p.is_file())>max_output_bytes:raise SourceBlocked('Total tiny output budget exceeded')
 return m
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();m=build(a.root,a.output);print(json.dumps({k:v for k,v in m.items() if k not in ['inputs','files']},indent=2))
