"""Focused evidence review and publication of separate coordinate research context.

No main database writes, no geometry repair, and no canonical place reassignment.
Review signatures are transparent checksum-based agent attestations, not a human
or certificate-based digital signature.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from types import SimpleNamespace

from .geography import resolve_geography, municipality_for
from .spatial_context import _hash, _save, _now, _require_space, NAMESPACE


def _safe(value):
    return "'" + value if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@', '\t', '\r')) else value


def _city(value):
    # Draft CSV neutralises spreadsheet formulas. Undo exactly that export prefix
    # when resolving the original locality; never change the published raw field.
    return value[1:] if value.startswith("'") and value[1:].lstrip().startswith(('=', '+', '-', '@', '\t', '\r')) else value


def _context_status(status, comparison, coordinate_conflict=False):
    if coordinate_conflict or status.startswith('ambiguous') or comparison == 'conflict':
        return 'geography_review_required'
    if status == 'single_polygon_context':
        return 'reviewed_derived_coordinate_research_context'
    return 'unknown_against_selected_polygon_scope'


def _small_csv(path, rows):
    if not rows:
        return
    with Path(path).open('w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        for row in rows:
            writer.writerow({k: _safe(json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v) for k, v in row.items()})


def exhaustive_point_check(features, x, y):
    """Independent simple full scan, with no STRtree or prepared geometries."""
    import math
    from shapely.geometry import Point, shape, box
    if not all(isinstance(v, (float, int)) and math.isfinite(v) for v in (x, y)) or not (-180 <= x <= 180 and -90 <= y <= 90):
        return {'status': 'unknown_invalid_reported_coordinate', 'municipality_code': None, 'candidate_codes': []}
    point = Point(x, y)
    covers, interiors, invalid = set(), set(), set()
    boundary = False
    for feature in features:
        geom = shape(feature['geometry'])
        code = str(feature['properties']['MUNID'])
        if not geom.is_valid or geom.is_empty:
            if not geom.is_empty and box(*geom.bounds).covers(point):
                invalid.add(code)
            continue
        if geom.covers(point):
            covers.add(code)
            inside = geom.contains(point)
            if inside:
                interiors.add(code)
            boundary |= not inside
    if invalid:
        return {'status': 'ambiguous_invalid_source_geometry', 'municipality_code': None, 'candidate_codes': sorted(covers | invalid)}
    if len(covers) > 1:
        status = 'ambiguous_overlapping_municipalities' if len(interiors) > 1 else 'ambiguous_shared_boundary'
    elif boundary and covers:
        status = 'ambiguous_shared_boundary'
    elif covers:
        return {'status': 'single_polygon_context', 'municipality_code': next(iter(covers)), 'candidate_codes': sorted(covers)}
    else:
        status = 'unknown_no_selected_polygon_hit'
    return {'status': status, 'municipality_code': None, 'candidate_codes': sorted(covers)}


def publish_reviewed_context(database, polygon_folder, derived_folder, *, reviewer, authorization, min_free_bytes=1073741824):
    if not reviewer or not authorization:
        raise ValueError('An explicit reviewer and root publication authorization are required')
    polygons, folder = Path(polygon_folder), Path(derived_folder)
    _require_space(folder, min_free_bytes)
    summary_path = folder / 'spatial-context-summary.json'
    summary = json.loads(summary_path.read_text())
    source = json.loads((polygons / 'polygon-source.json').read_text())
    scope = json.loads((polygons / 'municipality-scope.json').read_text())
    geo_path = polygons / source['geojson_path']
    draft = folder / summary['draft_csv']
    if source['status'] != 'completed' or _hash(geo_path) != source['geojson_sha256'] or _hash(draft) != summary['draft_csv_sha256']:
        raise ValueError('Draft or official polygon evidence checksum mismatch')
    page_receipts = []
    features = json.loads(geo_path.read_text())['features']
    ids = {f['properties'][source['object_id_field']] for f in features}
    inventory = json.loads((polygons / 'polygon-ids.json').read_text())['objectIds']
    count = json.loads((polygons / 'polygon-count.json').read_text())['count']
    extent = json.loads((polygons / 'projected-extent.json').read_text())['extent']['spatialReference']
    if len(features) != count or len(ids) != count or ids != set(inventory) or not (extent.get('wkid') == 4326 or extent.get('latestWkid') == 4326):
        raise ValueError('Official polygon count, unique IDs or projection do not reconcile')
    codes = {str(f['properties']['MUNID']) for f in features}
    if codes != set(scope['municipalities']) or len(codes) != source['selected_municipality_count']:
        raise ValueError('Official polygon MUNID inventory differs from scope')
    for page in source['raw_pages']:
        actual = _hash(polygons / page['path'])
        if actual != page['sha256']:
            raise ValueError('Official raw polygon page checksum mismatch')
        page_receipts.append({'path': page['path'], 'sha256': actual})
    input_receipts = []
    for receipt in summary['inputs']:
        if _hash(receipt['rows_path']) != receipt['compressed_sha256']:
            raise ValueError('Frozen source compressed checksum mismatch')
        manifest = json.loads(Path(receipt['manifest']).read_text())
        if not manifest.get('lossless_compression_verified') or manifest['rows_sha256'] != receipt['uncompressed_sha256'] or manifest['metadata']['fetched_count'] != receipt['rows']:
            raise ValueError('Frozen source lossless verification/count receipt mismatch')
        input_receipts.append({'manifest': receipt['manifest'], 'manifest_sha256': _hash(receipt['manifest']), 'compressed_sha256': receipt['compressed_sha256'],
            'uncompressed_sha256_verified_during_derivation': receipt['uncompressed_sha256'], 'rows': receipt['rows']})
    # Only the small owned derived scratch and main geography tables are read.
    work = sqlite3.connect((folder / 'spatial-context-working.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
    work.row_factory = sqlite3.Row
    samples = {}
    for column in ['scope_status', 'comparison']:
        for group in work.execute(f'SELECT DISTINCT {column} FROM points WHERE observations>0'):
            for row in work.execute(f'SELECT * FROM points WHERE observations>0 AND {column}=? ORDER BY gers LIMIT 3', (group[0],)):
                samples[row['gers']] = dict(row)
    for city in ['Georgetown', 'Acton', 'Port Perry', 'Bowmanville', 'Thornhill', 'Oakland']:
        for row in work.execute('SELECT * FROM points WHERE observations>0 AND city=? ORDER BY gers LIMIT 2', (city,)):
            samples[row['gers']] = dict(row)
    work.close()
    point_receipts = []
    for row in samples.values():
        checked = exhaustive_point_check(features, row['x'], row['y'])
        if checked['status'] != row['scope_status'] or checked['municipality_code'] != row['assigned_code'] or checked['candidate_codes'] != json.loads(row['candidates']):
            raise ValueError('Independent sampled point check differs from draft: ' + row['gers'])
        point_receipts.append({'gers': row['gers'], 'reported_longitude': row['x'], 'reported_latitude': row['y'], 'publisher_locality': row['city'], **checked})
    # Sample exact source-line bytes independently, grouping scans by input gzip.
    wanted = defaultdict(dict)
    for row in list(samples.values())[:8]:
        wanted[row['input_index']][row['line_number']] = row
    source_line_receipts = []
    for input_index, targets in wanted.items():
        receipt = summary['inputs'][input_index]
        with gzip.open(receipt['rows_path'], 'rb') as handle:
            for lineno, line in enumerate(handle, 1):
                if lineno in targets:
                    expected = targets[lineno]
                    raw = json.loads(line)
                    if hashlib.sha256(line).hexdigest() != expected['row_hash'] or str(raw['source_record_id']) != expected['gers'] or (raw.get('longitude'), raw.get('latitude')) != (expected['x'], expected['y']):
                        raise ValueError('Sampled exact original source line differs')
                    source_line_receipts.append({'manifest': receipt['manifest'], 'line_number': lineno, 'gers': expected['gers'], 'sha256': expected['row_hash']})
                if lineno >= max(targets):
                    break
    db = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    store = SimpleNamespace(db=db)
    names = {r['id']: r['name'] for r in db.execute('SELECT id,name FROM geographies')}
    cache, changes = {}, Counter()
    status_counts, context_counts, comparisons, muni_counts = Counter(), Counter(), Counter(), Counter()
    unresolved, conflicts, review_counts = Counter(), Counter(), Counter()
    cross_counts = Counter()
    unique = observations = 0
    research = folder / 'reported-coordinate-context.research.csv.gz'
    temp = folder / 'reported-coordinate-context.research.csv.gz.tmp'
    with gzip.open(draft, 'rt', encoding='utf-8', newline='') as inp, temp.open('wb') as rawout:
        with gzip.GzipFile(filename='', fileobj=rawout, mode='wb', mtime=0, compresslevel=5) as gzout:
            with io.TextIOWrapper(gzout, encoding='utf-8', newline='') as out:
                reader = csv.DictReader(inp)
                writer = csv.DictWriter(out, fieldnames=reader.fieldnames + ['context_status', 'context_review_artifact'])
                writer.writeheader()
                for row in reader:
                    city = _city(row['publisher_locality'])
                    if city not in cache:
                        cache[city] = municipality_for(store, resolve_geography(store, city))
                    publisher = cache[city]
                    assigned = row['reported_coordinate_municipality_id']
                    status = row['reported_coordinate_scope_status']
                    duplicate_conflict = row['source_coordinate_conflict'] == 'True'
                    comparison = ('inconclusive_duplicate_reported_coordinates' if duplicate_conflict else 'publisher_locality_unresolved' if not publisher else 'agrees' if assigned == publisher else 'conflict' if assigned else 'inconclusive_no_unique_spatial_context')
                    if (row['publisher_locality_municipality_id'], row['publisher_locality_comparison']) != (publisher or '', comparison):
                        changes[city] += 1
                    row['publisher_locality_municipality_id'] = publisher or ''
                    row['publisher_locality_municipality_name'] = names.get(publisher, '')
                    row['publisher_locality_comparison'] = comparison
                    row['needs_geography_review'] = duplicate_conflict or status.startswith('ambiguous') or comparison in {'conflict', 'publisher_locality_unresolved'}
                    row['context_status'] = _context_status(status, comparison, duplicate_conflict)
                    row['context_review_artifact'] = 'coordinate-context-review.json'
                    if row['canonical_values_overwritten'] != 'False' or row['business_or_occupancy_verified'] != 'False':
                        raise ValueError('Draft implies canonical modification or occupancy verification')
                    numeric_fields = {'reported_longitude', 'reported_latitude', 'input_line_number', 'observation_count'}
                    writer.writerow({k: v if k in numeric_fields else _safe(v) for k, v in row.items()})
                    unique += 1
                    observations += int(row['observation_count'])
                    status_counts[status] += 1
                    context_counts[row['context_status']] += 1
                    comparisons[comparison] += 1
                    cross_counts[(status, comparison)] += 1
                    code = row['reported_coordinate_municipality_official_id']
                    if assigned:
                        muni_counts[code] += 1
                        if not publisher:
                            unresolved[(city, code)] += 1
                            review_counts[code] += 1
                        if comparison == 'conflict':
                            conflicts[(city, names.get(publisher, ''), code)] += 1
    db.close()
    if unique != summary['unique_gers'] or observations != summary['input_observations'] or dict(status_counts) != summary['scope_status_counts']:
        raise ValueError('Research refresh changed geometric/identity/observation counts')
    temp.replace(research)
    # Compact MUNID crosswalk is explicit about the identifier namespace.
    grouped = defaultdict(list)
    for f in features:
        grouped[str(f['properties']['MUNID'])].append(f['properties'])
    invalid_codes = {r['munid'] for r in summary['invalid_source_geometries']}
    crosswalk = []
    for code, target in sorted(scope['municipalities'].items()):
        props = grouped[code]
        official = NAMESPACE + code
        crosswalk.append({'geography_id': target['geography_id'], 'configured_municipality': target['name'], 'ontario_lio_munid': code,
            'official_id': official, 'statcan_csduid': None, 'publisher_full_name': sorted({p['MUNICIPAL_NAME'] for p in props}),
            'polygon_feature_count': len(props), 'has_invalid_source_geometry': code in invalid_codes,
            'unique_reported_coordinate_contexts': muni_counts[official], 'unresolved_publisher_locality_contexts_for_review': review_counts[official],
            'boundary_effective_dates': source['municipality_effective_dates'].get(code, []), 'source_url': source['source_url'], 'polygon_sha256': source['geojson_sha256']})
    _save(folder / 'municipality-context-crosswalk.json', crosswalk)
    _small_csv(folder / 'municipality-context-crosswalk.csv', crosswalk)
    def label(official):
        return scope['municipalities'].get(official.removeprefix(NAMESPACE), {}).get('name', '')
    unresolved_rows = [{'publisher_locality': c, 'reported_coordinate_municipality': label(code), 'official_id': code, 'gers_count': n,
        'decision': 'derived_scope_context_only; locality/source verification remains pending'} for (c, code), n in unresolved.most_common()]
    conflict_rows = [{'publisher_locality': c, 'resolved_publisher_municipality': pub, 'reported_coordinate_municipality': label(code), 'official_id': code, 'gers_count': n,
        'decision': 'review postal/locality naming versus source coordinate; no canonical reassignment'} for (c, pub, code), n in conflicts.most_common()]
    _save(folder / 'scope-locality-review-groups.json', unresolved_rows)
    _save(folder / 'publisher-coordinate-conflict-groups.json', conflict_rows)
    _small_csv(folder / 'scope-locality-review-groups.csv', unresolved_rows)
    _small_csv(folder / 'publisher-coordinate-conflict-groups.csv', conflict_rows)
    # Envelope/polygon intersection flags a possible capped-source lane only.
    from shapely.geometry import shape, box
    source_caps = []
    for receipt in summary['inputs']:
        manifest = json.loads(Path(receipt['manifest']).read_text())
        metadata = manifest['metadata']
        if metadata.get('source_query_exhausted') is True and metadata.get('status') == 'completed':
            continue
        bbox = manifest.get('source', {}).get('bbox')
        affected = set()
        if bbox:
            envelope = box(*bbox)
            for f in features:
                geom = shape(f['geometry'])
                # Invalid polygons give only a conservative bounding-box flag.
                geometry = geom if geom.is_valid else box(*geom.bounds)
                if not geometry.is_empty and geometry.intersects(envelope):
                    affected.add(str(f['properties']['MUNID']))
        source_caps.append({'manifest': receipt['manifest'], 'collection_scope': manifest['source'].get('collection_scope'),
            'status': metadata.get('status'), 'source_query_exhausted': metadata.get('source_query_exhausted'), 'accepted_observations': metadata['fetched_count'],
            'limits': metadata.get('limits'), 'bbox': bbox, 'potentially_intersecting_municipality_munids': sorted(affected),
            'potentially_intersecting_municipalities': [scope['municipalities'][c]['name'] for c in sorted(affected)],
            'interpretation': 'Envelope intersects selected polygons; neither exhausted sibling queries nor overlaps establish municipal/business census completeness.'})
    _save(folder / 'source-cap-municipality-review.json', source_caps)
    _small_csv(folder / 'source-cap-municipality-review.csv', source_caps)
    lanes = [
        {'priority': 1, 'lane': 'official_geometry_quality', 'municipalities': [scope['municipalities'][c]['name'] for c in invalid_codes], 'reason': 'Invalid retrieved source geometry prevents safe unique municipality assignment; acquire an independently published valid official boundary version, preserving this receipt.', 'affected_unique_contexts': status_counts['ambiguous_invalid_source_geometry']},
        {'priority': 2, 'lane': 'unresolved_locality_scope_review', 'reason': 'Unique reported-coordinate context can route research without changing raw publisher locality or verifying occupancy.', 'affected_unique_contexts': sum(unresolved.values()), 'top_groups': unresolved_rows[:20], 'source_families': ['municipal_business_directory', 'business_improvement_area', 'industrial_park_directory', 'property_tenant_directory', 'corporate_branch_locator']},
        {'priority': 3, 'lane': 'publisher_coordinate_conflict_review', 'reason': 'Resolve postal/locality naming and provider coordinate discrepancies using explicit address/property evidence before any canonical change.', 'affected_unique_contexts': sum(conflicts.values()), 'top_groups': conflict_rows[:20]},
        {'priority': 4, 'lane': 'capped_source_and_independent_source_expansion', 'source_cap_artifact': 'source-cap-municipality-review.json', 'partial_collections': len(source_caps), 'reason': 'Prioritize licensed municipal lists, commercial parcels, BIA/industrial park rosters, mall/property tenants, installer and appliance dealer lists, and corporate branch locators; keep each source traversal and physical-location claim separate.'}]
    _save(folder / 'prioritized-next-source-lanes.json', lanes)
    review = {'status': 'reviewed_coordinate_research_context', 'reviewed_at': _now(), 'reviewer': reviewer, 'authorization': authorization,
        'attestation_type': 'checksum_anchored_agent_review; not a human signature or certificate-based digital signature',
        'research_csv': research.name, 'research_csv_sha256': _hash(research), 'draft_csv_sha256': summary['draft_csv_sha256'],
        'original_summary_sha256': _hash(summary_path), 'polygon_geojson_sha256': source['geojson_sha256'], 'raw_polygon_pages_verified': page_receipts,
        'polygon_feature_count': count, 'selected_municipality_count': len(codes), 'output_crs': 'EPSG:4326', 'frozen_inputs_verified': input_receipts,
        'focused_independent_exhaustive_point_checks': point_receipts, 'focused_original_source_line_checks': source_line_receipts,
        'unique_gers': unique, 'input_observations': observations, 'scope_status_counts': dict(status_counts), 'context_status_counts': dict(context_counts),
        'publisher_locality_comparisons': dict(comparisons), 'scope_comparison_counts': [{'scope_status': s, 'comparison': c, 'gers_count': n} for (s, c), n in cross_counts.items()],
        'publisher_comparison_refresh_changes': dict(changes), 'unique_coordinate_contexts_with_unresolved_publisher_locality': sum(unresolved.values()),
        'invalid_source_geometries': summary['invalid_source_geometries'], 'source_caps': len(source_caps), 'canonical_database_mutated': False,
        'canonical_values_overwritten': 0, 'is_business_or_occupancy_verification': False,
        'limitations': ['Provider coordinates are reported and unverified.', 'Selected official polygons are a versioned research reference, not a complete Ontario extent.', 'No hit is unknown in this selected scope, never outside Ontario.', 'An invalid source polygon makes all intersecting bbox points ambiguous; no repair was applied.', 'Publisher locality can be postal/community nomenclature; conflict does not by itself prove an error.', 'Every original source/canonical account remains unchanged; there is no inferred market coverage percentage.']}
    review['attestation_payload_sha256'] = hashlib.sha256(json.dumps(review, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    _save(folder / 'coordinate-context-review.json', review)
    return {k: review[k] for k in ['status', 'research_csv', 'research_csv_sha256', 'unique_gers', 'input_observations', 'scope_status_counts', 'publisher_locality_comparisons', 'publisher_comparison_refresh_changes', 'unique_coordinate_contexts_with_unresolved_publisher_locality', 'source_caps']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--polygons', type=Path, required=True)
    parser.add_argument('--derived', type=Path, required=True)
    parser.add_argument('--reviewer', required=True)
    parser.add_argument('--authorization', required=True)
    args = parser.parse_args()
    print(json.dumps(publish_reviewed_context(args.database, args.polygons, args.derived, reviewer=args.reviewer, authorization=args.authorization)), flush=True)


if __name__ == '__main__':
    main()
