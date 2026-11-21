"""Observed pipeline coverage, never a claim of exhaustive businesses or people."""
import datetime,json,re
from collections import defaultdict,Counter
from pathlib import Path
from scripts.market_map.cloud.regional_contact_enrichment import group_inputs
ROOT=Path('/data/research');OUT=ROOT/'artifacts/regional-contact-enrichment-20261104'
FIELDS=['mapped_place_records','eligible_website_records','processed_website_records','records_with_saved_pages','records_with_source_matched_phone','records_with_email_on_associated_site','mobile_candidate_routes','source_identity_matched_routes','crm_reviewed_routes','crm_routes_without_existing_match']
def coverage(places,receipts,carriers,identities,crm):
 receipts=list(receipts)
 groups=defaultdict(lambda:{k:set() for k in FIELDS});records={r['source_record_id']:r for r in places}
 def add(record,metric,value):
  for key in [('total','all'),('city',record.get('municipality') or 'unknown'),('category',record.get('category') or 'unknown')]:groups[key][metric].add(value)
 for r in places:add(r,'mapped_place_records',r['source_record_id'])
 for g in group_inputs(places):
  for r in g['records']:add(r,'eligible_website_records',r['source_record_id'])
 for receipt in receipts:
  pages=receipt['pages'];phones={re.sub(r'\D','',o.get('phone',''))[-10:] for p in pages for o in p['phones'] if o.get('kind')!='fax' and not o.get('extension')}
  for r in receipt['records']:
   if r['source_record_id'] not in records:continue
   r=records[r['source_record_id']];ident=r['source_record_id'];add(r,'processed_website_records',ident)
   if pages:add(r,'records_with_saved_pages',ident)
   if r.get('phone_base') and r['phone_base'] in phones:add(r,'records_with_source_matched_phone',ident)
   if any(p['emails'] for p in pages):add(r,'records_with_email_on_associated_site',ident)
 for row in carriers:
  if row['state']!='source_supported_mobile_needs_crm_review':continue
  for ident in row['source_record_ids']:
   if ident in records:add(records[ident],'mobile_candidate_routes',row['phone'])
 for rows,metric in [(identities,'source_identity_matched_routes'),(crm,'crm_reviewed_routes')]:
  for row in rows:
   if metric=='source_identity_matched_routes' and row['state']!='source_identity_and_mobile_checks_passed_needs_crm_review':continue
   for match in row['matches']:
    ident=match['source_record_id']
    if ident not in records:continue
    add(records[ident],metric,row['phone'])
    if metric=='crm_reviewed_routes' and not row['crm_match_found']:add(records[ident],'crm_routes_without_existing_match',row['phone'])
 result={'totals':{},'cities':{},'categories':{}}
 for (kind,key),values in sorted(groups.items()):
  counts={k:len(v) for k,v in values.items()}
  counts['eligible_records_awaiting_capture']=len(values['eligible_website_records']-values['processed_website_records'])
  counts['processed_records_without_saved_pages']=len(values['processed_website_records']-values['records_with_saved_pages'])
  if kind=='total':result['totals']=counts
  else:result['cities' if kind=='city' else 'categories'][key]=counts
 failures=Counter()
 for receipt in receipts:
  if receipt['pages']:continue
  reasons=set()
  for error in receipt.get('errors',[]):
   text=error.get('error','')
   reason=next((label for fragment,label in [('robots.txt returned HTML','robots_policy_unresolved'),('robots.txt disallows','robots_disallowed'),('HTTP 403','http_403'),('HTTP 404','http_404'),('DNS lookup failed','dns_failure'),('Network retrieval failed','network_failure'),('outside explicit HTTPS host scope','redirect_or_host_scope'),('crawl delay','long_crawl_delay'),('access challenge','access_challenge')] if fragment in text),'other_retrieval_error')
   reasons.add(reason)
  failures.update(reasons or {'no_recorded_error'})
 result['website_domains']={'eligible':len(group_inputs(places)),'processed_receipts':len(receipts),'with_saved_pages':sum(bool(r['pages']) for r in receipts),'without_saved_pages':sum(not r['pages'] for r in receipts),'no_page_error_categories':dict(failures)}
 return result
def main():
 places=json.loads((ROOT/'artifacts/windsor-region-map-20261104/places.json').read_text())
 identities=json.loads((OUT/'source-identity-review.json').read_text());crm=json.loads((OUT/'mobile-crm-review.json').read_text())
 result=coverage(places,(json.loads(p.read_text()) for p in (OUT/'sources').glob('*/receipt.json')),json.loads((OUT/'carrier-reviewed-contacts.json').read_text()),identities['rows'],crm['rows'])
 result.update(checked_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),identity_snapshot_at=identities['checked_at'],crm_snapshot_at=crm['summary']['checked_at'],owner_send_hold=True,verified_unique_contacts=None,messages_sent_by_report=0,
  limits=['Mapped place records are not exhaustive verified commercial entities.','Website email observations do not establish ownership, branch association or valid mailboxes.','A shared route can appear in multiple city/category rows; totals deduplicate routes globally.','Stages use separate snapshots and are not a single cohort conversion rate.','CRM records without a match are not automatically new verified people.'])
 p=OUT/'coverage-report.json';t=p.with_suffix('.tmp');t.write_text(json.dumps(result,indent=2));t.replace(p);print(json.dumps({'totals':result['totals'],'cities':result['cities']}))
if __name__=='__main__':main()
