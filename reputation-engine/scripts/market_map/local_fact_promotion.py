"""Reviewed source-specific promotion of completed local directory/member facts.

Only nine named frozen source schemas are accepted. Event/polygon feeds and
active/partial captures have no route here. Relationships remain raw source
claims for separate review; hidden addresses and unknown geography stay unknown.
"""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path

from .factual_promotion import member_path, normalize_selected_fact, sha
from .place_import import _guard_storage, _committed_batch
from .transport import SourceBlocked

CONFIG = Path(__file__).parent / 'config/completed-local-factual-promotions.json'
VERSION = 'completed-local-facts/2026-10-27.1'


def prepare_local(folder, kind):
    folder = Path(folder)
    specs = json.loads(CONFIG.read_text())['source_cohorts']
    if kind not in specs:
        raise SourceBlocked('Source has no reviewed completed local-facts adapter')
    spec = specs[kind]
    primary = member_path(folder, spec['primary_manifest'])
    if sha(primary) != spec['primary_manifest_sha256']:
        raise SourceBlocked('Local source primary manifest differs from reviewed snapshot')
    manifest = json.loads(primary.read_text())
    status = str(manifest.get('status') or '')
    if any(token in status.casefold() for token in ['partial', 'blocked', 'running', 'permission', 'restricted']):
        raise SourceBlocked('Local selected facts are not a completed eligible source snapshot')
    if manifest.get('source_id') != spec['source_id'] or manifest.get('source_inventory_exhausted') is not True:
        raise SourceBlocked('Local completed source identity/inventory scope differs')
    for file, expected in spec['snapshot_files'].items():
        if sha(member_path(folder, file)) != expected:
            raise SourceBlocked('Local original/rights/selected-fact artifact differs before mutations: ' + file)
    source = dict(spec['source_registration'])
    if source.get('id') != spec['source_id'] or source.get('rights_status') != spec['rights_status'] or spec['rights_status'] not in {'licensed_open', 'limited_factual_review_only'}:
        raise SourceBlocked('Local source registry/reuse status differs')
    if spec.get('preferred_pointer'):
        pointer = spec['preferred_pointer']
        if sha(member_path(folder, pointer['file'])) != pointer['sha256']:
            raise SourceBlocked('Preferred parser/snapshot-qualified identity pointer differs')
    rows, identifiers = [], set()
    for record_file in spec['record_files']:
        path = member_path(folder, record_file['file'])
        if sha(path) != record_file['sha256']:
            raise SourceBlocked('Local selected facts checksum differs')
        with gzip.open(path, 'rb') as handle:
            for number, line in enumerate(handle, 1):
                if not line.strip(): continue
                original = json.loads(line)
                key = original.get('source_record_id')
                if not isinstance(key, str) or not key or key in identifiers:
                    raise SourceBlocked('Unique publisher/profile/snapshot-qualified record key missing or duplicated')
                if original.get('source_id') and original['source_id'] != spec['source_id']:
                    raise SourceBlocked('Selected row source namespace differs')
                if spec['identifier_policy'] == 'snapshot_qualified':
                    if 'snapshot' not in str(original.get('source_record_id_basis')).casefold() or key == original.get('original_source_position_key'):
                        raise SourceBlocked('Source snapshot position was incorrectly treated as persistent publisher identity')
                raw = original.get('raw_payload') or {}
                if kind == 'ajax_pickering' and raw.get('address_display_allowed') is False:
                    if any(original.get(field) is not None or raw.get(field) is not None for field in ['address', 'city', 'province', 'postal_code', 'latitude', 'longitude']):
                        raise SourceBlocked('Hidden publisher address/coordinates must never be restored or copied')
                identifiers.add(key)
                # Published source category labels retain their literal wording.
                adapted = dict(original)
                if not adapted.get('categories') and adapted.get('published_categories'):
                    adapted['categories'] = adapted['published_categories']
                if not adapted.get('categories') and adapted.get('published_category_text'):
                    adapted['categories'] = [adapted['published_category_text']]
                row, eligible = normalize_selected_fact(adapted, manifest_sha=spec['primary_manifest_sha256'],
                    row_file=path, row_file_sha=record_file['sha256'], line_number=number, line_sha=hashlib.sha256(line).hexdigest())
                # Preserve exact original selected source row before any category
                # projection or conservative site/context separation.
                row['raw_payload']['original_selected_source_observation'] = original
                rows.append((row, eligible))
    if len(rows) != spec['source_factual_rows']:
        raise SourceBlocked('Whole selected-fact row count differs from complete reviewed source snapshot')
    if kind == 'ajax_pickering':
        inventory = spec['raw_inventory_file']
        path = member_path(folder, inventory['file'])
        if sha(path) != inventory['sha256']:
            raise SourceBlocked('Public member-ID inventory checksum differs')
        inventory_rows = json.loads(path.read_text())
        if not isinstance(inventory_rows, list) or any(not isinstance(v, dict) or not isinstance(v.get('source_record_id'), str) for v in inventory_rows):
            raise SourceBlocked('Public member-ID inventory role schema differs')
        all_ids = [v['source_record_id'] for v in inventory_rows]
        if len(all_ids) != spec['all_source_rows_or_ids'] or len(set(all_ids)) != len(all_ids) or not identifiers.issubset(all_ids):
            raise SourceBlocked('Public company/individual member-ID partitions do not reconcile')
        held = sorted(set(all_ids) - identifiers)
        if any(v.get('record_disposition') != 'excluded_explicit_individual_member' for v in inventory_rows if v['source_record_id'] in held):
            raise SourceBlocked('Raw-only member partition is not explicitly individual-only')
        if len(held) != 2 or manifest.get('explicit_individual_members_excluded') != 2:
            raise SourceBlocked('Explicit individual-only exclusion partition differs')
        for key in held:
            original = {'source_record_id': key, 'name': None, 'source_url': manifest['source_url'],
                        'observed_at': manifest['observed_at'], 'source_record_id_basis': 'Publisher public member UUID',
                        'record_type': 'explicit_individual_member_excluded', 'name_copied': False,
                        'source_published_at': None, 'country': None}
            row, _ = normalize_selected_fact(original, manifest_sha=spec['primary_manifest_sha256'], row_file=path,
                row_file_sha=inventory['sha256'], line_number=None, line_sha=None)
            rows.append((row, False))
    if len(rows) != spec['all_source_rows_or_ids']:
        raise SourceBlocked('All-source factual/raw-only partitions do not reconcile')
    source['source_date'] = source.get('source_date') or None
    source['adapter_name'] = 'completed_local_facts_' + kind
    source['config'] = {**(source.get('config') or {}), 'original_manifest': str(primary),
                        'original_manifest_sha256': spec['primary_manifest_sha256'], 'source_inventory_exhausted': True,
                        'market_coverage_complete': False, 'top_level_relationships_are_unreviewed_raw_source_claims': True,
                        'no_named_people_or_contact_stage': True, 'public_redistribution_authorised': spec['rights_status'] == 'licensed_open'}
    return spec, manifest, source, rows


def apply_local_acquisition(store, folder, *, kind, batch_size=250, progress=None):
    """Explicit sole-writer local promotion, not invoked by acquisition modules."""
    if not 1 <= batch_size <= 1000: raise ValueError('Use1–1000row completed-fact batches')
    folder = Path(folder)
    spec, manifest, source, rows = prepare_local(folder, kind)
    _guard_storage(store, [row for row, _ in rows[:batch_size]], {'source_folder': str(folder), 'source_id': source['id'], 'area': kind, 'chunk': 'preflight'})
    observed = manifest.get('observed_at') or next((r.get('observed_at') for r, _ in rows if r.get('observed_at')), None)
    if not observed: raise SourceBlocked('Original capture timestamp missing; import time is not a substitute')
    source_id = store.upsert_source(source)
    metrics = manifest.get('metrics') or {key: manifest.get(key) for key in ['requests', 'bytes_fetched', 'elapsed_seconds']}
    summary = {'source_id': source_id, 'processed_source_rows': 0, 'candidate_rows': 0, 'raw_only_rows': 0,
               'new_organisations': 0, 'new_locations': 0, 'replayed_batches': 0, 'quarantined': 0,
               'unique_company_count': None, 'relationships_inserted': 0, 'named_people_or_contacts_inserted': 0}
    for start in range(0, len(rows), batch_size):
        chunk = rows[start:start + batch_size];candidates = [r for r, eligible in chunk if eligible]
        metadata = {'batch_id': spec['primary_manifest_sha256'] + ':' + str(start), 'observed_at': observed,
                    'adapter_name': source['adapter_name'], 'parser_version': VERSION + ':' + kind,
                    'acquisition_id': 'completed-source:' + spec['primary_manifest_sha256'],
                    'original_manifest_sha256': spec['primary_manifest_sha256'], 'expected_count': len(rows),
                    'source_inventory_exhausted': True, 'coverage_complete': False,
                    'historical_acquisition_meter_scope': 'Known primary manifest counters charged once; separately recorded shared discovery counters are not recharged here.',
                    **{key: (metrics.get(key) or 0) if start == 0 else 0 for key in ['requests', 'bytes_fetched', 'elapsed_seconds', 'estimated_cost']}}
        if not _committed_batch(store, source_id, candidates, metadata):
            _guard_storage(store, [r for r, _ in chunk], {'source_folder': str(folder), 'source_id': source_id, 'area': kind, 'chunk': start // batch_size})
        with store.transaction():
            result = store.ingest(source_id, candidates, run_metadata=metadata)
            if not result.get('replayed'):
                with store._buffer_field_assertions():
                    for row, eligible in chunk:
                        original = row['raw_payload']['original_selected_source_observation']
                        if not eligible:
                            eid = store.record_evidence(source_id, row['raw_payload'], row.get('source_url'), row.get('observed_at'), run_id=result['run_id'], source_record_id=row['source_record_id'], excerpt='Source row held raw-only: blank/malformed name or explicitly individual member; no invented organisation/site')
                            raw = store.db.execute('SELECT raw_record_id FROM evidence WHERE id=?', (eid,)).fetchone()[0]
                            raw_hash = store.db.execute('SELECT payload_hash FROM raw_records WHERE id=?', (raw,)).fetchone()[0]
                            store.db.execute('INSERT OR IGNORE INTO source_run_items VALUES(?,?,?,?,?,?,?)', (result['run_id'], row['source_record_id'], raw_hash, raw, None, None, 'raw_only_source_role_review'))
                            continue
                        identity = store.db.execute('SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?', (source_id, row['source_record_id'])).fetchone()
                        held = store.db.execute("SELECT 1 FROM source_run_items WHERE run_id=? AND source_record_id=? AND outcome='quarantined'", (result['run_id'], row['source_record_id'])).fetchone()
                        if not identity or held: continue
                        values = {key: original.get(key) for key in ['source_record_id_basis', 'record_type', 'source_reference_period',
                            'source_reported_legal_name', 'source_legal_name_verified', 'source_city_basis', 'collection_context_city',
                            'member_section', 'membership_independently_verified', 'association_membership_verified', 'coordinate_role',
                            'original_source_position_key', 'address_parse_status', 'source_record_reference']}
                        values.update({'source_listed_city_context': original.get('city'), 'physical_presence_verified': False,
                            'current_operation_verified': False, 'source_top_level_relationship_claims_pending_review': original.get('relationships'),
                            'source_map_coordinate_context': {'latitude': original.get('latitude'), 'longitude': original.get('longitude'), 'role': original.get('coordinate_role')},
                            'original_normalized_line_sha256': row['raw_payload']['original_normalized_line_sha256']})
                        if kind == 'ajax_pickering': values['publisher_address_display_allowed'] = (original.get('raw_payload') or {}).get('address_display_allowed')
                        for field, value in values.items():
                            store.assert_field(identity['organisation_id'], 'organisation', field, value, identity['last_evidence_id'], row['observed_at'], method='completed_local_source_fact_assertion', review_status='source_supported_unverified')
                result.update(fetched_count=len(chunk), parsed_count=len(chunk), raw_only_count=len(chunk) - len(candidates))
                store.db.execute('UPDATE source_runs SET fetched_count=?,parsed_count=?,result_json=? WHERE id=?', (len(chunk), len(chunk), json.dumps(result, sort_keys=True, ensure_ascii=False), result['run_id']))
        summary['processed_source_rows'] += len(chunk);summary['candidate_rows'] += len(candidates);summary['raw_only_rows'] += len(chunk) - len(candidates)
        summary['replayed_batches'] += int(bool(result.get('replayed')))
        if not result.get('replayed'):
            summary['new_organisations'] += result.get('inserted_count', 0);summary['new_locations'] += result.get('new_locations', 0);summary['quarantined'] += result.get('quarantined_count', 0)
        if progress: progress({**summary, 'total': len(rows)})
    return summary
