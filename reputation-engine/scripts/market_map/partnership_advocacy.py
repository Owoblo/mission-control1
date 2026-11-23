"""Production and advocacy tiers from attributed jobs and explicit CRM feedback."""
from collections import Counter, defaultdict
import re
import unicodedata

COMPLETE = {'completed', 'customer_success'}
OPEN = {'open', 'in_progress'}
RECOVERY = re.compile(r'complaint|service recovery|payment dispute|payment discussion|damage claim|refund', re.I)
PERMISSIONS = ('reference', 'testimonial', 'content')


def municipality_key(value):
    normalized = unicodedata.normalize('NFKD', value.casefold())
    return re.sub('[^a-z0-9]', '', normalized)


def group(values):
    values = sorted(set(filter(None, values)))
    for at in range(0, len(values), 60):
        yield 'in.(' + ','.join(values[at:at + 60]) + ')'


def tier(contact, referrals, leads, tasks):
    cid = contact['id']
    linked = [lead for lead in leads if lead.get('contact_id') == cid]
    lead_ids = {lead['id'] for lead in linked}
    by_id = {lead['id']: lead for lead in leads}
    ids_with_referral = set()
    jobs = defaultdict(set)
    job_ids_by_lead = defaultdict(set)
    for r in referrals:
        if r['contact_id'] == cid and r.get('crm_lead_id') and r.get('job_id'):
            job_ids_by_lead[r['crm_lead_id']].add(r['job_id'])
    for r in referrals:
        if r['contact_id'] != cid:
            continue
        lead = r.get('crm_lead_id')
        alternatives = job_ids_by_lead[lead]
        job = r.get('job_id') or (next(iter(alternatives)) if len(alternatives) == 1 else lead if not alternatives else None)
        if lead:
            ids_with_referral.add(lead)
        if job and (r['job_status'] in COMPLETE or
                    lead in by_id and by_id[lead]['stage'] in COMPLETE):
            jobs[job].update(filter(None, (job, lead)))
    for lead in linked:
        if lead['id'] not in ids_with_referral and lead['stage'] in COMPLETE:
            jobs[lead['id']].add(lead['id'])
    relevant = [t for t in tasks if t['related_id'] == cid]
    reviews = {t.get('source_key'): str(t.get('outcome_note') or '').strip().lower()
               for t in relevant if t['status'] == 'completed'}
    recovery = any(t['status'] in OPEN and RECOVERY.search(t.get('title') or '') for t in relevant)
    positive = set()
    for job, aliases in jobs.items():
        if all(any(reviews.get(f'partner-referral-feedback:{alias}:{role}', '').startswith('positive:') and
                   reviews[f'partner-referral-feedback:{alias}:{role}'].split(':', 1)[1].strip() for alias in aliases)
               for role in ('customer', 'partner')):
            positive.add(job)
    permission = [kind for kind in PERMISSIONS if reviews.get('partner-advocacy-permission:'+kind, '').startswith('approved:') and
                  reviews['partner-advocacy-permission:'+kind].split(':', 1)[1].strip()]
    if recovery:
        state = 'Service recovery'
    elif positive:
        state = 'Verified advocate'
    elif jobs:
        state = 'Completed referral · feedback needed'
    elif lead_ids or any(r['contact_id'] == cid for r in referrals):
        state = 'Referral recorded · completion unverified'
    else:
        state = 'No attributed referral'
    return {'contact_id':cid,'name':contact.get('name') or contact.get('company') or '',
            'city':contact.get('city') or 'City unverified',
            'workflow':'Realtor' if re.search(r'realtor|real.?estate|salesperson',contact.get('category') or '',re.I) else
                       'Business / organization' if contact.get('category') else 'Relationship category unverified',
            'state':state,'completed_jobs':len(jobs),'positive_jobs':len(positive),
            'permissions':permission,'evidence_ids':sorted(jobs)}


def scan(db, markets=()):
    refs = db('partner_referrals','id,contact_id,crm_lead_id,job_id,job_status')
    leads = db('crm_leads','id,contact_id:data->>partnerReferralContactId,stage:data->>stage',
               deleted='eq.false',**{'data->>partnerReferralContactId':'not.is.null'})
    known = {r['id'] for r in leads}
    extra = {r.get('crm_lead_id') for r in refs} - known
    for ids in group(extra):
        leads.extend(db('crm_leads','id,contact_id:data->>partnerReferralContactId,stage:data->>stage',
                        deleted='eq.false',**{'and':f'(id.{ids})'}))
    results = []
    configured = {municipality_key(city):city for city in markets}
    ids = {r['contact_id'] for r in [*refs,*leads] if r.get('contact_id') and re.fullmatch(r'[a-f0-9-]{36}', r['contact_id'])}
    for linked in group(ids):
        contacts = db('market_contacts','id,name,company,city,category',**{'and':f'(id.{linked})'})
        tasks = db('crm_tasks','id,related_id,title,status,source_key,outcome_note',related_id=linked,
                   related_type='in.(partner,relationship)')
        for c in contacts:
            if re.match(r'^(QA |Test[ -]|Internal test)',c.get('name') or '',re.I):
                continue
            partner = tier(c,refs,leads,tasks)
            city = municipality_key(partner['city'])
            partner['city'] = configured.get(city, partner['city'])
            results.append(partner)
    results.sort(key=lambda r:(r['city'],r['workflow'],r['name']))
    cities = Counter((r['city'],r['workflow']) for r in results if r['state']=='Verified advocate')
    geographical = sorted({(r['city'],r['workflow']) for r in results} |
                          {(city,workflow) for city in markets for workflow in ('Realtor','Business / organization')})
    return {'partners':results,'states':dict(Counter(r['state'] for r in results)),
            'markets':[{'city':city,'workflow':workflow,'verified':cities[city,workflow],
                        'target':100 if workflow=='Realtor' and city in configured.values() else None}
                       for city,workflow in geographical]}
