"""Parse a saved official GECDSB directory; never request Google Maps content."""
import argparse
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import re
from shapely.geometry import Point, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree
from .windsor_physical_report import ROOT, BOUNDARY, esri_shape, read_layer

SOURCE = 'https://schooldirectory.publicboard.ca/'


def parse(body):
    popups = re.findall(r'_infoWindow\.setContent\(("(?:[^"\\]|\\.)*")\);', body)
    records = {}
    for raw in popups:
        fragment = json.loads(raw)
        matches = list(re.finditer(r"<strong><a[^>]*data-value='([^']+)'[^>]*>(.*?)</a></strong><br/>(.*?)<br/>Directions: <a href='http://maps.google.com/\?daddr=([\d.\-]+),([\d.\-]+)'", fragment))
        if not matches:
            raise ValueError('Directory popup schema changed; review before import')
        for m in matches:
            sid, name, address, lat, lon = m.groups()
            row = dict(source_record_id=sid, name=html.unescape(name), full_address=html.unescape(address),
                       latitude=float(lat), longitude=float(lon))
            if not (-90 <= row['latitude'] <= 90 and -180 <= row['longitude'] <= 180):
                raise ValueError('Invalid coordinates')
            if sid in records and records[sid] != row:
                raise ValueError('Conflicting source identity')
            records[sid] = row
    if not records:
        raise ValueError('No directory records parsed; not a successful zero-result run')
    return list(records.values())


def run(source_file):
    body = source_file.read_bytes()
    records = parse(body.decode('utf-8-sig'))
    output = ROOT / 'artifacts/windsor-school-directory-20261029'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'source.html').write_bytes(body)
    boundary = unary_union([shape(f['geometry']) for f in json.loads(BOUNDARY.read_text())['features'] if f['properties']['MUNID'] == '37039'])
    raw, manifest = read_layer(ROOT / 'artifacts/windsor-physical-20261028/buildings')
    geometries, ids = [], []
    for r in raw:
        try:
            g = esri_shape(r['geometry'])
        except (ValueError, TypeError):
            continue
        if not boundary.intersects(g):
            continue
        a = r['attributes']
        ids.append('buildings:' + str(a.get('GlobalID') or a.get('building_id') or a['OBJECTID']))
        geometries.append(g)
    tree = STRtree(geometries)
    accepted, held = [], []
    for r in records:
        point = Point(r['longitude'], r['latitude'])
        labelled = ', Windsor, Ontario, Canada ' in r['full_address']
        inside = boundary.covers(point)
        if labelled != inside:
            held.append({**r, 'reason': 'municipality_label_and_coordinate_disagree'})
        if not (labelled and inside):
            continue
        matches = sorted(ids[int(i)] for i in tree.query(point) if geometries[int(i)].covers(point))
        accepted.append({'address': r['full_address'].split(', Windsor, Ontario, Canada ')[0],
                         'organization': r['name'], 'unit_or_floor': None,
                         'relationship': 'GECDSB listed school/program site; multiple programs may share one physical site and operator',
                         'source_url': SOURCE, 'source_record_id': r['source_record_id'],
                         'status': 'official_directory_address_and_coordinate_supported',
                         'checked_on': '2026-10-29', 'latitude': r['latitude'], 'longitude': r['longitude'],
                         'source_building_candidates': matches,
                         'spatial_method': 'Board-published point covered by original municipal footprint geometry; not verified occupancy',
                         'raw_evidence_reference': str((output / 'source.html').relative_to(ROOT))})
    summary = {'retrieved_at': datetime.now(timezone.utc).isoformat(), 'source_url': SOURCE,
               'sha256': hashlib.sha256(body).hexdigest(), 'source_bytes': len(body),
               'published_records_in_saved_page': len(records), 'accepted_windsor_records': len(accepted),
               'label_coordinate_conflicts': len(held), 'with_covering_building_candidate': sum(bool(o['source_building_candidates']) for o in accepted),
               'without_covering_building_candidate': sum(not o['source_building_candidates'] for o in accepted),
               'robots_check': 'robots.txt returned HTTP 404; one public directory page fetched, no detail crawl',
               'licence': 'No bulk reuse licence established; internal factual research, no public republishing of source HTML.',
               'scope': 'All parsed popup records in one saved official page, not a claim of all schools or institutions in Windsor.',
               'google_maps_requests': 0, 'database_writes': 0,
               'building_geometry_sha256': manifest['sha256']}
    (output / 'observations.json').write_text(json.dumps(accepted, indent=2))
    (output / 'held.json').write_text(json.dumps(held, indent=2))
    (output / 'summary.json').write_text(json.dumps(summary, indent=2))
    p = Path(__file__).with_name('windsor_address_evidence.json')
    evidence = json.loads(p.read_text())
    # Source-key replacement makes a rerun idempotent while preserving other evidence.
    evidence['observations'] = [o for o in evidence['observations'] if o.get('source_url') != SOURCE] + accepted
    p.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--source-file', type=Path, required=True)
    run(p.parse_args().source_file)
