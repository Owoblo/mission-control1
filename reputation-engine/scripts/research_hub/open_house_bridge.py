"""Compile captured listing detail evidence into review-only CRM activity rows.

No network, paid research, CRM contact creation or messaging. Import separately
with conflict-ignore semantics; reviewed CRM links must never be overwritten.
"""
import datetime as dt
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path


def key(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def name(value):
    return re.sub('[^a-z0-9]', '', str(value or '').lower())


def phone(value):
    digits = re.sub(r'\D', '', str(value or ''))
    return digits[-10:] if len(digits) in (10, 11) else None


def compile_activity(report, contacts, evidence_root, today=None):
    today = today or dt.datetime.now(dt.timezone.utc).date()
    by_phone = defaultdict(list)
    for contact in contacts:
        number = phone(contact.get('phone'))
        if number:
            by_phone[number].append(contact)
    output, holds, seen = [], [], set()
    for row in report['rows']:
        if not row.get('current_detail_signal'):
            continue
        events = [e for e in row.get('open_house_events', [])
                  if dt.date.fromisoformat(e['date']) >= today]
        if not events:
            holds.append({'mls': row['mls'], 'reason': 'schedule_expired'})
            continue
        if not row.get('detail_url', '').startswith('https://www.realtor.ca/real-estate/'):
            raise ValueError('Expected attributable public listing detail URL')
        evidence = (Path(evidence_root) / row['evidence_file']).resolve()
        if not evidence.is_relative_to(Path(evidence_root).resolve()):
            raise ValueError('Evidence path outside capture directory')
        digest = hashlib.sha256(evidence.read_bytes()).hexdigest()
        city = row['address'].split(',')[-2].strip() if ',' in row['address'] else 'Unresolved locality'
        property_key = 'realtor.ca:mls:' + row['mls']
        for agent in row.get('associated_agents', []):
            if not agent.get('name'):
                continue
            number = phone(agent.get('direct_phone_displayed'))
            candidates = by_phone.get(number, []) if number else []
            exact = [c for c in candidates if name(c.get('name')) == name(agent['name'])]
            same_page = [a for a in row['associated_agents'] if number and phone(a.get('direct_phone_displayed')) == number]
            state = ('shared_route_review' if len(candidates) > 1 or len(same_page) > 1 else
                     'exact_name_phone_candidate' if len(exact) == 1 else
                     'phone_name_conflict' if candidates else 'unmatched_identity')
            representative_key = key(['public-detail-agent', name(agent['name']), number])
            activity_key = key([property_key, representative_key, 'open_house_schedule'])
            if activity_key in seen:
                continue
            seen.add(activity_key)
            rep = {'name': agent['name'], 'role': 'unknown',
                   'professional_title': agent.get('role'),
                   'phone': agent.get('direct_phone_displayed'), 'phone_kind': 'unknown',
                   'email': None, 'brokerage': None, 'source_url': row['detail_url'],
                   'provenance': 'public_detail_page_review',
                   'open_house_events': events, 'host_role': 'not_verified',
                   'identity_state': state, 'candidate_contact_ids': [c['id'] for c in exact],
                   'conflicting_contact_ids': [c['id'] for c in candidates if c not in exact],
                   'outreach_eligible': False, 'current_availability': 'not_confirmed',
                   'evidence_sha256': digest, 'evidence_file': row['evidence_file'],
                   'schedule_year_requires_confirmation': any('not explicit' in e.get('year_basis', '') for e in events),
                   'next_action': 'Validate schedule, person/role and complete current CRM history; preserve suppression, recent contact and promised work before any outreach.'}
            output.append({'activity_key': activity_key, 'property_key': property_key,
                'listing_id': row['mls'], 'lane': 'residential', 'region': None,
                'city': city, 'address': row['address'],
                'listing_status': 'open_house_schedule_observed',
                'status_evidence': 'public_detail_schedule_current_availability_not_confirmed',
                'representative_key': representative_key, 'representative': rep,
                'contact_id': None, 'match_status': 'ambiguous' if state != 'unmatched_identity' else 'new',
                'source_url': row['detail_url'], 'observed_at': row['observed_at'],
                'run_id': 'public-open-house-bridge-20261117',
                'postcard_batch_id': None, 'postcard_status': None})
    return {'rows': output, 'holds': holds,
            'summary': {'properties': len({r['property_key'] for r in output}),
                        'agent_associations': len(output),
                        'crm_identity_candidates': len({c for r in output for c in r['representative']['candidate_contact_ids']}),
                        'identity_conflicts': sum(r['representative']['identity_state'] == 'phone_name_conflict' for r in output),
                        'automatic_links': 0, 'messages_sent': 0, 'paid_calls': 0}}
