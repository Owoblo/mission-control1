"""Build a complete city/category/source research plan without claiming execution."""
import argparse
import collections
import csv
import hashlib
import json
from datetime import date, timedelta
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='artifacts/city-category-source-14day-20261028')
    args = parser.parse_args()
    out = Path(args.output)
    if out.exists():
        raise SystemExit('Output exists; use a new immutable snapshot path')
    root = Path(__file__).resolve().parents[2]
    coverage = root / 'artifacts/coverage-workqueue-20261028'
    labels = json.loads((coverage / 'catalog-reconciliation/coverage-labels.json').read_text())['rows']
    with (root / 'partnership-system/catalogs/outreach-overlay.csv').open(newline='', encoding='utf8') as stream:
        categories = list(csv.DictReader(stream))
    sources = json.loads((coverage / 'category-and-source-catalog.json').read_text())['sources']
    existing = collections.Counter()
    for line in (coverage / 'observations.jsonl').open(encoding='utf8'):
        if line.strip():
            existing[json.loads(line)['locality_id']] += 1
    labels.sort(key=lambda row: (row['canonical_label'] != 'Windsor', -existing[row['coverage_label_id']], row['canonical_label']))
    out.mkdir(parents=True)
    start = date(2026, 10, 28)
    schedule = []
    for i, label in enumerate(labels):
        day = i * 14 // len(labels)
        schedule.append({
            'day': day + 1, 'date': (start + timedelta(days=day)).isoformat(),
            'locality_id': label['coverage_label_id'], 'service_label': label['canonical_label'],
            'kind': label['kind'], 'jurisdiction_status': label['jurisdiction_status'],
            'existing_entity_observations': existing[label['coverage_label_id']],
            'category_source_cells': len(categories) * len(sources),
            'status': 'planned_not_executed',
        })
    with (out / 'city-schedule.csv').open('w', newline='', encoding='utf8') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(schedule[0]))
        writer.writeheader()
        writer.writerows(schedule)
    with (out / 'planned-source-cells.jsonl').open('w', encoding='utf8') as stream:
        for scheduled in schedule:
            for category in categories:
                for source in sources:
                    raw = f"{scheduled['locality_id']}|{category['category_id']}|{source['id']}"
                    row = {
                        'task_id': 'city_source_' + hashlib.sha256(raw.encode()).hexdigest()[:24],
                        'date': scheduled['date'], 'locality_id': scheduled['locality_id'],
                        'service_label': scheduled['service_label'], 'category_id': category['category_id'],
                        'category': category['category'], 'source_id': source['id'],
                        'query_seed': f"{category['search_synonyms'].split(';')[0]} {scheduled['service_label']} Ontario",
                        'status': 'planned_not_executed', 'receipt': None,
                    }
                    stream.write(json.dumps(row, ensure_ascii=False) + '\n')
    navigator_registry = Path('/Users/owoblo/Downloads/grome/hub/source-registry.json')
    supplemental = {'status': 'routes_to_review_not_executed', 'navigator_routes': [], 'market_map_routes': []}
    if navigator_registry.exists():
        supplemental['navigator_routes'] = json.loads(navigator_registry.read_text()).get('sources', [])
    market_registry = root / 'scripts/market_map/config/sources.json'
    if market_registry.exists():
        supplemental['market_map_routes'] = [
            {k: row.get(k) for k in ('id', 'name', 'source_type', 'source_url', 'geography_scope', 'sector_scope', 'retrieval_status', 'rights_status', 'adapter_name')}
            for row in json.loads(market_registry.read_text()).get('sources', [])
        ]
    (out / 'supplemental-source-routes.json').write_text(json.dumps(supplemental, indent=2, ensure_ascii=False))
    first = labels[0]
    packet = {
        'service_label': first['canonical_label'], 'locality_id': first['coverage_label_id'],
        'jurisdiction_status': first['jurisdiction_status'], 'label_kind': first['kind'],
        'existing_entity_observations': existing[first['coverage_label_id']],
        'state': 'research_plan_not_executed', 'campaign_ready': False,
        'municipal_task': 'Verify actual government jurisdiction, department/vendor routes and official evidence before assigning municipal contacts.',
        'categories': [],
    }
    for category in categories:
        cat = {
            'category_id': category['category_id'], 'category': category['category'],
            'account_units': category['account_units'], 'role_targets': category['role_targets'],
            'size_bands_to_classify_per_entity': ['small', 'medium', 'large', 'unknown'],
            'search_synonyms': category['search_synonyms'].split(';'), 'sources': [],
        }
        for source in sources:
            raw = f"{first['coverage_label_id']}|{category['category_id']}|{source['id']}"
            cat['sources'].append({
                'task_id': 'city_source_' + hashlib.sha256(raw.encode()).hexdigest()[:24],
                'source_id': source['id'], 'purpose': source['purpose'], 'execution': source['execution'],
                'query_seed': f"{category['search_synonyms'].split(';')[0]} {first['canonical_label']} Ontario",
                'status': 'planned_not_executed', 'receipt': None,
            })
        packet['categories'].append(cat)
    (out / 'first-city-windsor.json').write_text(json.dumps(packet, indent=2, ensure_ascii=False))
    counts = collections.Counter(row['date'] for row in schedule)
    manifest = {
        'start': start.isoformat(), 'days': 14, 'service_labels': len(labels),
        'kind_counts': dict(collections.Counter(row['kind'] for row in labels)),
        'unreconciled_owner_target': {'claimed': 249, 'catalogued': len(labels), 'difference': 249-len(labels)},
        'categories': len(categories), 'source_families': len(sources),
        'supplemental_navigator_routes': len(supplemental['navigator_routes']),
        'supplemental_market_map_routes': len(supplemental['market_map_routes']),
        'planned_cells': len(labels) * len(categories) * len(sources),
        'average_cells_per_day': len(labels) * len(categories) * len(sources) / 14,
        'labels_per_day': dict(counts), 'first_city': first['canonical_label'],
        'executed_cells': 0, 'verified_entities': 0, 'send_ready': 0,
        'rules': [
            'A scheduled cell is not a completed search or evidence of no results.',
            'Small, medium and large are entity attributes requiring evidence; never infer size from a category or search rank.',
            'Record exact query, bounds, result IDs, pagination and terminal or partial state for each executed source.',
            'Resolve jurisdiction before assuming a service label has its own city government.',
            'Keep brand, operator and physical branch distinct; preserve source, identity, role and suppression evidence.',
            'Email verification and outreach admission are separate downstream gates; no campaign sends in this plan.',
        ],
    }
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
