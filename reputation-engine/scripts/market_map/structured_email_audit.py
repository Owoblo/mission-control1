"""Independent source-line proof and exact read-only canonical email bindings."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sqlite3
from pathlib import Path

from .email_extraction import clean_email
from .structured_email_recovery import Parts, atomic, guard, sha
from .store import stamp
from .transport import SourceBlocked


def _leaves(value):
    if isinstance(value, str): yield value
    elif isinstance(value, list):
        for child in value: yield from _leaves(child)
    elif isinstance(value, dict):
        for key in ['email', 'value', 'address']:
            if key in value: yield from _leaves(value[key])


def _pointer(row, path):
    value = row
    for key in path.split('/')[1:]:
        key = key.replace('~1', '/').replace('~0', '~')
        if isinstance(value, list):
            if not key.isdigit() or int(key) >= len(value): return None
            value = value[int(key)]
        elif isinstance(value, dict) and key in value: value = value[key]
        else: return None
    return value


def verify_recovery(output, *, progress=None):
    """Check every exported email against original bytes and explicit field, not a sample."""
    output = Path(output);manifest_path = output / 'manifest.json';manifest = json.loads(manifest_path.read_text())
    if manifest.get('status') != 'all_planned_sources_streamed': raise SourceBlocked('Recovery is not complete')
    guard(output);associations, emails, seen, files, records = 0, set(), set(), 0, 0
    for report in manifest['source_file_reports']:
        spec = report['spec'];source = Path(report['file'])
        if sha(source) != report['source_artifact_sha256'] or sha(spec['manifest']) != spec['manifest_sha256']:
            raise SourceBlocked('Independent proof: original source/manifest bytes differ')
        expected = {}
        for part in report['output_parts']:
            path = Path(part['path'])
            if sha(path) != part['sha256']: raise SourceBlocked('Independent proof: output partition hash differs')
            with gzip.open(path, 'rt') as handle:
                for line in handle:
                    fact = json.loads(line);key = (fact['source_id'], fact['source_record_id'], fact['email'])
                    if key in seen: raise SourceBlocked('Independent proof: duplicate source-record-email association')
                    seen.add(key);emails.add(fact['email']);associations += 1
                    if fact['source_id'] != spec['source_id'] or fact['source_artifact_sha256'] != spec['file_sha256']:
                        raise SourceBlocked('Independent proof: source namespace/file pointer differs')
                    if clean_email(fact['email_as_published']) != fact['email'] or fact['outreach_eligibility'] != 'research_only':
                        raise SourceBlocked('Independent proof: exact published email/eligibility differs')
                    expected.setdefault(fact['source_row_ordinal'], []).append(fact)
        if expected:
            bodyhash = hashlib.sha256();observed = 0
            with gzip.open(source, 'rb') as handle:
                for ordinal, line in enumerate(handle, 1):
                    bodyhash.update(line)
                    if not line.strip(): continue
                    observed += 1
                    if ordinal not in expected: continue
                    row = json.loads(line);props = (row.get('raw_payload') or {}).get('properties') or {}
                    for fact in expected.pop(ordinal):
                        publisher_key = row.get('source_record_id') or row.get('registration_id') or row.get('native_collection_item_id')
                        provider_mismatch = spec.get('kind') != 'structured_jsonl' and props.get('id') != fact['source_record_id']
                        if (hashlib.sha256(line).hexdigest() != fact['source_row_sha256']
                            or str(publisher_key) != fact['source_record_id'] or provider_mismatch):
                            raise SourceBlocked('Independent proof: original source row/GERS bytes differ')
                        values = [value for path in fact['source_field_paths'] for value in _leaves(_pointer(row, path))]
                        if not any(fact['email_as_published'] in value for value in values):
                            raise SourceBlocked('Independent proof: email absent from its exact explicit publisher field')
            if expected or observed != report['rows_scanned'] or (spec.get('uncompressed_sha256') and bodyhash.hexdigest() != spec['uncompressed_sha256']):
                raise SourceBlocked('Independent proof: whole original file/line inventory differs')
        files += 1;records += report['rows_scanned']
        if progress: progress({'source_files_verified': files, 'exported_associations_proved': associations})
    if associations != manifest['unique_record_email_associations'] or len(emails) != manifest['unique_email_values']:
        raise SourceBlocked('Independent proof: total association/email counts differ')
    result = {'status': 'passed', 'checked_at': stamp(), 'source_files_hash_verified': files,
        'source_rows_covered': records, 'every_exported_association_original_row_field_proved': associations,
        'distinct_case_preserving_email_values': len(emails), 'duplicate_exported_associations': 0,
        'not_a_sample': True, 'manifest_sha256': sha(manifest_path), 'network_requests': 0,
        'main_database_opened_or_mutated': False, 'central_email_queue_opened_or_mutated': False}
    atomic(output / 'independent-source-line-proof.json', result);return result


def bind_exact(recovery, main_database, output, *, progress=None):
    """Both SQLite sources read-only; only exact(source_id,record_id) mapping joins."""
    recovery, database, output = Path(recovery).resolve(), Path(main_database).resolve(), Path(output).resolve()
    proof = json.loads((recovery / 'independent-source-line-proof.json').read_text())
    if proof.get('status') != 'passed' or proof['manifest_sha256'] != sha(recovery / 'manifest.json'):
        raise SourceBlocked('Passed exact current recovery proof is required before bindings')
    guard(recovery);output.mkdir(parents=True, exist_ok=True);before = database.stat()
    conn = sqlite3.connect((recovery / 'recovery-index.sqlite').as_uri() + '?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row;conn.execute('PRAGMA cache_size=-65536');conn.execute('PRAGMA mmap_size=536870912')
    conn.execute('ATTACH DATABASE ? AS canonical', (database.as_uri() + '?mode=ro',));conn.execute('PRAGMA canonical.mmap_size=536870912')
    writer = Parts(output, 'exact-source-identity-email-bindings')
    counts = {'associations': 0, 'matched_associations': 0, 'unmatched_associations': 0, 'shared_email_associations': 0}
    source_records, matched_records, unmatched_records, orgs, locations, shared_emails = set(), set(), set(), set(), set(), set()
    try:
        query = '''WITH email_counts AS (SELECT email,COUNT(*) AS n FROM associations GROUP BY email)
            SELECT a.source_id,a.record_id,a.email,n.n,i.organisation_id,i.location_id
            FROM associations a JOIN email_counts n ON n.email=a.email
            LEFT JOIN canonical.source_identities i ON i.source_id=a.source_id AND i.source_record_id=a.record_id
            ORDER BY a.source_id,a.record_id,a.email'''
        for row in conn.execute(query):
            matched = row['organisation_id'] is not None;key = (row['source_id'], row['record_id'])
            source_records.add(key);(matched_records if matched else unmatched_records).add(key)
            counts['associations'] += 1;counts['matched_associations' if matched else 'unmatched_associations'] += 1
            if row['organisation_id']: orgs.add(row['organisation_id'])
            if row['location_id']: locations.add(row['location_id'])
            if row['n'] > 1: counts['shared_email_associations'] += 1;shared_emails.add(row['email'])
            writer.add({'source_id': row['source_id'], 'source_record_id': row['record_id'], 'email': row['email'],
                'organisation_id': row['organisation_id'], 'location_id': row['location_id'],
                'canonical_binding_status': 'exact_source_identity_mapping' if matched else 'unmatched_staged_or_review_required',
                'binding_basis': 'Exact canonical.source_identities(source_id,source_record_id); no name/domain/email identity inference',
                'shared_email_record_associations': row['n'], 'shared_email_is_not_an_identity_merge': True,
                'canonical_mapping_is_not_company_ownership_or_person_authority_verification': True,
                'mailbox_status': 'not_checked', 'outreach_eligibility': 'research_only'})
            if counts['associations'] % 25000 == 0:
                guard(output)
                if progress: progress(counts)
        parts = writer.finish()
    finally:
        writer.close();conn.close()
    after = database.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise SourceBlocked('MAIN database changed during read-only binding; review concurrent state')
    result = {'status': 'passed', 'checked_at': stamp(), **counts, 'unique_source_records_with_email': len(source_records),
        'matched_unique_source_records': len(matched_records), 'unmatched_unique_source_records': len(unmatched_records),
        'matched_distinct_provisional_organisation_ids': len(orgs), 'matched_distinct_location_ids': len(locations),
        'unique_shared_email_values': len(shared_emails), 'output_parts': parts,
        'main_database_path': str(database), 'main_database_size': before.st_size,
        'main_database_mtime_ns': before.st_mtime_ns, 'main_database_size_and_mtime_unchanged': True,
        'sqlite_sources_both_uri_mode': 'ro', 'main_database_mutated': False, 'central_queue_opened_or_mutated': False,
        'recovery_manifest_sha256': sha(recovery / 'manifest.json'), 'independent_proof_sha256': sha(recovery / 'independent-source-line-proof.json'),
        'matching_method': 'Exact source_id+publisher source_record_id (GERS for provider records); unmatched records retained; no fuzzy/domain/name joins',
        'unique_verified_company_count': None, 'network_requests': 0, 'messages_sent': 0}
    atomic(output / 'binding-receipt.json', result);return result


def main():
    parser = argparse.ArgumentParser();parser.add_argument('--recovery', required=True, type=Path)
    parser.add_argument('--main-database', type=Path);parser.add_argument('--output', type=Path);args = parser.parse_args()
    if args.main_database:
        if not args.output: parser.error('--main-database requires --output')
        result = bind_exact(args.recovery, args.main_database, args.output, progress=lambda e: print(json.dumps(e), flush=True))
    else: result = verify_recovery(args.recovery, progress=lambda e: print(json.dumps(e), flush=True))
    print(json.dumps(result), flush=True)


if __name__ == '__main__': main()
