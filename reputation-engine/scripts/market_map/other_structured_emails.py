"""Offline explicit-email schema/row coverage for other completed source cohorts."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import unicodedata
from pathlib import Path

from .email_extraction import clean_email
from .structured_email_recovery import atomic, field_values, recover, sha, guard
from .transport import SourceBlocked

ALLOWED_RIGHTS = {'licensed_open', 'limited_factual_review_only', 'permitted_internal_factual_export'}
CONTAINERS = {'raw_payload', 'attributes', 'properties', 'source_fields', 'source_raw_fields', 'source_row',
    'values', 'contacts', 'contactDetails', 'contact_details', 'contactPoint', 'contact_point', 'public_profile',
    'directory_record', 'cleaned_snapshot', 'published_web_url_records', 'original_selected_source_observation',
    'source_profile_fields', 'source_appearances', 'contact', 'record', 'feature'}
URL_FIELDS = {'website', 'websites', 'contacturl', 'businesswebsite', 'websiteurl', 'homepage', 'websitecandidates'}


def normalized_key(value):
    return re.sub('[^a-z]', '', unicodedata.normalize('NFKD', str(value)).encode('ascii', 'ignore').decode().lower())


def explicit_email_fields(row):
    """Only declared contact fields/public contact URLs; no arbitrary descriptions."""
    def walk(value, path=''):
        if isinstance(value, list):
            for number, child in enumerate(value):
                yield from walk(child, path + '/' + str(number))
        elif isinstance(value, dict):
            flags = {normalized_key(k): v for k, v in value.items()}
            if (any(flags.get(k) is False for k in ['emaildisplayallowed', 'displayemail', 'showemail', 'emailpublic'])
                or any(flags.get(k) is True for k in ['emailhidden', 'hideemail', 'emailisprivate'])):
                return
            for key, child in value.items():
                label = normalized_key(key);pointer = path + '/' + key.replace('~', '~0').replace('/', '~1')
                blocked = any(word in label for word in ['private', 'hidden', 'display', 'allow', 'status', 'consent', 'creator', 'maintainer', 'publisher', 'editor', 'author'])
                is_email = (label in {'email', 'emails', 'courriel', 'courriels', 'adresseelectronique', 'emailcontact'}
                            or label.endswith(('email', 'emails', 'emailaddress', 'emailaddresses'))) and not blocked
                if is_email:
                    yield pointer, child
                elif label in URL_FIELDS:
                    values = child if isinstance(child, list) else [child]
                    for item in values:
                        if isinstance(item, str):
                            # A public Contact URL may literally contain an
                            # inbox rather than a website. HTTP userinfo strings
                            # are never interpreted as an email address.
                            if clean_email(item.strip()): yield pointer, item.strip()
                            elif item.strip().lower().startswith('mailto:'): yield pointer, item.strip()[7:].split('?', 1)[0]
                if key in CONTAINERS and isinstance(child, (dict, list)):
                    yield from walk(child, pointer)
    yield from walk(row)


def structured_facts(row, spec):
    if str(row.get('record_type') or '').startswith('explicit_individual_member_excluded'): return
    key = row.get('source_record_id') or row.get('registration_id') or row.get('native_collection_item_id')
    found = {}
    for field, value in explicit_email_fields(row):
        for email, published in field_values(value):
            entry = found.setdefault(email, {'original': published, 'fields': []})
            if field not in entry['fields']: entry['fields'].append(field)
    if found and key is None:
        raise SourceBlocked('Structured email source has no reviewed native/profile row identifier')
    for email, value in found.items():
        yield {'email': email, 'email_as_published': value['original'], 'source_id': spec['source_id'],
            'source_record_id': str(key), 'organisation_name': row.get('name') or row.get('legal_name'),
            'source_url': row.get('source_url') or row.get('profile_url') or row.get('native_profile_url') or spec['source_url'],
            'observed_at': row.get('observed_at') or row.get('first_observed_at') or spec.get('observed_at'),
            'extraction_method': 'explicit_structured_public_business_contact_field', 'source_field_paths': value['fields'],
            'identity_status': 'source_published_candidate', 'mailbox_status': 'not_checked',
            'outreach_eligibility': 'research_only', 'rights_status': spec['rights_status'],
            'public_redistribution_permission': 'not_established' if spec['rights_status'] != 'licensed_open' else 'subject_to_source_licence',
            'canonical_association_status': 'exact_source_identity_join_pending', 'source_cohort': spec['source_cohort'],
            'source_query_exhausted': spec.get('source_query_exhausted'), 'person_name_or_authority_inferred': False}


def other_plan(root):
    root = Path(root);jobs, holds, covered_primaries = {}, [], set()
    def add(folder, primary, source_id, rights, file, expected_hash=None, expected_rows=None, source_url=None, observed=None):
        folder, primary = Path(folder), Path(primary);path = folder / file
        if rights not in ALLOWED_RIGHTS:
            holds.append({'source_id': source_id, 'file': str(path), 'reason': 'Source rights require review', 'rights_status': rights});return
        if not path.is_file() or path.suffix not in {'.gz', '.jsonl'}: return
        actual = sha(path)
        if expected_hash and actual != expected_hash: raise SourceBlocked('Other source selected-fact hash differs: ' + str(path))
        jobs[str(path)] = {'kind': 'structured_jsonl', 'file': str(path), 'file_sha256': actual,
            'manifest': str(primary), 'manifest_sha256': sha(primary), 'uncompressed_sha256': None,
            'source_id': source_id, 'rights_status': rights, 'source_url': source_url,
            'observed_at': observed, 'source_cohort': str(folder.relative_to(root)), 'expected_rows': expected_rows,
            'source_query_exhausted': True}
    # Exact completed source handoffs select preferred repaired/snapshot-key
    # normalizations rather than accidentally scanning both parser versions.
    for handoff in sorted(root.glob('gta*completed*handoff*.json')) + [root / 'gta-completed-promotion-handoff.json']:
        if not handoff.is_file(): continue
        content = json.loads(handoff.read_text())
        for entry in content.get('cohorts', []):
            fragment = entry.get('source_fragment') if isinstance(entry.get('source_fragment'), dict) else {}
            source_id = entry.get('source_id') or fragment.get('id')
            rights = entry.get('rights_status') or fragment.get('rights_status')
            primary = Path(entry.get('primary_manifest') or entry.get('manifest') or Path(entry.get('folder') or entry.get('cohort_folder', '')) / 'manifest.json')
            primary_hash = entry.get('primary_manifest_sha256') or entry.get('manifest_sha256')
            if primary_hash and sha(primary) != primary_hash: raise SourceBlocked('Completed handoff primary bytes differ')
            records = list(entry.get('selected_records_files') or [])
            if entry.get('raw_facts_file'): records.append({'path': entry['raw_facts_file'], 'sha256': entry['raw_facts_sha256']})
            if entry.get('selected_facts'): records.append({'path': entry['selected_facts'], 'sha256': entry['selected_facts_sha256']})
            if not source_id or not records: continue
            covered_primaries.add(str(primary))
            for record in records:
                p = Path(record['path'])
                add(p.parent, primary, source_id, rights, p.name, record.get('sha256'),
                    source_url=entry.get('source_url') or fragment.get('source_url'))
    skip_dirs = {'consolidation-plan', 'structured-email-recovery', 'email-acquisition', 'verification-pilot',
                 'reported-coordinate-context', 'identity-review-acquisition', 'acquired-inventory', 'corridor-inventory'}
    for primary in sorted(root.rglob('manifest.json')):
        if any(part in skip_dirs for part in primary.parts): continue
        if str(primary) in covered_primaries: continue
        try: data = json.loads(primary.read_text())
        except (ValueError, OSError): continue
        source = data.get('source') or {};source_id = data.get('source_id') or source.get('id')
        file = data.get('records_file') or data.get('rows_file')
        if not source_id or not file: continue
        if 'aggregate-site-acquisition' in primary.parts:
            holds.append({'source_id': source_id, 'file': str(primary), 'rights_status': 'licensed_open',
                'reason': 'Area-feature context, not a reviewed organisation-contact projection; retained as raw context'});continue
        status = str(data.get('status') or '')
        rights = data.get('rights_status') or source.get('rights_status') or (data.get('rights') or {}).get('rights_status')
        if any(token in status.lower() for token in ['blocked', 'partial', 'running', 'review_required', 'count_review']):
            holds.append({'source_id': source_id, 'file': str(primary), 'reason': 'Partial/held source not silently treated as complete', 'status': status});continue
        if 'waterloo-bia-factual-snapshot' in primary.parts:
            holds.append({'source_id': source_id, 'file': str(primary), 'reason': 'Known incomplete publisher IP section; further reuse held'});continue
        path = primary.parent / file
        if str(path) in jobs: continue
        # Existing preferred views carry fixes; their byte hashes remain pinned.
        pointer = primary.parent / 'preferred-normalization.json'
        if pointer.exists():
            preferred = json.loads(pointer.read_text())
            if preferred.get('records_file'):
                file = preferred['records_file'];expected_hash = preferred.get('records_sha256')
            else: expected_hash = data.get('records_sha256')
        else: expected_hash = data.get('records_sha256')
        add(primary.parent, primary, source_id, rights, file, expected_hash, data.get('records_count'),
            data.get('source_url') or source.get('source_url'), data.get('observed_at'))
    # CRA original Contact URL values stay in each Ontario BN's raw records,
    # including literal inboxes that the website normalizer cannot use as URLs.
    primary = root / 'institution-acquisition/cra-manifest.json'
    if primary.exists():
        data = json.loads(primary.read_text());source = data['source']
        add(primary.parent, primary, source['id'], source['rights_status'], data['records_file'], data['records_sha256'],
            data['stats']['accepted_rows'], source.get('source_url'), data.get('observed_at'))
    primary = root / 'durham-live/collection.json'
    if primary.exists():
        data = json.loads(primary.read_text());source = data['source']
        add(primary.parent, primary, source['id'], source['rights_status'], 'normalised-records.jsonl',
            expected_rows=len(data['rows']), source_url=source.get('source_url'), observed=data.get('metadata', {}).get('observed_at'))
    return list(jobs.values()), holds


def main():
    parser = argparse.ArgumentParser();parser.add_argument('--run-root', required=True, type=Path);parser.add_argument('--output', required=True, type=Path);args = parser.parse_args()
    guard(args.run_root)
    jobs, holds = other_plan(args.run_root);args.output.mkdir(parents=True, exist_ok=True)
    atomic(args.output / 'input-plan.json', {'kind': 'other_public_structured_contact_fields', 'jobs': jobs, 'holds': holds})
    result = recover(jobs, args.output, progress=lambda e: print(json.dumps(e), flush=True))
    print(json.dumps({k: v for k, v in result.items() if k != 'source_file_reports'}), flush=True)


if __name__ == '__main__': main()
