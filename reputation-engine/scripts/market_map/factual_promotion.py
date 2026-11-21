"""Source-specific local promotion of completed, licensed selected-fact snapshots.

No collector/network functions. Publisher profile IDs stay source scoped; map
parcels/coordinates remain source context. Raw rows and unprinted unknowns are
preserved. No relationships, named people, campaigns or CRM writes are inferred.
"""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path

from .place_import import _guard_storage, _committed_batch
from .transport import SourceBlocked

YORK_SOURCE = 'york-business-directory-2024'
YORK_MANIFEST_SHA256 = 'fd3082d1c02a9fe52f8d89706bc41b188d9701a579afc87b83f7ce1dbdd8178a'
YORK_EXPECTED_ROWS = 29863
YORK_EXPECTED_MUNICIPALITIES = 9
VERSION = 'completed-selected-facts/2026-10-27.1'


def sha(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def member_path(folder, name):
    path = Path(folder) / name
    if path.is_symlink() or not path.resolve().is_relative_to(Path(folder).resolve()) or not path.is_file():
        raise SourceBlocked('Snapshot file is missing, symlinked or outside its reviewed folder')
    return path


def checked_raw(folder, receipt):
    path = member_path(folder, receipt['file'])
    if sha(path) != receipt['gzip_sha256']:
        raise SourceBlocked('Original source gzip checksum differs before mutations')
    original = gzip.open(path, 'rb').read()
    if len(original) != receipt['original_bytes'] or hashlib.sha256(original).hexdigest() != receipt['original_sha256']:
        raise SourceBlocked('Original publisher bytes/hash differ before mutations')
    return path


def source_fragment(folder, source_id):
    value = json.loads(member_path(folder, 'source-registry-fragment.json').read_text())
    rows = value.get('sources', []) if isinstance(value, dict) else value
    sources = [row for row in rows if row.get('id') == source_id]
    if len(sources) != 1:
        raise SourceBlocked('Exactly one reviewed source registry entry required')
    return dict(sources[0])


def normalize_selected_fact(original, *, manifest_sha, row_file, row_file_sha, line_number, line_sha):
    """Do not turn coarse map context, missing address or legal-name claims into facts."""
    row = dict(original)
    if not isinstance(row.get('source_record_id'), str) or not row['source_record_id'].strip():
        raise SourceBlocked('Publisher source record identifier missing; source snapshot requires review')
    valid_name = isinstance(row.get('name'), str) and row['name'].strip() and row['name'].strip().casefold() not in {'none', 'null', 'nan'}
    row['country'] = row.get('country') or None
    row['province'] = row.get('province') or None
    # No named contact/channel stage is introduced by selected-fact promotion.
    # Original published business contact fields still survive in raw evidence.
    row['phone'] = row['email'] = None
    row['published_phones'] = row['published_emails'] = []
    address = row.get('address')
    if not isinstance(address, str) or not address.strip():
        row['address'] = None
        # All of these fields can trigger a core location candidate. A listed
        # locality/postcode or a coarse map point alone is not street evidence.
        for field in ['address_raw', 'street', 'unit', 'city', 'city_raw', 'postal_code', 'municipality_name']:
            row[field] = None
        row['municipality_id'] = None
    row['latitude'] = row['longitude'] = None
    row['location_type'] = 'source_reported_address_candidate' if row['address'] else None
    row['physical_presence_verified'] = row['legal_company_verified'] = row['current_operation_verified'] = False
    row['campaign_ready'] = False
    row['raw_payload'] = {'original_selected_source_observation': original,
                          'original_manifest_sha256': manifest_sha,
                          'original_normalized_file': str(row_file), 'original_normalized_file_sha256': row_file_sha,
                          'original_normalized_line': line_number, 'original_normalized_line_sha256': line_sha}
    return row, bool(valid_name)


def prepare_york(folder):
    folder = Path(folder)
    manifest_path = member_path(folder, 'manifest.json')
    manifest_sha = sha(manifest_path)
    if manifest_sha != YORK_MANIFEST_SHA256:
        raise SourceBlocked('York primary snapshot differs from reviewed frozen manifest')
    manifest = json.loads(manifest_path.read_text())
    if (manifest.get('source_id') != YORK_SOURCE or manifest.get('status') != 'completed'
        or manifest.get('rights_status') != 'licensed_open' or manifest.get('source_inventory_exhausted') is not True
        or manifest.get('raw_listing_appearances') != YORK_EXPECTED_ROWS
        or manifest.get('unique_profile_urls') != YORK_EXPECTED_ROWS
        or len(manifest.get('collections', [])) != YORK_EXPECTED_MUNICIPALITIES or manifest.get('blocked_or_partial')):
        raise SourceBlocked('York source status/licence/inventory/count scope differs')
    for file, expected in manifest['evidence_files'].items():
        if sha(member_path(folder, file)) != expected:
            raise SourceBlocked('York rights/publisher evidence checksum differs')
    source = source_fragment(folder, YORK_SOURCE)
    if source.get('rights_status') != 'licensed_open':
        raise SourceBlocked('York licensed source registry status differs')
    # A survey reference year is not a publication or observation timestamp.
    source['source_date'] = None
    source['adapter_name'] = 'completed_york_selected_facts'
    source['config'] = {**(source.get('config') or {}), 'source_inventory_exhausted': True,
                        'market_coverage_complete': False, 'original_manifest': str(manifest_path),
                        'original_manifest_sha256': manifest_sha, 'source_reference_period': manifest['reference_period'],
                        'publisher_map_parcels_are_not_company_ids': True,
                        'map_coordinates_are_context_not_verified_sites': True}
    rows, identifiers = [], set()
    for collection in manifest['collections']:
        if Path(collection['folder']).name != collection['folder']:
            raise SourceBlocked('York municipality snapshot folder differs')
        municipality_folder = folder / collection['folder']
        details = json.loads(member_path(municipality_folder, 'collection.json').read_text())
        if details.get('source_inventory_exhausted') is not True or details['reference_period'] != '2024 per page':
            raise SourceBlocked('York municipality period/completion differs')
        checked_raw(municipality_folder, details['index_raw'])
        checked_raw(municipality_folder, details['all_raw'])
        path = member_path(municipality_folder, details['records_file'])
        expected = details['records_sha256']
        if sha(path) != expected:
            raise SourceBlocked('York selected facts checksum differs')
        count = 0
        with gzip.open(path, 'rb') as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip(): continue
                original = json.loads(line)
                key = original.get('source_record_id')
                if not key or key != original.get('profile_url') or original.get('source_record_id_basis') != 'publisher_profile_url_not_parcel_id' or key in identifiers:
                    raise SourceBlocked('York unique profile-key namespace differs; parcel IDs cannot identify companies')
                identifiers.add(key)
                row, eligible = normalize_selected_fact(original, manifest_sha=manifest_sha, row_file=path,
                    row_file_sha=expected, line_number=line_number, line_sha=hashlib.sha256(line).hexdigest())
                rows.append((row, eligible))
                count += 1
        if count != details['raw_listing_appearances'] or count != collection['raw_listing_appearances'] or count != details['unique_profile_urls']:
            raise SourceBlocked('York municipality whole-file count does not reconcile')
    if len(rows) != YORK_EXPECTED_ROWS or len(identifiers) != YORK_EXPECTED_ROWS:
        raise SourceBlocked('York full nine-municipality source inventory does not reconcile')
    return manifest, source, rows


def apply_york_acquisition(store, folder, *, batch_size=250, progress=None):
    """Local-only source-specific promotion; caller must own the MAIN write window."""
    if not 1 <= batch_size <= 1000:
        raise ValueError('Use1–1000row selected-fact batches')
    folder = Path(folder)
    manifest, source, rows = prepare_york(folder)
    manifest_sha = sha(folder / 'manifest.json')
    _guard_storage(store, [r for r, _ in rows[:batch_size]], {'source_folder': str(folder), 'source_id': YORK_SOURCE, 'area': 'york-selected-facts', 'chunk': 'preflight'})
    source_id = store.upsert_source(source)
    summary = {'source_id': source_id, 'processed_source_rows': 0, 'candidate_rows': 0, 'raw_only_rows': 0,
               'new_organisations': 0, 'new_locations': 0, 'quarantined': 0, 'replayed_batches': 0,
               'original_source_observations': len(rows), 'unique_company_count': None}
    for start in range(0, len(rows), batch_size):
        chunk = rows[start:start + batch_size]
        candidates = [row for row, eligible in chunk if eligible]
        metadata = {'batch_id': manifest_sha + ':' + str(start), 'observed_at': manifest['observed_at'],
                    'adapter_name': source['adapter_name'], 'parser_version': VERSION + ':york2024',
                    'acquisition_id': 'york2024:' + manifest_sha, 'expected_count': len(rows),
                    'source_inventory_exhausted': True, 'coverage_complete': False,
                    'source_reference_period': manifest['reference_period'], 'original_manifest_sha256': manifest_sha,
                    **{k: (manifest.get('metrics', {}).get(k, 0) if start == 0 else 0) for k in ['requests', 'bytes_fetched', 'elapsed_seconds', 'estimated_cost']}}
        if not _committed_batch(store, source_id, candidates, metadata):
            _guard_storage(store, [row for row, _ in chunk], {'source_folder': str(folder), 'source_id': source_id, 'area': 'york-selected-facts', 'chunk': start // batch_size})
        with store.transaction():
            result = store.ingest(source_id, candidates, run_metadata=metadata)
            if not result.get('replayed'):
                with store._buffer_field_assertions():
                    for row, eligible in chunk:
                        original = row['raw_payload']['original_selected_source_observation']
                        if not eligible:
                            eid = store.record_evidence(source_id, row['raw_payload'], row.get('source_url'), row.get('observed_at'), run_id=result['run_id'], source_record_id=row['source_record_id'], excerpt='Published source row lacks usable business name; raw-only, no invented company/site')
                            raw = store.db.execute('SELECT raw_record_id FROM evidence WHERE id=?', (eid,)).fetchone()[0]
                            raw_hash = store.db.execute('SELECT payload_hash FROM raw_records WHERE id=?', (raw,)).fetchone()[0]
                            store.db.execute('INSERT OR IGNORE INTO source_run_items VALUES(?,?,?,?,?,?,?)', (result['run_id'], row['source_record_id'], raw_hash, raw, None, None, 'raw_only_name_review'))
                            store.add_review('source_name_missing', [], [eid], 'Published selected-fact row retained without an invented organisation')
                            continue
                        identity = store.db.execute('SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?', (source_id, row['source_record_id'])).fetchone()
                        quarantined = store.db.execute("SELECT 1 FROM source_run_items WHERE run_id=? AND source_record_id=? AND outcome='quarantined'", (result['run_id'], row['source_record_id'])).fetchone()
                        if not identity or quarantined: continue
                        values = {key: original.get(key) for key in ['source_record_id_basis', 'publisher_profile_filename_id',
                            'publisher_map_parcel_identifier', 'source_city_basis', 'source_taxonomy', 'publisher_category_code',
                            'source_reference_period', 'coordinate_role', 'street_view_point_role', 'record_type']}
                        values.update({'source_listed_city_context': original.get('city'), 'physical_presence_verified': False,
                            'legal_company_verified': False, 'current_operation_verified': False,
                            'source_map_context_coordinates': {'latitude': original.get('latitude'), 'longitude': original.get('longitude'),
                                'role': original.get('coordinate_role'), 'crs': 'publisher_CRS_metadata_not_supplied'},
                            'original_normalized_line_sha256': row['raw_payload']['original_normalized_line_sha256']})
                        for field, value in values.items():
                            store.assert_field(identity['organisation_id'], 'organisation', field, value, identity['last_evidence_id'], row['observed_at'], method='licensed_historical_york_source_assertion', review_status='source_supported_unverified')
                result.update(fetched_count=len(chunk), parsed_count=len(chunk), raw_only_count=len(chunk) - len(candidates))
                store.db.execute('UPDATE source_runs SET fetched_count=?,parsed_count=?,result_json=? WHERE id=?',
                    (len(chunk), len(chunk), json.dumps(result, sort_keys=True, ensure_ascii=False), result['run_id']))
        summary['processed_source_rows'] += len(chunk)
        summary['candidate_rows'] += len(candidates)
        summary['raw_only_rows'] += len(chunk) - len(candidates)
        summary['replayed_batches'] += int(bool(result.get('replayed')))
        if not result.get('replayed'):
            summary['new_organisations'] += result.get('inserted_count', 0)
            summary['new_locations'] += result.get('new_locations', 0)
            summary['quarantined'] += result.get('quarantined_count', 0)
        if progress: progress({**summary, 'total': len(rows)})
    return summary
