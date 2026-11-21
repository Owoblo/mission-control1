"""Group address investigations without merging occupants or dropping suite text."""
import collections
import csv
import hashlib
import html
import json
import re
from pathlib import Path
from .windsor_physical_report import ROOT, PLACES
from .windsor_address_pilot import address_key


def comparison_address(value):
    """Candidate comparison only; preserve units, numbers and directionals."""
    aliases = {'street': 'st', 'avenue': 'ave', 'road': 'rd', 'boulevard': 'blvd',
               'east': 'e', 'west': 'w', 'north': 'n', 'south': 's'}
    return ' '.join(aliases.get(t, t) for t in address_key(value).replace('.', '').split())


def reconcile_evidence(evidence, rows, places):
    # Build once per run, rather than scan every footprint for every observation.
    place_addresses = collections.defaultdict(set)
    for gid, p in places.items():
        if p.get('address'):
            place_addresses[comparison_address(p['address'])].add(gid)
    building_addresses = collections.defaultdict(set)
    building_places = collections.defaultdict(set)
    by_id = {r['building_id']: r for r in rows}
    order = {r['building_id']: i for i, r in enumerate(rows)}
    for r in rows:
        for address in r['parcel_address_candidates']:
            building_addresses[comparison_address(address)].add(r['building_id'])
        for gid in r['covering_place_ids']:
            building_places[gid].add(r['building_id'])
    results = []
    for observation in evidence['observations']:
        key = comparison_address(observation['address'])
        gids = place_addresses[key]
        bids = set(building_addresses[key]) | (set(observation.get('source_building_candidates', [])) & by_id.keys())
        for gid in gids:
            bids.update(building_places[gid])
        buildings = [by_id[bid] for bid in sorted(bids, key=order.get)]
        results.append({**observation, 'candidate_existing_place_ids': sorted(gids),
                        'candidate_building_ids': [r['building_id'] for r in buildings],
                        'outside_original_filter_feature_count': sum(not r['business_zone_research_candidate'] for r in buildings),
                        'matching_scope': 'Address and separately retained source-point candidates; no automatic organization merge or exact footprint confirmation',
                        'incremental_verified_organization': None})
    return results


def group_addresses(rows, places):
    groups = {}
    for row in rows:
        if not (row['business_zone_research_candidate'] or row['covering_place_ids']):
            continue
        # Parcel candidate and place-reported addresses retain different roles.
        observations = [(a, 'parcel_candidate', None) for a in row['parcel_address_candidates']]
        observations += [(places[g]['address'], 'reported_place_address', g)
                         for g in row['covering_place_ids'] if places[g].get('address')]
        for address, role, gid in observations:
            key = address_key(address)
            entry = groups.setdefault(key, {'address_id': hashlib.sha256(key.encode()).hexdigest()[:20],
                                           'address': address, 'building_ids': set(), 'roles': set(),
                                           'reported_place_ids': set(), 'needs_address_review': False})
            entry['building_ids'].add(row['building_id'])
            entry['roles'].add(role)
            if gid:
                entry['reported_place_ids'].add(gid)
            entry['needs_address_review'] |= row['status'] == 'address_conflict'
    return [{**v, **{k: sorted(v[k]) for k in ('building_ids', 'roles', 'reported_place_ids')}}
            for _, v in sorted(groups.items())]


def include_evidence_addresses(groups, evidence):
    """Keep source-supported addresses in the queue even without a footprint match."""
    indexed = {address_key(g['address']): dict(g) for g in groups}
    for observation in evidence:
        address = observation['address']
        if observation.get('unit_or_floor'):
            address += ' · ' + observation['unit_or_floor']
        key = address_key(address)
        g = indexed.setdefault(key, {
            'address_id': hashlib.sha256(key.encode()).hexdigest()[:20],
            'address': address, 'building_ids': [], 'roles': [],
            'reported_place_ids': [], 'needs_address_review': False})
        g['building_ids'] = sorted(set(g['building_ids']) | set(observation['candidate_building_ids']))
        g['roles'] = sorted(set(g['roles']) | {'website_address_evidence'})
        g['needs_address_review'] |= not bool(observation['candidate_building_ids'])
    return [indexed[k] for k in sorted(indexed)]


def build():
    source = ROOT / 'artifacts/windsor-address-pilot-20261029'
    output = ROOT / 'artifacts/windsor-address-investigation-20261029'
    output.mkdir(parents=True, exist_ok=True)
    rows = [json.loads(line) for line in (source / 'building-address-candidates.jsonl').read_text().splitlines()]
    places = {p['gers']: p for p in map(json.loads, PLACES.read_text().splitlines())}
    groups = group_addresses(rows, places)
    extra = [r for r in rows if not r['business_zone_research_candidate'] and r['covering_place_ids']]
    summary = {'original_zone_features': sum(r['business_zone_research_candidate'] for r in rows),
               'additional_features_with_reported_places': len(extra),
               'research_features_total': sum(bool(r['business_zone_research_candidate'] or r['covering_place_ids']) for r in rows),
               'distinct_address_strings_to_investigate': len(groups),
               'method': 'Group exact case/whitespace-normalized addresses; units and directions remain distinct. Different spelling variants are NOT automatically merged.',
               'limits': 'Additional places can include home businesses or inaccurate records; neither inclusion nor zoning proves non-residential use. This is not complete coverage.',
               'database_writes': 0, 'automatic_outreach': False}
    evidence = json.loads(Path(__file__).with_name('windsor_address_evidence.json').read_text())
    reconciled = reconcile_evidence(evidence, rows, places)
    groups = include_evidence_addresses(groups, reconciled)
    summary['distinct_address_strings_to_investigate'] = len(groups)
    website_buildings = {bid for o in reconciled for bid in o['candidate_building_ids']}
    summary['additional_features_from_website_address_checks'] = sum(
        r['building_id'] in website_buildings and not (r['business_zone_research_candidate'] or r['covering_place_ids'])
        for r in rows)
    summary['expanded_map_research_features'] = summary['research_features_total'] + summary['additional_features_from_website_address_checks']
    summary['website_observations'] = len(reconciled)
    summary['website_addresses_reviewed'] = len({o['address'] for o in reconciled})
    summary['website_observations_with_candidate_buildings'] = sum(bool(o['candidate_building_ids']) for o in reconciled)
    (output / 'website-evidence-reconciliation.json').write_text(json.dumps(reconciled, indent=2))
    (output / 'official-website-observations.json').write_text(json.dumps(evidence, indent=2))
    (output / 'summary.json').write_text(json.dumps(summary, indent=2))
    with (output / 'address-investigations.jsonl').open('w') as f:
        for g in groups:
            f.write(json.dumps(g) + '\n')
    with (output / 'address-investigations.csv').open('w') as f:
        writer = csv.DictWriter(f, fieldnames=list(groups[0]))
        writer.writeheader()
        for g in groups:
            writer.writerow({k: json.dumps(v) if isinstance(v, list) else v for k, v in g.items()})
    with (output / 'outside-zone-review.jsonl').open('w') as f:
        for r in extra:
            f.write(json.dumps({'building_id': r['building_id'], 'addresses': r['parcel_address_candidates'],
                               'reported_places': [{'id': g, 'name': places[g]['name'], 'address': places[g]['address']}
                                                   for g in r['covering_place_ids']],
                               'status': 'review_non_residential_relevance'}) + '\n')
    cards = []
    for o in reconciled:
        cards.append('<article><h3>'+html.escape(o['organization'])+'</h3><p>'+html.escape(o['address'])+
                     ' · '+html.escape(o['unit_or_floor'] or 'Floor not supplied')+'</p><p>'+html.escape(o['relationship'])+
                     '</p><p>Candidate building outlines: '+str(len(o['candidate_building_ids']))+
                     ' · Existing place records with matching address: '+str(len(o['candidate_existing_place_ids']))+
                     '</p><a href="'+html.escape(o['source_url'], quote=True)+'">Source evidence</a></article>')
    batch_note = ''
    batch_path = ROOT / 'artifacts/windsor-downtown-addresses-20261029/summary.json'
    if batch_path.exists():
        batch = json.loads(batch_path.read_text())
        batch_note = '<p>Downtown BIA address batch: '+str(batch['address_observations'])+' address observations saved; '+str(batch['held_for_review'])+' source rows held/excluded; '+str(batch['remaining_unchecked'])+' source rows still unchecked. This is a checkpoint, not a complete downtown inventory.</p>'
    (output / 'index.html').write_text('''<!doctype html><meta charset="utf-8"><title>Windsor address investigations</title>
<style>body{max-width:1000px;margin:40px auto;background:#101b28;color:#edf5ff;font:17px system-ui;padding:20px}p{line-height:1.6}a{color:#72dfcb}article{padding:20px;background:#20374d;margin:15px 0;border-radius:10px}</style>
<h1>Windsor: finding who operates at each address</h1><p>Research addresses once, retain all candidate buildings and keep different floors, suites and businesses separate.</p>
<p><a href="../windsor-address-pilot-20261029/map.html">Open the expanded building map</a> · <a href="address-investigations.csv">Address research list</a> · <a href="inventory-review.html">Compare with existing records</a> · <a href="../windsor-operator-groups-20261029/index.html">Groups and their venues</a> · <a href="../windsor-property-evidence-20261029/index.html">Properties and contact scope</a> · <a href="progress.html">Coverage and remaining work</a></p>
<p>'''+str(summary['expanded_map_research_features'])+' building features in the expanded research view, including '+str(len(extra))+
        ' added through reported places and '+str(summary['additional_features_from_website_address_checks'])+' more through source address checks. These are candidates, not confirmed non-residential buildings.</p><p>'+str(len(groups))+
        ' distinct address strings queued. Spelling variants and unit addresses may describe the same property; this is not a count of unique properties.</p><h2>Source checks: '+str(summary['website_addresses_reviewed'])+' addresses, '+str(len(reconciled))+' organization/facility observations</h2>'+''.join(cards)+
        batch_note+'<p>Checked 2026-10-29. Publisher listings support the addresses; they do not establish a complete tenant list, the exact footprint occupied, or separate legal-company identities. Nothing has been added to outreach.</p>')
    # Refresh presentation without rerunning or changing spatial associations.
    old = (source / 'map.html').read_text()
    data = json.loads(old.split('const D=', 1)[1].split(';\nconst styles=', 1)[0])
    data['websiteEvidence'] = reconciled
    evidence_by_building = collections.defaultdict(list)
    for i, observation in enumerate(reconciled):
        for bid in observation['candidate_building_ids']:
            evidence_by_building[bid].append(i)
    for b in data['buildings']:
        b[11:] = [evidence_by_building[b[0]]]
    template = Path(__file__).with_name('windsor_address_template.html').read_text()
    (source / 'map.html').write_text(template.replace('__DATA__', json.dumps(data).replace('</', '<\\/')))
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    build()
