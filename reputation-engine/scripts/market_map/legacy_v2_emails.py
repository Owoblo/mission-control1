"""Read-only historical V2 email recovery with publisher-footer separation."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3

from .structured_email_recovery import atomic, field_values, guard, sha
from .store import stamp


def explicit_business_emails(payload):
    fields = payload.get('fields') or {}
    if not isinstance(fields, dict): return []
    return list(field_values(fields.get('Email')))


def recover_v2(source_database, output):
    database, output = Path(source_database).resolve(), Path(output);guard(database.parent)
    before = database.stat();original_hash = sha(database)
    conn = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True);conn.row_factory = sqlite3.Row
    query = 'SELECT r.source,o.id observation_id,o.entity_id,o.source_url,o.captured_at,o.payload FROM observations o JOIN runs r ON r.id=o.run_id ORDER BY r.source,o.id'
    source_rows = Counter();repeated = defaultdict(Counter);profile_examples = {};all_observations = 0
    for record in conn.execute(query):
        payload = json.loads(record['payload']);source_rows[record['source']] += 1;all_observations += 1
        for email, published in field_values(payload.get('profile_emails') or []):
            repeated[record['source']][email] += 1;profile_examples.setdefault((record['source'], email), (dict(record), published))
    businesses = {};review = []
    for record in conn.execute(query):
        payload = json.loads(record['payload'])
        for email, published in explicit_business_emails(payload):
            key = (record['source'], record['entity_id'], email)
            businesses.setdefault(key, {'email': email, 'email_as_published': published,
                'source_id': 'legacy-v2:' + record['source'], 'source_record_id': 'v2:' + record['entity_id'],
                'organisation_name': payload.get('name'), 'source_url': record['source_url'], 'observed_at': record['captured_at'],
                'source_artifact_sha256': original_hash, 'source_artifact_path': str(database),
                'source_observation_id': record['observation_id'], 'source_original_entity_id': record['entity_id'],
                'source_row_sha256': hashlib.sha256(record['payload'].encode()).hexdigest(),
                'source_row_hash_method': 'exact_stored_normalized_payload_json_bytes', 'source_field_paths': ['/fields/Email'],
                'extraction_method': 'historical_business_directory_explicit_Email_field',
                'identity_status': 'source_published_candidate', 'mailbox_status': 'not_checked', 'outreach_eligibility': 'research_only',
                'rights_status': 'legacy_unreviewed', 'source_role_or_authority_inferred': False,
                'canonical_association_status': 'exact_legacy_source_identity_join_pending', 'messages_sent': 0})
    for (source, email), (record, published) in profile_examples.items():
        # Dedicated Email-field facts already have stronger support above.
        if source == 'sarnia': continue
        payload = json.loads(record['payload']);frequency = repeated[source][email]
        review.append({'email': email, 'email_as_published': published, 'source_id': 'legacy-v2:' + source,
            'source_record_id': 'v2:' + record['entity_id'], 'organisation_name': None,
            'source_url': record['source_url'], 'observed_at': record['captured_at'],
            'source_artifact_sha256': original_hash, 'source_artifact_path': str(database),
            'source_observation_id': record['observation_id'], 'source_row_sha256': hashlib.sha256(record['payload'].encode()).hexdigest(),
            'source_field_paths': ['/profile_emails'], 'source_profile_occurrence_count': frequency,
            'extraction_method': 'historical_profile_email_list_page_contact_review_only',
            'association_status': 'possible_publisher_footer_contact' if frequency > 1 else 'profile_page_email_ownership_unverified',
            'canonical_company_email_coverage_eligible': False,
            'no_member_company_email_ownership_claim': True, 'identity_status': 'source_page_contact_review_candidate',
            'mailbox_status': 'not_checked', 'outreach_eligibility': 'research_only', 'rights_status': 'legacy_unreviewed',
            'source_role_or_authority_inferred': False, 'messages_sent': 0})
    conn.close();after = database.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns): raise RuntimeError('Historical source DB changed during read-only recovery')
    guard(database.parent);output.mkdir(parents=True, exist_ok=True);outputs = []
    for name, rows in [('explicit-business-email-associations.jsonl.gz', list(businesses.values())), ('publisher-or-profile-page-email-review.jsonl.gz', review)]:
        path = output / name
        with gzip.open(path, 'wt') as handle:
            for row in rows: handle.write(json.dumps(row, ensure_ascii=False) + '\n')
        outputs.append({'path': str(path), 'sha256': sha(path), 'bytes': path.stat().st_size, 'rows': len(rows)})
    report = {'status': 'passed', 'checked_at': stamp(), 'source_database': str(database), 'source_database_sha256': original_hash,
        'source_open_mode': 'ro', 'source_size_and_mtime_unchanged': True, 'observations_scanned': all_observations,
        'source_observation_counts': dict(source_rows), 'explicit_business_email_associations': len(businesses),
        'explicit_business_unique_emails': len({r['email'] for r in businesses.values()}),
        'page_contact_review_candidates': len(review), 'profile_occurrence_frequencies': {s: sorted(v.values(), reverse=True) for s,v in repeated.items()},
        'publisher_footer_repetitions_not_counted_as_member_company_emails': True, 'outputs': outputs,
        'rights_status': 'legacy_unreviewed', 'mailbox_status': 'not_checked', 'outreach_eligibility': 'research_only',
        'main_database_opened_or_mutated': False, 'central_queue_opened_or_mutated': False, 'network_requests': 0, 'messages_sent': 0}
    atomic(output / 'manifest.json', report);return report


def main():
    parser = argparse.ArgumentParser();parser.add_argument('--source-database', required=True, type=Path);parser.add_argument('--output', required=True, type=Path);args = parser.parse_args()
    print(json.dumps(recover_v2(args.source_database, args.output), indent=2), flush=True)


if __name__ == '__main__': main()
