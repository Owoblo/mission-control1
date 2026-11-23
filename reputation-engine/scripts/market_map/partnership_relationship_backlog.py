"""Owner review of unresolved partnership obligations and referral follow-through."""
from collections import Counter, defaultdict
from datetime import timedelta
import re

CONTACT_URL = 'https://go.quote2move.com/marketing/partners?tab=phone&contact='
CLOSED_SALES = {'closed', 'closed_won', 'closed_lost', 'lost', 'completed', 'customer_success', 'cancelled', 'canceled'}
SUPPRESSED = {'dnc', 'do_not_contact', 'closed_lost', 'suppressed', 'opted_out',
              'unsubscribed', 'not_interested', 'wrong_number', 'bad_number', 'rejected'}
OPEN_TASKS = {'open', 'in_progress'}
CASE_TYPES = {
    'Service recovery': (r"\b(?:service recovery|bad experience|unhappy|dissatisfied|damaged|damage claim|complaint|overcharg\w*|refund|additional charges|payment dispute|payment terms|poor service|make (?:it right|amends))\b",
                         'Read the job and call history, confirm what remains unresolved, and agree an owner-led repair.'),
    'Meeting or visit': (r"\b(?:meeting|appointment|meet in person|meet up|come by|stop by|stopped by|swing by|office visit|drop (?:off )?(?:a few |some |the )?cards)\b",
                         'Confirm whether the visit happened, was cancelled, or needs a new date and confirmed host.'),
    'Nonstandard partnership': (r"\b(?:subcontract\w*|referral fee|referral commission|revenue share|broker fee|exclusiv\w* agreement|vendor agreement|special arrangement|joint venture|sponsor\w*|trucker\w*)\b",
                                'Confirm the proposed terms, owner and next action before making commitments.'),
    'FAQ review': (r"\b(?:insurance|liability|licensed|cancell?ation|deposit|payment options|piano|storage|packing|travel fee|minimum hours)\b",
                   'Answer from the approved FAQ or record the gap and escalate any exception.'),
}
ORDER = {label: index for index, label in enumerate((*CASE_TYPES, 'Completed referral', 'Closed Sales outcome'))}
COMMITMENT = re.compile(
    r"\b(?:i(?:'ll| will| can)|we(?:'ll| will| can)|would it be (?:okay|ok)|can i|could i|"
    r"would you|looking forward|see you|set up|schedule|reschedule|missed|couldn.t make|drop[ -]off)\b", re.I)
VISIT_CTA = re.compile(r"would it be (?:okay|ok) if i stopped by|if you ever|if a .* comes up", re.I)
CALL_SUMMARY_END = re.compile(r'\btranscript\s*:', re.I)
EMAIL = re.compile(r'[\w.+-]+@[\w.-]+\.[a-z]{2,}', re.I)
PHONE = re.compile(r'(?<!\w)(?:\+?1[-. ()]*)?(?:\d[-. ()]*){9}\d(?!\w)')


def chunks(values):
    values = sorted(set(filter(None, values)))
    for offset in range(0, len(values), 80):
        yield 'in.(' + ','.join(values[offset:offset + 80]) + ')'


def clean(text):
    return PHONE.sub('[phone]', EMAIL.sub('[email]', ' '.join(str(text or '').split())))


def touch_text(touch):
    return CALL_SUMMARY_END.split(touch.get('notes') or '', maxsplit=1)[0][:1500]


def relevant(kind, text):
    return bool(re.search(CASE_TYPES[kind][0], text, re.I))


def disposition(touch):
    return touch.get('review_disposition')


def case_evidence(kind, history):
    latest_sms_reply = max((t['created_at'] for t in history if t['direction'] == 'outbound'
                            and t['channel'] in ('sms', 'email')), default='')
    for touch in reversed(history):
        text = touch_text(touch)
        direction = touch['direction']
        incoming = direction == 'inbound'
        if disposition(touch) in {'reaction_only', 'automated_reply', 'polite_decline', 'no_reply_needed'}:
            continue
        if touch.get('outcome_code') in {'email_automatic_reply', 'opt_out', 'opted_out', 'wrong_number'}:
            continue
        if incoming and re.match(r"^(?:Inbound SMS:\s*)?(?:Liked|Loved|Laughed at|Le gustó)\s+[\"“]", text, re.I):
            continue
        if direction not in {'inbound', 'outbound'}:
            continue
        if kind == 'Meeting or visit':
            if (touch.get('outcome_code') == 'meeting_requested' or
                    relevant(kind, text) and (incoming or COMMITMENT.search(text) and not VISIT_CTA.search(text))):
                return touch
        elif kind == 'FAQ review':
            if incoming and relevant(kind, text) and '?' in text and touch['created_at'] > latest_sms_reply:
                return touch
        elif relevant(kind, text) and (incoming or COMMITMENT.search(text)):
            return touch
    return None


def task_kind(task, kind):
    return relevant(kind, task.get('title') or '')


def project(contacts, touches, tasks, leads, referrals, appointments, cutoff, now):
    threads, obligations, sales, jobs = (defaultdict(list) for _ in range(4))
    for touch in touches:
        threads[touch['contact_id']].append(touch)
    for task in tasks:
        obligations[task['related_id']].append(task)
    for lead in leads:
        sales[lead['contact_id']].append(lead)
    for job in referrals:
        jobs[job['contact_id']].append(job)
    rows = []
    for contact in contacts:
        cid = contact['id']
        history = sorted(threads[cid], key=lambda t: (t['created_at'], t['id']))
        linked = sales[cid]
        active = [lead for lead in linked if lead.get('stage') not in CLOSED_SALES or lead.get('pending_commitment')]
        suppressed = (contact.get('do_not_contact') or contact.get('cross_channel_suppressed_at')
                      or contact.get('stage') in SUPPRESSED or contact.get('decision') in SUPPRESSED)
        case_count = len(rows)

        def add(kind, detail, next_action, observed):
            rows.append({'name': (contact.get('name') or contact.get('company') or 'Partner')[:200],
                         'city': (contact.get('city') or '')[:120], 'state': kind,
                         'reasons': clean(f'{observed[:10]} · {detail} Next: {next_action}')[:500],
                         'crmUrl': CONTACT_URL + cid})

        for kind, (_, action) in CASE_TYPES.items():
            evidence = case_evidence(kind, history)
            related = [task for task in obligations[cid] if task_kind(task, kind)]
            outstanding = [task for task in related if task['status'] in OPEN_TASKS]
            task = max(outstanding, key=lambda item: item['updated_at'], default=None)
            if not evidence and not task:
                continue
            if not task and any(item['status'] == 'completed' and item.get('outcome_note') and
                                (item.get('completed_at') or '') >= evidence['created_at'] for item in related):
                continue
            title = f"Open CRM task: {task['title']}. " if task else ''
            excerpt = clean(touch_text(evidence))[:195] if evidence else ''
            add(kind, f'{title}{excerpt}', action + (' Contact is suppressed.' if suppressed else ''),
                max(task['updated_at'] if task else '', evidence['created_at'] if evidence else ''))

        for appointment in appointments.get(cid, []):
            due = appointment['scheduled_at']
            label = ('Marked no-show' if appointment['status'] == 'no_show' else
                     'Past appointment with no recorded outcome' if due < now else 'Upcoming appointment')
            add('Meeting or visit', f"{label}. CRM status {appointment['status']}.",
                'Record the real outcome for a past visit, or confirm the host and attendance for an upcoming appointment.', due)

        needs_recovery = any(row['state'] == 'Service recovery' for row in rows[case_count:])
        if suppressed or needs_recovery:
            continue
        for job in jobs[cid]:
            if job.get('job_status') != 'completed' or not job.get('job_id'):
                continue
            stamp = job['updated_at']
            key = 'partner-referral-thanks:' + job['job_id']
            if any(task.get('source_key') == key and task['status'] in {'completed', 'cancelled'}
                   for task in obligations[cid]):
                continue
            add('Completed referral', f"Linked job {job['job_id']} is recorded as completed.",
                'Confirm service outcome and prior thanks. If appropriate, thank the referring partner privately and share only a genuinely public review.', stamp)

        if len(rows) == case_count and linked and not active and history:
            latest = max(linked, key=lambda lead: lead.get('updated_at') or '')
            stamp = latest.get('updated_at') or ''
            reviewed = any(task['status'] == 'completed' and task.get('outcome_note') and
                           (task.get('completed_at') or '') >= stamp and
                           'closed sales outcome' in task['title'].lower() for task in obligations[cid])
            if stamp >= cutoff and latest.get('stage') in CLOSED_SALES and not reviewed:
                details = 'Linked Sales outcome is ' + latest['stage'].replace('_', ' ') + '.'
                if re.search(r'price|budget|expensive|cost', latest.get('lost_reason') or '', re.I):
                    details += ' Pricing was recorded as a factor.'
                add('Closed Sales outcome', details,
                    'Review the partner relationship and current context. Keep the 45-day rule, open commitments and release checks in force.', stamp)

    return sorted(rows, key=lambda row: (ORDER[row['state']], row['city'], row['name'], row['reasons']))


def scan(db, now):
    cutoff = (now - timedelta(days=180)).isoformat()
    touches = db(
        'market_touches', 'id,contact_id,created_at,direction,channel,notes,outcome_code,review_disposition:metadata->partnership_review->>disposition',
        channel='in.(sms,email,phone)', direction='in.(inbound,outbound)',
        **{'and': f'(created_at.gte.{cutoff},created_at.lte.{now.isoformat()})'})
    tasks = db('crm_tasks', 'id,related_id,title,status,source_key,updated_at,completed_at,outcome_note',
               related_type='in.(partner,relationship)', **{'or': f'(status.in.(open,in_progress),updated_at.gte.{cutoff})'})
    leads = db('crm_leads', 'id,contact_id:data->>partnerReferralContactId,stage:data->>stage,lost_reason:data->>lostReason,updated_at',
               deleted='eq.false', **{'data->>partnerReferralContactId': 'not.is.null'})
    referral_rows = db('partner_referrals', 'id,contact_id,job_id,job_status,updated_at',
                       job_status='eq.completed', updated_at='gte.' + cutoff)
    appointment_rows = db('market_appointments', 'id,contact_id,scheduled_at,status',
                          scheduled_at='gte.' + cutoff, status='not.in.(completed,cancelled,canceled)')
    appointments = defaultdict(list)
    for row in appointment_rows:
        appointments[row['contact_id']].append(row)
    jobs = {(job['contact_id'], job['job_id']): job for job in referral_rows}
    threads = defaultdict(list)
    for row in touches:
        threads[row['contact_id']].append(row)
    ids = ({row['contact_id'] for row in [*leads, *jobs.values()]} |
           {row['related_id'] for row in tasks} | appointments.keys())
    for cid, history in threads.items():
        history.sort(key=lambda row: (row['created_at'], row['id']))
        if any(case_evidence(kind, history) for kind in CASE_TYPES):
            ids.add(cid)
    contacts = [row for group in chunks(cid for cid in ids if cid and re.fullmatch(r'[\da-f-]{36}', cid))
                for row in db('market_contacts', 'id,name,company,city,stage,decision,do_not_contact,cross_channel_suppressed_at',
                              **{'and': f'(id.{group})'})]
    if any(contact['id'] not in ids for contact in contacts):
        raise ValueError('CRM contact read returned identities outside the backlog')
    contacts = [c for c in contacts if 'internal test' not in (c.get('company') or '').lower()]
    cases = project(contacts, touches, tasks, leads, jobs.values(), appointments, cutoff, now.isoformat())
    for task in db('crm_tasks', 'id,title,description,status',
                   source_key='like.partnership-unlinked-recovery:*', status='in.(open,in_progress)'):
        cases.insert(0, {'name': task['title'][:200], 'city': '', 'state': 'Service recovery',
                         'reasons': clean(task['description'])[:500],
                         'crmUrl': 'https://go.quote2move.com/sales/tasks'})
    return {'cutoff': cutoff[:10], 'threads_reviewed': len((set(threads) | ids) - {None}),
            'touches_reviewed': len(touches),
            'counts': dict(Counter(row['state'] for row in cases)), 'review': cases}
