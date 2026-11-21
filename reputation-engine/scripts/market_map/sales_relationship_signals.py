"""Read Sales relationship evidence for the preparation queue."""
import json
import re
from collections import Counter, defaultdict
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    from .prepared_relationship_buffer import digest, dt
except ImportError:
    from prepared_relationship_buffer import digest, dt

FIELDS = ('stage', 'source', 'partnerReferralContactId', 'partnerReferralLinkedAt',
          'createdAt', 'completedAt', 'originCity', 'destCity', 'originAddress', 'destAddress',
          'leadKind', 'primaryContactRole', 'reviewSentAt', 'reviewCompletedAt')
JSON_FIELDS = ('moveRelationships', 'partnershipMoveCloseout', 'operationalOutcomeSummary')
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$', re.I)


def read_sales_rows(secret_path):
    credentials = json.loads(Path(secret_path).read_text())
    key = credentials['SUPABASE_KEY']
    headers = {'apikey': key, 'Authorization': 'Bearer ' + key}
    root = credentials['SUPABASE_URL'].rstrip('/') + '/rest/v1/'
    filters = {
        'select': ','.join(['id'] + [f'{k}:data->>{k}' for k in FIELDS] + [
            f'{k}:data->{k}' for k in JSON_FIELDS
        ]),
        'deleted': 'eq.false',
        'data->>mergedIntoLeadId': 'is.null',
        'or': '(and(data->moveRelationships.not.is.null,data->moveRelationships.neq.[]),'
              'and(data->>partnerReferralContactId.not.is.null,'
              'data->>source.in.(partner_referral,realtor_referral)))',
    }

    def get(table, query, exact=False):
        request = Request(root + table + '?' + urlencode(query),
                          headers={**headers, **({'Prefer': 'count=exact'} if exact else {})})
        with urlopen(request, timeout=20) as response:
            return json.load(response), response.headers.get('Content-Range', '').split('/')[-1]

    _, expected = get('crm_leads', {**filters, 'limit': '1'}, exact=True)
    leads, cursor = [], None
    for _ in range(100):
        query = {**filters, 'order': 'id.asc', 'limit': '500'}
        if cursor:
            query['id'] = 'gt.' + cursor
        page, _ = get('crm_leads', query)
        if page and cursor and page[0]['id'] <= cursor:
            raise ValueError('Sales pagination did not advance')
        leads.extend(page)
        if len(page) < 500:
            break
        cursor = page[-1]['id']
    _, after = get('crm_leads', {**filters, 'limit': '1'}, exact=True)
    if expected != after or len({r['id'] for r in leads}) != len(leads) or str(len(leads)) != expected:
        raise ValueError('Sales signal source counts did not reconcile')
    ids = sorted({x for lead in leads for x in contact_ids(lead)})
    contacts = {}
    for start in range(0, len(ids), 100):
        rows, _ = get('market_contacts', {
            'id': 'in.(' + ','.join(ids[start:start + 100]) + ')',
            'select': 'id,name,company,city,stage,decision,do_not_contact,cross_channel_suppressed_at,'
                      'sequence_paused_reason,last_touch_at,last_inbound_at,preferred_channel,email_unsubscribed_at,email,phone',
        })
        contacts.update((r['id'], r) for r in rows)
    return leads, contacts


def contact_ids(lead):
    candidates = [lead.get('partnerReferralContactId')]
    candidates += [r.get('contactId') for r in lead.get('moveRelationships') or [] if isinstance(r, dict)]
    return {x.lower() for x in candidates if isinstance(x, str) and UUID.fullmatch(x)}


def recorded_customer_referral(lead):
    if lead.get('source') not in ('partner_referral', 'realtor_referral') or not lead.get('partnerReferralContactId'):
        return False
    role, kind = lead.get('primaryContactRole'), lead.get('leadKind')
    return role == 'customer' or (not role and kind in (None, 'customer'))


def project(leads, contacts, now):
    groups = defaultdict(dict)
    counts = Counter()
    for lead in leads:
        referrer = lead.get('partnerReferralContactId')
        source = lead.get('source')
        links = [r for r in lead.get('moveRelationships') or [] if isinstance(r, dict) and r.get('role')]
        actual_referrer = recorded_customer_referral(lead)
        if actual_referrer:
            links.append({'contactId': referrer, 'role': 'referring_realtor' if source == 'realtor_referral'
                          else 'referring_partner', 'actual_referral': True, 'confidence': 'confirmed',
                          'createdAt': lead.get('partnerReferralLinkedAt')})
        elif source in ('partner_referral', 'realtor_referral') and referrer:
            counts['partner_opportunities_without_customer_attribution'] += 1
        for edge in links:
            cid = str(edge.get('contactId') or '').lower()
            contact = contacts.get(cid)
            name = (contact or {}).get('name') or edge.get('name')
            if not name and not cid:
                counts['missing_identity'] += 1
                continue
            stage = lead.get('stage')
            side = edge.get('addressConnection') or 'other'
            role = edge['role']
            actual = edge.get('actual_referral', False)
            if not actual and actual_referrer and cid and cid == str(referrer or '').lower() and role in ('referring_realtor', 'customer_referrer'):
                continue
            city = (contact or {}).get('city') or (lead.get('originCity') if side == 'origin' else
                                                   lead.get('destCity') if side == 'destination' else None)
            grouped_key = 'crm:' + cid if contact else 'sales-unmatched:' + digest(
                [lead['id'], cid or str(name).casefold(), str(edge.get('company') or '').casefold()])
            event = digest([lead['id'], grouped_key, role, side, actual])
            recorded_at = edge.get('createdAt') or lead.get('createdAt')
            try:
                age = now - dt(recorded_at)
                fresh = timedelta(0) <= age <= timedelta(days=60)
            except (AttributeError, TypeError, ValueError):
                fresh = False
            closed = stage in ('completed', 'customer_success')
            closeout = lead.get('partnershipMoveCloseout') or {}
            outcome = closeout.get('outcome') if closed else None
            damage = (lead.get('operationalOutcomeSummary') or {}).get('damage_flag')
            issue = closed and (outcome == 'issue_open' or
                                str(damage).lower() == 'true' and outcome != 'issue_resolved')
            review_left = (lead.get('operationalOutcomeSummary') or {}).get('review_left')
            address = edge.get('connectedAddress')
            current_address = lead.get('originAddress') if side == 'origin' else lead.get('destAddress') if side == 'destination' else None
            address_changed = bool(address and current_address and
                                   ' '.join(address.lower().split()) != ' '.join(current_address.lower().split()))
            role_confirmed = edge.get('confidence') == 'confirmed' and not address_changed
            missing = []
            if not contact:
                missing.append('match_person_or_organization_to_crm')
            if not role_confirmed:
                missing.append('verify_current_move_stop_and_role' if address_changed else 'verify_reported_role')
            if not contact or not (contact.get('email') or contact.get('phone')):
                missing.append('confirm_published_professional_route')
            if closed and not outcome and not issue:
                missing.append('confirm_sales_closeout_outcome')
            if event not in groups[grouped_key]:
                counts['referral_edges' if actual else 'graph_edges'] += 1
            groups[grouped_key][event] = {
                'event_id': event, 'lead_id': lead['id'], 'lead_source': source, 'role': role, 'side': side, 'move_stage': stage,
                'actual_referral': actual, 'recorded_at': recorded_at, 'recent_evidence': fresh,
                'recorded_at_basis': ('referral_link' if actual else 'graph_entry') if edge.get('createdAt') else 'lead_created',
                'move_completed_at': lead.get('completedAt') if closed else None,
                'role_confirmed': role_confirmed, 'missing_evidence': missing,
                'stop_needs_reverification': address_changed, 'city': city,
                'research_name': name if not contact else None,
                'research_company': edge.get('company') if not contact else None,
                'outcome': 'issue_open' if issue else outcome,
                'customer_review_status': ('recorded' if closed and
                                           (lead.get('reviewCompletedAt') or str(review_left).lower() == 'true')
                                           else 'requested' if lead.get('reviewSentAt') else None),
                'proof_recorded': bool(closed and not issue and closeout.get('proof')),
            }
    return groups, counts


def add_sales_evidence(actions, leads, contacts, outstanding_tasks, now):
    groups, counts = project(leads, contacts, now)
    tasks = defaultdict(list)
    for task in outstanding_tasks:
        tasks[task.get('related_id')].append(task)
    for key, entries in sorted(groups.items()):
        signals = [entries[k] for k in sorted(entries)]
        cid = key[4:] if key.startswith('crm:') else None
        contact = contacts.get(cid, {})
        current = actions.get(key)
        history_needed = not contact or any(not s['role_confirmed'] for s in signals) or not (contact.get('email') or contact.get('phone'))
        suppressed = (contact.get('do_not_contact') or contact.get('cross_channel_suppressed_at') or contact.get('email_unsubscribed_at')
                      or contact.get('decision') in ('bad_number', 'rejected', 'opted_out')
                      or contact.get('stage') in ('dnc', 'closed_lost'))
        pending_tasks = tasks.get(cid, []) if cid else []
        # Existing relationship work keeps its copy, priority and owner.
        if current:
            decision = 'add_evidence_to_existing_action'
        elif suppressed:
            decision = 'suppression_hold'
        elif contact.get('sequence_paused_reason') == 'john_personal_review' or pending_tasks:
            decision = 'coordinate_with_existing_owner'
        elif any(s['outcome'] == 'issue_open' for s in signals):
            decision = 'wait_for_sales_service_resolution'
        elif not any(s['recent_evidence'] for s in signals):
            decision = 'historical_relationship_evidence'
        elif history_needed:
            decision = 'verify_role_and_professional_route'
        elif any(s['move_stage'] in ('completed', 'customer_success') for s in signals):
            decision = 'verify_outcome_and_review_relationship'
        elif all(s['move_stage'] == 'lost' for s in signals):
            decision = 'review_relationship_without_job_outcome_claim'
        else:
            decision = 'review_history_and_move_stage'
        counts[decision] += 1
        evidence = {'source': 'sales_crm', 'signals': signals, 'decision': decision,
                    'open_task_ids': [t['id'] for t in pending_tasks if t.get('id')]}
        if current is None:
            if decision == 'historical_relationship_evidence' and all(s['actual_referral'] for s in signals):
                continue
            current = actions[key] = {
                'key': key, 'source': 'sales_relationship_review', 'contact_id': cid,
                'name': contact.get('name') or signals[0]['research_name'], 'city': contact.get('city') or signals[0]['city'],
                'kind': decision, 'state': decision, 'priority': 55 if decision in (
                    'verify_role_and_professional_route', 'verify_outcome_and_review_relationship',
                    'review_history_and_move_stage') else 92,
                'body': None, 'channel': None, 'recipient': None, 'media_urls': [],
                'not_before': now.isoformat(), 'reason': 'Review Sales evidence and contact history before choosing a touch.',
                'holds': ['full_history_and_channel_review'], 'approved': False, 'scheduled': False,
                'send_ready': False, 'source_fingerprint': digest(key),
            }
        current['sales_signal_evidence'] = evidence
        if current['source'] == 'sales_relationship_review':
            current['source_fingerprint'] = digest([current['source_fingerprint'], evidence])
    return dict(counts), len(groups)
