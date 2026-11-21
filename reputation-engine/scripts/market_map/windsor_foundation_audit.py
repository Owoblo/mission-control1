"""Catalogue municipal service layers and partition existing research by district.

Metadata only: no automatic licence approval, occupant inference or queue changes.
"""
import collections
import csv
import gzip
import json
import subprocess
from pathlib import Path

from shapely.geometry import Point
from .windsor_physical_report import esri_shape

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/windsor-foundation-audit-20261030'
BASE = 'https://mappmycity.ca/arcgis/rest/services/'


def fetch(url, path):
    if not path.exists():
        subprocess.run(['curl', '--fail', '--silent', '--show-error', '--max-time', '60', url, '-o', str(path)], check=True)
    value = json.loads(path.read_text())
    if 'error' in value:
        raise ValueError(value['error'])
    return value


def write_csv(path, rows, fields):
    with path.open('w') as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = fetch(BASE + 'open_data_services?f=json', OUT / 'services.json')
    layers = []
    for service in catalog['services']:
        url = BASE + service['name'] + '/' + service['type']
        name = service['name'].split('/')[-1]
        metadata = fetch(url + '?f=json', OUT / (name + '.json'))
        for layer in metadata.get('layers', []) + metadata.get('tables', []):
            layers.append(dict(service=name, layer_id=layer['id'], name=layer['name'],
                               source_url=url + '/' + str(layer['id']),
                               status='catalogued_metadata_only', licence_status='review_before_ingestion'))
    write_csv(OUT / 'municipal-layer-catalogue.csv', layers,
              ['service', 'layer_id', 'name', 'source_url', 'status', 'licence_status'])
    districts = []
    with gzip.open(ROOT / 'artifacts/windsor-physical-20261028/districts/features.jsonl.gz', 'rt') as handle:
        for line in handle:
            feature = json.loads(line)
            districts.append((feature['attributes']['district_name'], esri_shape(feature['geometry'])))
    rows = []
    counts = collections.Counter()
    for line in (ROOT / 'artifacts/windsor-building-ledger-20261029/buildings.jsonl').read_text().splitlines():
        building = json.loads(line)
        x, y = building.get('longitude'), building.get('latitude')
        matched = sorted(name for name, geom in districts if x is not None and y is not None and geom.covers(Point(x, y)))
        district = matched[0] if len(matched) == 1 else ('BOUNDARY_REVIEW' if matched else 'UNMATCHED')
        counts[district] += 1
        rows.append(dict(building_id=building['building_id'], district=district,
                         district_candidates=' | '.join(matched),
                         addresses=' | '.join(building.get('candidate_addresses', [])),
                         investigation_status=building.get('investigation_status', 'unknown')))
    rows.sort(key=lambda row: (row['district'], row['addresses'], row['building_id']))
    write_csv(OUT / 'district-building-manifest.csv', rows, list(rows[0]))
    summary = dict(services=len(catalog['services']), catalogue_entries=len(layers),
                   candidate_buildings=len(rows), district_counts=dict(counts.most_common()),
                   scope='Existing candidate queue only, not all Windsor buildings. District uses stored coordinate, not full footprint. Catalogue covers one municipal service directory, not every City dataset.',
                   queue_modified=False, occupancy_verified=False)
    (OUT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    run()
