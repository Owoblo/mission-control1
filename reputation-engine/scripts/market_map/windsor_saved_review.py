"""Import already-saved research from the authenticated cloud report; no model calls."""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import urllib.request

class SavedResearchParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_pre = False; self.parts = []; self.results = []
    def handle_starttag(self, tag, attrs):
        if tag == 'pre': self.in_pre = True; self.parts = []
    def handle_data(self, value):
        if self.in_pre: self.parts.append(value)
    def handle_endtag(self, tag):
        if tag == 'pre' and self.in_pre:
            self.in_pre = False
            value = json.loads(''.join(self.parts))
            if value: self.results.append(value)

def review_cohort(entities, limit=50):
    """Unique site/organization hypotheses, spread across districts for review."""
    from collections import defaultdict
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 500:
        raise ValueError('Review limit must be 1-500')
    groups = defaultdict(list); seen = set()
    for row in entities:
        if row.get('temporal_status') != 'reported_current': continue
        if not all(row.get(k) for k in ['site_id', 'name', 'address', 'source_url', 'quote', 'body_sha256']): continue
        key = (row['site_id'], ' '.join(row['name'].casefold().split()), row.get('unit') or '')
        if key in seen: continue
        seen.add(key)
        groups[row.get('district') or 'unknown'].append({**row, 'review_state': 'source_and_identity_verification',
            'channel_state': 'requires_current_route_and_CRM_checks', 'size_band': 'unknown',
            'source_priority': 'reuse_saved_evidence_before_paid_research', 'outreach_eligible': False})
    for rows in groups.values(): rows.sort(key=lambda r: (r['name'].casefold(), r['site_id']))
    selected=[]; districts=sorted(groups)
    while len(selected)<limit and any(groups.values()):
        for district in districts:
            if groups[district] and len(selected)<limit: selected.append(groups[district].pop(0))
    return selected

def collect(output, password_path, fetcher=None):
    output = Path(output); output.mkdir(parents=True, exist_ok=True)
    import base64
    password = Path(password_path).read_text().strip()
    headers = {'Authorization': 'Basic ' + base64.b64encode(('john:' + password).encode()).decode()}
    def get(path):
        request = urllib.request.Request('https://windsor-research-production.up.railway.app' + path, headers=headers)
        with urllib.request.urlopen(request, timeout=40) as response:
            return response.read()
    get = fetcher or get
    before = json.loads(get('/status'))
    body = get('/')
    parser = SavedResearchParser(); parser.feed(body.decode('utf-8')); parser.close()
    results = parser.results
    ids = [r.get('site_id') for r in results]
    if not ids or any(not i for i in ids) or len(set(ids)) != len(ids):
        raise ValueError('Saved site identities missing or duplicated')
    expected = before.get('queue', {}).get('saved_investigations')
    if len(results) != expected:
        raise ValueError('Cloud report count differs from worker snapshot; retry without importing a partial cohort')
    claims = [claim for row in results for claim in row.get('claims', [])]
    entities = []
    for row in results:
        for claim in row.get('claims', []):
            name = claim.get('organization') or claim.get('organization_name')
            if not name: continue
            entities.append({'site_id': row['site_id'], 'district': row.get('district'), 'name': name,
                             'address': claim.get('address'), 'unit': claim.get('unit'),
                             'source_url': claim.get('source_url'), 'source_observed_at': claim.get('retrieved_at'),
                             'quote': claim.get('exact_quote'), 'body_sha256': claim.get('body_sha256'),
                             'semantic_status': claim.get('semantic_status'), 'temporal_status': claim.get('temporal_status'),
                             'occupancy_verified': claim.get('occupancy_verified', False),
                             'next_action': 'Verify current organization/site and match existing CRM history before contact research or outreach',
                             'outreach_eligible': False})
    with gzip.open(output / 'saved-investigations.jsonl.gz', 'wt') as handle:
        for row in results: handle.write(json.dumps(row) + '\n')
    with gzip.open(output / 'organization-assertions.jsonl.gz', 'wt') as handle:
        for row in entities: handle.write(json.dumps(row) + '\n')
    summary = {'at': datetime.now(timezone.utc).isoformat(), 'source': 'authenticated existing cloud report',
               'report_sha256': hashlib.sha256(body).hexdigest(), 'site_investigations': len(results),
               'site_tasks': before['queue']['site_tasks'], 'organization_assertions': len(entities),
               'districts': dict(Counter(r.get('district') or 'unknown' for r in results)),
               'semantic_status': dict(Counter(c.get('semantic_status') or 'unknown' for c in claims)),
               'temporal_status': dict(Counter(c.get('temporal_status') or 'unknown' for c in claims)),
               'verified_occupancy_assertions': sum(c.get('occupancy_verified') is True for c in claims),
               'sites_with_no_organization_assertion': sum(not r.get('claims') for r in results),
               'paid_model_calls': 0, 'messages_sent': 0, 'production_writes': 0,
               'limitation': 'Saved site investigations and source assertions are not verified unique businesses or approved contacts.'}
    (output / 'summary.json').write_text(json.dumps(summary, indent=2))
    cohort = review_cohort(entities)
    (output / 'first-review-cohort.json').write_text(json.dumps({'at': summary['at'], 'site_investigations': len(results),
        'selected_assertions': len(cohort), 'districts': sorted({r['district'] for r in cohort}),
        'automatic_send': False, 'paid_calls': 0, 'rows': cohort}, indent=2))
    print(json.dumps(summary, indent=2))
    return summary

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='partnership-system/state/windsor-activation-20261118')
    parser.add_argument('--password-path', default='.runtime/railway-research/dashboard-password')
    args = parser.parse_args()
    collect(args.output, args.password_path)
