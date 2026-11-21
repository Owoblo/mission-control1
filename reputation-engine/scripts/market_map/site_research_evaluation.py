"""Read-only stratified evaluation manifests and honest workflow comparisons.

Proxy strata describe stored evidence, never verified physical building types.
Quality requires independent reference labels; missing labels never mean zero errors.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import sqlite3
import statistics


def read_sites(db_path):
    db = sqlite3.connect(Path(db_path).resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        members = defaultdict(list)
        for row in db.execute('SELECT site_id,building_id,context FROM members ORDER BY building_id'):
            members[row['site_id']].append(json.loads(row['context']))
        result = []
        for row in db.execute('SELECT * FROM sites ORDER BY site_id'):
            item = dict(row)
            item['addresses'] = json.loads(item['addresses'])
            item['members'] = members[item['site_id']]
            result.append(item)
        return result
    finally:
        db.close()


def describe(site):
    zones, places, bids = set(), set(), []
    for member in site['members']:
        bids.append(member['building_id'])
        snapshot = member.get('queue_snapshot', {})
        zones.update(str(z) for z in snapshot.get('zoning_codes', []))
        places.update(str(p) for p in member.get('reported_place_names', []) if p)
    ambiguous = site['state'] == 'needs_review' or len(site['addresses']) != 1
    if ambiguous:
        category = 'address_or_context_ambiguity'
    elif len(places) > 1:
        category = 'multiple_reported_places'
    elif any(z.startswith('MD') for z in zones):
        category = 'industrial_zoning_context'
    elif any(z.startswith('ID') for z in zones):
        category = 'institutional_zoning_context'
    elif len(bids) > 1:
        category = 'shared_address_multiple_footprints'
    elif places:
        category = 'one_reported_place'
    else:
        category = 'no_reported_place'
    return dict(site_id=site['site_id'], municipality=site['municipality'],
        district=site['district'], candidate_addresses=site['addresses'],
        member_building_ids=sorted(bids), queue_state=site['state'],
        proxy_stratum=category, zoning_codes=sorted(zones),
        reported_place_names=sorted(places),
        expected_current_occupants=None, reference_sources=[],
        reference_review_status='not_independently_labeled',
        verified_physical_building_type=None)


def make_manifest(sites, count=50):
    if not 1 <= count <= 1000:
        raise ValueError('Sample count must be 1..1000')
    rows = [describe(s) for s in sites]
    # Spread selections first across proxy category, then districts within category.
    groups = defaultdict(lambda: defaultdict(list))
    for row in sorted(rows, key=lambda r: hashlib.sha256(r['site_id'].encode()).hexdigest()):
        groups[row['proxy_stratum']][row['district']].append(row)
    category_order = sorted(groups)
    selected = []
    district_counts = Counter()
    while len(selected) < min(count, len(rows)):
        for category in category_order:
            available = [d for d, items in groups[category].items() if items]
            if available and len(selected) < count:
                district = min(available, key=lambda d:(district_counts[d], d))
                selected.append(groups[category][district].pop(0))
                district_counts[district] += 1
    return dict(schema_version=1, sampling='deterministic_equal_proxy_strata_then_district_round_robin',
        statistical_representativeness='not_claimed; purposive stress-test sample',
        strata_are_physical_type_verification=False, population_sites=len(rows),
        sample_sites=len(selected), sample_building_memberships=sum(len(s['member_building_ids']) for s in selected),
        population_proxy_strata=dict(Counter(r['proxy_stratum'] for r in rows)),
        sample_proxy_strata=dict(Counter(r['proxy_stratum'] for r in selected)),
        sample_districts=dict(Counter(r['district'] for r in selected)), sites=selected)


def legacy_baseline(run_root):
    rows = []
    for path in sorted(Path(run_root).glob('*/worker-*/result.json')):
        value = json.loads(path.read_text())
        elapsed = value.get('elapsed_seconds')
        if not isinstance(elapsed, (int, float)):
            continue
        rows.append(dict(path=str(path), state=value.get('state'), elapsed_seconds=elapsed,
            candidate_attempts=value.get('count', 1),
            model_token_usd=value.get('estimated_token_usd')))
    costs = [r['model_token_usd'] for r in rows if isinstance(r['model_token_usd'], (int,float))]
    return dict(comparison_scope='historical_mixed_workloads_not_controlled_baseline',
        attempts_with_timing=len(rows), candidate_attempts=sum(r['candidate_attempts'] for r in rows),
        submitted_worker_results=sum(r['state']=='submitted' for r in rows),
        mean_worker_seconds=statistics.mean(r['elapsed_seconds'] for r in rows) if rows else None,
        median_worker_seconds=statistics.median(r['elapsed_seconds'] for r in rows) if rows else None,
        measured_model_token_usd=sum(costs) if costs else None, cost_rows=len(costs),
        costs_exclude='unreported tool/search fees, hosting, independent validation',
        verified_occupants=None, quality_comparison='unknown', rows=rows)


def summarize_measurements(rows, manifest):
    """Input rows: site_id, elapsed_seconds, cost_usd, capture_failures,
    predicted_occupants:[stable reference names/IDs], unsupported_claims (if labeled).
    Missing fields remain unknown. Every sample site needs a recorded outcome.
    """
    refs = {s['site_id']: s for s in manifest['sites']}
    by_id = {}
    for row in rows:
        sid = row['site_id']
        if sid not in refs or sid in by_id:
            raise ValueError('Unknown or duplicate evaluation site')
        by_id[sid] = row
    metrics = {}
    for name in ('elapsed_seconds','cost_usd','capture_failures','unsupported_claims'):
        values = [r[name] for r in rows if isinstance(r.get(name), (int,float)) and not isinstance(r.get(name), bool)]
        if any(v < 0 for v in values):
            raise ValueError('Negative measurement')
        metrics[name] = dict(observed_rows=len(values), total=sum(values) if values else None,
                            all_sample_sites_measured=len(values)==len(refs))
    labeled = []
    for sid,row in by_id.items():
        expected = refs[sid].get('expected_current_occupants')
        if (refs[sid].get('reference_review_status') != 'independently_labeled'
                or not isinstance(expected,list) or not isinstance(row.get('predicted_occupants'),list)):
            continue
        truth, predicted = set(expected), set(row['predicted_occupants'])
        labeled.append(dict(site_id=sid, correct=len(truth & predicted),
            missed=len(truth-predicted), false_matches=len(predicted-truth)))
    return dict(sample_sites=len(refs), recorded_sites=len(rows), missing_sites=sorted(set(refs)-set(by_id)),
        metrics=metrics, independently_labeled_sites=len(labeled),
        missed_occupants=sum(r['missed'] for r in labeled) if labeled else None,
        false_matches=sum(r['false_matches'] for r in labeled) if labeled else None,
        correctly_matched_occupants=sum(r['correct'] for r in labeled) if labeled else None,
        quality_scope='independently_labeled_subset_only' if labeled else 'unknown_no_reference_truth')


def compare(manifest, legacy_rows, redesigned_rows):
    legacy = summarize_measurements(legacy_rows, manifest)
    redesigned = summarize_measurements(redesigned_rows, manifest)
    return dict(schema_version=1, legacy=legacy, redesigned=redesigned,
        same_sample_fully_measured=not legacy['missing_sites'] and not redesigned['missing_sites'],
        quality_equivalence_established=False,
        note='No automatic quality-equivalence claim. Review independently labeled misses and false matches before rollout.')


def run_measurements(report):
    """Accept either measurement rows or a worker batch's results list.

    Do not infer occupants from a success state or count unsupported claims as zero.
    """
    rows = report if isinstance(report,list) else report.get('results',[])
    return [dict(site_id=r['site_id'], elapsed_seconds=r.get('elapsed_seconds'),
        cost_usd=r.get('cost_usd'), capture_failures=r.get('capture_failures'),
        unsupported_claims=r.get('unsupported_claims'),
        predicted_occupants=r.get('predicted_occupants')) for r in rows if r.get('site_id')]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--db', type=Path)
    inputs.add_argument('--sample', type=Path, help='Reuse a saved independently labeled sample')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--legacy-runs', type=Path)
    parser.add_argument('--count', type=int, default=50)
    parser.add_argument('--legacy-measurements', type=Path)
    parser.add_argument('--redesigned-measurements', type=Path)
    args = parser.parse_args()
    manifest = (json.loads(args.sample.read_text()) if args.sample else
                make_manifest(read_sites(args.db),args.count))
    args.output.mkdir(parents=True,exist_ok=True)
    destination=args.output/'sample.json'
    if destination.exists() and json.loads(destination.read_text()) != manifest:
        raise ValueError('Refusing to overwrite a different or independently labeled sample')
    destination.write_text(json.dumps(manifest,indent=2)+'\n')
    if args.legacy_runs:
        (args.output/'historical-baseline.json').write_text(json.dumps(legacy_baseline(args.legacy_runs),indent=2)+'\n')
    measurements = [dict(site_id=s['site_id'], elapsed_seconds=None,cost_usd=None,
        capture_failures=None,unsupported_claims=None,predicted_occupants=None) for s in manifest['sites']]
    (args.output/'measurement-template.json').write_text(json.dumps(measurements,indent=2)+'\n')
    if args.legacy_measurements or args.redesigned_measurements:
        result = compare(manifest,
            run_measurements(json.loads(args.legacy_measurements.read_text())) if args.legacy_measurements else [],
            run_measurements(json.loads(args.redesigned_measurements.read_text())) if args.redesigned_measurements else [])
        (args.output/'comparison.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in manifest.items() if k!='sites'},indent=2))


if __name__=='__main__':
    main()
