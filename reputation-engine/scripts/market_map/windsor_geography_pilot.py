"""Read-only Windsor point screening and conservative directory overlap candidates."""
import argparse
import collections
import csv
import gzip
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from market_map.spatial_context import PolygonIndex
from market_map.occupancy_research import write_queue

ROOT = Path(__file__).resolve().parents[2]
RUN = ROOT / 'partnership-system/markets/ca/on/all-service-areas/runs/2026-10-26'
PLACES = RUN / 'overture-2026-10-21/windsor-essex/normalised-records.jsonl.gz'
POLYGONS = RUN / 'reported-coordinate-context/polygons/municipal-polygons.geojson'
DIRECTORY = ROOT / 'partnership-system/markets/ca/on/windsor-essex/runs/2026-10-28/accounts-and-locations.csv'


def norm(value):
    return re.sub(r'[^a-z0-9]', '', (value or '').lower())


def verified_inputs(places, polygons):
    receipts = {}
    for path, manifest_name, checksum_key in [
        (places, 'collection.json', 'rows_compressed_sha256'),
        (polygons, 'polygon-source.json', 'geojson_sha256'),
    ]:
        receipt = json.loads((path.parent / manifest_name).read_text())
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if receipt.get(checksum_key) != digest:
            raise ValueError('Source checksum mismatch: ' + str(path))
        receipts[manifest_name] = receipt
    boundary = receipts['polygon-source.json']
    if boundary.get('status') != 'completed' or boundary.get('validated_output_spatial_reference', {}).get('wkid') != 4326:
        raise ValueError('Boundary completion/projection unconfirmed')
    return receipts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--output', required=True, type=Path)
    ap.add_argument('--places', type=Path, default=PLACES)
    ap.add_argument('--polygons', type=Path, default=POLYGONS)
    ap.add_argument('--directory', type=Path, default=DIRECTORY)
    ap.add_argument('--municipality-code', default='37039')
    args = ap.parse_args()
    places, polygons, directory = args.places, args.polygons, args.directory
    receipts = verified_inputs(places, polygons)
    if args.output.exists():
        raise SystemExit('Output already exists')
    features = json.loads(polygons.read_text())['features']
    if not any(str(f['properties']['MUNID']) == args.municipality_code for f in features):
        raise ValueError('Requested municipality missing from saved configuration')
    index = PolygonIndex(features, {})
    with directory.open(newline='', encoding='utf8') as f:
        accounts = list(csv.DictReader(f))
    args.output.mkdir(parents=True)
    by_name = collections.defaultdict(list)
    for a in accounts:
        if norm(a['name']): by_name[norm(a['name'])].append(a)
    counts = collections.Counter()
    with gzip.open(places, 'rt', encoding='utf8') as src, (args.output/'windsor-place-candidates.jsonl').open('w') as out, (args.output/'spatial-review.jsonl').open('w') as review:
        for line in src:
            p = json.loads(line); x = p.get('longitude'); y = p.get('latitude')
            counts['input_observations'] += 1
            context = index.locate(x, y)
            counts['spatial_' + context['status']] += 1
            if context['status'] != 'single_polygon_context':
                review.write(json.dumps({'source_record_id': p.get('source_record_id'), 'longitude': x, 'latitude': y, 'context': context})+'\n')
                continue
            if context['municipality_code'] != args.municipality_code:
                continue
            candidates = by_name.get(norm(p.get('name')), []) if norm(p.get('name')) else []
            phone = re.sub(r'\D', '', p.get('phone') or '')[-10:]
            matches = [{'source_id': a['source_id'], 'source_url': a['source_url'],
                        'same_phone': bool(phone and phone == re.sub(r'\D', '', a.get('phone') or '')[-10:]),
                        'same_address': bool(norm(p.get('address')) and norm(p.get('address')) == norm(a.get('address')))} for a in candidates]
            counts['windsor_reported_points'] += 1
            counts['name_match_candidates'] += bool(matches)
            counts['name_and_address_or_phone_candidates'] += any(m['same_phone'] or m['same_address'] for m in matches)
            out.write(json.dumps({'gers': p['source_record_id'], 'name': p.get('name'), 'address': p.get('address'),
                'latitude': y, 'longitude': x, 'source_url': p.get('source_url'), 'observed_at': p.get('observed_at'),
                'provider_existence_confidence': p.get('provider_existence_confidence'), 'source_provenance': p.get('source_provenance'),
                'directory_match_candidates': matches, 'status': 'reported_point_in_windsor_unverified',
                'verified_organisation': False, 'outreach_eligible': False}, ensure_ascii=False)+'\n')
    with (args.output/'windsor-place-candidates.jsonl').open() as handle:
        counts.update(write_queue((json.loads(line) for line in handle), args.municipality_code, args.output))
    manifest = {'counts': dict(counts), 'boundary_munid': args.municipality_code, 'boundary_source': str(polygons),
        'places_source': str(places), 'directory_source': str(directory),
        'input_sha256': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in [places, polygons, directory]},
        'scope': 'Reported point screened against saved Windsor municipality polygons; candidate matches against one directory only',
        'limitations': ['Source-reported coordinates are not independently verified', 'Not a building, parcel, address or occupancy census',
                        'Matches are candidates; unmatched does not mean net new', 'No operating status, contact or outreach verification'],
        'source_receipts': receipts, 'invalid_boundary_features': index.invalid_features,
        'directory_baseline_records': len(accounts),
        'net_new_verified_organisations': None, 'cost_per_new_verified': None, 'database_writes': 0}
    (args.output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest['counts']))


if __name__ == '__main__': main()
