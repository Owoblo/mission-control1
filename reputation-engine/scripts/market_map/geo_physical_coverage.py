"""Reconcile the existing municipal atlas, physical receipts, and saved map.

The resulting manifest is a geometry-first research handoff. It records source
gaps independently of candidate stock and does not infer occupancy from zoning,
address records, or the presence of a mapped organization.
"""
import argparse
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
ATLAS = ROOT/'artifacts/service-baseline-atlas-20261029-reviewed'
MAP = ROOT/'partnership-system/state/market-map.sqlite'
OUTPUT = ROOT/'partnership-system/state/geo-coverage-progress/physical-foundation.json'
LAYERS = ('boundary', 'zoning', 'parcels', 'buildings', 'addresses', 'streets')
PILOTS = {
    '37039': 'windsor-physical-20261028',
    '37043': 'tecumseh-physical-20261029',
    '20002': 'toronto-physical-20261029',
}

NEXT = {
    'source_discovery_pending': 'Find an official layer and verify scope and access',
    'county_download_excluded_municipal_access_unconfirmed': 'Check municipal access or use independent open address and building layers',
    'empty_source_requires_review': 'Check publisher scope and a separate source before treating the result as empty',
    'downloaded_checksum_verified': 'Check geometry and reconcile it with collection coverage',
    'collected_publisher_inventory_reconciled': 'Join the features to adjacent GIS layers and record unmatched features',
    'display_tiles_ready': 'Validate raw geographic extent and preserve matched and unmatched features',
    'downloaded_not_yet_spatially_validated': 'Validate source geometry, coverage and feature counts',
    'available_in_linked_physical_pilot': 'Verify the saved source receipt and scope',
}


def read(path):
    return json.loads(path.read_text())


def location_counts(database):
    # Aggregate by the existing municipality ID. Presence of a unit value only
    # establishes that the saved location carries one.
    with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.execute('PRAGMA query_only=ON')
        return {row[0]: dict(zip(('saved_locations', 'with_address', 'with_recorded_unit',
                                  'with_coordinates', 'without_primary_domain'), row[1:]))
                for row in db.execute("""
                    SELECT l.municipality_id, count(*),
                           sum(CASE WHEN trim(coalesce(l.street, '')) <> '' OR
                                         trim(coalesce(l.address_raw, '')) <> '' THEN 1 ELSE 0 END),
                           sum(CASE WHEN trim(coalesce(l.unit, '')) <> '' THEN 1 ELSE 0 END),
                           sum(CASE WHEN l.latitude IS NOT NULL AND l.longitude IS NOT NULL THEN 1 ELSE 0 END),
                           sum(CASE WHEN trim(coalesce(o.primary_domain, '')) = '' THEN 1 ELSE 0 END)
                    FROM locations l JOIN organisations o ON o.id = l.organisation_id
                    WHERE l.municipality_id IS NOT NULL AND l.country = 'CA'
                    GROUP BY l.municipality_id
                """)}


def layer_handoff(city, layer, work, receipts):
    code = city['municipality_code']
    saved = work.get((code, layer), {})
    state = saved.get('status', 'source_discovery_pending')
    if layer == 'boundary':
        state = city.get('boundary_status', state)
    receipt = receipts.get((code, layer))
    result = {'id': f'gis:{code}:{layer}', 'layer': layer}
    if receipt:
        state = receipt['status']
        if state == 'completed' and receipt.get('source_id_inventory_reconciled') is True:
            state = 'collected_publisher_inventory_reconciled'
        if saved.get('status') == 'display_tiles_ready' and state == 'downloaded_not_yet_spatially_validated':
            state = 'display_tiles_ready'
        result.update(source_url=receipt['source_url'], observed_at=receipt.get('observed_at'),
                      source_feature_count=receipt.get('count'),
                      evidence=receipt['path'])
    action = NEXT.get(state, 'Review saved evidence and establish the source extent')
    return {**result, 'state': state, 'next_action': action}


def reconcile(municipalities, queue, counts, receipts, captured_at):
    work = {(row['municipality_code'], row['layer']): row for row in queue}
    ids = {row['geography_id'] for row in municipalities}
    codes = {row['municipality_code'] for row in municipalities}
    if len(ids) != len(municipalities) or len(codes) != len(municipalities):
        raise ValueError('Municipality identities are ambiguous in the atlas')
    cities = []
    for city in sorted(municipalities, key=lambda row: row['name']):
        code = city['municipality_code']
        known = counts.get(city['geography_id'], {})
        layers = [layer_handoff(city, layer, work, receipts) for layer in LAYERS]
        cities.append({
            'municipality': city['name'], 'municipality_id': city['geography_id'],
            'municipality_code': code, 'layers': layers, 'saved_map': known,
            'observed_source_envelope_covers_boundary': city.get('place_envelopes_cover_boundary'),
            'occupancy': {'id': f'gis:{code}:occupancy', 'state': 'tenant_scope_unverified',
                          'next_action': 'Match dated official business, institutional and property directories to civic address and suite evidence'},
        })
    return {
        'generated_at': captured_at, 'municipalities': cities,
        'summary': {
            'municipalities': len(cities), 'physical_layer_cells': len(cities) * len(LAYERS),
            'layer_states': dict(Counter(layer['state'] for city in cities for layer in city['layers'])),
            'addresses_with_reconciled_source_inventory': sum(
                any(layer['layer'] == 'addresses' and layer['state'] == 'collected_publisher_inventory_reconciled'
                    for layer in city['layers']) for city in cities),
            'saved_locations': sum(city['saved_map'].get('saved_locations', 0) for city in cities),
            'saved_locations_without_primary_domain': sum(
                city['saved_map'].get('without_primary_domain', 0) for city in cities),
            'saved_locations_with_recorded_unit': sum(city['saved_map'].get('with_recorded_unit', 0) for city in cities),
        },
    }


def build(root=ROOT, atlas=ATLAS, database=MAP):
    receipts = {}
    for code, pilot in PILOTS.items():
        for layer in LAYERS:
            path = root/'artifacts'/pilot/layer/'manifest.json'
            if path.is_file():
                receipts[code, layer] = {**read(path), 'path': str(path.relative_to(root))}
    return reconcile(read(atlas/'municipality-manifest.json'),
                     read(atlas/'physical-acquisition-queue.json')['jobs'],
                     location_counts(database), receipts, datetime.now(timezone.utc).isoformat())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    args = parser.parse_args()
    result = build()
    path = args.output
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.next')
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    temporary.replace(path)
    print(json.dumps(result['summary']))


if __name__ == '__main__':
    main()
