"""Frozen Toronto inspection and BIA-boundary observations as raw context only.

There is deliberately no organisation/site/people/relationship creation route.
Native object IDs identify source observations, not businesses or occupancies.
The complete CSV and publisher row types survive without interpreting events
as company identities. This module performs no network activity.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
from pathlib import Path

from .factual_promotion import member_path, sha
from .place_import import _guard_storage, _committed_batch
from .transport import SourceBlocked

CONFIG = Path(__file__).parent / 'config/completed-toronto-context-promotions.json'
VERSION = 'toronto-observation-context-only/2026-10-27.1'
SOURCE_IDS = {'dinesafe': 'toronto-dinesafe', 'bodysafe': 'toronto-bodysafe',
              'business-improvement-areas': 'toronto-business-improvement-areas'}


def prepare_context(folder):
    folder = Path(folder)
    if folder.name not in SOURCE_IDS: raise SourceBlocked('Unreviewed context-only source cohort')
    spec = json.loads(CONFIG.read_text())['cohorts'][folder.name]
    primary = member_path(folder, 'manifest.json')
    if sha(primary) != spec['primary_manifest_sha256']:
        raise SourceBlocked('Context source primary snapshot differs')
    manifest = json.loads(primary.read_text())
    if (manifest.get('dataset') != folder.name or manifest.get('source_id') != SOURCE_IDS[folder.name]
        or manifest.get('status') != 'acquired_complete' or manifest.get('source_inventory_exhausted') is not True
        or manifest.get('rights_status') != 'licensed_open' or not manifest.get('observed_at')):
        raise SourceBlocked('Context source identity/completion/licence/observation scope differs')
    for file, expected in spec['files'].items():
        if sha(member_path(folder, file)) != expected:
            raise SourceBlocked('Context original/rights/count artifact differs: ' + file)
    path = member_path(folder, manifest['raw_file'])
    if sha(path) != manifest['raw_gzip_sha256']:
        raise SourceBlocked('Context whole-source gzip checksum differs')
    body = gzip.open(path, 'rb').read()
    if len(body) != manifest['original_bytes'] or hashlib.sha256(body).hexdigest() != manifest['original_sha256']:
        raise SourceBlocked('Context original publisher CSV bytes differ')
    # The licensed BIA source includes large polygon geometry cells. Match its
    # documented CSV parser bound rather than truncating a source feature.
    csv.field_size_limit(10000000)
    reader = csv.DictReader(io.StringIO(body.decode('utf-8-sig')))
    if reader.fieldnames != manifest['headers']:
        raise SourceBlocked('Context native source column schema differs')
    keys, rows = set(), []
    for ordinal, original in enumerate(reader, 1):
        key = original.get('_id')
        if not key or key in keys or None in original:
            raise SourceBlocked('Context publisher native object ID/schema missing or duplicated')
        keys.add(key)
        rows.append({'source_record_id': key, 'source_url': manifest['source_url'],
                     'observed_at': manifest['observed_at'], 'source_published_at': None,
                     'source_resource_last_modified': (manifest.get('resource') or {}).get('last_modified'),
                     'source_record_id_basis': 'Publisher native _id identifies an observation, not a company',
                     'record_unit': manifest['record_unit'], 'source_row_ordinal': ordinal,
                     'original_publisher_csv_row': original,
                     'original_manifest_sha256': spec['primary_manifest_sha256'],
                     'original_csv_sha256': manifest['original_sha256'],
                     'original_gzip_sha256': manifest['raw_gzip_sha256'],
                     'source_geometry_crs': manifest.get('geometry_crs_publisher_resource_label'),
                     'canonical_organisation_or_site_created': False})
    ids_hash = hashlib.sha256(('\n'.join(sorted(keys)) + '\n').encode()).hexdigest()
    if (len(rows) != manifest['raw_rows'] or len(rows) != manifest['reported_row_count']
        or len(keys) != manifest['native_object_ids'] or ids_hash != manifest['native_id_sorted_sha256']):
        raise SourceBlocked('Context entire native object-ID/count inventory does not reconcile')
    source = {'id': manifest['source_id'], 'name': 'City of Toronto ' + manifest['dataset'],
              'publisher': 'City of Toronto', 'source_url': manifest['source_url'], 'source_type': manifest['family'],
              'rights_status': 'licensed_open', 'terms_url': manifest['licence_url'], 'attribution': manifest['attribution'],
              'source_date': None, 'last_checked_at': manifest['observed_at'], 'adapter_name': 'toronto_raw_context_only',
              'config': {'original_manifest_sha256': spec['primary_manifest_sha256'], 'record_unit': manifest['record_unit'],
                         'native_record_ids_are_not_organisation_ids': True, 'no_organisation_site_or_people_creation': True,
                         'source_inventory_exhausted': True, 'market_coverage_complete': False,
                         'resource_last_modified_is_not_claimed_publication_date': (manifest.get('resource') or {}).get('last_modified')}}
    return spec, manifest, source, rows


def apply_context_acquisition(store, folder, *, batch_size=500, progress=None):
    if not 1 <= batch_size <= 1000: raise ValueError('Use 1–1000 observation rows per atomic batch')
    spec, manifest, source, rows = prepare_context(folder)
    context = {'source_folder': str(folder), 'source_id': source['id'], 'area': manifest['dataset'], 'chunk': 'preflight'}
    _guard_storage(store, rows[:batch_size], context)
    source_id = store.upsert_source(source)
    summary = {'source_id': source_id, 'processed_raw_observations': 0, 'new_raw_observations': 0,
               'replayed_batches': 0, 'organisations_created': 0, 'locations_created': 0,
               'people_or_contacts_created': 0, 'relationships_created': 0, 'unique_company_count': None}
    for start in range(0, len(rows), batch_size):
        chunk = rows[start:start + batch_size]
        metadata = {'batch_id': spec['primary_manifest_sha256'] + ':' + str(start),
                    'observed_at': manifest['observed_at'], 'parser_version': VERSION,
                    'adapter_name': source['adapter_name'], 'expected_count': len(rows),
                    'acquisition_id': 'toronto-context:' + spec['primary_manifest_sha256'],
                    'record_unit': manifest['record_unit'], 'source_inventory_exhausted': True,
                    'coverage_complete': False, 'canonical_company_candidates': 0,
                    **{key: (manifest.get('metrics') or {}).get(key, 0) if start == 0 else 0
                       for key in ['requests', 'bytes_fetched', 'elapsed_seconds', 'estimated_cost']}}
        if not _committed_batch(store, source_id, [], metadata):
            _guard_storage(store, chunk, {**context, 'chunk': start // batch_size})
        with store.transaction():
            result = store.ingest(source_id, [], run_metadata=metadata)
            if not result.get('replayed'):
                for row in chunk:
                    evidence_id = store.record_evidence(source_id, row, row['source_url'], row['observed_at'],
                        run_id=result['run_id'], source_record_id=row['source_record_id'],
                        excerpt='Publisher ' + manifest['record_unit'] + '; raw context only, no company/site/occupancy inference')
                    raw = store.db.execute('SELECT r.id,r.payload_hash FROM raw_records r JOIN evidence e ON e.raw_record_id=r.id WHERE e.id=?', (evidence_id,)).fetchone()
                    store.db.execute('INSERT OR IGNORE INTO source_run_items VALUES(?,?,?,?,?,?,?)',
                        (result['run_id'], row['source_record_id'], raw['payload_hash'], raw['id'], None, None, 'raw_only_context_observation'))
                result.update(fetched_count=len(chunk), parsed_count=len(chunk), raw_only_count=len(chunk), candidate_count=0)
                store.db.execute('UPDATE source_runs SET fetched_count=?,parsed_count=?,result_json=? WHERE id=?',
                    (len(chunk), len(chunk), json.dumps(result, sort_keys=True), result['run_id']))
        summary['processed_raw_observations'] += len(chunk)
        summary['replayed_batches'] += int(bool(result.get('replayed')))
        if not result.get('replayed'): summary['new_raw_observations'] += len(chunk)
        if progress: progress({**summary, 'total': len(rows)})
    return summary
