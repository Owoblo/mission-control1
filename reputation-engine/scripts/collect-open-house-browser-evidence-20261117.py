"""Normalize saved public-browser observations; never send or infer a sale."""
import collections
import csv
import html
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'partnership-system/state/november-revival-20261117/online-open-houses'
RECENT = {'today', 'yesterday', '2 days ago', '3 days ago', '4 days ago', '5 days ago', '6 days ago', 'last week'}


def normalized(value):
    import unicodedata
    return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower())


def main():
    scope = json.loads((OUT / 'city-scope.json').read_text())
    route_city = {row[key]: row['city'] for row in scope['targets'] for key in ('realtor_url', 'zillow_url')}
    observations = []
    pages = []
    for path in sorted(OUT.glob('*.json')):
        if not (path.name.startswith('web-') or path.name.startswith('realtor-') or path.name.startswith('zillow-')):
            continue
        saved = json.loads(path.read_text())
        for block in re.split(r'-{20,}\n?', saved['result']):
            source = re.search(r'Source: open\(\{"ref_id":"([^"]+)', block)
            if not source:
                continue
            url = source.group(1)
            reference = re.search(r'(turn\w+)', block)
            crawl = re.search(r'Crawled: ([^;]+)', block)
            ref, age = reference.group(1) if reference else None, crawl.group(1) if crawl else None
            content = re.sub(r'^L\d+: ?', '', block, flags=re.M)
            error = 'Internal Error' in block or 'not accessible via this tool' in block
            pages.append({'url': url, 'city': route_city.get(url), 'crawl_age': age, 'browser_reference': ref,
                          'state': 'unavailable' if error else 'readable_snapshot', 'evidence_file': path.name,
                          'inventory_complete': False})
            if error:
                continue
            # REALTOR cards carry explicit MLS and agent-photo labels. The photo labels
            # establish association only; they do not identify the open-house host.
            cards = list(re.finditer(r'【(\d+)†MLS\^?\{?[^:]*:\s*([A-Z]?\d+)\s+\$([\d,]+)\s+([^】]+)】', content))
            for i, match in enumerate(cards):
                tail = content[match.end():cards[i + 1].start() if i + 1 < len(cards) else len(content)]
                names = re.findall(r'Image: ([^†】]+?) photo', tail)
                before = content[max(0, match.start() - 170):match.start()]
                dates = re.findall(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b', before)
                date = dates[-1] if dates else None
                future = bool(date and date[0] == 'Nov' and 17 <= int(date[1]) <= 30)
                description = match.group(4)
                address = re.split(r'\s+\d+(?:\s*\+\s*\d+)?\s+Bedrooms|\s+Bedrooms|\s+Bathrooms', description)[0]
                brokerage = re.split(r'Square Feet\s*', description)[-1] if 'Square Feet' in description else None
                observations.append({'mls': match.group(2), 'address': address, 'city': route_city.get(url),
                    'price': match.group(3), 'associated_agents': list(dict.fromkeys(names)), 'brokerage': brokerage,
                    'event_month_day': ' '.join(date) if date else None, 'event_year': None,
                    'future_date_candidate': future, 'source_url': url, 'source': 'realtor', 'crawl_age': age,
                    'recent_source_candidate': age in RECENT, 'browser_reference': ref, 'listing_link_id': int(match.group(1)),
                    'evidence_file': path.name, 'observed_at': saved['at'], 'host_identity': 'not_verified',
                    'live_listing_verified': False, 'outreach_eligible': False})
            if 'zillow.com' not in url:
                continue
            entries = list(re.finditer(r'MLS® ID #([A-Z]?\d+),\s*([^\n]+)', content))
            for i, match in enumerate(entries):
                before = content[max(0, match.start() - 200):match.start()]
                addresses = re.findall(r'【(\d+)†([^】]+, ON [^】]+)】', before)
                after = content[match.end():entries[i + 1].start() if i + 1 < len(entries) else len(content)]
                event = re.search(r'Open: ([^\n]+)', after)
                if not addresses:
                    continue
                link, address = addresses[-1]
                observations.append({'mls': match.group(1), 'address': address, 'city': route_city.get(url),
                    'associated_agents': [], 'brokerage': match.group(2), 'event_month_day': event.group(1) if event else None,
                    'event_year': None, 'future_date_candidate': bool(event and re.search(r'\(11/(?:1[7-9]|2\d|30)\)', event.group(1))),
                    'source_url': url, 'source': 'zillow', 'crawl_age': age, 'recent_source_candidate': age in RECENT,
                    'browser_reference': ref, 'listing_link_id': int(link), 'evidence_file': path.name,
                    'observed_at': saved['at'], 'host_identity': 'not_verified', 'live_listing_verified': False,
                    'outreach_eligible': False})
    properties = {}
    for row in observations:
        prop = properties.setdefault(row['mls'], {'mls': row['mls'], 'observations': [], 'associated_agents': []})
        # A later browser window may contain the same card with more agent labels.
        key = (row['source_url'], row['event_month_day'], tuple(row['associated_agents']))
        if any((r['source_url'], r['event_month_day'], tuple(r['associated_agents'])) == key for r in prop['observations']):
            continue
        prop['observations'].append(row)
        prop['associated_agents'] = sorted(set(prop['associated_agents']) | set(row['associated_agents']))
    contacts = json.loads((OUT.parent / 'market_contacts.json').read_text())
    index = collections.defaultdict(list)
    for contact in contacts:
        index[normalized(contact['name'])].append(contact)
    candidates = []
    for prop in properties.values():
        recent = [r for r in prop['observations'] if r['recent_source_candidate'] and r['future_date_candidate']]
        prop['current_review_candidate'] = bool(recent)
        for row in recent:
            for name in row['associated_agents']:
                for c in index[normalized(name)]:
                    candidates.append({'contact_id': c['id'], 'name': c['name'], 'crm_city': c['city'], 'mls': prop['mls'],
                        'address': row['address'], 'event_month_day': row['event_month_day'], 'source_url': row['source_url'],
                        'source_reference': row['browser_reference'], 'listing_link_id': row['listing_link_id'],
                        'state': 'identity_and_current_full_thread_review_required', 'suppressed_in_saved_index': bool(c.get('do_not_contact') or c.get('cross_channel_suppressed_at')),
                        'phone': c['phone'], 'company': c['company'], 'source_agent_name': name, 'source_brokerage': row['brokerage']})
    unique_pages = {r['url']: r for r in pages}
    summary = {'at': '2026-11-17', 'city_targets': len(scope['targets']), 'source_pages_attempted': len(unique_pages),
        'readable_source_pages': sum(r['state'] == 'readable_snapshot' for r in unique_pages.values()),
        'unavailable_source_pages': sum(r['state'] == 'unavailable' for r in unique_pages.values()),
        'unique_mls_candidates': len(properties), 'recent_future_date_candidates': sum(r['current_review_candidate'] for r in properties.values()),
        'exact_name_candidate_contacts': len({r['contact_id'] for r in candidates}),
        'verified_current_listings': 0, 'messages_sent_by_this_sweep': 0,
        'complete_inventory': False, 'limits': ['Browser snapshots may be stale or truncated.', 'First-page observations do not exhaust publisher pagination.',
            'Candidate route URLs may be invalid for communities.', 'Index agent association does not verify hosting role or mobile ownership.',
            'Events need full-date and live listing verification before outreach.', 'CRM saved index is not a live suppression or recent-contact check.']}
    (OUT / 'inventory.json').write_text(json.dumps({'summary': summary, 'properties': list(properties.values()), 'pages': list(unique_pages.values())}, indent=2))
    (OUT / 'agent-crm-candidates.json').write_text(json.dumps(candidates, indent=2))
    with (OUT / 'agent-review.csv').open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(candidates[0]) if candidates else ['contact_id'])
        writer.writeheader()
        writer.writerows(candidates)
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
