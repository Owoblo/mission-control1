"""Read-only address research reuse manifest; never merges or completes buildings.

Read the queue in SQLite read-only mode and group pending footprint IDs by exact
normalized candidate-address sets. Only one unambiguous numbered address is a
safe research-sharing candidate. Even those groups do not establish co-tenancy.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import unicodedata

DEFAULT = Path('artifacts/windsor-building-ledger-20261029')


def normalize_address(value):
    """Conservative: preserve unit, suffix, direction, punctuation and number."""
    if not isinstance(value, str):
        raise ValueError('Address candidates must be strings')
    return ' '.join(unicodedata.normalize('NFKC', value).upper().split())


def classify(row, addresses):
    if row.get('review_events') or row.get('review_stages') or row.get('investigation_status') not in (None, '', 'not_individually_reviewed'):
        return 'pending_but_previously_reviewed'
    if not addresses:
        return 'missing_address'
    if len(addresses) != 1 or row.get('address_matching_status') == 'address_conflict':
        return 'ambiguous_address_set'
    address = addresses[0]
    # Ranges, unit-prefix notations and PO boxes are not safe civic anchors.
    if re.match(r'^\d+\s*[-/]\s*\d+', address) or address.startswith(('PO BOX', 'P.O. BOX', 'UNIT ', 'SUITE ', '#')):
        return 'ambiguous_address_set'
    if not re.match(r'^\d+[A-Z]?\s+\S', address):
        return 'street_only_or_no_civic_number'
    return 'single_numbered_address_candidate'


def build_manifest(ledger_rows, queue_rows, generated_at=None):
    ledger = {}
    for row in ledger_rows:
        bid = row['building_id']
        if bid in ledger:
            raise ValueError('Duplicate ledger building ID: '+bid)
        ledger[bid] = row
    groups = {}
    excluded = {}
    seen = set()
    mismatch_ids = []
    for item in queue_rows:
        bid = item['building_id']
        if bid in seen:
            raise ValueError('Duplicate queue building ID: '+bid)
        seen.add(bid)
        if item['state'] != 'pending':
            excluded.setdefault(item['state'], []).append(bid)
            continue
        snap = item['snapshot']
        if isinstance(snap, str):
            snap = json.loads(snap)
        if snap.get('building_id') != bid:
            raise ValueError('Queue snapshot ID mismatch: '+bid)
        row = ledger.get(bid, snap)
        values = row.get('candidate_addresses', [])
        if not isinstance(values, list):
            raise ValueError('candidate_addresses must be a list')
        addresses = tuple(sorted(set(filter(None, (normalize_address(a) for a in values)))))
        prior = tuple(sorted(set(filter(None, (normalize_address(a) for a in snap.get('candidate_addresses', []))))))
        if addresses != prior:
            mismatch_ids.append(bid)
        bucket = classify(row, addresses)
        # Missing addresses offer no shared query; keep them separate.
        key = (bucket, addresses, bid if not addresses else '')
        group = groups.setdefault(key, {'category': bucket, 'normalized_candidate_addresses': list(addresses),
            'building_ids': [], 'members': [], 'original_zoning_building_count': 0,
            'reusable_address_query_candidate': bucket == 'single_numbered_address_candidate'})
        group['building_ids'].append(bid)
        group['original_zoning_building_count'] += int(bool(row.get('original_zoning_scope')))
        group['members'].append({'building_id': bid, 'candidate_addresses_original': values,
            'address_matching_status': row.get('address_matching_status'),
            'ledger_present': bid in ledger, 'queue_attempts': item.get('attempts'),
            'available_at': item.get('available_at'), 'reported_place_names': [p.get('name') for p in row.get('reported_places', [])]})
    results = []
    for key, group in groups.items():
        group['group_id'] = 'address-group:'+hashlib.sha256(json.dumps(key).encode()).hexdigest()[:24]
        group['building_ids'].sort()
        group['members'].sort(key=lambda r: r['building_id'])
        group['building_count'] = len(group['building_ids'])
        group['identity_merge_permitted'] = False
        group['review_status_changed'] = False
        results.append(group)
    results.sort(key=lambda g: (not g['reusable_address_query_candidate'], -g['building_count'], g['group_id']))
    category_groups = Counter(g['category'] for g in results)
    category_buildings = Counter()
    for g in results:
        category_buildings[g['category']] += g['building_count']
    safe = [g for g in results if g['reusable_address_query_candidate']]
    shared = [g for g in safe if g['building_count'] > 1]
    summary = {'queue_rows': len(seen), 'pending_buildings': sum(category_buildings.values()),
        'groups': len(results), 'groups_by_category': dict(category_groups), 'buildings_by_category': dict(category_buildings),
        'excluded_by_queue_state': {k: len(v) for k,v in sorted(excluded.items())},
        'safe_shared_address_groups': len(shared), 'buildings_in_safe_shared_groups': sum(g['building_count'] for g in shared),
        'potential_repeated_address_queries_avoided': sum(g['building_count']-1 for g in shared),
        'queue_ledger_address_mismatch_count': len(mismatch_ids),
        'largest_safe_groups': [{k:g[k] for k in ('group_id','normalized_candidate_addresses','building_count','building_ids')} for g in safe[:20]],
        'largest_ambiguous_groups': [{k:g[k] for k in ('group_id','category','normalized_candidate_addresses','building_count','building_ids')} for g in sorted((g for g in results if not g['reusable_address_query_candidate']), key=lambda g:-g['building_count'])[:20]]}
    return {'schema_version': 1, 'generated_at': generated_at or datetime.now(timezone.utc).isoformat(),
        'scope': 'Pending queue snapshots only; research reuse candidates, not identity merges or verified occupancy. Read-only snapshot may age while workers run.',
        'normalization': 'Unicode NFKC, uppercase, whitespace collapse, exact set equality; no suffix expansion, geocoding or fuzzy merge.',
        'summary': summary, 'groups': results, 'excluded_building_ids_by_queue_state': {k:sorted(v) for k,v in excluded.items()},
        'queue_ledger_address_mismatch_ids': sorted(mismatch_ids), 'ledger_ids_not_in_queue': sorted(set(ledger)-seen),
        'queue_mutations': 0, 'outreach_activated': False}


def generate(ledger_path, queue_path, output_path, summary_path=None):
    raw = Path(ledger_path).read_bytes()
    ledger = [json.loads(line) for line in raw.splitlines() if line.strip()]
    uri = Path(queue_path).resolve().as_uri()+'?mode=ro'
    db = sqlite3.connect(uri, uri=True)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        items = [dict(r) for r in db.execute('SELECT building_id,state,snapshot,attempts,available_at FROM building_items ORDER BY building_id')]
        db.rollback()
    finally:
        db.close()
    manifest = build_manifest(ledger, items)
    manifest['inputs'] = {'ledger':str(ledger_path),'ledger_sha256':hashlib.sha256(raw).hexdigest(),'queue':str(queue_path),
        'queue_read_mode':'read-only SQLite transaction; no claims/updates performed'}
    output_path = Path(output_path)
    if output_path.resolve() in (Path(ledger_path).resolve(), Path(queue_path).resolve()):
        raise ValueError('Output must not overwrite input')
    summary_path = Path(summary_path) if summary_path else output_path.with_name(output_path.stem+'-summary.json')
    if summary_path.resolve() in (Path(ledger_path).resolve(), Path(queue_path).resolve(),output_path.resolve()):
        raise ValueError('Summary must be a separate output')
    output_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(manifest, indent=2)+'\n')
    summary_path.write_text(json.dumps(manifest['summary'], indent=2)+'\n')
    return manifest['summary']


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--ledger',type=Path,default=DEFAULT/'buildings.jsonl')
    p.add_argument('--queue',type=Path,default=DEFAULT/'research-queue.sqlite3')
    p.add_argument('--output',type=Path,default=DEFAULT/'address-work-groups.json')
    p.add_argument('--summary',type=Path)
    a = p.parse_args()
    print(json.dumps(generate(a.ledger,a.queue,a.output,a.summary),indent=2))


if __name__ == '__main__':
    main()
