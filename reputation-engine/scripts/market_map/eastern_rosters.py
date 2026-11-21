"""Complete permitted minimal-factual North Grenville listing inventory.

Rows are source listing appearances, with unique publisher profile IDs counted
separately. No profile biographies, named people, decoded emails or ownership
claims are collected. Website visit redirects remain source links, not domains.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import re
import shutil
from pathlib import Path
from urllib.parse import urljoin

from lxml import html

from .eastern_sources import MINIMUM_FREE, save
from .store import stamp
from .transport import Transport, SourceBlocked

BASE = 'https://www.northgrenville.ca'
ENTRY = BASE + '/things-to-do/shopping-services/business-directory/shop/all?start=0'
PAGE = BASE + '/things-to-do/shopping-services/business-directory/shop/all?start='


def text(node):
    return ' '.join(node.text_content().split())


def parse_page(body, source_url, observed_at):
    doc = html.fromstring(body)
    whole = text(doc)
    counts = re.findall(r'Results\s+(\d+)\s*[-–]\s*(\d+)\s+of\s+([\d,]+)', whole, re.I)
    if len(set(counts)) != 1:
        raise SourceBlocked('North Grenville native result-range/count missing or ambiguous')
    first, last, total = (int(v.replace(',', '')) for v in counts[0])
    cards = doc.xpath('//*[contains(concat(" ", normalize-space(@class), " "), " listing-summary ")]')
    if len(cards) != last - first + 1:
        raise SourceBlocked('North Grenville advertised page range differs from factual card count')
    rows = []
    for ordinal, card in enumerate(cards, first):
        names = card.xpath('.//h3/a[@href]')
        if len(names) != 1 or not text(names[0]):
            raise SourceBlocked('North Grenville listing name/profile schema differs')
        ids = {m.group(1) for value in card.xpath('.//@id') if (m := re.fullmatch(r'field-\d+-link-(\d+)', value))}
        if len(ids) > 1:
            raise SourceBlocked('North Grenville card has conflicting publisher profile identifiers')
        native = next(iter(ids), None)
        profile_url = urljoin(BASE, names[0].get('href'))
        addresses = card.xpath('.//*[contains(concat(" ", normalize-space(@class), " "), " address ")]')
        address = text(addresses[0]) if len(addresses) == 1 else None
        if len(addresses) > 1:
            raise SourceBlocked('North Grenville card has ambiguous address fields')
        categories = [text(n) for n in card.xpath('.//*[contains(concat(" ", normalize-space(@class), " "), " category ")]//span[contains(concat(" ", normalize-space(@class), " "), " output ")]/a')]
        phone_nodes = card.xpath('.//a[starts-with(@href,"tel:")]')
        visit_nodes = card.xpath('.//*[contains(concat(" ", normalize-space(@class), " "), " mfieldtype_corewebsite ")]/a[@href]')
        province = city = postal = country = None
        if address:
            parts = [p.strip() for p in address.split(',')]
            country = 'CA' if any(p.casefold() == 'canada' for p in parts) else None
            match = re.search(r'\b([A-Z]\d[A-Z]\s?\d[A-Z]\d)\b', address, re.I)
            postal = match.group(1).upper() if match else None
            # Parse only printed suffix components. Neither the municipality
            # hosting the directory nor a postal prefix supplies a province.
            province_labels = {'on': 'ON', 'ontario': 'ON', 'qc': 'QC', 'quebec': 'QC', 'québec': 'QC'}
            suffix = list(parts)
            if suffix and suffix[-1].casefold() == 'canada':
                suffix.pop()
            if suffix and re.fullmatch(r'[A-Z]\d[A-Z]\s?\d[A-Z]\d', suffix[-1], re.I):
                suffix.pop()
            if len(suffix) >= 2 and suffix[-1].casefold() in province_labels:
                printed_provinces = set()
                while len(suffix) >= 2 and (suffix[-1].casefold() in province_labels or suffix[-1].casefold() == 'canada'):
                    value = suffix.pop().casefold()
                    if value in province_labels:
                        printed_provinces.add(province_labels[value])
                province = next(iter(printed_provinces)) if len(printed_provinces) == 1 else None
                if len(suffix) >= 2:
                    city = suffix[-1] or None
            elif len(suffix) >= 2:
                combined = re.fullmatch(r'(.+?)\s+(ON|Ontario|QC|Quebec|Québec)(?:\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d)?', suffix[-1], re.I)
                if combined:
                    city, province = combined.group(1), province_labels[combined.group(2).casefold()]
                elif postal and suffix[-1].casefold() != 'canada' and re.fullmatch(r'[^\d]+', suffix[-1]):
                    city = suffix[-1] or None
        factual = {'name': text(names[0]), 'source_profile_id': native, 'source_profile_url': profile_url,
                   'source_printed_address': address, 'source_categories': categories,
                   'source_phone': text(phone_nodes[0]) if len(phone_nodes) == 1 else None,
                   'source_website_visit_link': urljoin(BASE, visit_nodes[0].get('href')) if len(visit_nodes) == 1 else None,
                   'source_row_ordinal': ordinal, 'source_page_body_sha256': hashlib.sha256(body).hexdigest(),
                   'source_listing_page_url': source_url}
        rows.append({'name': factual['name'], 'source_record_id': native or ('profile-url:' + profile_url),
                     'source_record_id_basis': 'publisher_profile_field_link_id' if native else 'published_profile_url_fallback',
                     'source_url': source_url, 'observed_at': observed_at, 'address': address, 'city': city,
                     'province': province, 'postal_code': postal, 'country': country,
                     'website': None, 'email': None, 'phone': None, 'categories': categories, 'raw_payload': factual,
                     'location_type': 'source_listed_address', 'physical_site_verified': False,
                     'current_operation_verified': False, 'ownership_or_membership_inferred': False,
                     'source_published_at': None, 'contact_eligibility': 'research_only'})
    return {'first': first, 'last': last, 'total': total, 'rows': rows}


def require_space(folder):
    if shutil.disk_usage(folder).free < MINIMUM_FREE:
        raise RuntimeError('Minimum 2 GiB free required; saved roster checkpoint retained')


def receipt(folder, index, url, transport):
    path = folder / ('page-' + str(index) + '.receipt.json')
    if path.exists():
        metadata = json.loads(path.read_text())
        stored = folder / metadata['file']
        if metadata['url'] != url or hashlib.sha256(stored.read_bytes()).hexdigest() != metadata['gzip_sha256']:
            raise SourceBlocked('Saved North Grenville page receipt differs')
        with gzip.open(stored, 'rb') as handle:
            body = handle.read()
        if hashlib.sha256(body).hexdigest() != metadata['body_sha256']:
            raise SourceBlocked('Saved North Grenville body hash differs')
        return body, metadata
    require_space(folder)
    response = transport.fetch(url)
    file = folder / ('page-' + str(index) + '.private.html.gz')
    temporary = file.with_suffix(file.suffix + '.tmp')
    with temporary.open('wb') as out, gzip.GzipFile(filename='', fileobj=out, mode='wb', mtime=0) as zipped:
        zipped.write(response.body)
    temporary.replace(file)
    metadata = {'url': url, 'observed_at': stamp(), 'response_url': response.url,
                'response_status': response.status, 'file': file.name,
                'body_sha256': hashlib.sha256(response.body).hexdigest(),
                'gzip_sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'bytes': len(response.body),
                'private_traceability_receipt': True, 'public_redistribution_permission': 'not_established'}
    save(path, metadata)
    return response.body, metadata


def collect(folder):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    require_space(folder)
    policies = json.loads((folder / 'rights-review.json').read_text())
    if policies.get('rights_status') != 'limited_factual_review_only' or not policies.get('internal_factual_research_approved'):
        raise SourceBlocked('Reviewed internal minimal-factual rights decision required')
    transport = Transport(max_requests=1500, max_bytes=100000000, max_response_bytes=2000000,
                          timeout=25, retries=1, min_interval=.5, allowed_hosts=['www.northgrenville.ca', 'northgrenville.ca'])
    appearances, pages = [], []
    status = {'source_id': 'north-grenville-public-directory', 'started_at': stamp(),
              'status': 'acquired_partial', 'source_inventory_exhausted': False,
              'market_completeness_verified': False, 'canonical_database_mutated': False}
    try:
        first_body, first_receipt = receipt(folder, 0, ENTRY, transport)
        parsed = parse_page(first_body, ENTRY, first_receipt['observed_at'])
        total = parsed['total']
        if parsed['first'] != 1 or parsed['last'] != min(20, total):
            raise SourceBlocked('Native North Grenville initial page size changed')
        for page in range(math.ceil(total / 20)):
            url = ENTRY if page == 0 else PAGE + str(page * 20)
            body, metadata = (first_body, first_receipt) if page == 0 else receipt(folder, 'entry-route-' + str(page), url, transport)
            parsed = parse_page(body, url, metadata['observed_at'])
            if (parsed['total'], parsed['first'], parsed['last']) != (total, page * 20 + 1, min(total, (page + 1) * 20)):
                raise SourceBlocked('Native North Grenville page count/range changed during collection')
            appearances.extend(parsed['rows'])
            pages.append({'page': page, 'first': parsed['first'], 'last': parsed['last'], **metadata})
            status.update(processed_source_appearances=len(appearances), reported_row_count=total, completed_pages=len(pages))
            save(folder / 'acquisition-status.json', status)
            print(json.dumps({'page': page, 'rows': len(appearances), 'reported': total}), flush=True)
        # Independent terminal recheck detects a changing roster rather than
        # declaring the initial pages a complete current snapshot silently.
        require_space(folder)
        terminal_body, terminal = receipt(folder, 'terminal-first-recheck', ENTRY, transport)
        checked = parse_page(terminal_body, ENTRY, terminal['observed_at'])
        if checked['total'] != total or [r['source_record_id'] for r in checked['rows']] != [r['source_record_id'] for r in appearances[:20]]:
            raise SourceBlocked('North Grenville inventory changed between first and terminal first-page checks')
        ids = {r['source_record_id'] for r in appearances}
        variants = {}
        for row in appearances:
            variants.setdefault(row['source_record_id'], set()).add(json.dumps(row['raw_payload'], sort_keys=True, ensure_ascii=False))
        normalized = folder / 'listing-appearances.jsonl.gz'
        temporary = normalized.with_suffix(normalized.suffix + '.tmp')
        with temporary.open('wb') as out, gzip.GzipFile(filename='', fileobj=out, mode='wb', mtime=0) as zipped:
            for row in appearances:
                zipped.write((json.dumps(row, ensure_ascii=False) + '\n').encode())
        temporary.replace(normalized)
        status.update(status='acquired_complete', source_inventory_exhausted=True,
                      exhaustion_scope='All native unfiltered public listing-result pages; profile detail pages not acquired',
                      observed_listing_appearances=len(appearances), unique_source_profile_keys=len(ids),
                      native_profile_id_rows=sum(bool(r['raw_payload']['source_profile_id']) for r in appearances),
                      repeated_profile_keys=sum(1 for values in variants.values() if len(values) > 1),
                      normalized_file=normalized.name, normalized_sha256=hashlib.sha256(normalized.read_bytes()).hexdigest(),
                      source_url=ENTRY, rights_status=policies['rights_status'], source_date=None,
                      publisher='Municipality of North Grenville / ExploreNG', record_unit='directory listing appearance; unique profile keys separately reconciled',
                      pages=pages, terminal_first_page_recheck=terminal,
                      no_named_people_contact_enrichment_or_relationship_inference=True,
                      public_redistribution_permission='not_established', completed_at=stamp())
        save(folder / 'manifest.json', status)
        return status
    except Exception as exc:
        status.update(error=str(exc), stopped_at=stamp())
        raise
    finally:
        save(folder / 'acquisition-status.json', status)
        save(folder / ('http-metrics-' + stamp().replace(':', '-') + '.json'), transport.metrics())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = collect(args.output)
    print(json.dumps({k: v for k, v in result.items() if k not in ('pages', 'terminal_first_page_recheck')}), flush=True)


def apply_eastern_acquisition(store, folder, *, batch_size=250, progress=None):
    """Explicit local-only promotion of the reviewed full North Grenville roster.

    Private originals and the 74-row native-route scope probe remain immutable
    external evidence references; only the reconciled 800-row main roster enters
    account-candidate ingestion. Supplemental probe is not a new-company claim.
    """
    from .place_import import _guard_storage, _committed_batch
    if not 1 <= batch_size <= 1000:
        raise ValueError('Use 1–1000 row Eastern batches')
    folder = Path(folder)
    manifest = json.loads((folder / 'manifest.json').read_text())
    verification = json.loads((folder / 'independent-verification.json').read_text())
    rights = json.loads((folder / 'rights-review.json').read_text())
    if (manifest.get('source_id') != 'north-grenville-public-directory' or manifest.get('status') != 'acquired_complete'
        or manifest.get('rights_status') != 'limited_factual_review_only' or not rights.get('internal_factual_research_approved')
        or verification.get('status') != 'passed' or verification.get('normalized_sha256') != manifest.get('normalized_sha256')):
        raise SourceBlocked('Eastern complete-source/rights/independent-verification gate differs')
    path = folder / manifest['normalized_file']
    if hashlib.sha256(path.read_bytes()).hexdigest() != manifest['normalized_sha256']:
        raise SourceBlocked('Eastern normalized source checksum differs before writes')
    for page in [*manifest['pages'], manifest['terminal_first_page_recheck']]:
        raw_path = folder / page['file']
        if hashlib.sha256(raw_path.read_bytes()).hexdigest() != page['gzip_sha256']:
            raise SourceBlocked('Eastern original page checksum differs before writes')
        with gzip.open(raw_path, 'rb') as handle:
            if hashlib.sha256(handle.read()).hexdigest() != page['body_sha256']:
                raise SourceBlocked('Eastern original body checksum differs before writes')
    with gzip.open(path, 'rt') as handle:
        rows = [json.loads(line) for line in handle]
    if (len(rows) != manifest['observed_listing_appearances'] or len({r['source_record_id'] for r in rows}) != manifest['unique_source_profile_keys']
        or not all(r.get('name') for r in rows)):
        raise SourceBlocked('Eastern source row/key reconciliation differs before writes')
    source = {'id': manifest['source_id'], 'name': 'North Grenville complete published directory listing results',
              'publisher': manifest['publisher'], 'source_url': manifest['source_url'], 'source_type': 'municipal_directory',
              'geography_scope': ['North Grenville'], 'sector_scope': ['*'], 'rights_status': manifest['rights_status'],
              'retrieval_status': 'accessible', 'access_method': 'public_native_get_listing_pages',
              'adapter_name': 'eastern_north_grenville_directory', 'source_date': None,
              'last_checked_at': manifest['terminal_first_page_recheck']['observed_at'],
              'reported_count': manifest['reported_row_count'], 'count_definition': manifest['record_unit'],
              'config': {'source_inventory_exhausted': True, 'market_coverage_complete': False,
                         'source_originals_manifest': str(folder / 'manifest.json'), 'public_redistribution_authorised': False,
                         'source_profile_detail_pages_acquired': False, 'supplemental_native_route_probe': str(folder / 'native-linked-route-scope-probe.json')},
              'notes': 'Limited internal minimal factual use only. Not an open licence. Source printed address, category and role assertions remain unverified for current occupancy; no inferred owners, tenants or named contact enrichment.'}
    _guard_storage(store, rows[:batch_size], {'source_folder': str(folder), 'source_id': source['id'], 'chunk': 'preflight'})
    source_id = store.upsert_source(source)
    metrics = [json.loads(p.read_text()) for p in folder.glob('http-metrics-*.json')]
    totals = {key: sum(item.get(key, 0) for item in metrics) for key in ['requests', 'bytes_fetched', 'elapsed_seconds']}
    summary = {'source_id': source_id, 'rows': 0, 'new_organisations': 0, 'new_locations': 0, 'quarantined': 0, 'replayed_batches': 0}
    for start in range(0, len(rows), batch_size):
        chunk = rows[start:start + batch_size]
        metadata = {'batch_id': manifest['normalized_sha256'] + ':' + str(start), 'observed_at': manifest['pages'][0]['observed_at'],
                    'adapter_name': source['adapter_name'], 'parser_version': 'eastern-directory/2026-10-27.1',
                    'acquisition_id': 'north-grenville:' + manifest['normalized_sha256'], 'coverage_complete': False,
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
                        quarantined = store.db.execute("SELECT 1 FROM source_run_items WHERE run_id=? AND source_record_id=? AND outcome='quarantined'", (result['run_id'], row['source_record_id'])).fetchone()
                        if not identity or quarantined:
                            continue
                        assertions = {'source_record_id_basis': row['source_record_id_basis'], 'source_profile_url': row['raw_payload']['source_profile_url'],
                                      'source_address_role': 'directory_printed_address_unverified', 'physical_site_verified': False,
                                      'current_operation_verified': False, 'source_municipal_directory_context': 'North Grenville',
                                      'source_original_page_sha256': row['raw_payload']['source_page_body_sha256']}
                        for field, value in assertions.items():
                            store.assert_field(identity['organisation_id'], 'organisation', field, value, identity['last_evidence_id'], row['observed_at'], method='publisher_directory_factual_assertion', review_status='source_supported')
        summary['rows'] += len(chunk)
        summary['replayed_batches'] += int(bool(result.get('replayed')))
        if not result.get('replayed'):
            summary['new_organisations'] += result.get('inserted_count', 0)
            summary['new_locations'] += result.get('new_locations', 0)
            summary['quarantined'] += result.get('quarantined_count', 0)
        if progress:
            progress({**summary, 'total': len(rows)})
    return summary


if __name__ == '__main__':
    main()
