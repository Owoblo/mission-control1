"""Owner-only notices from the existing Railway preparation receipts."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import base64
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

EVIDENCE_GAPS = {
    'source_review': 'confirm the business and its current first-party contact or location page',
    'business_identity_review': 'corroborate the business identity and exact local branch',
    'route_attribution_review': 'find first-party evidence linking the route to this identity',
    'route_or_existing_identity_review': 'resolve route ownership and check its prior CRM match',
    'verify_unique_current_mobile': 'confirm the carrier result and that the number belongs to this business',
    'carrier_sms_unroutable': 'verify a different professional contact route',
    'primary_mobile_route_selection_required': 'identify which verified number belongs to the intended person or branch',
    'confirm_single_direct_realtor_mobile': 'resolve a current direct mobile for the named agent',
    'independently_attributed_mobile_route_missing': 'find a professional source that directly attributes the mobile',
    'first_party_realtor_route_required': 'find the route on a current first-party professional page',
    'current_open_house_attribution_required': 'confirm the current event and agent role against the source',
    'additional_listing_evidence_needed': 'confirm the exact property and listing representative',
    'open_house_market_conflict': 'resolve the listing market and the agent’s service market',
    'resolve_brokerage': 'resolve the agent and current brokerage using first-party evidence',
    'verify_historical_mobile_receipt': 'reconcile the earlier delivery receipt with the current mobile route',
}
RELEASE_CHECKS = {
    'recipient_specific_release_basis_unconfirmed': 'review the saved source and recipient-specific release basis',
    'channel_or_role_review': 'confirm the recipient’s role and appropriate channel',
    'sector_specific_copy_review': 'verify the business use case and review the proposed copy',
    'full_thread_decision_required': 'read the full conversation before choosing an action',
    'office_visit_promise_or_sensitive_thread_review': 'review the prior commitment and agree on the next action',
    'verification_request_review': 'reconcile the previous verification attempt before retrying',
}


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
    codes = sorted(set(map(str, holds)))
    gaps = list(dict.fromkeys(EVIDENCE_GAPS[key] for key in codes if key in EVIDENCE_GAPS))
    checks = list(dict.fromkeys(RELEASE_CHECKS[key] for key in codes if key in RELEASE_CHECKS))
    state = ('Weak evidence · ' if gaps else '') + str(state)
    reasons = ', '.join(codes)
    if gaps or checks:
        reasons += ' | Next check — ' + '. '.join([*gaps, *checks]) + '.'
    return {'name': str(name or '')[:200], 'city': str(city or '')[:120], 'state': str(state)[:120],
            'reasons': reasons[:500], 'crmUrl': url}


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
        for path in sorted((results/'records').glob('*.json')):
            record = read(path, {})
            if record.get('hold') and record.get('id') not in issues and record.get('id') not in inventory:
                state = record.get('state', 'research_review')
                review.append(review_row(record.get('name'), record.get('city'), state, [state]))
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
    counts = Counter(reason for row in review for reason in row['reasons'].partition(' | ')[0].split(', ') if reason)
    metrics.update({'Review records': len(review),
                    'Records with a known evidence gap': sum(row['state'].startswith('Weak evidence · ') for row in review),
                    **{'Hold · ' + reason: count for reason, count in sorted(counts.items())}})
    yield from split_review_notice(day, lane, key, metrics, review)


def split_review_notice(day, lane, key, metrics, review):
    # Leave space for the full summary and the JSON envelope under Vercel's request limit.
    parts = [[]]
    size = 0
    for row in review:
        length = len(json.dumps(row, ensure_ascii=False).encode()) + 1
        if size + length > 1500000 or len(parts[-1]) >= 10000:
            parts.append([])
            size = 0
        parts[-1].append(row)
        size += length
    for index, rows in enumerate(parts, start=1):
        part_metrics = {**metrics, 'Review attachment part': f'{index} of {len(parts)}'} if len(parts) > 1 else metrics
        part_key = key if index == 1 else f'{key}:part{index}'
        yield notice(day, lane, part_key, 'run', part_metrics, rows)


def geographic_coverage_notices(out, day):
    foundation = read(out/'physical-foundation.json', {})
    daily = out/'days'/day
    coverage = read(daily/'municipality-candidate-coverage.json', {})
    if not foundation or not coverage:
        return
    report = read(daily/'report.json', {})
    if not report:
        return
    stock = {row['municipality_id']: row for row in coverage['municipalities']}
    screened = Counter()
    for row in report.get('city_category', []):
        screened[row['city']] += sum(row['states'].values())
    rows = []
    for city in foundation['municipalities']:
        intake = stock.get(city['municipality_id'], {})
        layer_states = {layer['layer']: layer['state'] for layer in city['layers']}
        short = {
            'collected_publisher_inventory_reconciled': 'source inventory checked',
            'downloaded_checksum_verified': 'boundary file verified',
            'display_tiles_ready': 'display ready',
            'source_discovery_pending': 'source needed',
            'county_download_excluded_municipal_access_unconfirmed': 'access unconfirmed',
            'empty_source_requires_review': 'empty result needs review',
            'available_in_linked_physical_pilot': 'pilot evidence',
            'downloaded_not_yet_spatially_validated': 'validation needed',
        }
        scope = ', '.join(layer + ' ' + short.get(state, state) for layer, state in layer_states.items())
        mapped = city.get('saved_map', {})
        reasons = f"{scope}. Occupants and suite coverage unverified. Mapped locations {mapped.get('saved_locations', 'unknown')}, recorded units {mapped.get('with_recorded_unit', 'unknown')}, no domain {mapped.get('without_primary_domain', 'unknown')}. Selected {intake.get('selected_candidates', 'unknown')}, screened {screened[city['municipality']]}."
        rows.append({
            'name': city['municipality'], 'city': city['municipality'], 'state': intake.get('stock_state', 'stock receipt missing'),
            'reasons': reasons[:500], 'crmUrl': '',
        })
    metrics = {
        'Report': 'Physical geography and research coverage',
        'Municipalities tracked': len(rows),
        'Daily municipalities with eligible candidate stock': coverage.get('municipalities_with_candidates', 'unknown'),
        'Daily municipalities with no eligible stock': len(coverage.get('empty_municipalities', [])),
        'Physical layer status cells': foundation['summary']['physical_layer_cells'],
        'Municipalities with reconciled civic address source inventory': foundation['summary']['addresses_with_reconciled_source_inventory'],
        'Saved locations with no domain': foundation['summary']['saved_locations_without_primary_domain'],
        'Physical evidence ledger generated at': foundation['generated_at'],
        'Remaining work': 'Verify zoning, buildings, parcels, civic addresses and published occupants at the property and suite level.',
    }
    yield from split_review_notice(day, 'Scheduler', 'geography-coverage', metrics, rows)


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


def billing_request(url, authorization):
    request = Request(url, headers={'Authorization': authorization})
    with build_opener(NoRedirects()).open(request, timeout=8) as response:
        return json.load(response)


def billing_amount(value):
    cents = Decimal(str(value))
    if not cents.is_finite():
        raise ValueError('Invalid billing amount')
    return cents


def phone_billing(root, provider):
    if provider == 'Twilio':
        config = read(root/'.private/regional-outcomes.json', {})
        sid = config['TWILIO_ACCOUNT_SID'].strip()
        if not re.fullmatch(r'AC[\da-fA-F]{32}', sid):
            raise ValueError('Invalid account')
        token = config['TWILIO_AUTH_TOKEN'].strip()
        auth = 'Basic ' + base64.b64encode(f'{sid}:{token}'.encode()).decode()
        base = 'https://api.twilio.com/2010-04-01/Accounts/' + sid
        result = billing_request(base+'/Balance.json', auth)
    else:
        config = read(root/'.private/contact-verification.json', {})
        auth = 'Bearer ' + config['TELNYX_API_KEY'].strip()
        result = billing_request('https://api.telnyx.com/v2/balance', auth)['data']
    currency = result['currency']
    if not re.fullmatch(r'[A-Z]{3}', currency):
        raise ValueError('Missing billing currency')
    return {'currency': currency, 'balance': str(billing_amount(result['balance'])),
            'available': str(billing_amount(result.get('available_credit', result['balance'])))}


def refresh_billing(out, root, now, reader=phone_billing):
    path = out/'provider-billing-status.json'
    prior = read(path, {})
    if prior.get('at') and now - parse_date(prior['at']) < timedelta(hours=1):
        return prior

    def check(provider):
        try:
            return provider, reader(root, provider)
        except HTTPError as exc:
            return provider, {'error': f'HTTP {exc.code}'}
        except Exception as exc:
            return provider, {'error': type(exc).__name__}

    with ThreadPoolExecutor(max_workers=2) as executor:
        providers = dict(executor.map(check, ('Twilio', 'Telnyx')))
    current = {'at': now.isoformat(), 'providers': providers}
    save(path, current)
    return current


def balance_notices(day, snapshot, floors):
    for provider, row in snapshot.get('providers', {}).items():
        key = provider.lower()
        if row.get('error'):
            yield notice(day, 'Scheduler', 'billing:' + key + ':unavailable', 'issue', {
                'Issue': provider + ' balance check unavailable',
                'Provider response': row['error'], 'Checked at': snapshot['at'],
            })
            continue
        floor = billing_amount(floors.get(key, 25))
        available = billing_amount(row['available'])
        if available <= floor:
            level = 'critical' if available <= 0 else 'low'
            yield notice(day, 'Scheduler', f'billing:{key}:{level}', 'issue', {
                'Issue': provider + ' ' + level + ' available funds',
                'Available': f"{available:.2f} {row['currency']}",
                'Alert threshold': f"{floor:.2f} {row['currency']}",
                'Checked at': snapshot['at'],
                'Next step': 'Check payment and auto-recharge in the provider console.',
            })


def openai_cost_notices(day, report, results, floor):
    usage = read(results/'api-usage.json', {})
    worker = report.get('worker', {})
    if usage.get('quota_exhausted') or worker.get('state') == 'model_quota_hold':
        yield notice(day, 'B2B', 'openai:quota', 'issue', {
            'Issue': 'OpenAI run hit a quota or billing limit',
            'Next step': 'Check prepaid credit and spend limits in the OpenAI billing dashboard.',
        })
    if worker.get('estimated_model_token_usd') is not None:
        estimate = billing_amount(worker['estimated_model_token_usd'])
        if estimate >= floor:
            yield notice(day, 'B2B', 'openai:spend', 'issue', {
                'Issue': 'OpenAI run crossed the estimated token-cost threshold',
                'Estimated cost USD': f'{estimate:.2f}', 'Alert threshold USD': f'{floor:.2f}',
            })


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


def tick(out, state, now, db, sender=post, root=ROOT):
    settings = read(out/'run-notifications-config.json', {})
    first = settings.get('first_day')
    if not first:
        return
    today = now.astimezone(TORONTO).date()
    day = today.isoformat()
    days = {d for d in (day, (today-timedelta(days=1)).isoformat(), (today-timedelta(days=2)).isoformat()) if d >= first}
    floors = settings.get('billing_alerts')
    billing = refresh_billing(out, root, now) if floors else {}
    warnings = list(balance_notices(day, billing, floors)) if floors else []
    if floors:
        daily = out/'days'/day
        warnings.extend(openai_cost_notices(day, read(daily/'report.json', {}), daily/'results',
                        billing_amount(floors.get('openai_per_run_usd', 10))))
    push_notices(state, warnings, now, sender)
    for batch_day, lane, key, folder, results, prep, path, errors in iter_batches(out, days):
        receipt = read(path, {})
        notifications = list(issues_for(batch_day, lane, key, errors))
        if lane == 'B2B':
            report = read(folder/'report.json', {})
            if floors and batch_day != day:
                notifications.extend(openai_cost_notices(batch_day, report, results,
                    billing_amount(floors.get('openai_per_run_usd', 10))))
            uncertain = report.get('record_states', {}).get('verification_request_review', 0)
            if uncertain:
                notifications.append(notice(batch_day, lane, key + ':verification_review', 'issue', {
                    'Issue': 'Verification requests need reconciliation',
                    'Records affected': uncertain,
                }))
        report_key = notice(batch_day, lane, key, 'run', {})
        plan_path = already_saved(state, report_key, 'plan')
        complete = already_saved(state, report_key, 'complete')
        report_plan = []
        if not complete.exists():
            report_plan = read(plan_path, [])
            if not report_plan:
                for report_notice in run_notices(folder, batch_day, lane, key, results, prep, receipt):
                    for provider, row in billing.get('providers', {}).items():
                        value = row.get('error') or f"{row['available']} {row['currency']}"
                        report_notice['metrics'].append([provider + ' available funds', value])
                    if billing.get('at'):
                        report_notice['metrics'].append(['Billing checks observed at', billing['at']])
                    report_plan.append(report_notice)
                if report_plan:
                    save(plan_path, report_plan)
            notifications.extend(report_plan)
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
        push_notices(state, notifications, now, sender)
        if report_plan and all(already_saved(state, part).exists() for part in report_plan):
            save(complete, {'at': now.isoformat(), 'parts': len(report_plan)})
            plan_path.unlink(missing_ok=True)
    for report_day in sorted(days):
        key = notice(report_day, 'Scheduler', 'geography-coverage', 'run', {})
        if not already_saved(state, key).exists():
            push_notices(state, geographic_coverage_notices(out, report_day), now, sender)
    if day in days:
        warnings = list(issues_for(day, 'Scheduler', 'scheduler', [out/'muse-review-error.json']))
        heartbeat = read(out/'scheduler-status.json', {}).get('at')
        if (out/'HOLD').exists() or (out/'STOP').exists() or (heartbeat and
                now - parse_date(heartbeat) > timedelta(minutes=30)):
            warnings.append(notice(day, 'Scheduler', 'scheduler:paused', 'issue',
                {'Issue': 'Preparation scheduler is held, stopped, or has a stale heartbeat',
                 'Last heartbeat': heartbeat or 'Unavailable'}))
        push_notices(state, warnings, now, sender)


def push_notices(state, warnings, now, sender):
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
