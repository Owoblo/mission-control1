"""Read-only reconciliation of website observations against existing Windsor inventory."""
import collections
from datetime import datetime, timezone
import html
import json
from pathlib import Path
import re
import sqlite3
from .windsor_physical_report import ROOT
from .windsor_address_investigation import comparison_address


def name_key(value):
    return ' '.join(re.findall(r'\w+', (value or '').casefold()))


def address_difference_hint(left, right):
    """Explain a review candidate without weakening identity matching."""
    a, b = comparison_address(left).split(), comparison_address(right).split()
    types = {'st', 'rd', 'ave', 'blvd', 'dr', 'drive', 'lane', 'ln', 'court', 'ct', 'crescent', 'cres'}
    if a == b:
        return 'address_text_agrees'
    if (len(a) == len(b)+1 and a[:-1] == b and a[-1] in types) or (len(b) == len(a)+1 and b[:-1] == a and b[-1] in types):
        return 'street_type_omitted_in_one_source; not a confirmed relocation'
    return 'different_address_text_requires_review; not a confirmed relocation'


def compare_observation(observation, inventory):
    name = name_key(observation['organization'])
    address = comparison_address(observation['address'])
    unit = observation.get('unit_or_floor')
    full = comparison_address(observation['address'] + (' ' + unit if unit else ''))
    candidates = []
    for item in inventory:
        same_name = name_key(item['trading_name']) == name
        # Base address associations do not confirm a unit or identity.
        item_address = comparison_address(item['address_raw'])
        same_full = item_address == full
        same_base = item_address == address
        if same_name or same_full or same_base:
            candidates.append({**item, 'same_normalized_name': same_name,
                               'same_full_address': same_full, 'same_base_address_text': same_base,
                               'address_difference_hint': address_difference_hint(observation['address'] + (' ' + unit if unit else ''), item['address_raw'])})
    if any(c['same_normalized_name'] and c['same_full_address'] for c in candidates):
        status = 'existing_name_and_address_agree'
    elif any(c['same_normalized_name'] for c in candidates):
        status = 'existing_name_address_differs_review'
    elif candidates:
        status = 'address_only_candidates_identity_unresolved'
    else:
        status = 'no_exact_candidate_not_proof_of_new_organization'
    return {'organization': observation['organization'], 'reported_address': observation['address'],
            'unit_or_floor': unit, 'source_url': observation['source_url'],
            'evidence_status': observation['status'], 'inventory_comparison_status': status,
            'candidates': candidates, 'net_new_verified_organization': None}


def run():
    database = ROOT / 'partnership-system/state/market-map.sqlite'
    output = ROOT / 'artifacts/windsor-address-investigation-20261029'
    db = sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        db.execute('BEGIN')
        geos = db.execute("SELECT id FROM geographies WHERE name='Windsor' AND province='ON'").fetchall()
        if len(geos) != 1:
            raise ValueError('Ambiguous Windsor geography')
        inventory = [dict(r) for r in db.execute('''SELECT l.id AS location_id,l.organisation_id,
            l.address_raw,o.trading_name FROM locations l JOIN organisations o ON o.id=l.organisation_id
            WHERE l.municipality_id=?''', (geos[0]['id'],))]
    finally:
        db.rollback()
        db.close()
    evidence = json.loads(Path(__file__).with_name('windsor_address_evidence.json').read_text())
    compared = [compare_observation(o, inventory) for o in evidence['observations']]
    counts = dict(collections.Counter(r['inventory_comparison_status'] for r in compared))
    summary = {'checked_at': datetime.now(timezone.utc).isoformat(), 'existing_windsor_locations': len(inventory),
               'website_observations_compared': len(compared), 'comparison_counts': counts,
               'net_new_verified_organizations': None, 'database_writes': 0,
               'limits': 'Exact names/addresses produce evidence candidates, not merges. Unmatched names can be aliases or existing branches. Shared addresses do not establish common identity. Existing municipality assignment defines this comparison scope.'}
    (output / 'existing-inventory-comparison.json').write_text(json.dumps({'summary': summary, 'observations': compared}, indent=2))
    # Explicitly preserve the temporal observation without overwriting location history.
    events = []
    for observation, result in zip(evidence['observations'], compared):
        if observation.get('announced_opening_date'):
            events.append({'event_type': 'reported_branch_relocation', 'organization': observation['organization'],
                           'event_date': observation['announced_opening_date'], 'detected_at': summary['checked_at'],
                           'new_reported_address': observation['address'],
                           'previous_inventory_candidates': [c for c in result['candidates'] if c['same_normalized_name']],
                           'source_url': observation['source_url'], 'publication_date': observation['publication_date'],
                           'evidence_status': observation['status'], 'access_note': observation.get('access_note'),
                           'current_buying_intent': 'unknown; event already occurred', 'outreach_eligible': False,
                           'action': 'Review organization/location identity and append dated history; do not overwrite old evidence'})
    (output / 'location-change-review.json').write_text(json.dumps(events, indent=2))
    labels = {'existing_name_and_address_agree': 'Already recorded; name and address agree',
              'existing_name_address_differs_review': 'Name already recorded; address needs review',
              'address_only_candidates_identity_unresolved': 'Same address found; organization identity needs review',
              'no_exact_candidate_not_proof_of_new_organization': 'No exact match; aliases/other sources still need checking'}
    cards = []
    for r in compared:
        entries = ''.join('<li>'+html.escape(c['trading_name'])+' — '+html.escape(c['address_raw'] or 'Unknown address')+'</li>' for c in r['candidates'])
        cards.append('<article><h3>'+html.escape(r['organization'])+'</h3><p>'+html.escape(labels[r['inventory_comparison_status']])+
                     '</p><p>Website address: '+html.escape(r['reported_address'])+' '+html.escape(r['unit_or_floor'] or '')+
                     '</p><ul>'+entries+'</ul><a href="'+html.escape(r['source_url'], quote=True)+'">Evidence source</a></article>')
    (output / 'inventory-review.html').write_text('''<!doctype html><meta charset="utf-8"><title>Windsor inventory comparison</title>
<style>body{max-width:1000px;margin:35px auto;padding:20px;background:#101b28;color:#edf5ff;font:16px system-ui}p,li{line-height:1.6}article{padding:18px;margin:16px 0;background:#20374d;border-radius:10px}a{color:#72dfcb}</style>
<h1>Windsor: what is new, and what needs correcting?</h1><p><a href="index.html">Address investigations and map</a></p>
<p>Compared website observations with '''+str(len(inventory))+''' existing Windsor location records. Nothing was merged, deleted or marked ready for outreach.</p>
<p>A matching address alone does not identify a company. No exact match does not prove a new organization.</p>'''+''.join(cards))
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    run()
