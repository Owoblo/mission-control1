"""Tiny offline extraction of explicitly published Lanark business email fields.

Reads original hashed directory pages only. No network, SMTP, canonical store,
named-contact inference, mail sending or frozen-source modification.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
import shutil
from pathlib import Path
from urllib.parse import unquote, urljoin

from lxml import html

from .store import stamp
from .transport import SourceBlocked

SOURCE_ID = 'lanark-highlands-bta-public-directory'
VERSION = 'saved-lanark-published-business-email/2026-10-27.1'
EMAIL = re.compile(r"[A-Z0-9.!#$%&'*+/=?^_`{|}~\-]+@[A-Z0-9](?:[A-Z0-9.\-]*[A-Z0-9])?\.[A-Z]{2,63}", re.I)


def parse_published_email_fields(body, source_url, observed_at, *, artifact_sha256, rights_status):
    rows, fields = [], 0
    doc = html.fromstring(body)
    for card in doc.xpath('//div[starts-with(@id,"wpbdp-listing-")]'):
        native = re.fullmatch(r'wpbdp-listing-(\d+)', card.get('id') or '')
        if not native: raise SourceBlocked('Published email card native ID schema differs')
        title = card.xpath('./div[contains(@class,"listing-title")]//h3/a[@href]')
        if len(title) != 1: raise SourceBlocked('Published business title/profile schema differs')
        field_nodes = card.xpath('.//div[contains(@class,"wpbdp-field-display")][span[contains(@class,"field-label") and normalize-space(.)="Business Contact Email"]]')
        for field in field_nodes:
            fields += 1;found = {}
            for anchor in field.xpath('.//a[@href]'):
                href = anchor.get('href') or ''
                if href.lower().startswith('mailto:'):
                    literal = unquote(href[7:].split('?', 1)[0])
                    for value in re.split(r'[,;]', literal):
                        value = value.strip()
                        if EMAIL.fullmatch(value): found.setdefault(value.casefold(), {'original': value, 'methods': set()})['methods'].add('explicit_business_contact_email_mailto')
            # Text is confined to the explicitly labelled business email field;
            # footer, narrative, biography and unrelated addresses are excluded.
            visible_value = ' '.join(' '.join(node.itertext()) for node in field.xpath('./div|./a'))
            for value in EMAIL.findall(visible_value):
                found.setdefault(value.casefold(), {'original': value, 'methods': set()})['methods'].add('explicit_business_contact_email_text')
            for email, fact in sorted(found.items()):
                rows.append({'email': email, 'email_as_published': fact['original'], 'source_url': source_url,
                    'observed_at': observed_at, 'source_id': SOURCE_ID, 'source_record_id': native.group(1),
                    'organisation_name': ' '.join(title[0].text_content().split()),
                    'organisation_profile_url': urljoin(source_url, title[0].get('href')),
                    'extraction_method': '+'.join(sorted(fact['methods'])),
                    'source_artifact_sha256': artifact_sha256, 'source_field_label': 'Business Contact Email',
                    'identity_status': 'source_published_candidate', 'mailbox_status': 'not_checked',
                    'outreach_eligibility': 'research_only', 'rights_status': rights_status,
                    'public_redistribution_permission': 'not_established', 'source_publication_date': None,
                    'person_name_or_role_inferred': False, 'messages_sent': 0})
    return rows, fields


def extract_lanark_saved_emails(folder, output):
    folder, output = Path(folder), Path(output)
    if shutil.disk_usage(folder).free < 2 * 1024**3:
        raise SourceBlocked('Minimum2GiBfree retained even for tiny offline email extraction')
    manifest_path = folder / 'manifest.json';manifest = json.loads(manifest_path.read_text())
    if (manifest.get('source_id') != SOURCE_ID or manifest.get('source_inventory_exhausted') is not True
        or manifest.get('rights_status') != 'limited_factual_review_only'):
        raise SourceBlocked('Only the reviewed completed limited-internal-factual Lanark source is supported')
    rows, fields = [], 0
    for receipt in manifest['raw_receipts']:
        path = folder / receipt['file']
        if path.is_symlink() or not path.resolve().is_relative_to(folder.resolve()):
            raise SourceBlocked('Original email source receipt left frozen source folder')
        if hashlib.sha256(path.read_bytes()).hexdigest() != receipt['gzip_sha256']:
            raise SourceBlocked('Original email source gzip checksum differs')
        body = gzip.open(path, 'rb').read()
        if len(body) != receipt['source_bytes'] or hashlib.sha256(body).hexdigest() != receipt['source_body_sha256']:
            raise SourceBlocked('Original email publisher bytes differ')
        facts, n = parse_published_email_fields(body, receipt['source_url'], receipt['observed_at'],
            artifact_sha256=receipt['source_body_sha256'], rights_status=manifest['rights_status'])
        rows += facts;fields += n
    unique = {}
    for row in rows:
        key = (row['source_id'], row['source_record_id'], row['email'])
        if key in unique: raise SourceBlocked('Email source association repeated across native source pages')
        unique[key] = row
    output.mkdir(parents=True, exist_ok=True)
    jsonl = output / 'published-email-associations.jsonl'
    jsonl.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows))
    csv_path = output / 'published-email-associations.csv'
    columns = list(rows[0]) if rows else ['email', 'source_url', 'observed_at', 'source_id', 'source_record_id', 'organisation_name', 'extraction_method', 'source_artifact_sha256', 'identity_status', 'mailbox_status', 'outreach_eligibility', 'rights_status']
    with csv_path.open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=columns);writer.writeheader();writer.writerows(rows)
    proof = {'status': 'passed', 'extracted_at': stamp(), 'parser_version': VERSION, 'source_id': SOURCE_ID,
        'publisher_pages_verified': len(manifest['raw_receipts']), 'source_business_email_fields': fields,
        'published_record_email_associations': len(rows), 'unique_email_values': len({r['email'] for r in rows}),
        'source_manifest_sha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        'source_artifact_refs': [{'source_artifact_sha256': r['source_body_sha256'],
            'source_gzip_sha256': r['gzip_sha256'], 'source_artifact_path': str(folder / r['file']),
            'source_url': r['source_url'], 'observed_at': r['observed_at']} for r in manifest['raw_receipts']],
        'jsonl_file': str(jsonl), 'jsonl_sha256': hashlib.sha256(jsonl.read_bytes()).hexdigest(),
        'csv_file': str(csv_path), 'csv_sha256': hashlib.sha256(csv_path.read_bytes()).hexdigest(),
        'output_bytes': jsonl.stat().st_size + csv_path.stat().st_size, 'network_requests': 0,
        'main_database_opened_or_mutated': False, 'frozen_source_files_changed': False,
        'mailbox_status': 'not_checked', 'outreach_eligibility': 'research_only',
        'rights_status': manifest['rights_status'], 'public_redistribution_permission': 'not_established',
        'person_name_or_role_inferred': False, 'messages_sent': 0}
    (output / 'extraction-receipt.json').write_text(json.dumps(proof, indent=2) + '\n')
    return proof


def main():
    parser = argparse.ArgumentParser();parser.add_argument('--folder', required=True, type=Path);parser.add_argument('--output', required=True, type=Path);args = parser.parse_args()
    print(json.dumps(extract_lanark_saved_emails(args.folder, args.output), indent=2), flush=True)


if __name__ == '__main__': main()
