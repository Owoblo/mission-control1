"""Reconcile approved physical layers using the current address register.

Run this from the existing daily Railway scheduler. The output is research-only
evidence and holds. Source points, parcel links and reported places retain
separate meanings from a verified occupant or suite.
"""
import argparse
from collections import Counter, defaultdict
from contextlib import closing
from datetime import datetime, timezone
import fcntl
import gzip
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import unicodedata
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.strtree import STRtree
from scripts.market_map.site_source_worker import collect_site
from scripts.market_map.windsor_physical_report import esri_shape, read_layer


ASHORT = {
    'STREET': 'ST', 'ROAD': 'RD', 'AVENUE': 'AVE', 'DRIVE': 'DR', 'LANE': 'LN',
    'BOULEVARD': 'BLVD', 'COURT': 'CRT', 'CRESCENT': 'CRES', 'TRAIL': 'TR',
    'NORTH': 'N', 'SOUTH': 'S', 'EAST': 'E', 'WEST': 'W',
}
DIRS = {'NORTH', 'SOUTH', 'EAST', 'WEST', 'N', 'S', 'E', 'W'}


def civic_key(address):
    tokens = re.findall(r'[A-Z0-9]+', unicodedata.normalize('NFKD', address.upper()))
    if len(tokens) < 3 or not tokens[0][0].isdigit():
        return ''
    last = -2 if tokens[-1] in DIRS else -1
    tokens[last] = ASHORT.get(tokens[last], tokens[last])
    if last == -2:
        tokens[-1] = ASHORT.get(tokens[-1], tokens[-1])
    return ' '.join(tokens)


def read(path, fallback=None):
    return json.loads(path.read_text()) if path.is_file() else fallback


def save(path, payload):
    tmp = path.with_suffix('.next')
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    tmp.replace(path)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            result.update(chunk)
    return result.hexdigest()


class Layer:
    def __init__(self, folder, boundary):
        self.manifest = None
        self.rows = []
        self.invalid = 0
        self.outside = 0
        if not folder.is_dir():
            self.tree = STRtree([])
            return
        raw, self.manifest = read_layer(folder)
        if self.manifest.get('output_crs') != 'EPSG:4326':
            raise ValueError('Unexpected layer CRS')
        key = self.manifest.get('object_id_field', 'OBJECTID')
        for row in raw:
            attrs = row['attributes']
            try:
                geom = esri_shape(row.get('geometry'))
            except (ValueError, TypeError):
                self.invalid += 1
                continue
            if not boundary.intersects(geom):
                self.outside += 1
                continue
            self.rows.append((str(attrs[key]), geom, attrs))
        self.tree = STRtree([geom for _, geom, _ in self.rows])

    def hits(self, geom, predicate='intersects'):
        return [self.rows[int(idx)] for idx in self.tree.query(geom, predicate=predicate)]

    def source_summary(self):
        if not self.manifest:
            return {'state': 'source_unavailable'}
        return {'state': 'reconciled_source', 'source_url': self.manifest['source_url'],
                'observed_at': self.manifest['observed_at'], 'sha256': self.manifest['sha256'],
                'in_scope': len(self.rows), 'invalid_geometry': self.invalid, 'outside_boundary': self.outside}


def source_rows(path, city):
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        yield from db.execute("""
            SELECT ADDR_GUID, LOC_GUID, CIVIC_NO, CIVIC_NO_SUFFIX, OFFICIAL_STREET_NAME,
                   OFFICIAL_STREET_TYPE, OFFICIAL_STREET_DIR, APT_NO_LABEL, BU_USE
            FROM addresses WHERE municipality_id=? ORDER BY ADDR_GUID
        """, (city,))


def place_index(path, city):
    result = defaultdict(list)
    for row in read(path, []):
        if row.get('municipality') != city or not row.get('address') or not row.get('source_url'):
            continue
        # A unit-prefixed place address deliberately fails the same-civic check.
        address = civic_key(str(row['address']).split(',')[0])
        if address:
            result[address].append({k: row.get(k) for k in ('source_record_id', 'organization', 'source_url', 'address', 'category')})
    return result


def output_rows(path, rows):
    temp = path.with_suffix('.next')
    with gzip.open(temp, 'wt', encoding='utf-8') as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')
    temp.replace(path)


def corroborate_sites(base, status, places, output, limit):
    if not limit or not status.get('evidence_folder'):
        return {}
    root = Path('/data/research')
    source = base/status['evidence_folder']/'address-evidence.jsonl.gz'
    cache = base/'occupancy-source-receipts'
    cache.mkdir(exist_ok=True)
    seen = set()
    results = []
    with gzip.open(source, 'rt') as stream:
        for raw in stream:
            row = json.loads(raw)
            for candidate in row['reported_business_candidates']:
                native = candidate.get('source_record_id')
                website = places.get(native)
                if not native or not website:
                    continue
                identifier = hashlib.sha256(json.dumps([status['municipality'], native, row['civic'], website]).encode()).hexdigest()
                if identifier in seen or (cache/identifier/'result.json').exists():
                    continue
                seen.add(identifier)
                site = {'site_id': identifier, 'municipality': status['municipality'], 'addresses': json.dumps([row['civic']])}
                report, receipts = collect_site(site, [website], root, cache/identifier)
                name = re.sub(r'[^a-z0-9]', '', str(candidate.get('organization') or '').lower())
                matches = [match for page in report['sources'] for match in page['candidates']
                           if not page['gaps'] and match['match_status'] == 'explicit_source_assertion'
                           and name and name == re.sub(r'[^a-z0-9]', '', match['organization_name'].lower())]
                results.append({'source_record_id': native, 'site_id': identifier, 'civic': row['civic'],
                                'state': 'civic_business_corroborated_unit_review' if matches else 'occupancy_evidence_review',
                                'receipts': receipts, 'occupant_verified': False})
                if len(results) >= limit:
                    break
            if len(results) >= limit:
                break
    save(output/'occupancy-source-review.json', {'results': results})
    return {'source_sites_reviewed': len(results),
            'civic_business_matches': sum(r['state'] == 'civic_business_corroborated_unit_review' for r in results)}


def first_party_places(path):
    websites = {}
    for place in read(path, []):
        website = str(place.get('website') or '')
        try:
            url = urlsplit(website)
        except ValueError:
            continue
        if (url.scheme == 'https' and url.hostname and not url.username and not url.password
                and url.hostname.split('.')[-2:] not in
                [['facebook', 'com'], ['instagram', 'com'], ['google', 'com'], ['yelp', 'ca'], ['linkedin', 'com']]):
            websites[place['source_record_id']] = website
    return websites


def reconcile(city, spec, base, output, database, places_path, nar_receipt):
    folder = base/spec['bundle']
    if digest(folder/'boundary.geojson') != spec['boundary_sha256']:
        raise ValueError('Municipal boundary checksum mismatch')
    boundary_rows = read(folder/'boundary.geojson')['features']
    polygons = [shape(feat['geometry']) for feat in boundary_rows
                if str(feat['properties']['MUNID']) == spec['municipality_code']]
    if not polygons or any(not p.is_valid or p.is_empty for p in polygons):
        raise ValueError('Approved municipal boundary missing or invalid')
    boundary = unary_union(polygons)
    layers = {name: Layer(folder/name, boundary) for name in ('addresses', 'parcels', 'buildings', 'zoning')}
    places = place_index(places_path, city)
    counts = Counter()
    occupied_candidates = set()
    building_address_links = set()
    address_geometry = defaultdict(list)
    parcel_geometry = defaultdict(list)
    for record in layers['addresses'].rows:
        key = civic_key(str(record[2].get(spec.get('civic_field', 'AddressComplete')) or ''))
        if key:
            address_geometry[key].append(record)
    for record in layers['parcels'].rows:
        key = civic_key(str(record[2].get(spec.get('parcel_civic_field', 'primary_address')) or ''))
        if key:
            parcel_geometry[key].append(record)

    def addresses():
        for aid, lid, number, suffix, street, kind, direction, unit, use in source_rows(database, spec['municipality_id']):
            label = ' '.join(str(part).strip() for part in (number + suffix, street, kind, direction) if part)
            key = civic_key(label)
            civic = address_geometry.get(key, [])
            named_parcels = parcel_geometry.get(key, [])
            business = places.get(key, [])
            buildings, zones, parcels = set(), set(), set()
            for _, point, _ in civic:
                buildings.update(r[0] for r in layers['buildings'].hits(point, 'covered_by'))
                zones.update(r[0] for r in layers['zoning'].hits(point, 'covered_by'))
                parcels.update(r[0] for r in layers['parcels'].hits(point, 'covered_by'))
            for pid, parcel, _ in named_parcels:
                parcels.add(pid)
                buildings.update(r[0] for r in layers['buildings'].hits(parcel) if r[1].intersection(parcel).area > 0)
                zones.update(r[0] for r in layers['zoning'].hits(parcel) if r[1].intersection(parcel).area > 0)
            counts['address_rows'] += 1
            if unit:
                counts['address_rows_with_recorded_unit'] += 1
            if civic or named_parcels:
                counts['matched_municipal_civic_or_parcel_rows'] += 1
            else:
                counts['unresolved_municipal_address_join'] += 1
            if buildings:
                counts['address_rows_with_building_candidates'] += 1
                building_address_links.update(buildings)
                if len(buildings) > 1:
                    counts['address_rows_with_multiple_building_candidates'] += 1
            if parcels:
                counts['address_rows_with_parcel_candidates'] += 1
            if zones:
                counts['address_rows_with_zoning_candidates'] += 1
            if business:
                counts['address_rows_with_reported_business_candidates'] += 1
                occupied_candidates.update(r['source_record_id'] for r in business)
            missing = []
            if not (civic or named_parcels):
                missing.append('municipal_address_match_needed')
            if len(buildings) != 1:
                missing.append('unique_building_link_needed')
            if not parcels:
                missing.append('parcel_evidence_missing')
            if not zones:
                missing.append('zoning_evidence_missing')
            missing.append('independent_current_occupant_confirmation_needed')
            yield {'address_id': aid, 'source_location_id': lid, 'civic': label, 'unit': unit or None,
                   'publisher_use': use, 'municipal_address_ids': sorted(row[0] for row in civic),
                   'parcel_candidates': sorted(parcels), 'building_candidates': sorted(buildings),
                   'zoning_candidates': sorted(zones), 'reported_business_candidates': business,
                   'holds': missing, 'occupant_verified': False}

    output.mkdir(parents=True, exist_ok=True)
    output_rows(output/'address-evidence.jsonl.gz', addresses())

    def footprints():
        for building_id, geom, _ in layers['buildings'].rows:
            zones = [{'source_id': zid, 'local_code': data.get(spec.get('zone_field', 'Zoning_Sym'))}
                     for zid, zone, data in layers['zoning'].hits(geom) if geom.intersection(zone).area > 0]
            linked = building_id in building_address_links
            if zones:
                counts['footprints_with_zoning_candidates'] += 1
            if not linked:
                counts['footprints_without_linked_imported_address'] += 1
            yield {'building_id': building_id, 'linked_imported_address': linked, 'zoning_candidates': zones,
                   'occupancy_state': 'unverified'}

    output_rows(output/'footprint-evidence.jsonl.gz', footprints())
    return {'municipality': city, 'state': 'reconciled_with_evidence_gaps', 'address_source_release': nar_receipt['release'],
            'layers': {name: layer.source_summary() for name, layer in layers.items()},
            'counts': dict(counts), 'reported_business_source_ids': len(occupied_candidates),
            'verified_occupants': 0}


def run(base, day, places_path):
    config = read(base/'config.json')
    address_root = base.parent/'gis-address-foundation-202606'
    nar = read(address_root/'status.json', {})
    if nar.get('state') != 'ontario_address_members_verified':
        raise ValueError('Awaiting reconciled address source receipt')
    out = base/'runs'/day
    out.mkdir(parents=True, exist_ok=True)
    statuses = []
    website_limit = config.get('source_sites_per_municipality', 0)
    if type(website_limit) is not int or not 0 <= website_limit <= 5:
        raise ValueError('Use at most five public source sites per municipality per day')
    websites = first_party_places(places_path) if website_limit else {}
    previous = {row['municipality']: row for row in read(base/'latest-status.json', {}).get('municipalities', [])}
    common = [digest(Path(__file__)), digest(address_root/'status.json'),
              digest(places_path) if places_path.is_file() else None]
    for spec in config['municipalities']:
        site = out/spec['municipality_code']
        receipt = site/'status.json'
        prior = read(receipt)
        if prior:
            statuses.append(prior)
            continue
        source = base/spec['bundle']
        revisions = {path.parent.name: digest(path) for path in source.glob('*/manifest.json')}
        fingerprint = hashlib.sha256(json.dumps([*common, spec, revisions], sort_keys=True).encode()).hexdigest()
        prior = previous.get(spec['name'], {})
        try:
            if (prior.get('fingerprint') == fingerprint and prior.get('state') == 'reconciled_with_evidence_gaps'
                    and all((base/prior['evidence_folder']/name).is_file()
                            for name in ('address-evidence.jsonl.gz', 'footprint-evidence.jsonl.gz'))):
                status = {**prior, 'reused_verified_source_revision': True}
            else:
                status = reconcile(spec['name'], spec, base, site, address_root/'research-addresses.sqlite3', places_path, nar)
                status.update(fingerprint=fingerprint, evidence_folder=str(site.relative_to(base)),
                              reused_verified_source_revision=False)
        except (ValueError, OSError, KeyError) as exc:
            status = {'municipality': spec['name'], 'state': 'physical_reconciliation_held',
                      'issue': type(exc).__name__}
        site.mkdir(exist_ok=True)
        if status['state'] == 'reconciled_with_evidence_gaps':
            try:
                status['occupancy_source_review'] = corroborate_sites(base, status, websites, site, website_limit)
            except (ValueError, OSError, KeyError) as exc:
                status['occupancy_source_review'] = {'state': 'needs_review', 'issue': type(exc).__name__}
        save(receipt, status)
        statuses.append(status)
    report = {'day': day, 'at': datetime.now(timezone.utc).isoformat(), 'municipalities': statuses}
    save(out/'status.json', report)
    save(base/'latest-status.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--places', type=Path, required=True)
    parser.add_argument('--day', default=datetime.now(ZoneInfo('America/Toronto')).date().isoformat())
    args = parser.parse_args()
    datetime.fromisoformat(args.day)
    # Require a canonical date before constructing storage paths.
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.day):
        raise ValueError('Invalid day')
    with (args.base/'run.lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(run(args.base, args.day, args.places)), flush=True)


if __name__ == '__main__':
    main()
