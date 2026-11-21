"""Daily geography and relationship preparation on the existing Railway volume."""
import argparse
import base64
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path('/data/research')
BASE = ROOT/'artifacts/daily-preparation-20261118'
OUT = BASE/'scaled-geography'
PREVIOUS = ROOT/'artifacts/geo-recipient-preparation-20261118-v4'
LOCAL = ZoneInfo('America/Toronto')
MUSE_RESEARCH_MAX_ATTEMPTS = 3
MUSE_RESEARCH_RETRY_SECONDS = 300
CARRIER_RETRY_SECONDS = 120
CARRIER_MAX_ATTEMPTS = 3
EXCLUDED = {'park','beach','bridge','atm','historic_site','monument','parking','parking_lot',
            'public_toilet','bus_stop','railway_station','charging_station'}

class NoPromotionRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read(path, default=None):
    return json.loads(path.read_text()) if path.is_file() else default


def save(path, value):
    temporary = path.with_suffix('.next')
    temporary.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')))
    temporary.replace(path)


def now():
    return datetime.now(timezone.utc).isoformat()


def normalize(value):
    return re.sub(r'[^a-z0-9]','',str(value or '').casefold())


def domain(url):
    try:
        return (urllib.parse.urlsplit(url or '').hostname or '').casefold().removeprefix('www.')
    except ValueError:
        return ''


def address(value):
    return str(value or '').strip().casefold()


def phone(value):
    digits = re.sub(r'\D','',str(value or ''))
    if len(digits)==11 and digits.startswith('1'):
        digits=digits[1:]
    return '+1'+digits if len(digits)==10 else ''


def database_rows(secret,table,select,*,cursor_key='id',**filters):
    cutoff = now()
    key = secret['SUPABASE_KEY'].strip()
    cursor = ''
    rows = []
    while True:
        params = dict(filters,select=select,limit=1000,order=cursor_key+'.asc')
        if table in ('market_contacts','sequence_jobs'):
            params['created_at']='lte.'+cutoff
        if cursor:
            params[cursor_key]='gt.'+cursor
        url = secret['SUPABASE_URL'].strip()+'/rest/v1/'+table+'?'+urllib.parse.urlencode(params)
        request = urllib.request.Request(url,headers={'apikey':key,'Authorization':'Bearer '+key})
        with urllib.request.urlopen(request,timeout=30) as response:
            page=json.load(response)
        if not page:
            return rows
        next_cursor = str(page[-1][cursor_key])
        if next_cursor==cursor:
            raise RuntimeError('CRM read did not advance')
        rows.extend(page)
        cursor = next_cursor


def inventory():
    supplied = json.loads((OUT/'expanded-inventory.json').read_text())['items']
    windsor = json.loads((ROOT/'artifacts/windsor-region-map-20261104/places.json').read_text())
    for row in windsor:
        name, city, site = (row.get(k) or '' for k in ('organization','municipality','website'))
        if not name or not city or not domain(site) or not row.get('source_url') or row.get('category') in EXCLUDED:
            continue
        key = hashlib.sha256((normalize(name)+'|'+normalize(city)+'|'+normalize(row.get('address'))).encode()).hexdigest()
        supplied.append({'organisation_id':key,'name':name,'city':city,'sector':row.get('category') or 'unknown',
                         'website':site,'email_candidate':'','map_source':row['source_url'],'saved_source_evidence':[]})
    return supplied


def map_stock(path=None):
    path=path or OUT/'map-stock.json.gz'
    if not path.is_file():
        return {'generated_at':None,'municipalities':[],'items':[]}
    with gzip.open(path,'rt',encoding='utf-8') as stream:
        return json.load(stream)


def already_investigated():
    seen_ids, seen_orgs, routes = set(), set(), set()
    results = [PREVIOUS/'results', *OUT.glob('days/*/results')]
    for result in results:
        for path in (result/'records').glob('*.json'):
            record=read(path,{})
            if pending_model_work(record):
                continue
            seen_ids.add(record.get('id'))
            seen_orgs.add((normalize(record.get('name')),normalize(record.get('city'))))
            if record.get('state')=='prepared_contextual_draft':
                routes.add(address(record.get('recipient')))
            elif record.get('state')=='verified_contact_inventory':
                routes.update(address(r['value']) for r in record.get('verified_routes',[]))
    for packet in OUT.glob('backfill-*/results/verified-contact-inventory.json'):
        for record in read(packet,{}).get('items',[]):
            routes.update(address(r['value']) for r in record['verified_routes'])
    prior_status=read(PREVIOUS/'results/status.json',{})
    if prior_status.get('state')=='running' and (PREVIOUS/'activation-receipt.json').is_file():
        receipt=read(PREVIOUS/'activation-receipt.json',{})
        if receipt.get('pid') and Path('/proc',str(receipt['pid'])).is_dir():
            for record in read(PREVIOUS/'intake.json',{}).get('items',[]):
                seen_ids.add(record['organisation_id'])
                seen_orgs.add((normalize(record['name']),normalize(record['city'])))
    return seen_ids,seen_orgs,routes


def pending_model_work(record):
    attempt_key={
        'context_and_copy_work':'copy_attempt_started',
        'verify_contact_context':'verification_attempt_started',
    }.get(record.get('state'))
    return attempt_key is not None and not record.get(attempt_key)


def select_candidates(rows,seen_ids,seen_orgs,seen_routes,day,limit):
    buckets=defaultdict(lambda:defaultdict(deque))
    seen_ids,seen_orgs,seen_routes=seen_ids.copy(),seen_orgs.copy(),seen_routes.copy()
    for row in rows:
        key=row['organisation_id']
        identity=(normalize(row['name']),normalize(row['city']))
        route=address(row['email_candidate'])
        if key in seen_ids or identity in seen_orgs or (route and route in seen_routes):
            continue
        seen_ids.add(key)
        seen_orgs.add(identity)
        if route:
            seen_routes.add(route)
        buckets[identity[1]][normalize(row['sector'])].append(row)
    availability={city:{category:len(group) for category,group in groups.items()} for city,groups in buckets.items()}
    remaining=sum(sum(groups.values()) for groups in availability.values())
    # Keep a regular turn for smaller cities while their saved inventory lasts.
    offset=datetime.fromisoformat(day).date().toordinal()
    city_turns=deque(sorted(buckets))
    if city_turns:
        city_turns.rotate(-(offset%len(city_turns)))
    category_turns={city:deque(sorted(groups)) for city,groups in buckets.items()}
    for turns in category_turns.values():
        turns.rotate(-(offset%len(turns)))
    chosen=[]
    while city_turns and len(chosen)<limit:
        city=city_turns.popleft()
        turns=category_turns[city]
        category=turns.popleft()
        group=buckets[city][category]
        chosen.append(group.popleft())
        if group:
            turns.append(category)
        if turns:
            city_turns.append(city)
    return chosen,remaining,availability


def coverage_report(stock,availability,chosen):
    selected=defaultdict(Counter)
    for row in chosen:
        selected[normalize(row['city'])][normalize(row['sector'])]+=1
    municipalities=[]
    for city in stock['municipalities']:
        key=normalize(city['municipality'])
        by_category=availability.get(key,{})
        eligible=sum(by_category.values())
        selected_by_category=selected[key]
        if eligible:
            next_action='continue_city_category_rotation'
        elif city.get('exported'):
            next_action='replenish_filtered_candidate_stock'
        elif city.get('saved_map_locations'):
            next_action='review_mapped_sites_for_source_backed_candidates'
        else:
            next_action='review_municipal_gis_and_source_foundation'
        municipalities.append({**city,'eligible_candidates':eligible,'selected_candidates':sum(selected_by_category.values()),
            'eligible_by_category':by_category,'selected_by_category':dict(selected_by_category),
            'stock_state':'empty' if not eligible else 'low' if eligible<25 else 'available',
            'next_research_action':next_action})
    return {'map_export_at':stock['generated_at'],'tracked_municipalities':len(municipalities),
        'source_scan_limit_per_municipality':stock.get('source_scan_limit_per_municipality'),
        'municipalities_with_candidates':sum(r['eligible_candidates']>0 for r in municipalities),
        'empty_municipalities':[r['municipality'] for r in municipalities if r['stock_state']=='empty'],
        'low_stock_municipalities':[r['municipality'] for r in municipalities if r['stock_state']=='low'],
        'municipalities':municipalities}


def crm_screen_snapshot(secret):
    contacts=database_rows(secret,'market_contacts',
        'id,name,company,email,phone,website,do_not_contact,cross_channel_suppressed_at,email_unsubscribed_at,email_last_bounced_at,stage,decision,sequence_paused,sequence_paused_reason,last_inbound_at,last_touch_at')
    leads=database_rows(secret,'crm_leads','id,email:data->>email,phone:data->>phone,stage:data->>stage,referrer:data->>partnerReferralContactId',
                       deleted='eq.false')
    leads=[r for r in leads if r['stage'] not in ('lost','completed','customer_success')]
    jobs=database_rows(secret,'sequence_jobs','id,contact_id',status='in.(pending,processing,running)')
    reserved={r['contact_id'] for r in jobs}|{r['referrer'] for r in leads if r['referrer']}
    return contacts,leads,reserved


def screen_and_signals(folder, rows, prior_routes):
    key=read(ROOT/'.private/regional-outcomes.json')
    contacts,leads,reserved=crm_screen_snapshot(key)
    names,sites,emails,numbers=defaultdict(list),defaultdict(list),defaultdict(list),defaultdict(list)
    for contact in contacts:
        for value,index in ((normalize(contact['company'] or contact['name']),names),(domain(contact['website']),sites),
                           (address(contact['email']),emails),(phone(contact['phone']),numbers)):
            if value:
                index[value].append(contact)
    sales_emails={address(r['email']) for r in leads}-{''}
    sales_phones={phone(r['phone']) for r in leads}-{''}
    blocked_states=Counter()
    checked=now()
    for row in rows:
        route=address(row['email_candidate'])
        matches={c['id']:c for c in (names.get(normalize(row['name']),[])+sites.get(domain(row['website']),[])
                                    +emails.get(route,[]))}
        suppressed=any(suppression(c) for c in matches.values())
        active=route in sales_emails or bool(matches.keys()&reserved)
        state=('suppression_hold' if suppressed else 'owner_or_sales_review' if active else
               'existing_identity_context_review' if matches else 'source_mailbox_and_copy_enrichment')
        row.update(state=state,crm={'checked_at':checked,'account_matches':len(matches),'suppressed':suppressed,
                                    'active_sales_or_sequence':active})
        blocked_states[state]+=1
    screen={'at':checked,'contacts':len(contacts),'active_sales_rows':len(leads),'states':dict(blocked_states)}
    save(folder/'crm-screen-receipt.json',screen)
    prepare_open_house_review(folder,key,numbers,reserved)
    return {'items':rows,'existing_phones':sorted(set(numbers)|sales_phones|{r for r in prior_routes if r.startswith('+')}),
            'existing_emails':sorted(set(emails)|sales_emails|{r for r in prior_routes if '@' in r})}


def suppression(contact):
    return (contact['do_not_contact'] or contact['cross_channel_suppressed_at'] or
            contact['email_unsubscribed_at'] or contact['email_last_bounced_at'] or
            contact['stage'] in ('dnc','closed_lost') or contact['decision'] in ('opted_out','bad_number','rejected'))


def refresh_muse_storage(secret=None):
    previous=read(OUT/'muse-storage-receipt.json',{})
    checked=previous.get('checked_at')
    if checked and (datetime.now(timezone.utc)-datetime.fromisoformat(checked)).total_seconds()<300:
        return previous
    if __package__:
        from .muse_open_house_import import pull_storage_export
    else:
        from muse_open_house_import import pull_storage_export
    return pull_storage_export(OUT,secret or read(ROOT/'.private/regional-outcomes.json'))


def prepare_open_house_review(folder,secret,numbers,reserved,*,exported=None,storage=None):
    if exported is None:
        storage=refresh_muse_storage(secret)
        exported=read(OUT/'muse-open-house-intake.json',{})
    alert=read(OUT/'open-house-alert-intake.json',{})
    source=exported or alert
    output=[]
    current=datetime.now(LOCAL)
    today=current.date().isoformat()
    pause_reasons={c['id']:c.get('sequence_paused_reason') for group in numbers.values()
                   for c in group if c.get('sequence_paused')}

    def match(agent,number,office=False):
        candidates=numbers.get(phone(number),[])
        exact=[c for c in candidates if normalize(c['name'])==normalize(agent)]
        contact=exact[0] if not office and len(exact)==len(candidates)==1 else None
        if not contact:
            return None,'office_or_shared_route_review' if office or len(candidates)>1 else 'new_or_ambiguous_agent_research'
        if suppression(contact):
            return contact['id'],'suppression_hold'
        if contact.get('sequence_paused'):
            return contact['id'],'sequence_paused_review'
        if contact['id'] in reserved:
            return contact['id'],'active_sales_or_sequence_review'
        last=max(filter(None,(contact['last_touch_at'],contact['last_inbound_at'])),default=None)
        age=(datetime.now(timezone.utc)-datetime.fromisoformat(last.replace('Z','+00:00'))).days if last else None
        return contact['id'],('recent_conversation_hold' if age is not None and age<45 else
                              'confirm_event_and_review_existing_thread')

    for agent in source.get('items',[]):
        events=[e for e in agent['observations'] if (
            datetime.fromisoformat(e['start_iso'])>current if e.get('start_iso') else e['day']>=today)]
        if not events:
            continue
        contact_id,state=match(agent['agent_name'],agent['number'],agent['route_kind']=='office_listed')
        output.append({'source':'muse_export' if exported else 'mail_alert','listing_id':None,
                       'city':sorted({e['city'] for e in events}),
                       'source_url':source['summary'].get('source_url') or events[0].get('source_url'),
                       'events':events,'agent_name':agent['agent_name'],
                       'crm_contact_id':contact_id,'state':state,'pause_reason':pause_reasons.get(contact_id),'dispatch':False})
    crm_feed='review_only'
    try:
        activities=database_rows(secret,'partner_listing_activity',
            'activity_key,property_key,city,representative,observed_at,source_url',
            cursor_key='activity_key',listing_status='eq.open_house_schedule_observed')
    except Exception as exc:
        crm_feed='crm_feed_read_hold:'+type(exc).__name__
        activities=[]
    for activity in activities:
        rep=activity['representative'] or {}
        events=[e for e in rep.get('open_house_events',[]) if str(e.get('date',''))>=today]
        if not events:
            continue
        contact_id,state=match(rep.get('name'),rep.get('phone'),rep.get('phone_kind')=='office')
        output.append({'source':'saved_crm_activity','listing_id':activity['property_key'],'city':activity['city'],'source_url':activity['source_url'],
                       'observed_at':activity['observed_at'],'events':events,'agent_name':rep.get('name'),
                       'crm_contact_id':contact_id,'state':state,'pause_reason':pause_reasons.get(contact_id),'dispatch':False})
    grouped={}
    for item in output:
        identifier=item['crm_contact_id']
        if identifier:
            listing_ids={event.get('mls') or event.get('session_id') for event in item['events']}
            listing_ids.add(item['listing_id'])
            grouped.setdefault(identifier,set()).update(listing_ids-{None,''})
    sessions={event['session_id']:event for event in exported.get('upcoming_sessions',[])}
    unresolved=[{**sessions.get(item['session_id'],{}),**item} for item in exported.get('unresolved_sessions',[])]
    save(folder/'open-house-review.json',{'state':'review_only','crm_feed_state':crm_feed,'storage_inbox':storage,
         'mail_intake':alert.get('summary',{}),'muse_intake':exported.get('summary',{}),
         'matching_crm_relationships':len(grouped),'items':output,
         'unresolved_sessions':unresolved,
         'relationship_listing_keys':{k:sorted(v) for k,v in grouped.items()},'dispatch':False})


def review_latest_muse_export(storage, *, packet=None):
    """Screen a new validated intake version independently of the morning run."""
    if packet is None:
        packet=read(OUT/'muse-open-house-intake.json',{})
    digest=packet.get('summary',{}).get('archive_sha256','')
    if not re.fullmatch(r'[0-9a-f]{64}',digest):
        return
    folder=OUT/'muse-imports'/'reviews'/digest
    if (folder/'research-queue.json').is_file():
        return
    secret=read(ROOT/'.private/regional-outcomes.json')
    contacts,_,reserved=crm_screen_snapshot(secret)
    numbers=defaultdict(list)
    for contact in contacts:
        value=phone(contact['phone'])
        if value:
            numbers[value].append(contact)
    folder.mkdir(parents=True,exist_ok=True)
    prepare_open_house_review(folder,secret,numbers,reserved,exported=packet,storage=storage)
    review=read(folder/'open-house-review.json')
    unresolved=[{'mls':row.get('mls'),'property_key':row.get('property_key'),
                 'city':row.get('city'),'reason':row['reason'],'events':[row]}
                for row in review['unresolved_sessions'] if row.get('mls') or row.get('property_key')]
    agents={}
    for agent in packet.get('items',[]):
        observations=[e for e in agent['observations'] if e.get('start_iso') and
                      datetime.fromisoformat(e['start_iso'])>datetime.now(LOCAL)]
        if observations:
            entry=agents.setdefault(agent['agent_id'],{'agent_id':agent['agent_id'],'name':agent['agent_name'],
                           'observations':{},'publisher_routes':[]})
            entry['observations'].update((event['session_id'],event) for event in observations)
            if agent.get('number'):
                route={'phone':agent['number'],'kind':agent['route_kind']}
                if route not in entry['publisher_routes']:
                    entry['publisher_routes'].append(route)
    for entry in agents.values():
        entry['observations']=list(entry['observations'].values())
    save(folder/'muse-open-house-intake.json',packet)
    save(folder/'research-queue.json',{'feed':packet['summary'],'unresolved_listings':unresolved,
         'named_agent_candidates':list(agents.values()),'relationship_review':'open-house-review.json','dispatch':False})


def review_imported_muse_exports(storage):
    for version, receipt in storage.get('objects',{}).items():
        digest=receipt.get('archive_sha256') or ''
        if not re.fullmatch(r'[0-9a-f]{64}',version) or not re.fullmatch(r'[0-9a-f]{64}',digest):
            continue
        if (OUT/'muse-imports'/'reviews'/digest/'research-queue.json').is_file():
            continue
        packet=read(OUT/'muse-imports'/'versions'/(version+'.json'))
        if packet:
            review_latest_muse_export(storage,packet=packet)
    review_latest_muse_export(storage)


def muse_research_running(launch, worker, folder):
    try:
        command=Path('/proc',str(launch['pid']),'cmdline').read_bytes().split(b'\0')
    except (FileNotFoundError, ProcessLookupError):
        return False
    return str(worker).encode() in command and str(folder).encode() in command


def start_queued_muse_research():
    worker=OUT/'open_house_source_first.py'
    if not worker.is_file():
        return
    folders=sorted((OUT/'muse-imports'/'reviews').glob('*/research-queue.json'),
                   key=lambda queue:queue.stat().st_mtime)
    candidate=None
    active=False
    check_at=datetime.now(timezone.utc)
    for queue_path in folders:
        folder=queue_path.parent
        receipt_path=folder/'source-first-launch.json'
        launch=read(receipt_path,{})
        if launch and muse_research_running(launch,worker,folder):
            active=True
            continue
        status=read(folder/'source-first'/'status.json',{})
        if status.get('state')=='source_first_pass_complete':
            continue
        attempt=launch.get('attempt',1) if launch else 0
        if launch and 'interrupted_at' not in launch:
            state='manual_recovery_required' if attempt>=MUSE_RESEARCH_MAX_ATTEMPTS else 'retry_wait'
            save(receipt_path,{**launch,'attempt':attempt,'state':state,
                 'reason':'process_exited_before_completion','interrupted_at':check_at.isoformat(),'dispatch':False})
            continue
        if attempt>=MUSE_RESEARCH_MAX_ATTEMPTS:
            continue
        if launch:
            interrupted=datetime.fromisoformat(launch['interrupted_at'])
            if (check_at-interrupted).total_seconds()<MUSE_RESEARCH_RETRY_SECONDS:
                continue
        if active or candidate:
            continue
        queue=read(queue_path)
        if queue['unresolved_listings'] or queue['named_agent_candidates']:
            candidate=(folder,receipt_path,launch,attempt)
    if active or not candidate:
        return
    folder,receipt_path,launch,attempt=candidate
    prior_interruptions=launch.get('prior_interruptions',[])
    if launch:
        prior_interruptions=[*prior_interruptions,{'pid':launch['pid'],'at':launch['at'],
                             'interrupted_at':launch['interrupted_at']}]
    with (folder/'source-first.log').open('ab') as log:
        proc=subprocess.Popen([sys.executable,'-u',str(worker),'run','--workspace',str(OUT),
                               '--folder',str(folder)],cwd=ROOT,stdin=subprocess.DEVNULL,
                              stdout=log,stderr=log,start_new_session=True)
    save(receipt_path,{'pid':proc.pid,'at':now(),'attempt':attempt+1,'state':'launched',
         'prior_interruptions':prior_interruptions,'dispatch':False})


def muse_decision_summary(decision):
    contacts=decision['contacts']
    candidates=decision['new_or_ambiguous_agents']
    return {
        'crm_contacts_by_state':dict(sorted(Counter(row['state'] for row in contacts).items())),
        'crm_contacts_by_hold':dict(sorted(Counter(hold for row in contacts for hold in set(row['holds'])).items())),
        'new_or_ambiguous_agents_by_state':dict(sorted(Counter(row['state'] for row in candidates).items())),
        'new_or_ambiguous_agents_by_hold':dict(sorted(Counter(hold for row in candidates for hold in set(row['holds'])).items())),
    }


def reconcile_completed_muse_research():
    """Attach full saved CRM context to a completed source-first queue."""
    for result_path in sorted((OUT/'muse-imports'/'reviews').glob('*/source-first/agent-results.json')):
        folder=result_path.parent.parent
        output=folder/'relationship-decisions.json'
        prior=read(output,{})
        status=read(result_path.parent/'status.json',{})
        stamp=status.get('at')
        historic=bool(stamp and (datetime.now(timezone.utc)-datetime.fromisoformat(stamp.replace('Z','+00:00'))).total_seconds()>36*3600)
        if prior.get('decision_version')==3 or (prior.get('decision_version')==2 and (not stamp or historic)):
            if 'review_summary' not in prior:
                save(output,{**prior,'review_summary':muse_decision_summary(prior)})
            continue
        if status.get('state')!='source_first_pass_complete' or historic:
            continue
        review=read(folder/'open-house-review.json')
        agents=read(result_path)['items']
        matches={item['crm_contact_id'] for item in review['items'] if item.get('crm_contact_id')}
        matches.update(contact_id for agent in agents for contact_id in agent.get('crm_matches',[]))
        contact_ids=sorted(matches)
        contacts={}
        touches,tasks,jobs=defaultdict(list),defaultdict(list),defaultdict(list)
        linked_events={item['crm_contact_id'] for item in review['items']
                       if item.get('crm_contact_id') and item.get('source')=='saved_crm_activity'}
        secret=read(ROOT/'.private/regional-outcomes.json')
        for start in range(0,len(contact_ids),50):
            group='in.('+','.join(contact_ids[start:start+50])+')'
            for item in database_rows(secret,'market_contacts','id,name,company,city,phone,notes,last_touch_at,last_inbound_at,stage,decision,sequence_paused,sequence_paused_reason,do_not_contact,cross_channel_suppressed_at,email_unsubscribed_at,email_last_bounced_at',**{'and':'(id.'+group+')'}):
                contacts[item['id']]=item
            for item in database_rows(secret,'market_touches','id,contact_id,direction,channel,notes,metadata,created_at',contact_id=group):
                touches[item['contact_id']].append(item)
            for item in database_rows(secret,'crm_tasks','id,related_id,title,status',related_id=group,status='in.(open,in_progress)'):
                tasks[item['related_id']].append(item)
            for item in database_rows(secret,'sequence_jobs','id,contact_id,status',contact_id=group,status='in.(pending,processing,running,queued_manual)'):
                jobs[item['contact_id']].append(item)
        decisions=[]
        for contact_id in contact_ids:
            contact=contacts.get(contact_id)
            history=sorted(touches[contact_id],key=lambda touch:(touch['created_at'],touch['id']))
            last=max([touch['created_at'] for touch in history if touch['direction'] in ('outbound','inbound')]+
                     [v for v in ((contact or {}).get('last_touch_at'),(contact or {}).get('last_inbound_at')) if v],
                     default=None)
            holds=[]
            if not contact:
                holds.append('current_crm_record_missing')
            elif suppression(contact):
                holds.append('suppression_hold')
            if contact and contact['sequence_paused']:
                holds.append(contact.get('sequence_paused_reason') or 'sequence_paused')
            if last and (datetime.now(timezone.utc)-datetime.fromisoformat(last.replace('Z','+00:00'))).days<45:
                holds.append('recent_conversation_hold')
            if tasks[contact_id]:
                holds.append('open_relationship_tasks_review')
            if jobs[contact_id]:
                holds.append('active_sequence_hold')
            if contact_id in linked_events:
                holds.append('current_crm_linked_event_review')
            inbound=[touch for touch in history if touch['direction']=='inbound']
            outbound=[touch for touch in history if touch['direction']=='outbound']
            commitments=[touch for touch in history if re.search(
                r"\b(?:would it be okay if i stopped by|stop by your office|drop off (?:a few )?cards|swing by your office|missed (?:our|the) (?:meeting|appointment)|couldn.t make it|looking forward to meeting|complaint|unhappy)\b",
                touch.get('notes') or '',re.I)]
            if commitments:
                holds.append('office_visit_promise_or_sensitive_thread_review')
            if inbound:
                holds.append('inbound_thread_review')
            state=('held' if holds else 'quiet_sms_route_and_sender_review' if
                   len(outbound)==1 and outbound[0]['channel']=='sms' else 'full_thread_decision_required')
            decisions.append({'contact_id':contact_id,'state':state,
                              'holds':holds,'latest_activity_at':last,'history':history,
                              'contact':{k:contact.get(k) for k in ('name','company','city','phone','notes')} if contact else None,
                              'hold_touch_ids':[touch['id'] for touch in commitments],
                              'open_tasks':tasks[contact_id],'active_jobs':jobs[contact_id],'dispatch':False})
        if prior and not (folder/'relationship-decisions-v1.json').is_file():
            save(folder/'relationship-decisions-v1.json',prior)
        decision={'state':'saved_crm_context_ready','decision_version':3,'contacts':decisions,
             'new_or_ambiguous_agents':[{'id':agent['id'],'name':agent['name'],'state':agent['state'],
                  'holds':['recipient_specific_release_basis_unconfirmed']}
                  for agent in agents if not agent.get('crm_matches')],
             'verified_contact_inventory':'source-first/verified-contact-inventory.json','dispatch':False}
        save(output,{**decision,'review_summary':muse_decision_summary(decision)})


def report(folder,result):
    counts=Counter()
    geography=defaultdict(Counter)
    pending=0
    for path in (folder/'results/records').glob('*.json'):
        item=read(path,{})
        status=item['state']
        counts[status]+=1
        geography[(item['city'],item['sector'])][status]+=1
        pending+=pending_model_work(item)
    context=read(folder/'crm-context.json',{})
    signals=read(folder/'open-house-review.json',{})
    contacts=result.get('mode')=='contact_verification_only'
    filename='verified-contact-inventory.json' if contacts else 'recipient-preparation-queue.json'
    queue=read(folder/'results'/filename,{'items':[]})['items']
    identifier='id' if contacts else 'recipient'
    prepared=len({r[identifier] for r in queue})
    channels=Counter()
    combinations=Counter()
    for item in queue:
        if contacts:
            kinds={r['kind'] for r in item['verified_routes']}
            channels.update(kinds)
            combinations['email_and_phone' if len(kinds)==2 else next(iter(kinds))]+=1
        else:
            channels[item['channel']]+=1
    data={'at':now(),'day':folder.name,'worker':result,'prepared_recipients':prepared,
          'remaining_target':max(0,result['target']-prepared),'by_channel':dict(channels),
          'contact_route_combinations':dict(combinations),'inventory_filename':filename,
          'municipality_candidate_coverage':read(folder/'municipality-candidate-coverage.json',{}),
          'record_states':dict(counts),'model_work_pending_before_attempt':pending,
          'city_category':[{'city':city,'category':category,'states':dict(states)}
                                                      for (city,category),states in sorted(geography.items())],
          'inquiry_scan':context.get('state'),'priority_conversations':len(context.get('priority_review',[])),
          'open_relationship_tasks':len(context.get('outstanding_relationship_tasks',[])),
          'open_house_feed_state':signals.get('state'),'open_house_observations':len(signals.get('items',[])),
            'open_house_crm_feed_state':signals.get('crm_feed_state'),
            'open_house_mail_intake':signals.get('mail_intake'),
            'open_house_muse_intake':signals.get('muse_intake'),
            'open_house_storage_inbox_state':(signals.get('storage_inbox') or {}).get('state'),
          'open_house_agent_states':dict(Counter(r['state'] for r in signals.get('items',[]))),
          'open_house_existing_relationships':signals.get('matching_crm_relationships',0),
          'listing_feed_state':'awaiting_owner_confirmed_listing_refresh',
          'estimated_model_usd_per_prepared':result['estimated_model_token_usd']/prepared if prepared else None,
          'carrier_or_other_provider_billing':None,'paid_mailbox_checks':0,'dispatch':False}
    save(folder/'report.json',data)
    save(OUT/'latest-report.json',data)
    return data


def enrichment_module():
    sys.path.insert(0,str(ROOT))
    import scripts.market_map
    scripts.market_map.__path__[:0]=[str(OUT/'lib'),str(ROOT/'artifacts/partnership-enrichment-20261118/lib')]
    from scripts.market_map import geo_scaledmail_enrichment
    return geo_scaledmail_enrichment


def run_day(folder,config,dry_run=False):
    folder.mkdir(parents=True,exist_ok=True)
    if not dry_run and not (folder/'crm-context.json').is_file():
        save(folder/'plan.json',{'items':[]})
        with (folder/'conversation-scan.log').open('ab') as log:
            subprocess.run(['node',str(BASE/'crm_snapshot.mjs'),str(folder)],cwd=ROOT,stdout=log,
                           stderr=log,timeout=1200,check=False)
    intake=folder/'screened.json'
    if not intake.is_file():
        seen_ids,seen_orgs,prior_routes=already_investigated()
        stock=map_stock()
        rows,remaining,availability=select_candidates(inventory()+stock['items'],seen_ids,seen_orgs,prior_routes,
                     datetime.now(LOCAL).date().isoformat(),config['candidate_ceiling'] if not dry_run else 108)
        save(folder/'municipality-candidate-coverage.json',coverage_report(stock,availability,rows))
        save(folder/'plan-summary.json',{'selected':len(rows),'eligible_inventory_before_selection':remaining,
             'candidate_floor':config['candidate_floor'],'readiness_target':config['recipient_target'],
             'cities':len({r['city'] for r in rows}),'city_categories':len({(r['city'],r['sector']) for r in rows}),
             'dispatch':False})
        save(intake,screen_and_signals(folder,rows,prior_routes))
    prepare = enrichment_module().run
    if dry_run:
        return read(folder/'plan-summary.json')

    result=prepare(ROOT,intake,folder/'results',config['model_request_ceiling'],config['recipient_target'],
                   playbook_root=OUT/'docs',contact_only=config.get('contact_verification_only',True))
    daily_report=report(folder,result)
    if result.get('mode')=='contact_verification_only':
        start_carrier_checks(folder/'results')
    return daily_report


def start_carrier_checks(results):
    inventory_path=results/'verified-contact-inventory.json'
    if not inventory_path.is_file():
        return
    activation_path=results/'carrier-activation.json'
    status_path=results/'carrier-review-status.json'
    worker=OUT/'lib/geo_contact_carrier_checks.py'
    with (results/'carrier-launch.lock').open('a+b') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        prior=read(activation_path,{})
        attempt=prior.get('attempt',1) if prior else 0
        if prior:
            if attempt>=CARRIER_MAX_ATTEMPTS:
                return
            if muse_research_running(prior,worker,inventory_path):
                return
            status=read(status_path,{})
            started=prior.get('started_epoch',activation_path.stat().st_mtime)
            interrupted=not status_path.is_file() or status_path.stat().st_mtime<started
            if not interrupted and status.get('state')!='existing_carrier_worker_active':
                return
            if time.time()-activation_path.stat().st_mtime<CARRIER_RETRY_SECONDS:
                return
            shared=ROOT/'artifacts/regional-contact-enrichment-20261104/carrier.lock'
            if shared.is_file():
                with shared.open('rb') as carrier_lock:
                    try:
                        fcntl.flock(carrier_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    except BlockingIOError:
                        return
        cap=int(os.environ.get('REGIONAL_CARRIER_DAILY_CAP','1000'))
        if not 1<=cap<=2500:
            raise ValueError('Existing shared carrier cap is invalid')
        started=time.time()
        with (results/'carrier.log').open('ab') as log:
            runner=subprocess.Popen([sys.executable,'-u',str(worker),str(inventory_path),
                                     '--root',str(ROOT),'--limit',str(cap)],stdin=subprocess.DEVNULL,
                                     stdout=log,stderr=log,start_new_session=True)
        save(activation_path,{'pid':runner.pid,'at':now(),'started_epoch':started,'attempt':attempt+1,'dispatch':False})


def resume_deferred_carrier_checks():
    candidates=list((OUT/'days').glob('*/results/carrier-activation.json'))
    candidates+=list((OUT/'muse-imports/reviews').glob('*/source-first/carrier-activation.json'))
    candidates+=list((OUT/'muse-imports/reviews').glob('*/source-first/realtor-sms/carrier-activation.json'))
    cutoff=time.time()-36*3600
    for marker in candidates:
        if marker.stat().st_mtime>=cutoff:
            start_carrier_checks(marker.parent)


def post_research_sms(endpoint, batch):
    url=urllib.parse.urlsplit(endpoint)
    if url.scheme!='https' or url.netloc!='go.quote2move.com' or url.path!='/api/marketing/sms/promote-research' or url.query or url.fragment:
        raise ValueError('Invalid geography promotion endpoint')
    secret=os.environ.get('WORKER_SHARED_SECRET') or read(ROOT/'.private/geo-sms-promotion.json',{}).get('WORKER_SHARED_SECRET')
    if not secret:
        raise ValueError('Geography worker secret unavailable')
    payload=json.dumps(batch,ensure_ascii=False,separators=(',',':')).encode()
    if len(payload)>32*1024*1024:
        raise ValueError('Geography promotion evidence exceeds decoded request limit')
    compressed=base64.b64encode(gzip.compress(payload)).decode('ascii')
    payload=json.dumps({'encoding':'gzip-base64','data':compressed},separators=(',',':')).encode()
    if len(payload)>4*1024*1024:
        raise ValueError('Geography promotion payload exceeds request limit')
    request=urllib.request.Request(endpoint,data=payload,headers={'Content-Type':'application/json','x-internal-secret':secret})
    opener=urllib.request.build_opener(NoPromotionRedirect())
    with opener.open(request,timeout=70) as response:
        result=json.load(response)
    return result


def reconcile_daily_geo_sms(folder, config):
    results=folder/'results'
    inventory_path=results/'verified-contact-inventory.json'
    status_path=results/'carrier-review-status.json'
    activation=read(results/'carrier-activation.json',{})
    if not activation or not status_path.is_file() or not inventory_path.is_file():
        return
    if (status_path.stat().st_mtime < inventory_path.stat().st_mtime
            or status_path.stat().st_mtime < activation.get('started_epoch',0)
            or muse_research_running(activation,OUT/'lib/geo_contact_carrier_checks.py',inventory_path)
            or read(status_path,{}).get('state')=='existing_carrier_worker_active'):
        return
    execute=config.get('geo_sms_auto_promotion') is True and folder.name>=config.get('geo_sms_first_day','9999-99-99')
    receipt_path=results/'geo-sms-promotion-receipt.json'
    mode='execute' if execute else 'preview'
    receipt=read(receipt_path,{})
    if (receipt.get('mode')==mode and receipt.get('state')=='confirmed'
            and receipt.get('inventory_mtime')==inventory_path.stat().st_mtime):
        return
    attempt_path=results/'geo-sms-promotion-attempt.json'
    attempt=read(attempt_path,{})
    if attempt.get('mode')==mode and attempt_path.is_file() and time.time()-attempt_path.stat().st_mtime<300:
        return

    prepared=enrichment_module().prepare_geo_sms(read(inventory_path)['items'],OUT/'lib')
    save(results/'geo-sms-preparation.json',prepared)
    if not prepared['drafts']:
        save(receipt_path,{'mode':mode,'state':'confirmed','inventory_mtime':inventory_path.stat().st_mtime,
                           'prepared':0,'would_queue':0,'scheduled':0})
        return
    endpoint=config.get('geo_sms_promotion_endpoint')
    if not endpoint:
        return  # Local draft-only operation until the endpoint is configured.
    save(attempt_path,{'mode':mode,'at':now(),'state':'started'})
    try:
        batch={'day':folder.name,'draft_version':prepared['template_version'],
               'drafts':prepared['drafts'],'inventory':prepared['inventory'],'dry_run':not execute}
        result=post_research_sms(endpoint,batch)
        if result.get('prepared')!=len(prepared['drafts']) or result.get('campaign_key')!='geo-b2b-daily-'+folder.name.replace('-',''):
            raise ValueError('Incomplete geography promotion receipt')
        save(receipt_path,{'mode':mode,'state':'confirmed','inventory_mtime':inventory_path.stat().st_mtime,**result})
    except urllib.error.HTTPError as exc:
        save(attempt_path,{'mode':mode,'at':now(),'state':'unconfirmed','http_status':exc.code})
    except ValueError as exc:
        save(attempt_path,{'mode':mode,'at':now(),'state':'unconfirmed','error':type(exc).__name__,
                           'reason':str(exc)[:120]})
    except Exception as exc:
        save(attempt_path,{'mode':mode,'at':now(),'state':'unconfirmed','error':type(exc).__name__})


def open_house_sms_candidates(agents, decisions, feed, *, clock=None):
    clock=clock or datetime.now(timezone.utc)
    by_contact={r['contact_id']:r for r in decisions}
    by_identity=defaultdict(list)
    for group in feed.get('items',[]):
        by_identity[normalize(group.get('agent_name'))].extend(group.get('observations',[]))
    prepared=[]
    for agent in agents:
        matches=agent.get('crm_matches',[])
        if agent.get('sales_route_match') or len(matches)>1 or not agent.get('brokerages'):
            continue
        contact_decision=by_contact.get(matches[0],{}) if matches else {}
        contact=contact_decision.get('contact') or {}
        roles=agent.get('roles',[])
        events=[]
        for role in roles:
            associated=role.get('events') or by_identity[normalize(agent['name'])]
            for event in associated:
                start=event.get('start_iso')
                if (not start or event.get('mls')!=role.get('mls') or not role.get('source_url') or not role.get('proof')
                        or event.get('status')!='upcoming' or not event.get('verified_on_export_day') or not event.get('verified_at')):
                    continue
                if role.get('origin')=='validated_feed_association' and event.get('source_url')!=role['source_url']:
                    continue
                try:
                    if datetime.fromisoformat(start.replace('Z','+00:00'))<=clock:
                        continue
                except (ValueError,TypeError):
                    continue
                if event.get('city'):
                    events.append((start,event,role))
        cities={normalize(event['city']) for _,event,_ in events}
        city=contact.get('city') if matches else None
        if not events or (not matches and len(cities)!=1):
            # Save direct routes for carrier research even if the relationship
            # decision or listing attribution still needs review.
            selected_event=None
        else:
            start,event,role=min(events,key=lambda entry:entry[0])
            city=city or event['city']
            selected_event={'mls':role['mls'],'source_url':role['source_url'],'starts_at':start,
                            'city':event['city'],'verified_at':event['verified_at']}
        direct=[route for route in agent.get('routes',[]) if route['kind']=='phone'
                and route.get('shared_in_research_batch') is False and route.get('source_url') and route.get('proof')]
        prior=None
        if matches and contact_decision.get('state')=='quiet_sms_route_and_sender_review' and selected_event:
            prior=next((touch for touch in contact_decision['history'] if touch['direction']=='outbound' and touch['channel']=='sms'),None)
            profile=re.search(r'^profile=(https://\S+)$',contact.get('notes') or '',re.M)
            mobile=phone(contact.get('phone'))
            if not prior or not mobile or phone((prior.get('metadata') or {}).get('to'))!=mobile:
                prior=None
            elif not direct and profile:
                direct=[{'kind':'phone','value':mobile,'source_url':profile[1],
                         'proof':'Recorded Realtor profile and prior CRM SMS destination',
                         'origin':'crm_delivered_sms_route','shared_in_research_batch':False}]
        if not direct:
            continue
        holds=[]
        if len(direct)!=1: holds.append('confirm_single_direct_realtor_mobile')
        if not selected_event: holds.append('current_open_house_attribution_required')
        if matches:
            if not prior: holds.extend(contact_decision.get('holds') or ['existing_relationship_review'])
            if contact and any(phone(route['value'])!=phone(contact.get('phone')) for route in direct):
                holds.append('agent_phone_requires_identity_review')
        brokerages={normalize(re.sub(r'\s+brokerage$', '', b, flags=re.I)) for b in agent['brokerages']}
        source_identity_count=agent.get('candidate_directory_identities',0)
        brokerage=agent['brokerages']
        if matches and prior and source_identity_count<=1 and brokerages=={normalize(contact.get('company'))}:
            brokerage=[contact['company']]
            source_identity_count=1
        if source_identity_count!=1 or len(brokerages)!=1:
            holds.append('resolve_brokerage')
        prepared.append({'id':agent['id'],'name':contact.get('name') or agent['name'],'brokerages':brokerage,
                         'roles':roles,'event':selected_event,'city':city,
                         'source_identity_count':source_identity_count,
                         'verified_routes':direct,'review_holds':sorted(set(holds)),
                         **({'contact_id':matches[0],'prior_sms_touch_id':prior['id']} if prior else {})})
    return prepared


def reconcile_open_house_sms(config):
    endpoint=config.get('geo_sms_promotion_endpoint')
    if not endpoint:
        return
    today=datetime.now(LOCAL).date().isoformat()
    execute=config.get('open_house_sms_auto_promotion') is True and today>=config.get('open_house_sms_first_day','9999-99-99')
    mode='execute' if execute else 'preview'
    for source in sorted((OUT/'muse-imports'/'reviews').glob('*/source-first/agent-results.json')):
        folder=source.parent.parent
        decision=read(folder/'relationship-decisions.json',{})
        status=read(source.parent/'status.json',{})
        if (decision.get('decision_version')!=3 or status.get('state')!='source_first_pass_complete'
                or not status.get('at') or datetime.fromisoformat(status['at']).astimezone(LOCAL).date().isoformat()!=today):
            continue
        out=source.parent/'realtor-sms'
        out.mkdir(exist_ok=True)
        receipt_path=out/'promotion-receipt.json'
        if read(receipt_path,{}).get('mode')==mode:
            continue
        inventory_path=out/'verified-contact-inventory.json'
        if not inventory_path.is_file():
            agents=read(source)['items']
            feed=read(folder/'muse-open-house-intake.json',{})
            candidates=open_house_sms_candidates(agents,decision['contacts'],feed)
            save(inventory_path,{'items':candidates})
        else:
            candidates=read(inventory_path)['items']
        if not candidates:
            save(receipt_path,{'mode':mode,'prepared':0,'scheduled':0})
            continue
        start_carrier_checks(out)
        activation=read(out/'carrier-activation.json',{})
        status_path=out/'carrier-review-status.json'
        if (not activation or not status_path.is_file() or status_path.stat().st_mtime<inventory_path.stat().st_mtime
                or status_path.stat().st_mtime<activation.get('started_epoch',0)
                or muse_research_running(activation,OUT/'lib/geo_contact_carrier_checks.py',inventory_path)
                or read(status_path,{}).get('state')=='existing_carrier_worker_active'):
            continue
        ready=[item for item in candidates if not item['review_holds'] and len(item['verified_routes'])==1
               and item['verified_routes'][0].get('technical_state')=='canadian_mobile']
        if not ready:
            save(receipt_path,{'mode':mode,'prepared':0,'scheduled':0,
                               'verified_candidates':len(candidates)})
            continue
        attempt=out/'promotion-attempt.json'
        if read(attempt,{}).get('mode')==mode and time.time()-attempt.stat().st_mtime<300:
            continue
        key=hashlib.sha256(folder.name.encode()).hexdigest()[:24]
        batch={'day':today,'draft_version':'open_house_realtor_v1','export_key':key,
               'candidates':ready,'dry_run':not execute}
        save(attempt,{'mode':mode,'state':'started','at':now()})
        try:
            result=post_research_sms(endpoint,batch)
            if result.get('prepared')!=len(ready) or result.get('campaign_key')!='open-house-realtor-daily-'+today.replace('-','')+'-'+key:
                raise ValueError('Incomplete open-house promotion receipt')
            save(receipt_path,{'mode':mode,'state':'confirmed','verified_candidates':len(candidates),**result})
        except urllib.error.HTTPError as exc:
            save(attempt,{'mode':mode,'state':'unconfirmed','at':now(),'http_status':exc.code})
        except Exception as exc:
            save(attempt,{'mode':mode,'state':'unconfirmed','at':now(),'error':type(exc).__name__})


def daemon():
    with (OUT/'schedule.lock').open('a+b') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        while True:
            config=read(OUT/'config.json')
            local=datetime.now(LOCAL)
            day=local.date().isoformat()
            folder=OUT/'days'/day
            existing=read(folder/'report.json',{})
            prior=read(folder/'dispatcher-error.json')
            held=(OUT/'STOP').exists() or (OUT/'HOLD').exists()
            save(OUT/'scheduler-status.json',{'at':now(),'pid':os.getpid(),'day':day,
                 'local_start_hour':config['start_hour'],'recipient_target':config['recipient_target'],
                 'candidate_floor':config['candidate_floor'],'candidate_ceiling':config['candidate_ceiling'],
                 'state':'held' if held else 'waiting_or_running','dispatch':False})
            if not held:
                try:
                    review_imported_muse_exports(refresh_muse_storage())
                    start_queued_muse_research()
                    reconcile_completed_muse_research()
                    resume_deferred_carrier_checks()
                    reconcile_open_house_sms(config)
                except Exception as exc:
                    save(OUT/'muse-review-error.json',{'at':now(),'type':type(exc).__name__,'dispatch':False})
                if local.hour>=config['start_hour'] and day>=config['first_day'] and existing:
                    try:
                        reconcile_daily_geo_sms(folder,config)
                    except Exception as exc:
                        save(folder/'geo-sms-preparation-error.json',{'at':now(),'type':type(exc).__name__,'dispatch':False})
            if not held and local.hour>=config['start_hour'] and day>=config['first_day'] and not existing and not prior:
                try:
                    if shutil.disk_usage(ROOT).free<3*1024**3:
                        raise RuntimeError('Railway research volume storage reserve')
                    run_day(folder,config)
                except Exception as exc:
                    folder.mkdir(parents=True,exist_ok=True)
                    save(folder/'dispatcher-error.json',{'at':now(),'type':type(exc).__name__,
                         'reason':str(exc)[:240],'dispatch':False})
            time.sleep(30)


if __name__=='__main__':
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preflight',action='store_true')
    args=parser.parse_args()
    if args.preflight:
        print(json.dumps(run_day(OUT/'preflight',read(OUT/'config.json'),dry_run=True)))
    else:
        daemon()
