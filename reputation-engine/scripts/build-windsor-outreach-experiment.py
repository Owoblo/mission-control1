"""Build a full-directory review queue and reproducible account-level A/B drafts; never sends."""
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / 'partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15'
OUT = RUN / 'volume-experiment'
OUT.mkdir(exist_ok=True)

def read_csv(name):
    with (RUN / name).open() as f:
        return list(csv.DictReader(f))

def write_csv(name, rows):
    with (OUT / name).open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

accounts = read_csv('accounts-and-locations.csv')
routes = read_csv('deduplicated-email-routes.csv')
crm = json.loads((RUN / 'market_contacts.json').read_text())
by_account = defaultdict(list)
for route in routes:
    by_account[route['account_id']].append(route)
by_email = {c['email'].lower(): c for c in crm if c.get('email')}

def segment(a):
    text = (a['source_categories'] + ' ' + a['name']).lower()
    if any(w in text for w in ['school', 'college', 'university', 'municipal', 'hospital', 'government']):
        return 'institutional'
    if any(w in text for w in ['manufactur', 'automotive', 'tool', 'industrial']):
        return 'industrial'
    if any(w in text for w in ['hotel', 'hospitality', 'property', 'real estate', 'casino']):
        return 'property_hospitality'
    return 'other_business'

def score(r):
    text = (r['role'] + ' ' + r['email']).lower()
    if any(w in text for w in ['procurement', 'purchasing', 'facilit', 'operations']):
        return 0
    if any(w in text for w in ['info@', 'contact@', 'office@', 'general']):
        return 1
    return 2

# Shared company domains receive one assignment and only one initial candidate.
groups = defaultdict(list)
for a in accounts:
    groups[a['domain'].lower().removeprefix('www.') or a['account_id']].append(a)
strata = defaultdict(list)
for group, members in groups.items():
    strata[segment(members[0])].append(group)
assignments = {}
for bucket, keys in strata.items():
    for index, key in enumerate(sorted(keys, key=lambda k: hashlib.sha256(('windsor-v1:' + k).encode()).hexdigest())):
        assignments[key] = ('A' if index % 2 == 0 else 'B', index // 2 + 1)

queue, drafts, seen_groups, seen_emails = [], [], set(), set()
for a in sorted(accounts, key=lambda a: (score(sorted(by_account[a['account_id']], key=score)[0]) if by_account[a['account_id']] else 9, a['account_id'])):
    group = a['domain'].lower().removeprefix('www.') or a['account_id']
    variant, pair = assignments[group]
    options = sorted(by_account[a['account_id']], key=lambda r: (score(r), r['email']))
    route = options[0] if options else None
    email = route['email'].lower() if route else ''
    flags = ['current_source_and_recipient_review', 'sending_basis_review', 'live_crm_suppression_and_history_check']
    if a['quality_flags']:
        flags.append(a['quality_flags'])
    old = by_email.get(email)
    if old:
        flags.append('existing_crm_contact_review')
        if any(old.get(k) for k in ['do_not_contact', 'cross_channel_suppressed_at', 'email_unsubscribed_at']):
            flags.append('suppressed_in_crm_snapshot')
    if any(word in a['name'].lower() for word in ['st. clair', 'huli', 'steelcraft', 'border services']):
        flags.append('existing_relationship_keep_separate')
    if route and any(word in (route['role'] + ' ' + email).lower() for word in ['sales', 'recruit', 'careers', 'hr@', 'media', 'support@']):
        flags.append('department_suitability_review')
    state = 'candidate_for_review'
    if not route:
        state = 'find_contact_route'
    elif group in seen_groups or email in seen_emails:
        state = 'alternate_location_or_route'
    elif 'suppressed_in_crm_snapshot' in flags or 'existing_relationship_keep_separate' in flags:
        state = 'hold_existing_relationship_or_suppression'
    if route:
        seen_groups.add(group)
        seen_emails.add(email)
    row = dict(account_id=a['account_id'], account_name=a['name'], company_group=group,
               segment=segment(groups[group][0]), variant=variant, within_segment_pair=pair,
               city=a['city'], email=email, contact_name=route['contact_name'] if route else '',
               role=route['role'] if route else '', available_routes=len(options), state=state,
               review_flags='; '.join(flags), source_url=route['source_url'] if route else a['source_url'],
               draft_id='', sent_at='', provider_message_id='', delivered_at='', replied_at='',
               reply_outcome='', introduction_contact='', vendor_registration_status='',
               quote_requested_at='', job_won_at='', revenue_cents='', next_action='', owner='John')
    if state == 'candidate_for_review':
        draft_id = 'we-ab-v1-' + a['account_id']
        row['draft_id'] = draft_id
        question = ("Could you point me to the process for joining your vendor list for office and furniture moves?" if variant == 'A'
                    else "Who would be the best person to speak with about office and furniture moves for your team?")
        body = ("Hello,\n\nI’m John with Saturn Star Movers. We help businesses in Windsor–Essex with office and furniture moves, including packing, loading, transport and placement.\n\n"
                + question + "\n\nI’d like to make it easy for your team to reach us when something comes up.\n\nThank you,\nJohn Owolabi\nSaturn Star Movers\nbusiness@starmovers.ca\nhttps://starmovers.ca\n\nIf you prefer no further emails from me, just reply and let me know.")
        drafts.append(dict(draft_id=draft_id, account_id=a['account_id'], account_name=a['name'],
                           variant=variant, to=email, subject='Moving support for your team', body=body,
                           status='draft_requires_review_not_sent', release_checks=flags + ['validated_sender_footer', 'recipient_mailbox_check']))
    queue.append(row)

assert len(queue) == len(accounts)
assert len({d['to'] for d in drafts}) == len(drafts)
assert len({r['company_group'] for r in queue if r['draft_id']}) == len(drafts)
write_csv('account-review-queue.csv', queue)
(OUT / 'email-drafts.json').write_text(json.dumps(drafts, indent=2, ensure_ascii=False))
summary = dict(source_profiles=len(accounts), source_email_routes=len(routes),
               unique_source_emails=len({r['email'].lower() for r in routes}),
               company_groups=len(groups), accounts_with_route=sum(bool(by_account[a['account_id']]) for a in accounts),
               queue_states=dict(Counter(r['state'] for r in queue)),
               drafts=len(drafts), draft_variants=dict(Counter(d['variant'] for d in drafts)),
               sent=0, experiment='windsor-commercial-v1', allocation='Company-domain groups balanced within broad sector; candidate counts can differ after holds. Rebalance reviewed release batch within sector before sending.')
(OUT / 'summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))
