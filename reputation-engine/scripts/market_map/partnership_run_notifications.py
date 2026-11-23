"""Owner-only notices from the existing Railway preparation receipts."""
from collections import Counter
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zoneinfo import ZoneInfo

TORONTO = ZoneInfo('America/Toronto')
ROOT = Path('/data/research')
OUT = ROOT/'artifacts/daily-preparation-20261118/scaled-geography'
ENDPOINT = 'https://go.quote2move.com/api/marketing/partnership-digest'
CONTACT_URL = 'https://go.quote2move.com/marketing/partners?tab=phone&contact='
BAD_CARRIER = {'carrier_credentials_unavailable', 'shared_daily_carrier_capacity_reached',
               'carrier_provider_error_hold'}
QUEUE_ACTIVE = {'pending', 'processing', 'running', 'queued_manual'}
DELIVERED = {'delivered', 'read'}
FAILED = {'failed', 'undelivered', 'delivery_failed', 'sending_failed', 'canceled'}


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def read(path, default=None):
    return json.loads(path.read_text()) if path.is_file() else default


def save(path, value):
    tmp = path.with_suffix('.next')
    tmp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')))
    tmp.replace(path)


def review_row(name, city, state, holds, contact_id=None):
    url = CONTACT_URL + contact_id if isinstance(contact_id, str) and re.fullmatch(r'[\da-f-]{36}', contact_id) else ''
    return {'name': str(name or '')[:200], 'city': str(city or '')[:120], 'state': str(state)[:120],
            'reasons': ', '.join(sorted(set(map(str, holds))))[:500], 'crmUrl': url}


def notice(day, lane, key, kind, metrics, review=()):
    return {'id': f'{day}:{key}:{kind}', 'day': day, 'lane': lane, 'kind': kind,
            'metrics': [[str(k)[:300], str(v)[:300]] for k, v in metrics.items()], 'review': list(review)}


def summarize_receipt(receipt):
    return {k.replace('_', ' '): receipt[k] for k in ('mode', 'prepared', 'send_ready', 'would_queue', 'already_queued', 'scheduled')
            if k in receipt}


def run_notices(folder, day, lane, key, results, preparation, receipt):
    if not receipt or receipt.get('mode') not in ('execute', 'preview'):
        return
    review = []
    issues = {row.get('id'): row.get('reasons', []) for row in receipt.get('held', [])}
    inventory = {str(row['id']): row for row in read(results/'verified-contact-inventory.json', {}).get('items', [])}
    metrics = summarize_receipt(receipt)
    metrics['campaign'] = receipt.get('campaign_key') or 'No jobs queued'
    metrics['Carrier lookup requests'] = read(results/'carrier-review-status.json', {}).get('provider_attempts', 0)
    metrics['Carrier lookup errors'] = read(results/'carrier-review-status.json', {}).get('provider_errors', 0)
    if lane == 'B2B':
        report = read(folder/'report.json', {})
        plan = read(folder/'plan-summary.json', {})
        metrics.update({'Candidates selected': plan.get('selected', 'unavailable'),
                        'Businesses with researched routes': report.get('prepared_recipients', 'unavailable'),
                        'Model cost estimate USD': report.get('worker', {}).get('estimated_model_token_usd', 'unavailable')})
        for state, count in sorted(report.get('record_states', {}).items()):
            metrics['Research state · ' + state] = count
        by_city = Counter()
        for row in report.get('city_category', []):
            by_city[row['city']] += sum(row.get('states', {}).values())
        for city, count in sorted(by_city.items()):
            metrics['Researched · ' + city] = count
        for identifier, holds in read(preparation, {}).get('holds', {}).items():
            issues.setdefault(identifier, []).extend(holds)
    else:
        decision = read(folder/'relationship-decisions.json', {})
        metrics['CRM relationships reviewed'] = len(decision.get('contacts', []))
        metrics['New or ambiguous agents'] = len(decision.get('new_or_ambiguous_agents', []))
        status = read(results.parent/'status.json', {})
        for field in ('state', 'listing_tasks', 'listing_tasks_with_roles', 'named_agent_tasks', 'people_checked',
                      'carrier_candidate_numbers'):
            if isinstance(status.get(field), (int, str)):
                metrics['Source review · ' + field] = status[field]
        for reason, count in sorted(status.get('capture_failures', {}).items()):
            metrics['Source capture issue · ' + reason] = count
        for row in decision.get('contacts', []):
            if row.get('holds') or row['state'] == 'full_thread_decision_required':
                contact = row.get('contact') or {}
                review.append(review_row(contact.get('name'), contact.get('city'), row['state'],
                                         row.get('holds') or [row['state']], row.get('contact_id')))
        # Research failures and ambiguous matches may never reach the carrier inventory.
        source_agents = {str(row['id']): row for row in read(results.parent/'agent-results.json', {}).get('items', [])}
        for row in decision.get('new_or_ambiguous_agents', []):
            if str(row['id']) not in inventory:
                agent = source_agents.get(str(row['id']), {})
                review.append(review_row(row.get('name'), agent.get('city'), row['state'],
                                         [row['state'], *row.get('holds', [])]))
        for row in read(results.parent/'listing-results.json', {}).get('items', []):
            if row.get('state') == 'additional_listing_evidence_needed':
                review.append(review_row(row.get('mls') or row.get('address') or row.get('id'), row.get('city'),
                                         row['state'], [row['state']]))
        if receipt.get('verified_candidates') is not None:
            metrics['Agent route candidates'] = receipt['verified_candidates']
        for identifier, row in inventory.items():
            holds = list(row.get('review_holds') or [])
            routes = row.get('verified_routes', [])
            if sum(route.get('technical_state') == 'canadian_mobile' for route in routes) != 1:
                holds.append('confirm_single_direct_realtor_mobile')
            if holds:
                issues.setdefault(identifier, []).extend(holds)
    for identifier, holds in sorted(issues.items(), key=lambda row: str(row[0])):
        item = inventory.get(str(identifier), {})
        if holds:
            review.append(review_row(item.get('name') or identifier, item.get('city'), 'held_before_send', holds,
                                     item.get('contact_id')))
    counts = Counter(reason for row in review for reason in row['reasons'].split(', ') if reason)
    metrics.update({'Review records': len(review), **{'Hold · ' + reason: count for reason, count in sorted(counts.items())}})
    yield notice(day, lane, key, 'run', metrics, review)


def issues_for(day, lane, key, files):
    for path in files:
        data = read(path, {})
        if not data:
            continue
        state = data.get('state')
        timestamp = data.get('interrupted_at') if state == 'interrupted' else data.get('at')
        if timestamp and parse_date(timestamp).astimezone(TORONTO).date().isoformat() != day:
            continue
        if (path.name.endswith('error.json') or state in BAD_CARRIER or state in
                {'unconfirmed', 'failed', 'interrupted', 'attempts_exhausted', 'retry_exhausted', 'incomplete'}
                or (data.get('provider_errors') or 0) > 0):
            code = data.get('http_status') or data.get('type') or data.get('error') or state or 'failed'
            # Exclude exception strings and source payloads from email.
            code = re.sub(r'[^\w-]', '', str(code))[:80] or 'failed'
            yield notice(day, lane, f'{key}:{path.stem}:{code}', 'issue', {
                'Stage': path.stem.replace('-', ' '), 'Issue': code, 'Observed at': data.get('at') or 'Current run',
                'Next step': 'Check the Railway run receipt. Contacts requiring review stay held.',
            })


def delivery_notice(day, lane, key, receipt, now, db):
    if not receipt.get('scheduled') or not receipt.get('campaign_key'):
        return
    rows = db('sequence_jobs', 'id,status,provider_sid,sent_at,scheduled_at',
              **{'sms_payload->>campaign_key': 'eq.' + receipt['campaign_key']})
    if not rows:
        yield notice(day, lane, key + ':queue_missing', 'issue', {'Issue': 'Queue receipt has no matching jobs',
                     'Campaign': receipt['campaign_key']})
        return
    states = Counter(r['status'] for r in rows)
    if any(states.get(state) for state in QUEUE_ACTIVE):
        if any(r['status'] in QUEUE_ACTIVE and r['scheduled_at'] and
               parse_date(r['scheduled_at']) + timedelta(hours=2) < now for r in rows):
            yield notice(day, lane, key + ':queue_overdue', 'issue', {'Issue': 'Queue job open over two hours past schedule',
                         'Campaign': receipt['campaign_key'], **states})
        return
    ids = sorted({row['provider_sid'] for row in rows if row.get('provider_sid')})
    events = {}
    for start in range(0, len(ids), 70):
        for event in db('crm_sms_provider_events', 'event_id,message_key,status,occurred_at', cursor_key='event_id',
                        message_key='in.(' + ','.join(ids[start:start+70]) + ')'):
            k = event['message_key']
            previous = events.get(k)
            if not previous or parse_date(event['occurred_at']) > parse_date(previous['occurred_at']):
                events[k] = event
    sent = [parse_date(r['sent_at']) for r in rows if r.get('sent_at')]
    if not sent:
        sent = [parse_date(r['scheduled_at']) for r in rows if r.get('scheduled_at')]
    delivery = Counter(events.get(sid, {}).get('status', 'no_receipt') for sid in ids)
    delivered = sum(delivery[s] for s in DELIVERED)
    failed = sum(delivery[s] for s in FAILED)
    pending = len(ids) - delivered - failed
    if pending and (not sent or max(sent) + timedelta(hours=20) > now):
        return
    yield notice(day, lane, key, 'delivery', {
        'Campaign': receipt['campaign_key'], 'Queue records': len(rows), 'Provider accepted': len(ids),
        'Confirmed delivered': delivered, 'Provider delivery failures': failed, 'Awaiting final receipt': pending,
        **{'Queue · ' + state: n for state, n in sorted(states.items())},
        **{'Carrier · ' + state: n for state, n in sorted(delivery.items())},
    })


def parse_date(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def post(payload, root=ROOT):
    secret = os.environ.get('WORKER_SHARED_SECRET') or read(root/'.private/geo-sms-promotion.json', {}).get('WORKER_SHARED_SECRET')
    if not secret:
        raise ValueError('Worker notification credential unavailable')
    request = Request(ENDPOINT, data=json.dumps(payload, ensure_ascii=False).encode(),
                      headers={'Content-Type': 'application/json', 'x-internal-secret': secret})
    with build_opener(NoRedirects()).open(request, timeout=35) as response:
        return json.load(response)


def already_saved(state, payload, suffix='accepted'):
    return state/(hashlib.sha256(payload['id'].encode()).hexdigest() + '.' + suffix + '.json')


def send_once(state, payload, now, sender=post):
    accepted = already_saved(state, payload)
    if accepted.exists():
        return
    pending = already_saved(state, payload, 'pending')
    previous = read(pending)
    if previous:
        age = now - parse_date(previous['opened_at'])
        if age >= timedelta(hours=20) or now - parse_date(previous['tried_at']) < timedelta(minutes=5):
            return
        envelope = previous['payload']
    else:
        envelope = payload
    save(pending, {'payload': envelope, 'opened_at': previous['opened_at'] if previous else now.isoformat(),
                   'tried_at': now.isoformat()})
    result = sender(envelope)
    if result.get('state') != 'accepted' or not result.get('providerId'):
        raise ValueError('Notification receipt not confirmed')
    save(accepted, {'at': now.isoformat(), 'id': payload['id'], 'providerId': result['providerId']})
    pending.unlink(missing_ok=True)


def iter_batches(out, days):
    for day in days:
        folder = out/'days'/day
        results = folder/'results'
        if folder.is_dir():
            yield day, 'B2B', 'geo', folder, results, results/'geo-sms-preparation.json', results/'geo-sms-promotion-receipt.json', (
                folder/'dispatcher-error.json', folder/'geo-sms-preparation-error.json', results/'geo-sms-promotion-attempt.json',
                results/'carrier-review-status.json')
    for folder in (out/'muse-imports'/'reviews').glob('*'):
        source = folder/'source-first'
        results = source/'realtor-sms'
        receipt = results/'promotion-receipt.json'
        status = read(source/'status.json', {})
        launch = read(folder/'source-first-launch.json', {})
        timestamps = [status.get('at'), launch.get('interrupted_at'), launch.get('at'),
                      read(results/'promotion-attempt.json', {}).get('at')]
        if receipt.is_file():
            timestamps.append(datetime.fromtimestamp(receipt.stat().st_mtime, timezone.utc).isoformat())
        campaign = read(receipt, {}).get('campaign_key', '')
        match = re.fullmatch(r'open-house-realtor-daily-(\d{8})-[\da-f]{24}', campaign)
        day = (datetime.strptime(match[1], '%Y%m%d').date().isoformat() if match else
               max((parse_date(at).astimezone(TORONTO).date().isoformat() for at in timestamps if at), default=''))
        if day in days:
            key = hashlib.sha256(folder.name.encode()).hexdigest()[:24]
            yield day, 'Realtor', key, folder, results, results/'unused.json', receipt, (
                source/'status.json', folder/'source-first-launch.json', results/'promotion-attempt.json',
                results/'carrier-review-status.json')


def tick(out, state, now, db, sender=post):
    settings = read(out/'run-notifications-config.json', {})
    first = settings.get('first_day')
    if not first:
        return
    today = now.astimezone(TORONTO).date()
    day = today.isoformat()
    days = {d for d in (day, (today-timedelta(days=1)).isoformat(), (today-timedelta(days=2)).isoformat()) if d >= first}
    for batch_day, lane, key, folder, results, prep, path, errors in iter_batches(out, days):
        receipt = read(path, {})
        notifications = list(issues_for(batch_day, lane, key, errors))
        notifications += list(run_notices(folder, batch_day, lane, key, results, prep, receipt))
        ready_path = folder/'report.json' if lane == 'B2B' else results.parent/'status.json'
        if not receipt and ready_path.is_file():
            ready = read(ready_path, {}).get('at')
            if ready and now - parse_date(ready) > timedelta(hours=2):
                notifications.append(notice(batch_day, lane, key + ':promotion_waiting', 'issue', {
                    'Issue': 'Research finished over two hours ago with no promotion receipt',
                    'Research finished at': ready,
                }))
        delivered = notice(batch_day, lane, key, 'delivery', {})
        if receipt.get('scheduled') and not already_saved(state, delivered).exists():
            try:
                notifications.extend(delivery_notice(batch_day, lane, key, receipt, now, db))
            except Exception:
                notifications.append(notice(batch_day, lane, key + ':delivery_receipts', 'issue',
                    {'Issue': 'Could not reconcile queue delivery receipts', 'Campaign': receipt.get('campaign_key')}))
        for payload in notifications:
            try:
                send_once(state, payload, now, sender)
            except Exception as exc:
                print(f"Notification {payload['id']} unconfirmed ({getattr(exc, 'code', type(exc).__name__)})", flush=True)
    if day in days:
        warnings = list(issues_for(day, 'Scheduler', 'scheduler', [out/'muse-review-error.json']))
        heartbeat = read(out/'scheduler-status.json', {}).get('at')
        if (out/'HOLD').exists() or (out/'STOP').exists() or (heartbeat and
                now - parse_date(heartbeat) > timedelta(minutes=30)):
            warnings.append(notice(day, 'Scheduler', 'scheduler:paused', 'issue',
                {'Issue': 'Preparation scheduler is held, stopped, or has a stale heartbeat',
                 'Last heartbeat': heartbeat or 'Unavailable'}))
        for payload in warnings:
            try:
                send_once(state, payload, now, sender)
            except Exception as exc:
                print(f"Notification {payload['id']} unconfirmed ({getattr(exc, 'code', type(exc).__name__)})", flush=True)


def main():
    # The mounted scheduler exposes the same authenticated, paginated CRM reader.
    from worker import database_rows
    os.umask(0o077)
    state = OUT/'run-notification-receipts'
    state.mkdir(exist_ok=True)
    with (state/'worker.lock').open('a+b') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        while True:
            try:
                secret = read(ROOT/'.private/regional-outcomes.json', {})
                tick(OUT, state, datetime.now(timezone.utc), lambda *args, **kw: database_rows(secret, *args, **kw))
            except Exception as exc:
                print('Reporting scan failed:', type(exc).__name__, file=sys.stderr, flush=True)
            time.sleep(120)


if __name__ == '__main__':
    main()
