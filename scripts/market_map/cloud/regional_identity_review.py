"""Evidence-rule triage, not sender authorization or a person/owner assertion."""
import datetime,json,re,time,fcntl,sys
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path('/data/research/artifacts/regional-contact-enrichment-20261104')

def norm(value):return re.sub(r'[^a-z0-9]','',str(value or '').lower())
def street(value):
 words=re.findall(r'[a-z0-9]+',str(value or '').lower())
 replacements={'street':'st','road':'rd','avenue':'ave','drive':'dr','boulevard':'blvd','east':'e','west':'w','north':'n','south':'s'}
 return ''.join(replacements.get(w,w) for w in words)
def fresh(value,now):
 try:
  at=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
  if at.tzinfo is None:return False
  age=(now-at).total_seconds();return -60<=age<=86400
 except (AttributeError,ValueError,TypeError):return False

def check(record,page,observation,now):
 reasons=[]
 if observation.get('kind')=='fax' or observation.get('extension'):return ['fax_or_extension_requires_route_review'],None
 if observation.get('extraction_method')!='json_ld':return ['no_scoped_structured_identity'],None
 if re.sub(r'\D','',observation.get('phone',''))[-10:]!=record.get('phone_base'):return ['phone_mismatch'],None
 if not page.get('sha256') or observation.get('page_content_sha256')!=page['sha256']:return ['missing_or_mismatched_source_hash'],None
 if not fresh(page.get('captured_at'),now):reasons.append('stale_source')
 try:
  context=json.loads(observation.get('context',''));address=context.get('address')
  if not isinstance(address,dict):return reasons+['structured_address_missing'],None
 except (ValueError,AttributeError):return reasons+['structured_context_incomplete'],None
 name=norm(record.get('organization'))
 if len(name)<5 or norm(context.get('name'))!=name:reasons.append('business_name_requires_review')
 expected=street(record.get('address'));actual=street(address.get('streetAddress'))
 if not expected or not re.search(r'\d',expected) or expected!=actual:reasons.append('street_address_requires_review')
 locality=norm(address.get('addressLocality'));expected_cities={norm(record.get(k)) for k in ['municipality','source_city_label']}-{''}
 if not locality or locality not in expected_cities:reasons.append('locality_requires_review')
 region=norm(address.get('addressRegion'))
 if region and region not in {'on','ontario','caon'}:reasons.append('province_conflict')
 country=address.get('addressCountry');country=country.get('name') if isinstance(country,dict) else country
 if country and norm(country) not in {'ca','canada','can'}:reasons.append('country_conflict')
 try:
  source_host=urlsplit(page['url']).hostname.lower().removeprefix('www.');record_host=urlsplit(record['website']).hostname.lower().removeprefix('www.')
  if source_host!=record_host:reasons.append('website_host_requires_review')
 except (KeyError,AttributeError,ValueError):reasons.append('website_host_requires_review')
 evidence={'source_record_id':record['source_record_id'],'organization':record['organization'],'street':address.get('streetAddress'),'locality':address.get('addressLocality'),'source_url':page['url'],'source_sha256':page['sha256'],'captured_at':page.get('captured_at')}
 return reasons,evidence

def review(receipts,carriers,now):
 candidates={r['phone']:r for r in carriers if r['state']=='source_supported_mobile_needs_crm_review'};results={n:{'phone':n,'organization':r.get('organization'),'carrier_checked_at':r.get('carrier_checked_at'),'matches':[],'source_holds':set()} for n,r in candidates.items()}
 for d in receipts:
  for record in d['records']:
   number='+1'+str(record.get('phone_base',''))
   if number not in results:continue
   for page in d['pages']:
    for observation in page['phones']:
     if observation.get('phone')!=number:continue
     reasons,evidence=check(record,page,observation,now)
     if reasons:results[number]['source_holds'].update(reasons)
     else:results[number]['matches'].append(evidence)
 out=[]
 for number,r in results.items():
  r['matches']=list({(m['source_record_id'],m['source_url']):m for m in r['matches']}.values())
  accounts={(norm(m['organization']),street(m['street']),norm(m['locality'])) for m in r['matches']}
  r['source_holds']=sorted(r['source_holds'])
  conflicts={'business_name_requires_review','street_address_requires_review','locality_requires_review','province_conflict','country_conflict','website_host_requires_review'}
  qualified=len(accounts)==1 and fresh(r['carrier_checked_at'],now) and not conflicts.intersection(r['source_holds'])
  r.update(state='source_identity_and_mobile_checks_passed_needs_crm_review' if qualified else 'source_identity_review_required',account_scopes_matched=len(accounts),contact_kind='business_route',person_name=None,send_ready=False,release_holds=['current_crm_history_and_suppression_review','category_message_approval_required'],owner_send_hold=True)
  if not fresh(r['carrier_checked_at'],now):r['source_holds'].append('carrier_check_stale')
  if len(accounts)>1:r['source_holds'].append('shared_phone_multiple_locations')
  out.append(r)
 return out

def main():
 now=datetime.datetime.now(datetime.timezone.utc)
 receipts=(json.loads(p.read_text()) for p in sorted((ROOT/'sources').glob('*/receipt.json')))
 carriers=json.loads((ROOT/'carrier-reviewed-contacts.json').read_text());rows=review(receipts,carriers,now)
 report={'checked_at':now.isoformat(),'mobile_candidates':len(rows),'source_identity_matches':sum(r['state']=='source_identity_and_mobile_checks_passed_needs_crm_review' for r in rows),'send_ready':0,'owner_send_hold':True,'rows':rows}
 p=ROOT/'source-identity-review.json';tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(report,indent=2));tmp.replace(p)
 print(json.dumps({k:v for k,v in report.items() if k!='rows'}),flush=True)
def run(stop=None):
 lock=(ROOT/'source-identity-worker.lock').open('a+b')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 while stop is None or not stop.is_set():
  state={'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'read_only':True,'messages_sent':0}
  try:main();state['state']='monitoring'
  except Exception as exc:state.update(state='read_error',error=type(exc).__name__)
  p=ROOT/'source-identity-worker-status.json';tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(state));tmp.replace(p)
  if stop is not None:
   if stop.wait(300):break
  else:time.sleep(300)
if __name__=='__main__':
 if '--watch' in sys.argv:run()
 else:main()
