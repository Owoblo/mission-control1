"""Published-email candidate inventory. Neither mailbox nor person verification."""
import datetime,json,re
from scripts.market_map.regional_occurrences import evidence_for_page
from scripts.market_map.email_extraction import clean_email
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path('/data/research/artifacts/regional-contact-enrichment-20261104')
def special_purpose(email):
 local=re.sub(r'[._-]','',email.split('@')[0].lower())
 return local in {'accessibility','privacy','dpo','abuse','security','unsubscribe','noreply','donotreply','careers','jobs','recruitment','webmaster','postmaster','accountspayable','accountsreceivable'} or local.endswith('pressoffice')

def pilot_candidates(rows,limit=100):
 # Prefer general business routes; use at most one email per website account
 # before returning for additional staff. No branch/person identity is inferred.
 eligible=[r for r in rows if r.get('occurrence_supported_candidate') and not r.get('vendor_review_required') and r['validation_priority']=='first_party_single_organization' and not r['email'].startswith('//') and 'email_extraction_requires_review' not in r.get('holds',[])]
 eligible.sort(key=lambda r:(r['email'].split('@')[0] not in {'info','contact','hello','office','admin','enquiries','inquiries'},r['email']))
 selected=[];seen=set()
 for r in eligible:
  key=tuple(r['website_hosts'])
  if key in seen:continue
  seen.add(key);selected.append(r)
  if len(selected)>=limit:break
 return selected
def inventory(receipts):
 grouped={}
 for d in receipts:
  for page in d['pages']:
   evidence=evidence_for_page(page,d['records'])
   for observation in page['emails']:
    email=clean_email(observation['email']) or observation['email'].strip()
    item=grouped.setdefault(email,{'email':email,'organizations':set(),'source_record_ids':set(),'municipalities':set(),'source_pages':set(),'source_phones':set(),'website_hosts':set(),'occurrence_evidence':[],'phone_occurrence_evidence':[]})
    item['occurrence_evidence'].extend(e for e in evidence if e['channel']=='email' and (clean_email(e['value']) or e['value'].strip())==email)
    item['phone_occurrence_evidence'].extend(e for e in evidence if e['channel']=='phone')
    for r in d['records']:
     item['organizations'].add(r['organization']);item['source_record_ids'].add(r['source_record_id']);item['municipalities'].add(r['municipality'])
     if r.get('phone_base'):item['source_phones'].add('+1'+r['phone_base'])
    item['source_pages'].add(page['url']);item['website_hosts'].add(urlsplit(page['url']).hostname.removeprefix('www.'))
 site_emails={}
 for email,item in grouped.items():
  for host in item['website_hosts']:site_emails.setdefault(host,set()).add(email)
 out=[]
 for item in grouped.values():
  row={k:sorted(v) if isinstance(v,set) else v for k,v in item.items()};names={re.sub(r'[^a-z0-9]','',n.lower()) for n in row['organizations']};domain=row['email'].rsplit('@',1)[-1]
  row['domain_matches_publishing_site']=any(domain==h or domain.endswith('.'+h) for h in row['website_hosts'])
  row['occurrence_supported_candidate']=any(e['document_supported_candidate_record_ids'] for e in row['occurrence_evidence'])
  row['vendor_review_required']=any(e['vendor_review_required'] for e in row['occurrence_evidence'])
  row['relationship_status']='candidate_only_not_verified'
  row['holds']=['organization_and_role_review','mailbox_validation_needed','crm_history_review','category_message_approval_required']
  if any(e['evidence_status']=='attribution_evidence_incomplete' for e in row['occurrence_evidence']):row['holds'].append('attribution_evidence_incomplete')
  if not row['occurrence_supported_candidate']:row['holds'].append('document_owner_support_needed')
  if row['vendor_review_required']:row['holds'].append('vendor_occurrence_review')
  if len(names)>1:row['holds'].append('shared_email_organization_review')
  if not row['domain_matches_publishing_site']:row['holds'].append('different_email_domain_review')
  row['site_email_count']=max((len(site_emails[h]) for h in row['website_hosts']),default=0)
  if special_purpose(row['email']):row['holds'].append('special_purpose_inbox_not_general_outreach')
  if row['site_email_count']>=3:row['holds'].append('multi_contact_site_requires_individual_role_and_branch_evidence')
  # Preserve the observed spelling: malformed mailto:// links can supply this
  # prefix, but stripping it would guess a different mailbox. Require review.
  if row['email'].startswith('//'):row['holds'].append('email_extraction_requires_review')
  row['validation_priority']='first_party_single_organization' if row['occurrence_supported_candidate'] and not row['vendor_review_required'] and len(names)==1 and row['domain_matches_publishing_site'] and not special_purpose(row['email']) and row['site_email_count']<3 and 'email_extraction_requires_review' not in row['holds'] else 'association_review_first'
  row['phone_link_status']='possible_account_routes_not_resolved_person_aliases';row['send_ready']=False;out.append(row)
 return sorted(out,key=lambda r:(r['validation_priority']!='first_party_single_organization',r['email']))
def main():
 rows=inventory(json.loads(p.read_text()) for p in sorted((ROOT/'sources').glob('*/receipt.json')))
 report={'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'unique_published_emails':len(rows),'first_party_single_organization_candidates':sum(r['validation_priority']=='first_party_single_organization' for r in rows),'verified_contacts':0,'send_ready':0,'owner_send_hold':True,'rows':rows}
 tmp=ROOT/'email-inventory.tmp';tmp.write_text(json.dumps(report,indent=2));tmp.replace(ROOT/'email-inventory.json')
 selected=pilot_candidates(rows)
 # Frozen pilot scope: running again cannot silently add paid validation work.
 manifest=ROOT/'email-validation-pilot.json'
 if not manifest.exists():manifest.write_text(json.dumps({'maximum_new_requests':100,'send_authorized':False,'created_at':report['checked_at'],'emails':[r['email'] for r in selected]},indent=2))
 print(json.dumps({k:v for k,v in report.items() if k!='rows'}))
if __name__=='__main__':main()
