"""Offline historical public-profile email fields with explicit source/reuse status."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
from pathlib import Path

from .email_extraction import clean_email
from .structured_email_recovery import atomic, field_values, guard, sha
from .store import stamp
from .transport import SourceBlocked


def profile_fields(profile):
    """Publisher publication flag is mandatory; never infer a person or authority."""
    if profile.get('isPublished') is not True: return {}
    found = {}
    for key in ['email', 'executiveEmail', 'salesEmail']:
        for email, original in field_values((profile.get('contactDetails') or {}).get(key)):
            entry = found.setdefault(email, {'published': original, 'fields': []})
            entry['fields'].append('/contactDetails/' + key)
    return found


def chamber_fields(record):
    """Require a saved visible-text/mailto witness, not a guessed route list."""
    found = {};text = record.get('text') or ''
    def strings(value):
        if isinstance(value, str): yield value
        elif isinstance(value, list):
            for child in value: yield from strings(child)
        elif isinstance(value, dict):
            for key in ['href', 'url']:
                if key in value: yield from strings(value[key])
    links = list(strings(record.get('links') or []))
    for value in record.get('emails') or []:
        for email, original in field_values(value):
            if original not in text and not any(link.lower().startswith('mailto:') and clean_email(link[7:].split('?', 1)[0]) == email for link in links):
                continue
            found[email] = original
    return found


def extract_legacy(repo_root, output):
    repo_root, output = Path(repo_root), Path(output);guard(repo_root)
    base = repo_root / 'partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15'
    profiles_file = base / 'public-profiles.json';chamber_file = base / 'expansion/chamber-profiles.jsonl'
    profiles = json.loads(profiles_file.read_text());csv_file = base / 'accounts-and-locations.csv'
    with csv_file.open(newline='') as handle:
        captured = {r.get('source_id') or r.get('account_id'): r for r in csv.DictReader(handle)}
    rows = [];published = held = assertions = 0
    def common(email, original, source_id, key, name, url, observed, method):
        return {'email': email, 'email_as_published': original, 'source_id': source_id, 'source_record_id': str(key),
            'organisation_name': name, 'source_url': url, 'observed_at': observed,
            'extraction_method': method, 'identity_status': 'source_published_candidate', 'mailbox_status': 'not_checked',
            'outreach_eligibility': 'research_only', 'rights_status': 'legacy_unreviewed',
            'current_source_reuse_status': 'historical_capture_no_fresh_rights_validation',
            'public_redistribution_permission': 'not_established', 'canonical_association_status': 'exact_source_identity_join_pending',
            'person_name_or_authority_inferred': False, 'email_ownership_verified': False,
            'historical_snapshot_not_current_mailbox_verification': True, 'messages_sent': 0}
    profile_hash = sha(profiles_file);csv_hash = sha(csv_file)
    for key, record in profiles.items():
        if record.get('isPublished') is not True: held += 1;continue
        published += 1;entry = captured.get(key) or {};fields = profile_fields(record)
        for email, fact in fields.items():
            assertions += len(fact['fields'])
            row = common(email, fact['published'], 'legacy-windsor-source-directory', key,
                (record.get('demographics') or {}).get('companyTitle') or entry.get('name'),
                entry.get('source_url') or 'https://sourcewindsoressex.com/',
                record.get('retrieved_at') or entry.get('retrieved_at'), 'explicit_historical_published_company_contact_fields')
            row.update(source_artifact_sha256=profile_hash, source_artifact_path=str(profiles_file),
                source_record_json_pointer='/' + key.replace('~', '~0').replace('/', '~1'), source_field_paths=fact['fields'],
                source_record_sha256=hashlib.sha256(json.dumps(record, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest(),
                source_record_hash_method='canonical_json_object_sha256_not_original_byte_slice',
                capture_metadata_csv_sha256=csv_hash, source_isPublished_at_capture=True,
                source_publisher_updatedAt=record.get('updatedAt'), source_role_labels_are_not_verified_authority=True)
            rows.append(row)
    chamber_hash = sha(chamber_file);chamber_records = 0;unproved = 0
    with chamber_file.open('rb') as handle:
        for ordinal, line in enumerate(handle, 1):
            if not line.strip(): continue
            record = json.loads(line);chamber_records += 1
            if not record.get('source_url') or not record.get('source'): continue
            fields = chamber_fields(record)
            unproved += len({e for v in record.get('emails') or [] for e, _ in field_values(v)} - set(fields))
            for email, original in fields.items():
                row = common(email, original, 'legacy-windsor:' + record['source'], record['source_url'], record.get('name'),
                    record['source_url'], record.get('checked_at'), 'historical_public_profile_email_list_with_saved_text_or_mailto_witness')
                row.update(source_artifact_sha256=chamber_hash, source_artifact_path=str(chamber_file), source_row_ordinal=ordinal,
                    source_row_sha256=hashlib.sha256(line).hexdigest(), source_field_paths=['/emails'],
                    source_profile_status=record.get('status'), association_status='profile_page_candidate_organisation_ownership_unverified')
                rows.append(row)
    # Independently re-evaluate every candidate against the original source
    # field/text witness; count associations, not companies or mailboxes.
    seen = set()
    chamber_lines = [json.loads(line) for line in chamber_file.open() if line.strip()]
    for row in rows:
        key = (row['source_id'], row['source_record_id'], row['email'])
        if key in seen: raise SourceBlocked('Historical source email association duplicated')
        seen.add(key)
        if row['source_id'] == 'legacy-windsor-source-directory':
            source = profiles[row['source_record_id']]
            if source.get('isPublished') is not True: raise SourceBlocked('Unpublished profile must not become an email source')
            if not any(row['email_as_published'] in str((source.get('contactDetails') or {}).get(path.rsplit('/', 1)[1]) or '') for path in row['source_field_paths']):
                raise SourceBlocked('Published legacy email absent from its exact contact field')
        elif row['email'] not in chamber_fields(chamber_lines[row['source_row_ordinal'] - 1]):
            raise SourceBlocked('Historical chamber email lacks exact captured publication witness')
    guard(repo_root);output.mkdir(parents=True, exist_ok=True);facts = output / 'historical-published-email-associations.jsonl.gz'
    with gzip.open(facts, 'wt') as handle:
        for row in rows: handle.write(json.dumps(row, ensure_ascii=False) + '\n')
    report = {'status': 'passed', 'extracted_at': stamp(), 'source_profiles': len(profiles), 'explicit_published_profiles': published,
        'unpublished_or_unknown_publication_profiles_not_extracted': held,
        'published_profile_email_field_assertions': assertions, 'historical_chamber_profile_rows': chamber_records,
        'unproved_chamber_email_candidates_excluded': unproved,
        'unique_source_record_email_associations': len(rows), 'unique_email_values': len({r['email'] for r in rows}),
        'source_association_counts': {s: sum(r['source_id'] == s for r in rows) for s in sorted({r['source_id'] for r in rows})},
        'file': str(facts), 'sha256': sha(facts), 'bytes': facts.stat().st_size,
        'source_file_sha256': {str(profiles_file): profile_hash, str(chamber_file): chamber_hash, str(csv_file): csv_hash},
        'all_candidate_source_field_or_captured_publication_witnesses_rechecked': True,
        'rights_status': 'legacy_unreviewed', 'current_source_rights_not_revalidated': True,
        'source_publication_and_source_role_labels_are_not_mailbox_ownership_or_authority_verification': True,
        'mailbox_status': 'not_checked', 'outreach_eligibility': 'research_only', 'network_requests': 0,
        'main_database_opened_or_mutated': False, 'central_queue_opened_or_mutated': False, 'messages_sent': 0}
    atomic(output / 'manifest.json', report);return report


def main():
    parser = argparse.ArgumentParser();parser.add_argument('--repo-root', required=True, type=Path);parser.add_argument('--output', required=True, type=Path);args = parser.parse_args()
    print(json.dumps(extract_legacy(args.repo_root, args.output), indent=2), flush=True)


if __name__ == '__main__': main()
