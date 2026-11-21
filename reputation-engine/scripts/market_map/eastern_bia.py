"""Minimal factual full Kanata North BIA roster via its ordinary public GET UI.

Anonymous page nonce stays in memory, never in receipts/logs. No other AJAX
actions, forms, contact messages, authentication or access workarounds exist.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import re
from pathlib import Path
from urllib.parse import urlencode, urlsplit

from lxml import html

from .eastern_rosters import require_space
from .eastern_sources import save
from .store import stamp
from .transport import Transport, SourceBlocked

HOST = 'www.kanatanorthba.com'
ENTRY = 'https://' + HOST + '/member-directory/'
ACTION = 'https://' + HOST + '/wp-admin/admin-ajax.php'
POLICY = 'https://' + HOST + '/privacy-policy/'
SCRIPT = 'https://' + HOST + '/wp-content/themes/elevatex/dist/js/theme-9beed42341.js'


def content(node):
    return ' '.join(node.text_content().split())


def parse_cards(body, *, source_url, observed_at, page, source_body_hash):
    doc = html.fromstring(body, parser=html.HTMLParser(encoding='utf-8'))
    rows = []
    for ordinal, card in enumerate(doc.xpath('//article[contains(concat(" ",normalize-space(@class)," ")," company ")]'), 1):
        headings = card.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," company__heading ")]')
        if len(headings) != 1 or not content(headings[0]):
            raise SourceBlocked('Kanata North company heading schema differs')
        address_nodes = card.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," company__address ")]')
        if len(address_nodes) > 1:
            raise SourceBlocked('Kanata North printed company address is ambiguous')
        address = content(address_nodes[0]) if address_nodes else None
        website = None
        for col in card.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," company__details ")]/*'):
            labels = [content(s).casefold().rstrip(':') for s in col.xpath('./h3/span')]
            if 'website' in labels:
                links = col.xpath('./p/a[@href]')
                if len(links) == 1 and urlsplit(links[0].get('href')).scheme in ('https', 'http'):
                    website = links[0].get('href')
        terms = card.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," company__terms ")]')
        categories = [content(a) for n in terms for a in n.xpath('.//a|.//span[contains(concat(" ",normalize-space(@class)," ")," modal__page-label ")]') if content(a)]
        postal = re.search(r'\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b', address or '', re.I)
        city = province = None
        if address:
            parts = [part.strip() for part in address.split(',')]
            tail = re.sub(r'\s*[A-Z]\d[A-Z]\s?\d[A-Z]\d\s*$', '', parts[-1], flags=re.I).strip()
            labels = {'on': 'ON', 'ontario': 'ON', 'qc': 'QC', 'quebec': 'QC', 'québec': 'QC'}
            if len(parts) >= 3 and tail.casefold() in labels:
                province, city = labels[tail.casefold()], parts[-2]
            elif len(parts) >= 2:
                match = re.fullmatch(r'(.+?)\s+(ON|Ontario|QC|Quebec|Québec)', tail, re.I)
                if match:
                    city, province = match.group(1), labels[match.group(2).casefold()]
        if city and (re.search(r'\b(?:floor|suite|unit)\b', city, re.I) or re.match(r'^\d', city)):
            city = None
        factual = {'name': content(headings[0]), 'source_printed_address': address,
                   'source_website': website, 'source_categories': categories,
                   'source_page': page, 'source_row_on_page': ordinal,
                   'source_page_body_sha256': source_body_hash}
        rows.append({'name': factual['name'], 'website': website, 'address': address, 'city': city,
                     'province': province, 'postal_code': postal.group(0).upper() if postal else None,
                     'country': 'CA' if address and any(p.strip().casefold() == 'canada' for p in address.split(',')) else None,
                     'phone': None, 'email': None, 'categories': categories, 'raw_payload': factual,
                     'source_url': source_url, 'observed_at': observed_at, 'source_published_at': None,
                     'location_type': 'source_listed_address', 'physical_site_verified': False,
                     'current_operation_verified': False, 'ownership_or_tenancy_inferred': False,
                     'source_record_id_basis': 'snapshot_factual_fingerprint_plus_occurrence_not_publisher_identifier'})
    return rows


def fetch_page(folder, page, nonce, per_page, transport):
    receipt_path = folder / ('page-' + str(page) + '.receipt.json')
    if receipt_path.exists():
        meta = json.loads(receipt_path.read_text())
        path = folder / meta['file']
        if hashlib.sha256(path.read_bytes()).hexdigest() != meta['gzip_sha256']:
            raise SourceBlocked('Kanata North saved page gzip differs')
        body = gzip.open(path, 'rb').read()
        if hashlib.sha256(body).hexdigest() != meta['body_sha256']:
            raise SourceBlocked('Kanata North saved page body differs')
        return json.loads(body), meta
    require_space(folder)
    safe = {'action': 'elevatex_load_more_companies', 'posts_per_page': per_page, 'page': page, 'category': '', 'search': ''}
    # Same GET action, page size and fields published by the source's own
    # companies Load more script. No forms or other actions are accepted.
    try:
        response = transport.fetch(ACTION + '?' + urlencode({**safe, 'nonce': nonce}))
        value = response.json()
    except Exception as exc:
        # The original exception can contain a credential-bearing request URL.
        raise SourceBlocked('Kanata North public directory GET failed; no token or cookie values logged; ' + type(exc).__name__) from None
    if not isinstance(value, dict) or value.get('success') is not True or not isinstance(value.get('data'), dict):
        raise SourceBlocked('Kanata North public directory returned unsuccessful/nonstandard JSON')
    path = folder / ('page-' + str(page) + '.private.json.gz')
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('wb') as out, gzip.GzipFile(filename='', fileobj=out, mode='wb', mtime=0) as zipped:
        zipped.write(response.body)
    temporary.replace(path)
    meta = {'source_action_url': ACTION, 'safe_query_parameters': safe,
            'anonymous_nonce_stored_or_logged': False, 'observed_at': stamp(), 'file': path.name,
            'body_sha256': hashlib.sha256(response.body).hexdigest(), 'gzip_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'source_bytes': len(response.body), 'private_traceability_receipt': True,
            'public_redistribution_permission': 'not_established'}
    save(receipt_path, meta)
    return value, meta


def collect(folder, inspection_folder, *, offline_replay=False):
    folder, inspection_folder = Path(folder), Path(inspection_folder)
    folder.mkdir(parents=True, exist_ok=True)
    require_space(folder)
    source = json.loads((inspection_folder / 'kanata-north-directory.receipt.json').read_text())
    path = inspection_folder / source['file']
    if hashlib.sha256(path.read_bytes()).hexdigest() != source['gzip_sha256']:
        raise SourceBlocked('Kanata North reviewed source page differs')
    body = gzip.open(path, 'rb').read()
    if hashlib.sha256(body).hexdigest() != source['source_body_sha256']:
        raise SourceBlocked('Kanata North reviewed source body differs')
    for url in (POLICY, SCRIPT):
        receipt = json.loads((inspection_folder / ('policy-' + hashlib.sha256(url.encode()).hexdigest()[:16] + '.receipt.json')).read_text())
        if receipt.get('response_status') != 200 or hashlib.sha256((inspection_folder / receipt['file']).read_bytes()).hexdigest() != receipt['gzip_sha256']:
            raise SourceBlocked('Kanata North reviewed policy/public-script receipt differs')
    rights = json.loads((folder / 'rights-review.json').read_text())
    if rights.get('rights_status') != 'limited_factual_review_only' or not rights.get('internal_factual_research_approved'):
        raise SourceBlocked('Kanata North internal factual rights gate missing')
    document = html.fromstring(body)
    counts = document.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," companies__results ")]')
    targets = document.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," companies__target ")]')
    nonces = document.xpath('//input[@id="_wpnonce"]/@value')
    if len(counts) != 1 or len(targets) != 1 or len(nonces) != 1:
        raise SourceBlocked('Kanata North normal directory controls differ')
    total, per_page = int(content(counts[0])), int(targets[0].get('data-posts-per-page'))
    if per_page != 10 or not 0 < total <= 10000:
        raise SourceBlocked('Kanata North declared source page/count scope requires review')
    if offline_replay and not all((folder / ('page-' + str(number) + '.receipt.json')).exists() for number in range(1, math.ceil(total / per_page) + 1)):
        raise SourceBlocked('Offline replay requires every native source-page receipt')
    transport = Transport(max_requests=1500, max_bytes=100000000, max_response_bytes=3000000,
                          timeout=25, retries=1, min_interval=.5, allowed_hosts=[HOST])
    rows, receipts = [], []
    status = {'source_id': 'kanata-north-bia-directory', 'status': 'acquired_partial', 'reported_row_count': total,
              'source_inventory_exhausted': False, 'market_completeness_verified': False, 'canonical_database_mutated': False}
    try:
        # Exact public action robots check before parameters/nonce go anywhere.
        if not offline_replay:
            transport._guard(ACTION, {HOST})
            transport._check_robots(ACTION, {HOST})
        for number in range(1, math.ceil(total / per_page) + 1):
            value, meta = fetch_page(folder, number, nonces[0], per_page, transport)
            data = value['data']
            pieces = data.get('posts')
            if isinstance(pieces, str):
                pieces = [pieces]
            if not isinstance(pieces, list) or not all(isinstance(piece, str) for piece in pieces):
                raise SourceBlocked('Kanata North directory HTML response schema differs')
            fresh = parse_cards(''.join(pieces).encode(), source_url=ENTRY, observed_at=meta['observed_at'], page=number, source_body_hash=meta['body_sha256'])
            expected = min(per_page, total - (number - 1) * per_page)
            if len(fresh) != expected or data.get('more') is not (number * per_page < total):
                raise SourceBlocked('Kanata North native page size/more flag differs from published inventory')
            if data.get('total') is not None and int(data['total']) != total:
                raise SourceBlocked('Kanata North source total changed during acquisition')
            rows.extend(fresh)
            receipts.append(meta)
            status.update(processed_source_rows=len(rows), completed_pages=number)
            save(folder / 'acquisition-status.json', status)
            print(json.dumps({'page': number, 'rows': len(rows), 'reported': total}), flush=True)
        # Full observed first page matched against publisher's initial HTML.
        initial = parse_cards(body, source_url=ENTRY, observed_at=source['checked_at'], page=1, source_body_hash=source['source_body_sha256'])
        def identity(row):
            return (row['name'], row['address'], row['website'])
        if [identity(r) for r in initial] != [identity(r) for r in rows[:per_page]]:
            raise SourceBlocked('Kanata North first-page factual rows differ from inspected publisher entry page')
        seen = {}
        for row in rows:
            digest = hashlib.sha256(json.dumps({'name': row['name'], 'address': row['address'], 'website': row['website'], 'categories': row['categories']}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            seen[digest] = seen.get(digest, 0) + 1
            row['source_record_id'] = 'factual:' + digest + ':occurrence:' + str(seen[digest])
        output = folder / 'directory-facts.jsonl.gz'
        temporary = output.with_suffix(output.suffix + '.tmp')
        with temporary.open('wb') as out, gzip.GzipFile(filename='', fileobj=out, mode='wb', mtime=0) as zipped:
            for row in rows:
                zipped.write((json.dumps(row, ensure_ascii=False) + '\n').encode())
        temporary.replace(output)
        status.update(status='acquired_complete', source_inventory_exhausted=True, observed_source_rows=len(rows),
                      normalized_file=output.name, normalized_sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                      source_record_id_basis='all_content_derived_fingerprints_plus_occurrence_not_publisher_ids',
                      distinct_factual_fingerprints=len(seen), source_date=None, source_url=ENTRY, publisher='Kanata North Business Association',
                      rights_status='limited_factual_review_only', record_unit='public BIA directory listing observation; not verified legal company or occupied site',
                      pages=receipts, inspection_receipt=str(inspection_folder / 'kanata-north-directory.receipt.json'),
                      final_source_more_flag=False, original_entry_first_page_equals_action_first_page=True,
                      source_inventory_scope='Entire unfiltered public directory listing action at inspected source count; association About-page marketing totals have different scope.',
                      no_named_people_or_contact_channels=True, public_redistribution_permission='not_established', completed_at=stamp())
        save(folder / 'manifest.json', status)
        return status
    except Exception as exc:
        status.update(error=str(exc).replace(nonces[0], '[redacted]'), stopped_at=stamp())
        raise SourceBlocked(status['error']) from None
    finally:
        save(folder / 'acquisition-status.json', status)
        save(folder / ('http-metrics-' + stamp().replace(':', '-') + '.json'), transport.metrics())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--inspection', required=True, type=Path)
    parser.add_argument('--offline-replay', action='store_true')
    args = parser.parse_args()
    result = collect(args.output, args.inspection, offline_replay=args.offline_replay)
    print(json.dumps({k: v for k, v in result.items() if k != 'pages'}), flush=True)


def apply_bia_acquisition(store, folder, *, batch_size=250, progress=None):
    """Explicit local promotion, hash gated and atomic with source assertions."""
    from .place_import import _guard_storage, _committed_batch
    if not 1 <= batch_size <= 1000:
        raise ValueError('Use 1–1000 row BIA batches')
    folder = Path(folder)
    manifest = json.loads((folder / 'manifest.json').read_text())
    proof = json.loads((folder / 'independent-verification.json').read_text())
    rights = json.loads((folder / 'rights-review.json').read_text())
    if (manifest.get('source_id') != 'kanata-north-bia-directory' or manifest.get('status') != 'acquired_complete'
        or manifest.get('rights_status') != 'limited_factual_review_only' or not rights.get('internal_factual_research_approved')
        or proof.get('status') != 'passed' or proof.get('normalized_sha256') != manifest.get('normalized_sha256')):
        raise SourceBlocked('BIA complete/rights/independent-verification gate differs')
    path = folder / manifest['normalized_file']
    if hashlib.sha256(path.read_bytes()).hexdigest() != manifest['normalized_sha256']:
        raise SourceBlocked('BIA normalized source checksum differs before writes')
    for receipt in manifest['pages']:
        page_path = folder / receipt['file']
        if hashlib.sha256(page_path.read_bytes()).hexdigest() != receipt['gzip_sha256']:
            raise SourceBlocked('BIA original page checksum differs before writes')
        if hashlib.sha256(gzip.open(page_path, 'rb').read()).hexdigest() != receipt['body_sha256']:
            raise SourceBlocked('BIA original page body differs before writes')
    rows = [json.loads(line) for line in gzip.open(path, 'rt')]
    if len(rows) != manifest['observed_source_rows'] or len({r['source_record_id'] for r in rows}) != len(rows) or not all(r.get('name') for r in rows):
        raise SourceBlocked('BIA source rows/content-derived keys differ before writes')
    source = {'id': manifest['source_id'], 'name': 'Kanata North BIA complete public member directory listing snapshot',
              'publisher': manifest['publisher'], 'source_url': ENTRY, 'source_type': 'bia',
              'geography_scope': ['Kanata North BIA source district; not all Kanata'], 'sector_scope': ['*'],
              'rights_status': manifest['rights_status'], 'retrieval_status': 'accessible', 'access_method': 'source_documented_public_get_directory_action',
              'adapter_name': 'eastern_kanata_north_bia', 'source_date': None,
              'last_checked_at': manifest['pages'][-1]['observed_at'], 'reported_count': manifest['reported_row_count'],
              'count_definition': manifest['record_unit'], 'terms_url': POLICY,
              'notes': 'Minimal internal factual research only; no open licence/public redistribution. All source keys content-derived, not publisher-issued. Directory presence does not establish current physical occupancy, ownership or tenancy.',
              'config': {'source_inventory_exhausted': True, 'market_coverage_complete': False, 'source_originals_manifest': str(folder / 'manifest.json'),
                         'public_redistribution_authorised': False, 'publisher_native_ids_exposed': False}}
    _guard_storage(store, rows[:batch_size], {'source_folder': str(folder), 'source_id': source['id'], 'chunk': 'preflight'})
    source_id = store.upsert_source(source)
    metrics = [json.loads(p.read_text()) for p in folder.glob('http-metrics-*.json')]
    totals = {key: sum(item.get(key, 0) for item in metrics) for key in ['requests', 'bytes_fetched', 'elapsed_seconds']}
    report = {'source_id': source_id, 'rows': 0, 'new_organisations': 0, 'new_locations': 0, 'quarantined': 0, 'replayed_batches': 0}
    for start in range(0, len(rows), batch_size):
        chunk = rows[start:start + batch_size]
        metadata = {'batch_id': manifest['normalized_sha256'] + ':' + str(start), 'observed_at': manifest['pages'][0]['observed_at'],
                    'adapter_name': source['adapter_name'], 'parser_version': 'kanata-north-factual/2026-10-27.1',
                    'acquisition_id': 'kanata-north:' + manifest['normalized_sha256'], 'coverage_complete': False,
                    'source_inventory_exhausted': True, 'expected_count': len(rows),
                    'original_acquisition_manifest': str(folder / 'manifest.json'),
                    **{key: value if start == 0 else 0 for key, value in totals.items()}}
        if not _committed_batch(store, source_id, chunk, metadata):
            _guard_storage(store, chunk, {'source_folder': str(folder), 'source_id': source_id, 'chunk': start // batch_size})
        with store.transaction():
            result = store.ingest(source_id, chunk, run_metadata=metadata)
            if not result.get('replayed'):
                with store._buffer_field_assertions():
                    for row in chunk:
                        identity = store.db.execute('SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?', (source_id, row['source_record_id'])).fetchone()
                        quarantine = store.db.execute("SELECT 1 FROM source_run_items WHERE run_id=? AND source_record_id=? AND outcome='quarantined'", (result['run_id'], row['source_record_id'])).fetchone()
                        if not identity or quarantine:
                            continue
                        for field, value in {'source_record_id_basis': row['source_record_id_basis'], 'source_listed_role': 'listed_in_bia_member_directory',
                                             'physical_site_verified': False, 'current_operation_verified': False,
                                             'source_original_page_sha256': row['raw_payload']['source_page_body_sha256']}.items():
                            store.assert_field(identity['organisation_id'], 'organisation', field, value, identity['last_evidence_id'], row['observed_at'], method='publisher_bia_factual_assertion', review_status='source_supported')
        report['rows'] += len(chunk)
        report['replayed_batches'] += int(bool(result.get('replayed')))
        if not result.get('replayed'):
            report['new_organisations'] += result.get('inserted_count', 0)
            report['new_locations'] += result.get('new_locations', 0)
            report['quarantined'] += result.get('quarantined_count', 0)
        if progress:
            progress({**report, 'total': len(rows)})
    return report


if __name__ == '__main__':
    main()
