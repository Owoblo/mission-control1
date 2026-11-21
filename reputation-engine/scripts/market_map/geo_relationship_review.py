"""Reconcile geography holds against saved CRM relationships without contacting anyone."""
import json

from .geo_recipient_cloud import FOLDER, SCREEN, remote


RECONCILE = r"""
import os, pathlib
os.umask(0o077)
root = pathlib.Path('/data/research')
folder = pathlib.Path(FOLDER)
rows = json.loads((folder/'screened.json').read_text())['items']
rows = [r for r in rows if r['state'] in ('existing_identity_context_review','owner_or_sales_review')]
credential = json.loads((root/'.private/regional-outcomes.json').read_text())
checked_at = datetime.now(timezone.utc)

def scan(table, select, **filters):
    cursor = ''
    while True:
        params = dict(filters, select=select, limit=1000, order='id.asc')
        if cursor:
            params['id'] = 'gt.' + cursor
        url = credential['SUPABASE_URL'].strip()+'/rest/v1/'+table+'?'+urllib.parse.urlencode(params)
        key = credential['SUPABASE_KEY'].strip()
        request = urllib.request.Request(url, headers={'apikey':key,'Authorization':'Bearer '+key})
        with urllib.request.urlopen(request, timeout=30) as response:
            page = json.load(response)
        if not page:
            break
        yield from page
        cursor = str(page[-1]['id'])

def address(value):
    return str(value or '').strip().casefold()

def keys(contact):
    return (('email', address(contact.get('email'))),
            ('site', domain(contact.get('website'))),
            ('name', normalize(contact.get('company') or contact.get('name'))))

def index_expression(ids):
    return 'in.(' + ','.join(ids) + ')'

contacts = defaultdict(list)
columns = ('id,name,company,city,email,website,preferred_channel,last_touch_at,last_inbound_at,'
           'do_not_contact,cross_channel_suppressed_at,email_unsubscribed_at,stage,decision')
for contact in scan('market_contacts', columns):
    for kind, value in keys(contact):
        if value:
            contacts[(kind, value)].append(contact)

review = []
resolved_ids = set()
for row in rows:
    matches = {}
    values = (('email',address(row['email_candidate'])),('site',domain(row['website'])),
              ('name',normalize(row['name'])))
    for kind, value in values:
        for contact in contacts[(kind,value)]:
            match = matches.setdefault(contact['id'], {'contact':contact,'evidence':[]})
            match['evidence'].append(kind)
    supported = [m['contact'] for m in matches.values()
                 if normalize(m['contact']['city'])==normalize(row['city'])
                 and ('email' in m['evidence'] or set(m['evidence'])=={'name','site'})]
    contact = supported[0] if len(supported)==1 else None
    item = {'geo_id':row['organisation_id'],'organization':row['name'],'city':row['city'],
            'candidate_matches':list(matches.values()),'resolved_contact':contact}
    review.append(item)
    if contact:
        resolved_ids.add(contact['id'])

touches, tasks, sales = defaultdict(list), defaultdict(list), defaultdict(list)
ids = sorted(resolved_ids)
for start in range(0,len(ids),30):
    values = index_expression(ids[start:start+30])
    for touch in scan('market_touches','id,contact_id,created_at,channel,direction',contact_id=values):
        touches[touch['contact_id']].append(touch)
    for task in scan('crm_tasks','id,related_id,status',related_id=values,status='in.(open,in_progress)'):
        tasks[task['related_id']].append(task)
    for lead in scan('crm_leads','id,referrer:data->>partnerReferralContactId,stage:data->>stage',
                     deleted='eq.false',**{'data->>partnerReferralContactId':values}):
        if lead['stage'] not in ('lost','completed','customer_success'):
            sales[lead['referrer']].append(lead)

states = Counter()
for record in review:
    contact = record['resolved_contact']
    if not contact:
        state = 'identity_review'
    else:
        contact_id = contact['id']
        history = sorted(touches[contact_id],key=lambda t:(t['created_at'],t['id']),reverse=True)
        latest = history[0] if history else None
        record.update(saved_touch_count=len(history),latest_touch=latest,open_tasks=tasks[contact_id],
                      active_sales=sales[contact_id])
        suppressed = (contact['do_not_contact'] or contact['cross_channel_suppressed_at']
                      or contact['email_unsubscribed_at'] or contact['stage'] in ('dnc','closed_lost')
                      or contact['decision'] in ('opted_out','rejected','bad_number'))
        last = latest['created_at'] if latest else contact['last_touch_at']
        age = (checked_at-datetime.fromisoformat(last.replace('Z','+00:00'))).days if last else None
        record['saved_touch_age_days'] = age
        if suppressed:
            state = 'suppressed'
        elif tasks[contact_id] or sales[contact_id]:
            state = 'open_task_or_active_sales'
        elif latest and latest['direction']=='inbound':
            state = 'inbound_context_review'
        elif age is not None and age>=60:
            state = 'quiet_relationship_review'
        elif age is not None and age>=45:
            state = 'review_if_fresh_signal'
        elif age is not None:
            state = 'recent_touch'
        else:
            state = 'saved_contact_without_touch_history'
    states[state]+=1
    record['state']=state

receipt = {'as_of':checked_at.isoformat(),'reviewed':len(review),'resolved_relationships':len(resolved_ids),
           'states':dict(states),'dispatch':False}
out = folder/'relationship-context-review.json'
next_file = out.with_suffix('.next')
next_file.write_text(json.dumps({'summary':receipt,'items':review},separators=(',',':')))
next_file.replace(out)
print('RESULT:'+json.dumps(receipt))
"""

if __name__ == '__main__':
    helpers = SCREEN.split('\ndef screen(', 1)[0]
    print(json.dumps(remote(helpers + RECONCILE.replace('FOLDER',repr(FOLDER))),indent=2))
