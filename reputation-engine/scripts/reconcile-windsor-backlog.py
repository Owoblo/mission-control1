"""Reconcile all source profiles to actual receipts and actionable holds. No sends."""
import csv,json,collections,datetime
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15');S=P/'send-release'
rows=list(csv.DictReader(open(P/'volume-experiment/account-review-queue.csv')))
release=json.loads((S/'published-company-expanded-release.json').read_text());ready={r['id']:r for r in release['initial']};held={r['id']:r for r in release['held']}
plan={r['id']:r for r in json.loads((S/'live-send-preflight.json').read_text())['rows']}
reviews={r['id']:r for r in map(json.loads,(S/'company-publication-deep-review.jsonl').read_text().splitlines())}
retry=S/'company-publication-retry-review.jsonl'
if retry.exists():reviews.update({r['id']:r for r in map(json.loads,retry.read_text().splitlines()) if r['pages']})
receipts=[]
for n in ['personalized-send-receipts','published-send-receipts']:
 receipts+=list(map(json.loads,(S/(n+'.jsonl')).read_text().splitlines()))
by_id={r['id']:r for r in receipts};by_email={r['to']:r for r in receipts}
delivery={r['messageId']:r for r in json.loads((S/'delivery-results.json').read_text())['results']}
actions={r['id']:r for r in map(json.loads,(S/'published-send-actions.jsonl').read_text().splitlines())}
output=[]
for r in rows:
 id=r['draft_id'];candidate=ready.get(id);receipt=by_id.get(id) or by_email.get(r['email']);ev=reviews.get(id,{})
 reason=[];next_action=''
 if receipt:
  d=delivery.get(receipt['messageId'],{});state='delivery_failure_research' if d.get('bounced') else 'sent';next_action='Research replacement route; do not retry failed address' if d.get('bounced') else 'Monitor and classify replies; pause follow-ups on response';email=receipt['to']
 elif candidate:
  a=actions.get(id,{});state=a.get('status','ready_for_live_check');next_action='Review existing conversation or suppression' if state.startswith('held') else 'Run live history, suppression and delivery checks before send';email=candidate['to']
 elif r['state']=='find_contact_route':state='no_email_research';next_action='Find current official contact/team/vendor page and a role-relevant route';email=''
 elif r['state']=='alternate_location_or_route':state='linked_location_or_alternate';next_action='Coordinate with primary company record; retain local branch and alternative contact evidence';email=r['email']
 elif r['state']=='hold_existing_relationship_or_suppression':state='existing_relationship_or_suppression';next_action='Review existing relationship; honor suppression';email=r['email']
 else:
  reason=held.get(id,{}).get('reasons',plan.get(id,{}).get('holds',[]));email=held.get(id,{}).get('to',r['email'])
  if 'delivery_research' in reason:state='email_validation_hold';next_action='Find a different published address; validate it before use'
  elif not ev.get('pages'):state='website_unavailable';next_action='Find current official domain through company directory/search; inspect contact and team pages'
  elif 'email_not_found_on_reviewed_company_pages' in reason:state='published_contact_research';next_action='Research current contact/team/vendor pages; corroborate exact email and relevant role'
  elif 'appropriate_role_not_confirmed' in reason:state='decision_maker_research';next_action='Find facilities, operations, procurement, branch manager or owner; avoid careers/artwork-only inboxes'
  else:state='account_context_review';next_action='Confirm company identity and local branch/service coverage; outside headquarters alone is not exclusion'
 output.append({'account_id':r['account_id'],'account_name':r['account_name'],'company_group':r['company_group'],'city':r['city'],'status':state,'email':email,'draft_id':id,'contact_id':receipt.get('contact_id','') if receipt else '', 'provider_message_id':receipt.get('messageId','') if receipt else '', 'sent_at':receipt.get('accepted_at','') if receipt else '', 'reasons':'; '.join(reason),'next_action':next_action,'source_url':r['source_url'],'website':plan.get(id,{}).get('website',''),'reviewed_pages':len(ev.get('pages',[])),'owner':'John'})
with (S/'full-backlog-status.csv').open('w',newline='') as f:w=csv.DictWriter(f,fieldnames=list(output[0]));w.writeheader();w.writerows(output)
summary={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source_profiles':len(rows),'unique_campaign_sends':len({r['messageId'] for r in receipts}),'profile_statuses':dict(collections.Counter(r['status'] for r in output)),'note':'Source profiles include linked locations and existing relationships. Campaign sends include separate priority contacts; profile status totals are not unique-company counts. Research is pending, not cleared or sent.'}
(S/'full-backlog-status.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
