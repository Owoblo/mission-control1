"""Select geography-map organizations with reusable evidence for route and context review."""
import argparse
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys


def records(path):
    with path.open(encoding='utf-8') as stream:
        return [json.loads(line) for line in stream if line.strip()]


def norm(value):
    return re.sub(r'[^a-z0-9]', '', str(value or '').casefold())


def write(path, value):
    with path.with_suffix('.next').open('w', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
    path.with_suffix('.next').chmod(0o600)
    path.with_suffix('.next').replace(path)


def build(root, limit):
    history = root / 'artifacts/partnership-next-day-research-20261028'
    prep = history / 'preparation-20261028-current'
    work = {r['organisation_id']: r for r in records(prep / 'preparation-work.jsonl')}
    verified = {r['organisation_id']: r for r in records(
        history / 'completed-validation-review-20261028-after-retry/individual-review.jsonl')}
    source = {r['organisation_id']: r for r in records(history / 'source-observations.jsonl')}
    inventory = json.loads((prep / 'candidates.json').read_text())
    active = root / 'partnership-system/state/windsor-activation-20261118/cloud-enrichment/prepared-outreach-queue.json'
    active_items = json.loads(active.read_text())['items']
    active_names = {norm(r.get('organization')) for r in active_items}
    used_addresses = {str(r.get('proposed_recipient') or '').lower() for r in active_items}
    rows, companies = [], set()
    rejected = Counter()
    for historical in (True, False):
        buckets = defaultdict(deque)
        for c in inventory:
            key = c['organisation_id']
            e = work.get(key, {})
            s = source.get(key, {})
            mailbox = str(c.get('email') or '').strip().lower()
            city, company = str(c.get('city') or '').strip(), str(c.get('organisation_name') or '').strip()
            if (key in verified) != historical:
                continue
            if not all((city, company, c.get('sector'), mailbox, c.get('website'))) or not c.get('inventory_source_url'):
                rejected['missing_map_identity'] += 1
                continue
            if norm(company) in active_names or mailbox in used_addresses:
                rejected['already_in_enrichment_queue'] += 1
                continue
            if not e.get('source_binding_observed') or e.get('stage') != 'awaiting_mailbox_and_individual_review' or e.get('blockers'):
                rejected['source_or_history_hold'] += 1
                continue
            if s.get('restriction_signals') or not s.get('target_email_observed') or s.get('email', '').lower() != mailbox:
                rejected['source_observation_not_reusable'] += 1
                continue
            buckets[(norm(city), norm(c['sector']))].append((c, s))
        while buckets and len(rows) < limit:
            for area in sorted(buckets):
                c, s = buckets[area].popleft()
                if not buckets[area]:
                    del buckets[area]
                mailbox = c['email'].lower().strip()
                identity = (norm(c['organisation_name']), norm(c['city']))
                if mailbox in used_addresses or identity in companies:
                    rejected['duplicate_route_or_identity'] += 1
                    continue
                used_addresses.add(mailbox)
                companies.add(identity)
                rows.append({
                    'organisation_id': c['organisation_id'], 'name': c['organisation_name'],
                    'city': c['city'], 'sector': c['sector'], 'catchment': c.get('catchment'),
                    'website': c['website'], 'email_candidate': mailbox,
                    'publication_source': c.get('email_source_url'),
                    'saved_source_evidence': [{
                        'url': page.get('final_url') or page.get('requested_url'),
                        'page_sha256': page.get('sha256'),
                        'identity_excerpt': str(page.get('page_identity_excerpt') or '')[:300],
                        'published_route_context': [str(text)[:300] for text in
                                                    (page.get('target_contexts') or [])[:2]],
                    } for page in s.get('pages', []) if page.get('target_email_observed')
                        and (page.get('final_url') or page.get('requested_url'))][:2],
                    'map_source': c['inventory_source_url'],
                    'source_checked_at': s.get('checked_at'),
                    'prior_mailbox_screen': verified.get(c['organisation_id'], {}).get('technical_screen_status'),
                    'route_state': 'refresh_required', 'contact_role': 'unverified',
                    'state': 'geography_enrichment', 'send_ready': False,
                })
                if len(rows) >= limit:
                    break
        if len(rows) >= limit:
            break
    summary = {
        'at': datetime.now(timezone.utc).isoformat(), 'target_ready': limit,
        'from_local_geography': len(rows), 'source_inventory': len(inventory),
        'cities': len({norm(r['city']) for r in rows}),
        'sector_count': len({norm(r['sector']) for r in rows}),
        'historical_mailbox_screens': sum(bool(r['prior_mailbox_screen']) for r in rows),
        'send_ready': 0, 'scheduled': 0, 'excluded_before_selection': dict(rejected),
    }
    return {'summary': summary, 'items': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--limit', type=int, default=1000)
    args = parser.parse_args()
    if not 1 <= args.limit <= 10000:
        parser.error('Limit outside supported range')
    root = Path(__file__).resolve().parents[2]
    packet = build(root, args.limit)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    write(args.out, packet)
    print(json.dumps(packet['summary'], indent=2))
    return 0 if packet['summary']['from_local_geography'] == args.limit else 1


if __name__ == '__main__':
    sys.exit(main())
