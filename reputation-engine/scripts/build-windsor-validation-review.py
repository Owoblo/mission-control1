"""Join AWS validation evidence to source records, including recovery candidates. No sends."""
import csv,json
from collections import Counter,defaultdict
from pathlib import Path
P=Path('partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15')
V=P/'email-verification'
results={r['email']:r for r in map(json.loads,(V/'aws-validation-results.jsonl').read_text().splitlines())}
routes=list(csv.DictReader((P/'deduplicated-email-routes.csv').open()))
missing={r['email'].lower() for r in routes}-results.keys()
if missing:raise SystemExit(f'Validation incomplete: {len(missing)} directory addresses remain. Resume the AWS runner before producing final exports.')
by_account=defaultdict(list)
for r in routes:by_account[r['account_id']].append(r)
review=[]
for r in routes:
 a=results[r['email'].lower()]
 alternate=[x['email'] for x in by_account[r['account_id']] if x['email'].lower()!=r['email'].lower() and results[x['email'].lower()]['overall']=='HIGH']
 if a['overall']=='LOW' or a['mailbox']=='LOW' or a['status']=='hold_risk':
  next_step='Review current official domain and role; research replacement address. Retain failure evidence.'
 elif a['overall']=='MEDIUM':
  next_step='Review role/shared-inbox suitability and current official publication; consider second-provider check for a valuable unresolved contact.'
 else:
  next_step='Verify current person/role and company context; review existing account history and sending basis. Overall HIGH is not certain mailbox existence.'
 review.append({**r,'aws_overall':a['overall'],'aws_mailbox_exists':a['mailbox'],'aws_role_address':a['roleAddress'],'aws_policy_status':a['status'],'aws_checked_at':a['checked_at'],'next_action':next_step,'alternative_directory_candidates':'; '.join(alternate),'alternative_status':'unreviewed_candidates_not_approved','send_ready':False})
def write(name,rows):
 with (V/name).open('w',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(review[0]));w.writeheader();w.writerows(rows)
write('aws-reviewed-contact-routes.csv',review)
write('aws-recovery-queue.csv',[r for r in review if r['aws_overall']=='LOW' or r['aws_mailbox_exists']=='LOW' or r['aws_policy_status']=='hold_risk'])
unique={r['email'].lower():results[r['email'].lower()] for r in routes}
report={'directory_unique_addresses':len(unique),'account_email_routes':len(review),'overall_counts':dict(Counter(r['overall'] for r in unique.values())),'mailbox_confidence_counts':dict(Counter(r['mailbox'] for r in unique.values())),'recovery_unique_addresses':sum(r['overall']=='LOW' or r['mailbox']=='LOW' or r['status']=='hold_risk' for r in unique.values()),'recovery_account_email_rows':sum(r['aws_overall']=='LOW' or r['aws_mailbox_exists']=='LOW' or r['aws_policy_status']=='hold_risk' for r in review),'total_unique_api_results_including_personalized_batch':len(results),'published_api_cost_estimate_usd':round(len(results)*.01,2),'prospect_emails_sent':0}
(V/'aws-final-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
