"""Read-only, evidence-preserving Windsor building/address research pilot."""
import argparse
import collections
import csv
import hashlib
import json
import re
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import unary_union
from .windsor_physical_report import ROOT, BOUNDARY, PLACES, read_layer, esri_shape


def address_key(value):
    # Deliberately conservative: retain directions, units and all street tokens.
    return re.sub(r'\s+', ' ', str(value or '').strip()).casefold()


def classify(addresses, places):
    keys = {address_key(a) for a in addresses if address_key(a)}
    if len(keys) > 1:
        return 'address_conflict'
    if places:
        return 'reported_place'
    return 'address_candidate' if keys else 'address_unresolved'


def relevant_zone(code):
    return bool(re.search(r'\b(?:CD|MD|ID)\s*\d', code or ''))


def build(output):
    output.mkdir(parents=True, exist_ok=True)
    base = ROOT / 'artifacts/windsor-physical-map-20261028-reviewed'
    parcels_path = base / 'parcel-building-candidates.jsonl'
    links_path = base / 'place-physical-candidates.jsonl'
    parcels = [json.loads(x) for x in parcels_path.read_text().splitlines()]
    places = {r['gers']: r for r in map(json.loads, PLACES.read_text().splitlines())}
    by_building = collections.defaultdict(list)
    for parcel in parcels:
        for bid in parcel['building_candidates']:
            by_building[bid].append(parcel)
    direct_places = collections.defaultdict(list)
    parcel_places = collections.defaultdict(list)
    for link in map(json.loads, links_path.read_text().splitlines()):
        if link['gers'] not in places:
            raise ValueError('Place evidence missing')
        for bid in link['building_candidates']:
            direct_places[bid].append(link['gers'])
        for pid in link['parcel_candidates']:
            parcel_places[pid].append(link['gers'])
    boundary = unary_union([shape(f['geometry']) for f in json.loads(BOUNDARY.read_text())['features']
                            if f['properties']['MUNID'] == '37039'])
    raw, manifest = read_layer(ROOT / 'artifacts/windsor-physical-20261028/buildings')
    rows = []
    display = []
    counts = collections.Counter()
    focused = collections.Counter()
    for source in raw:
        try:
            geom = esri_shape(source.get('geometry'))
        except (ValueError, TypeError):
            continue
        if not boundary.intersects(geom):
            continue
        attrs = source['attributes']
        bid = 'buildings:' + str(attrs.get('GlobalID') or attrs.get('building_id') or attrs['OBJECTID'])
        candidates = by_building[bid]
        addresses = sorted({p['source_primary_address'] for p in candidates if p['source_primary_address']})
        zones = sorted({p['source_zoning'] for p in candidates})
        pids = direct_places[bid]
        related = sorted({gid for p in candidates for gid in parcel_places[p['parcel_id']]} - set(pids))
        status = classify(addresses, pids)
        focus = any(relevant_zone(z) for z in zones)
        point = geom.representative_point()
        exact = [gid for gid in pids if address_key(places[gid].get('address')) in
                 {address_key(a) for a in addresses} and address_key(places[gid].get('address'))]
        row = {'building_id': bid, 'longitude': point.x, 'latitude': point.y,
               'coordinate_method': 'footprint interior reference point; not an entrance',
               'status': status, 'business_zone_research_candidate': focus,
               'parcel_address_candidates': addresses, 'parcel_ids': [p['parcel_id'] for p in candidates],
               'source_zoning': zones, 'covering_place_ids': pids,
               'same_parcel_place_ids': related, 'exact_address_agreement_place_ids': exact,
               'verified_building_address': False, 'verified_occupancy': False,
               'evidence': {'parcel_links': str(parcels_path.relative_to(ROOT)),
                            'place_links': str(links_path.relative_to(ROOT)),
                            'place_observations': str(PLACES.relative_to(ROOT))}}
        rows.append(row)
        counts[status] += 1
        if focus:
            focused[status] += 1
        display.append([bid, point.x, point.y, status, focus, addresses, zones, pids, related, exact,
                        geom.simplify(.000005, preserve_topology=True).__geo_interface__])
    if len(rows) != 139074 or len({r['building_id'] for r in rows}) != len(rows):
        raise ValueError('Unexpected building count or duplicate source IDs; review input revision')
    with (output / 'building-address-candidates.jsonl').open('w') as f:
        for row in rows:
            f.write(json.dumps(row) + '\n')
    with (output / 'address-research-queue.csv').open('w') as f:
        fields = ['building_id', 'status', 'longitude', 'latitude', 'parcel_address_candidates', 'source_zoning', 'same_parcel_place_ids']
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            if row['business_zone_research_candidate'] and row['status'] != 'reported_place':
                writer.writerow({k: json.dumps(row[k]) if isinstance(row[k], list) else row[k] for k in fields})
    inputs = [parcels_path, links_path, PLACES, BOUNDARY]
    summary = {'building_features': len(rows), 'all_status_counts': dict(counts),
               'business_zone_candidate_status_counts': dict(focused),
               'features_with_exact_address_agreement': sum(bool(r['exact_address_agreement_place_ids']) for r in rows),
               'verified_occupants_added': 0, 'database_writes': 0, 'new_external_address_sources_ingested': 0,
               'classification': 'Address conflict takes precedence; otherwise reported place, address candidate, or unresolved.',
               'limits': ['Features can be roof sections or ancillary structures.',
                          'CD/MD/ID parcel codes flag research areas, not actual uses.',
                          'Same-parcel places are not assigned as occupants of all buildings.',
                          'Address agreement is conservative text agreement, not independent verification.',
                          'No exact suite, entrance, tenant identity or rental tenure inferred.'],
               'inputs': [{'path': str(p.relative_to(ROOT)), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in inputs],
               'building_source_manifest': manifest}
    (output / 'summary.json').write_text(json.dumps(summary, indent=2))
    # Preserve the original map. Reuse its display-only boundary, streets and zoning.
    original = (base / 'windsor-map.html').read_text()
    old_data = json.loads(original.split('const D=', 1)[1].split(';\nconst canvas=', 1)[0])
    data = {'boundary': old_data['boundary'], 'streets': old_data['streets'],
            'buildings': display, 'summary': {k: v for k, v in summary.items() if k != 'building_source_manifest'},
            'places': {gid: {'name': p.get('name'), 'address': p.get('address'), 'source_url': p.get('source_url'),
                            'observed_at': p.get('observed_at')} for gid, p in places.items()}}
    template = Path(__file__).with_name('windsor_address_template.html').read_text()
    (output / 'map.html').write_text(template.replace('__DATA__', json.dumps(data).replace('</', '<\\/')))
    print(json.dumps({k: v for k, v in summary.items() if k not in ('inputs', 'building_source_manifest')}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    build(parser.parse_args().output)
