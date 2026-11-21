"""Offline conservative promotion of four frozen western factual rosters.

Address lines retain publisher wording, not inferred components. A listing,
source-reported address, member, map point, employer count and legal company are
different claims. All original selected facts and their receipts stay traceable.
"""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path

from .factual_promotion import member_path, normalize_selected_fact, sha
from .place_import import _guard_storage, _committed_batch
from .transport import SourceBlocked

CONFIG = Path(__file__).parent / 'config/completed-western-factual-promotions.json'
VERSION = 'completed-western-facts/2026-10-27.1'


def project_western(original, kind, manifest):
    """Project only printed factual fields, retaining the exact source row below."""
    row = {'source_record_id': original.get('source_record_id'), 'name': original.get('name'),
           'address': None, 'city': None, 'province': None, 'country': None, 'postal_code': None,
           'website': None, 'categories': original.get('source_categories') or [],
           'source_url': original.get('native_profile_url') or manifest['source_url'],
           'observed_at': original.get('first_observed_at') or original.get('observed_at') or manifest.get('observed_at'),
           'source_published_at': None, 'record_type': 'publisher_directory_listing_candidate',
           'source_record_id_basis': 'Publisher native profile URL' if kind == 'elgin' else 'Publisher native listing identifier',
           'entity_type': 'organisation_candidate', 'eligibility': 'research_only'}
    if kind in {'elgin', 'tillsonburg'}:
        lines = original.get('published_address_lines') or []
        if not isinstance(lines, list) or any(not isinstance(v, str) for v in lines):
            raise SourceBlocked('Publisher address-line schema differs; no guessed parse permitted')
        # Literal multi-line address is an unverified source address candidate.
        # Locality/province/country are not filled from publisher footer/filter.
        row['address'] = '\n'.join(v for v in lines if v.strip()) or None
        websites = original.get('source_profile_business_websites') or original.get('business_websites') or []
        row['website'] = websites[0] if len(websites) == 1 else None
    elif kind == 'listowel':
        row['address'] = original.get('published_street_or_address_text') or None
        websites = original.get('business_websites') or []
        row['website'] = websites[0] if len(websites) == 1 else None
        if original.get('source_record_id') != original.get('native_collection_item_id'):
            raise SourceBlocked('Wix publisher native collection identifier differs')
    elif kind == 'guelph_bia':
        address = original.get('publisher_reported_address') or {}
        row.update(address=address.get('street') or None, city=address.get('city') or None,
                   province=address.get('region') or None, country=address.get('country') or None,
                   postal_code=address.get('zip') or None, website=original.get('business_website') or None)
        if str(original.get('native_profile_id')) != original.get('source_record_id'):
            raise SourceBlocked('Guelph publisher native listing identifier differs')
    else:
        raise SourceBlocked('Unreviewed western source projection')
    if not row['observed_at']:
        raise SourceBlocked('Original publisher observation timestamp missing')
    return row


def prepare_western(folder, kind):
    folder = Path(folder)
    specs = json.loads(CONFIG.read_text())['source_cohorts']
    if kind not in specs: raise SourceBlocked('Unreviewed western source cohort')
    spec = specs[kind]
    path = member_path(folder, spec['primary_manifest'])
    if sha(path) != spec['primary_manifest_sha256']:
        raise SourceBlocked('Western primary frozen manifest differs before mutations')
    manifest = json.loads(path.read_text())
    if manifest.get('source_id') != spec['source_id'] or manifest.get('source_inventory_exhausted') is not True:
        raise SourceBlocked('Western complete source inventory identity differs')
    rights = manifest.get('rights_status') or (manifest.get('rights') or {}).get('rights_status')
    if rights != spec['rights_status'] or rights != 'limited_factual_review_only':
        raise SourceBlocked('Western bounded internal factual rights scope differs')
    if 'complete' not in str(manifest.get('status') or '') or any(word in str(manifest.get('status')).lower() for word in ['partial', 'blocked', 'restricted']):
        raise SourceBlocked('Western source inventory is not completed and eligible')
    for name, expected in spec['snapshot_files'].items():
        if sha(member_path(folder, name)) != expected:
            raise SourceBlocked('Western original/rights/annotated fact checksum differs before mutations: ' + name)
    records = member_path(folder, spec['records_file'])
    if sha(records) != spec['records_sha256']:
        raise SourceBlocked('Western preferred selected-facts checksum differs')
    rows, identifiers = [], set()
    with gzip.open(records, 'rb') as handle:
        for number, line in enumerate(handle, 1):
            if not line.strip(): continue
            original = json.loads(line)
            row = project_western(original, kind, manifest)
            key = row['source_record_id']
            if not isinstance(key, str) or not key or key in identifiers:
                raise SourceBlocked('Western publisher native/profile identity missing or repeated')
            if kind == 'elgin' and key != 'profile-url:' + str(original.get('native_profile_url')):
                raise SourceBlocked('Elgin profile-URL identifier basis differs')
            identifiers.add(key)
            normalized, eligible = normalize_selected_fact(row, manifest_sha=spec['primary_manifest_sha256'],
                row_file=records, row_file_sha=spec['records_sha256'], line_number=number, line_sha=hashlib.sha256(line).hexdigest())
            normalized['raw_payload']['original_selected_source_observation'] = original
            normalized['raw_payload']['source_projection'] = row
            rows.append((normalized, eligible))
    if len(rows) != spec['source_rows']:
        raise SourceBlocked('Western entire published roster count differs')
    source = {'id': spec['source_id'], 'name': manifest.get('publisher') or spec['source_id'],
              'source_url': manifest['source_url'], 'source_type': 'economic_development' if kind in {'elgin', 'tillsonburg'} else 'bia',
              'publisher': manifest.get('publisher'), 'rights_status': rights, 'access_status': 'allowed_public',
              'source_date': None, 'last_checked_at': manifest.get('observed_at'),
              'adapter_name': 'completed_western_facts_' + kind,
              'config': {'rights_scope': 'Bounded internal business factual research; public redistribution grant not established',
                  'public_redistribution_authorised': False, 'source_inventory_exhausted': True, 'market_coverage_complete': False,
                  'original_manifest': str(path), 'original_manifest_sha256': spec['primary_manifest_sha256'],
                  'reported_listing_and_address_are_not_verified_company_or_site': True}}
    return spec, manifest, source, rows

def apply_western_facts(store, folder, *, kind, batch_size=250, progress=None):
    """Explicit sole-writer local promotion, not invoked by acquisition modules."""
    if not 1 <= batch_size <= 1000: raise ValueError('Use1–1000row completed-fact batches')
    folder = Path(folder)
    spec, manifest, source, rows = prepare_western(folder, kind)
    _guard_storage(store, [row for row, _ in rows[:batch_size]], {'source_folder': str(folder), 'source_id': source['id'], 'area': kind, 'chunk': 'preflight'})
    observed = manifest.get('observed_at') or next((r.get('observed_at') for r, _ in rows if r.get('observed_at')), None)
    if not observed: raise SourceBlocked('Original capture timestamp missing; import time is not a substitute')
    source_id = store.upsert_source(source)
    metrics = manifest.get('resource_metrics') or manifest.get('metrics') or {key: manifest.get(key) for key in ['requests', 'bytes_fetched', 'elapsed_seconds']}
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
                        values.update({'source_profile_primary_naics_code': original.get('source_profile_primary_naics_code'), 'source_profile_naics_version': original.get('source_profile_naics_version'), 'source_profile_review_flags': original.get('source_profile_review_flags'), 'source_zero_or_default_meaning_review_fields': original.get('source_zero_or_default_meaning_review_fields'), 'source_profile_fields': original.get('source_profile_fields'), 'source_categories_literal': original.get('source_categories'), 'source_competing_values': original.get('competing_source_values'), 'source_appearance_provenance': original.get('source_appearances'), 'source_phone_observations': original.get('business_phone_observations')})
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
