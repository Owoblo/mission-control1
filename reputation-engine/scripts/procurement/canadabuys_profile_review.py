"""Fetch public CanadaBuys partner profiles for human procurement research.

Input is the immutable interested-businesses.jsonl from canadabuys_partner_intake.
Output is research only and does not write the CRM or enqueue outreach.
"""

import argparse
import hashlib
import html
import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path


def clean(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value or ""))).strip()


def field(page, name):
    match = re.search(rf'field--name-field-supplier-{re.escape(name)}\b(.*?)(?=field--name-field-supplier-|</div>\s*</div>\s*</div>|$)', page, re.S)
    if not match:
        return None
    item = re.search(r'class="field--item[^\"]*"[^>]*>(.*?)</(?:span|div)>', match.group(1), re.S)
    return clean(item.group(1)) if item else None


def fetch(row, html_dir=None):
    url = row['profile_url']
    try:
        saved = html_dir / f"profile-{url.rsplit('/', 1)[-1]}.html" if html_dir else None
        if saved and saved.exists():
            page = saved.read_text(errors='replace')
        else:
            result = subprocess.run(['curl', '-L', '--fail', '--max-time', '20', '-sS', url], capture_output=True, timeout=25, check=True)
            page = result.stdout[:1_000_000].decode('utf-8', 'replace')
    except Exception as exc:
        return {'id': row['id'], 'profile_url': url, 'retrieval_status': 'failed', 'error_type': type(exc).__name__, 'campaign_ready': False}
    website = re.search(r'<span class="sr-only">Company website</span>\s*<a href="([^"]+)', page)
    email = re.search(r'href="mailto:([^"?]+)', page)
    phone = re.search(r'href="tel:([^"]+)', page)
    title = re.search(r'<p>\s*([^<]+)\s*</p>\s*<p class="mt-n10">', page)
    description = re.search(r'<p class="mt-n10">(.*?)</p>', page, re.S)
    return {
        'id': row['id'], 'organisation_name': row['organisation_name'], 'profile_url': url,
        'retrieval_status': 'ok', 'observed_at': datetime.now(timezone.utc).isoformat(),
        'profile_sha256': hashlib.sha256(page.encode('utf-8')).hexdigest(),
        'website': html.unescape(website.group(1)) if website else None,
        'public_contact_first_name': field(page, 'first-name'),
        'public_contact_last_name': field(page, 'last-name'),
        'public_contact_title': field(page, 'title'),
        'public_contact_email': html.unescape(email.group(1)) if email else None,
        'public_contact_phone': html.unescape(phone.group(1)) if phone else None,
        'self_reported_service_title': clean(title.group(1)) if title else None,
        'self_reported_description': clean(description.group(1)) if description else None,
        'evidence_type': 'public_partner_profile_self_reported',
        'bidder_status': 'unknown', 'award_status': 'unknown',
        'supply_arrangement_qualification': 'unknown', 'campaign_ready': False,
        'next_action': 'independent_website_and_crm_history_review',
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--html-dir', type=Path)
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.input.read_text().splitlines() if line.strip()]
    with ThreadPoolExecutor(max_workers=4) as pool:
        profiles = list(pool.map(lambda row: fetch(row, args.html_dir), rows))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in profiles))
    print(json.dumps({'profiles': len(profiles), 'retrieved': sum(p['retrieval_status'] == 'ok' for p in profiles), 'campaign_ready': 0}))


if __name__ == '__main__':
    main()
