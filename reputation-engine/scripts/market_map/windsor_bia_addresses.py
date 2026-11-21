"""Checkpointed factual address checks of existing Downtown Windsor BIA leads."""
import argparse
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser
from .windsor_physical_report import ROOT

BASE = 'https://www.downtownwindsor.ca'
OUT = ROOT / 'artifacts/windsor-downtown-addresses-20261029'
LEADS = ROOT / 'artifacts/city-category-source-14day-20261028/downtown-windsor-bia-consolidated.jsonl'


def clean(value):
    return ' '.join(html.unescape(re.sub('<[^>]*>', ' ', value)).split())


def parse(body):
    names = re.findall(r'<h1 class="sr-only">(.*?)</h1>', body, re.S)
    blocks = re.findall(r'<div class="location">(.*?)</div>', body, re.S)
    if len(names) != 1 or len(blocks) != 1:
        raise ValueError('Expected one listing title and location block')
    parts = [clean(x) for x in re.findall(r'<p[^>]*>(.*?)</p>', blocks[0], re.S)]
    if len(parts) != 2 or not parts[0] or not re.fullmatch(r'Windsor,\s*(?:ON|Ontario)(?:,?\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d)?', parts[1], re.I):
        raise ValueError('Missing address or unsupported municipality; retain for review')
    channels = []
    # Restrict extraction to the listing's contact panel, never footer/form fields.
    for block in re.findall(r'<div class="contact">(.*?)</div>', body, re.S):
        for href, label in re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, re.S):
            href, label = html.unescape(href).strip(), clean(label)
            kind = None
            if href.startswith('tel:'):
                kind, value = 'phone', href[4:].strip()
            elif href.startswith('mailto:'):
                kind, value = 'email', href[7:].split('?', 1)[0].strip()
            elif label.casefold() == 'website' and urlparse(href).scheme in ('http', 'https'):
                kind, value = 'website', href
            if kind and value:
                channel = {'type': kind, 'value': value, 'published_label': label,
                           'scope': 'Public listing contact; named person and decision-making authority unverified'}
                if channel not in channels:
                    channels.append(channel)
    return {'organization': clean(names[0]), 'address': parts[0], 'municipality_published': parts[1],
            'published_contact_channels': channels}


def run(limit, robots_file):
    OUT.mkdir(parents=True, exist_ok=True)
    robots = robots_file.read_text()
    (OUT / 'robots.txt').write_text(robots)
    policy = RobotFileParser(); policy.parse(robots.splitlines())
    delay = max(10, policy.crawl_delay('*') or 0)
    leads = [json.loads(x) for x in LEADS.read_text().splitlines()]
    receipts_path = OUT / 'receipts.json'
    receipts = json.loads(receipts_path.read_text()) if receipts_path.exists() else {}
    attempted = 0
    for lead in leads:
        url = lead['listing_url']
        previous = receipts.get(url)
        if (previous and previous.get('curl_exit') == 0) or attempted >= limit:
            continue
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.netloc != 'www.downtownwindsor.ca' or not parsed.path.startswith('/places/'):
            receipts[url] = {'source_url': url, 'http_status': 'not_requested', 'curl_exit': 0,
                             'review_reason': 'Source roster includes a non-listing URL; excluded without fetching'}
            receipts_path.write_text(json.dumps(receipts, indent=2))
            continue
        if not policy.can_fetch('*', url):
            raise ValueError('Listing disallowed by saved robots policy')
        time.sleep(delay)
        target = OUT / (hashlib.sha256(url.encode()).hexdigest()[:20] + '.html')
        result = subprocess.run(['curl', '-sS', '--max-time', '30', '--max-filesize', '3000000',
                                 '-w', '%{http_code}', '-o', str(target), url], capture_output=True, text=True)
        receipt = {'source_url': url, 'checked_at': datetime.now(timezone.utc).isoformat(),
                   'http_status': result.stdout, 'curl_exit': result.returncode,
                   'raw_evidence_reference': str(target.relative_to(ROOT))}
        if previous:
            receipt['previous_attempts'] = previous.get('previous_attempts', []) + [
                {k: previous[k] for k in ('checked_at', 'http_status', 'curl_exit')}]
        if result.returncode == 0 and result.stdout == '200':
            receipt['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
            try:
                receipt['observation'] = {**parse(target.read_text()), 'source_url': url,
                    'unit_or_floor': None, 'checked_on': receipt['checked_at'][:10],
                    'relationship': 'BIA-listed business/facility at published address; operator and current occupancy unverified',
                    'status': 'bia_directory_address_supported', 'categories': lead['categories'],
                    'raw_evidence_reference': receipt['raw_evidence_reference']}
            except ValueError as error:
                receipt['review_reason'] = str(error)
        else:
            receipt['review_reason'] = 'HTTP/network failure; not a successful empty result'
        receipts[url] = receipt
        receipts_path.write_text(json.dumps(receipts, indent=2))
        attempted += 1
        print(f'{attempted}: {url} — '+('address saved' if 'observation' in receipt else receipt['review_reason']), flush=True)
        if result.stdout in ('403', '429') or result.returncode:
            break
    # Reparse saved successes after parser fixes without repeating source requests.
    categories = {lead['listing_url']: lead['categories'] for lead in leads}
    for url, receipt in receipts.items():
        if receipt.get('http_status') != '200':
            continue
        raw = ROOT / receipt['raw_evidence_reference']
        if hashlib.sha256(raw.read_bytes()).hexdigest() != receipt['sha256']:
            raise ValueError('Saved source bytes changed')
        try:
            receipt['observation'] = {**parse(raw.read_text()), 'source_url': url,
                'unit_or_floor': None, 'checked_on': receipt['checked_at'][:10],
                'relationship': 'BIA-listed business/facility at published address; operator and current occupancy unverified',
                'status': 'bia_directory_address_supported', 'categories': categories[url],
                'raw_evidence_reference': receipt['raw_evidence_reference']}
            receipt.pop('review_reason', None)
        except ValueError as error:
            receipt.pop('observation', None)
            receipt['review_reason'] = str(error)
    receipts_path.write_text(json.dumps(receipts, indent=2))
    observations = [r['observation'] for r in receipts.values() if 'observation' in r]
    path = Path(__file__).with_name('windsor_address_evidence.json')
    evidence = json.loads(path.read_text())
    evidence['observations'] = [o for o in evidence['observations'] if not o['source_url'].startswith(BASE + '/places/')] + observations
    path.write_text(json.dumps(evidence, indent=2) + '\n')
    summary = {'source_leads': len(leads), 'checked_listings': len(receipts), 'address_observations': len(observations),
               'held_for_review': len(receipts)-len(observations), 'remaining_unchecked': len(leads)-len(receipts),
               'crawl_delay_seconds': delay, 'database_writes': 0,
               'licence': 'No bulk reuse licence established; internal factual address research only; raw HTML not publicly republished.',
               'limits': 'BIA listing is address evidence, not operator verification, a new-company claim or complete tenant inventory.'}
    summary['observations_with_published_contact_channels'] = sum(bool(o.get('published_contact_channels')) for o in observations)
    summary['published_contact_channel_observations'] = sum(len(o.get('published_contact_channels', [])) for o in observations)
    summary['distinct_exact_type_value_contact_channels'] = len({(c['type'], c['value']) for o in observations for c in o.get('published_contact_channels', [])})
    (OUT / 'summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--limit', type=int, default=20)
    p.add_argument('--robots-file', type=Path, required=True)
    p.add_argument('--reconcile-only', action='store_true', help='Reparse saved receipts; make no network requests')
    args = p.parse_args()
    if not 1 <= args.limit <= 50:
        p.error('Batch limit must be between 1 and 50')
    run(0 if args.reconcile_only else args.limit, args.robots_file)
