"""Offline, resumable recovery of explicit emails in frozen structured sources.

No network, MAIN connection or central email-queue writes. Unique source-record-
email associations retain exact supporting file/row/field hashes; repeat query
observations are counted separately and original captures remain immutable.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import sqlite3
from pathlib import Path

from .email_extraction import clean_email, EMAIL
from .store import stamp
from .transport import SourceBlocked

VERSION = 'offline-structured-source-email/2026-10-27.1'
MIN_FREE = 2 * 1024**3
MAX_PART = 20 * 1024**2
PROVIDER_GROUPS = ['overture-2026-10-21', 'overture-municipal-wave-2', 'overture-rural-wave-3',
                   'overture-cap-completion-wave-4', 'municipal-gap-collection']


def sha(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1024**2), b''): result.update(block)
    return result.hexdigest()


def atomic(path, value):
    path = Path(path);tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n');tmp.replace(path)


def guard(folder):
    if shutil.disk_usage(folder).free < MIN_FREE: raise SourceBlocked('Offline recovery paused below2GiBfree')


def provider_plan(root):
    root = Path(root);specs = []
    for group in PROVIDER_GROUPS:
        for primary in sorted((root / group).glob('*/collection.json')):
            manifest = json.loads(primary.read_text());source = manifest.get('source') or {};metadata = manifest.get('metadata') or {}
            path = primary.parent / manifest['rows_file']
            if (source.get('rights_status') != 'licensed_open' or not str(source.get('id')).startswith('overture-')
                or metadata.get('status') not in {'completed', 'partial'} or not manifest.get('lossless_compression_verified')):
                raise SourceBlocked('Provider capture rights/compression/status requires review: ' + str(primary))
            if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()): raise SourceBlocked('Provider input left frozen run')
            specs.append({'kind': 'overture_normalized', 'source_id': source['id'], 'source_url': source['source_url'],
                'rights_status': source['rights_status'], 'terms_url': source.get('terms_url'), 'attribution': source.get('attribution'),
                'file': str(path), 'file_sha256': manifest['rows_compressed_sha256'],
                'uncompressed_sha256': manifest['rows_sha256'], 'expected_rows': metadata.get('parsed_count'),
                'manifest': str(primary), 'manifest_sha256': sha(primary), 'observed_at': metadata.get('observed_at'),
                'source_query_exhausted': metadata.get('source_query_exhausted'), 'capture_status': metadata.get('status'),
                'source_cohort': metadata.get('market_map_cohort') or group,
                'scope_note': 'Source inventory/query exhaustion is not all-market coverage; canonical binding requires exact source-ID/GERS join.'})
    return specs


def field_values(value):
    if isinstance(value, str):
        text = value.removeprefix('mailto:').split('?', 1)[0]
        for candidate in EMAIL.findall(text):
            normalized = clean_email(candidate)
            if normalized: yield normalized, candidate
    elif isinstance(value, list):
        for child in value: yield from field_values(child)
    elif isinstance(value, dict):
        for key in ['email', 'value', 'address']:
            if key in value: yield from field_values(value[key])


def provider_facts(row, spec):
    props = (row.get('raw_payload') or {}).get('properties') or {}
    key = row.get('source_record_id')
    if not isinstance(key, str) or not key or key != props.get('id'):
        raise SourceBlocked('Provider GERS identity differs between normalized and original feature')
    # Only explicit contact fields. No description, website-credential strings,
    # names, guessed inboxes, person identification or authority inference.
    values = [('/email', row.get('email')), ('/published_emails', row.get('published_emails')),
              ('/raw_payload/properties/emails', props.get('emails'))]
    found = {}
    for field, value in values:
        for email, original in field_values(value):
            current = found.setdefault(email, {'original': original, 'fields': []})
            if field not in current['fields']: current['fields'].append(field)
    for email, value in found.items():
        yield {'email': email, 'email_as_published': value['original'], 'source_id': spec['source_id'],
            'source_record_id': key, 'organisation_name': row.get('name'),
            'source_url': row.get('source_url') or spec['source_url'], 'observed_at': row.get('observed_at') or spec.get('observed_at'),
            'extraction_method': 'explicit_structured_provider_email_field', 'source_field_paths': value['fields'],
            'identity_status': 'source_published_candidate', 'mailbox_status': 'not_checked',
            'outreach_eligibility': 'research_only', 'rights_status': spec['rights_status'],
            'canonical_association_status': 'exact_source_identity_join_pending',
            'source_cohort': spec['source_cohort'], 'source_query_exhausted': spec['source_query_exhausted'],
            'source_licences': sorted({s['license'] for s in props.get('sources') or [] if isinstance(s, dict) and s.get('license')}),
            'person_name_or_authority_inferred': False, 'source_record_is_not_verified_company': True}


class Parts:
    def __init__(self, output, prefix):
        self.output, self.prefix = Path(output), prefix;self.paths = [];self.part = 0;self.handle = None;self.raw = None
    def add(self, row):
        if self.handle is None:
            self.part += 1;path = self.output / (self.prefix + '-part-' + str(self.part).zfill(3) + '.jsonl.gz.partial')
            self.paths.append(path);self.raw = path.open('wb');self.handle = gzip.GzipFile(fileobj=self.raw, mode='wb', mtime=0)
        self.handle.write((json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n').encode())
        if self.raw.tell() >= MAX_PART: self.close()
    def close(self):
        if self.handle:
            self.handle.close();self.raw.close();self.handle = self.raw = None
    def finish(self):
        self.close();result = []
        for path in self.paths:
            final = path.with_suffix('');path.replace(final)
            if final.stat().st_size >= 25 * 1024**2: raise SourceBlocked('Email handoff partition exceeded25MiB')
            result.append({'path': str(final), 'sha256': sha(final), 'bytes': final.stat().st_size})
        return result


def recover(plan, output, *, progress=None, stop_after=None):
    output = Path(output);output.mkdir(parents=True, exist_ok=True);guard(output)
    database = output / 'recovery-index.sqlite'
    db = sqlite3.connect(database);db.execute('PRAGMA synchronous=FULL');db.execute('PRAGMA cache_size=-65536')
    db.execute('CREATE TABLE IF NOT EXISTS associations(source_id TEXT,record_id TEXT,email TEXT,observations INTEGER,PRIMARY KEY(source_id,record_id,email)) WITHOUT ROWID')
    db.execute('CREATE TABLE IF NOT EXISTS emails(email TEXT PRIMARY KEY) WITHOUT ROWID')
    db.execute('CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,sha256 TEXT NOT NULL,report_json TEXT NOT NULL) WITHOUT ROWID');db.commit()
    completed = 0
    try:
        for number, spec in enumerate(plan, 1):
            path = Path(spec['file']);saved = db.execute('SELECT sha256,report_json FROM files WHERE path=?', (str(path),)).fetchone()
            if saved:
                if saved[0] != spec['file_sha256']: raise SourceBlocked('Frozen recovery input changed across resume')
                if sha(path) != saved[0] or sha(spec['manifest']) != spec['manifest_sha256']:
                    raise SourceBlocked('Committed source bytes changed across recovery resume')
                report = json.loads(saved[1])
                for item in report['output_parts']:
                    if sha(item['path']) != item['sha256']: raise SourceBlocked('Committed recovery output changed across resume')
                if progress: progress({'status': 'replayed_file', 'file': str(path), 'files': number, **summary(db)})
                continue
            guard(output)
            if sha(path) != spec['file_sha256'] or sha(spec['manifest']) != spec['manifest_sha256']:
                raise SourceBlocked('Frozen source input/manifest checksum differs')
            writer = Parts(output, 'source-' + str(number).zfill(3) + '-' + spec['file_sha256'][:12])
            rows = evidence = inserted = 0;bodyhash = hashlib.sha256();schema_fields = set()
            db.execute('BEGIN IMMEDIATE')
            try:
                opener = gzip.open if str(path).endswith('.gz') else open
                with opener(path, 'rb') as handle:
                    for ordinal, line in enumerate(handle, 1):
                        bodyhash.update(line)
                        if not line.strip(): continue
                        row = json.loads(line);rows += 1
                        if spec.get('kind') == 'structured_jsonl':
                            from .other_structured_emails import structured_facts, explicit_email_fields
                            schema_fields.update(path for path, value in explicit_email_fields(row))
                            facts = structured_facts(row, spec)
                        else:
                            props = (row.get('raw_payload') or {}).get('properties') or {}
                            if 'emails' in props: schema_fields.add('/raw_payload/properties/emails')
                            facts = provider_facts(row, spec)
                        for fact in facts:
                            evidence += 1;key = (fact['source_id'], fact['source_record_id'], fact['email'])
                            fresh = db.execute('INSERT OR IGNORE INTO associations VALUES(?,?,?,0)', key).rowcount == 1
                            db.execute('UPDATE associations SET observations=observations+1 WHERE source_id=? AND record_id=? AND email=?', key)
                            db.execute('INSERT OR IGNORE INTO emails VALUES(?)', (fact['email'],))
                            if fresh:
                                fact.update(source_artifact_sha256=spec['file_sha256'], source_row_sha256=hashlib.sha256(line).hexdigest(),
                                    source_artifact_path=str(path), source_row_ordinal=ordinal, source_manifest_sha256=spec['manifest_sha256'])
                                writer.add(fact);inserted += 1
                        if rows % 10000 == 0:
                            guard(output)
                            if progress: progress({'status': 'streaming_file', 'file': str(path), 'rows': rows,
                                'published_email_observations': evidence, 'new_associations': inserted, 'files_before': number - 1})
                if spec.get('uncompressed_sha256') and bodyhash.hexdigest() != spec['uncompressed_sha256']: raise SourceBlocked('Uncompressed source row bytes differ')
                if spec.get('expected_rows') is not None and rows != spec['expected_rows']:
                    raise SourceBlocked('Whole-file source row count differs: ' + str((rows, spec['expected_rows'])))
                parts = writer.finish();report = {'file': str(path), 'source_id': spec['source_id'], 'source_artifact_sha256': spec['file_sha256'],
                    'rows_scanned': rows, 'explicit_email_schema_paths': sorted(schema_fields), 'published_email_observations': evidence,
                    'new_record_email_associations': inserted, 'output_parts': parts, 'spec': spec}
                db.execute('INSERT INTO files VALUES(?,?,?)', (str(path), spec['file_sha256'], json.dumps(report, sort_keys=True)));db.commit()
            except BaseException:
                writer.close();db.rollback();raise
            completed += 1
            state = {'status': 'running', 'updated_at': stamp(), 'completed_files': number, 'planned_files': len(plan), **summary(db)}
            atomic(output / 'progress.json', state)
            if progress: progress({'status': 'committed_file', 'file': str(path), **state})
            if stop_after and completed >= stop_after: break
        reports = [json.loads(r[0]) for r in db.execute('SELECT report_json FROM files ORDER BY path')]
        result = {'status': 'all_planned_sources_streamed' if len(reports) == len(plan) else 'resumable_checkpoint',
            'version': VERSION, 'checked_at': stamp(), 'planned_files': len(plan), 'completed_files': len(reports), **summary(db),
            'source_file_reports': reports, 'main_database_opened_or_mutated': False, 'central_email_queue_opened_or_mutated': False,
            'network_requests': 0, 'paid_service_calls': 0, 'messages_sent': 0, 'canonical_association_claimed': False,
            'dedupe_semantics': 'Unique source_id+record_id+case-preserving validated email; repeated observations counted separately. Every original source file remains pinned; output contains first exact supporting observation per association.',
            'mailbox_status': 'not_checked', 'outreach_eligibility': 'research_only'}
        atomic(output / 'manifest.json', result);return result
    finally: db.close()


def summary(db):
    return {'unique_record_email_associations': db.execute('SELECT COUNT(*) FROM associations').fetchone()[0],
            'unique_email_values': db.execute('SELECT COUNT(*) FROM emails').fetchone()[0],
            'published_email_observations': db.execute('SELECT COALESCE(SUM(observations),0) FROM associations').fetchone()[0]}


def main():
    parser = argparse.ArgumentParser();parser.add_argument('--run-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path);parser.add_argument('--stop-after', type=int);args = parser.parse_args()
    plan = provider_plan(args.run_root);args.output.mkdir(parents=True, exist_ok=True)
    atomic(args.output / 'input-plan.json', {'version': VERSION, 'kind': 'provider_explicit_structured_email_fields', 'files': plan})
    result = recover(plan, args.output, stop_after=args.stop_after, progress=lambda e: print(json.dumps(e), flush=True))
    print(json.dumps({k: v for k, v in result.items() if k != 'source_file_reports'}), flush=True)


if __name__ == '__main__': main()
