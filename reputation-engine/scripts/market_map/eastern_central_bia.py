"""Kanata Central's documented anonymous read-only directory form inspection."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from lxml import html

from .eastern_rosters import require_space
from .eastern_sources import save
from .store import stamp
from .transport import Transport, SourceBlocked

ENTRY = 'https://kanatacentral.com/directory/'
ACTION = 'https://kanatacentral.com/wp-admin/admin-ajax.php'
CONTEXT = {'kind': 'public_directory_listing', 'source_page_url': ENTRY}


def parse_listing(body, *, page, observed_at, body_hash, initial=False):
    doc = html.fromstring(body, parser=html.HTMLParser(encoding='utf-8'))
    nodes = doc.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," uc_post_title ")]/a[@href]') if initial else doc.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," store-card ")]/a[@href]')
    rows = []
    for ordinal, node in enumerate(nodes, 1):
        headings = node.xpath('.//h3')
        name = ' '.join((headings[0].text_content() if headings else node.text_content()).split())
        url = urljoin(ENTRY, node.get('href'))
        if not name or urlsplit(url).hostname != 'kanatacentral.com' or not urlsplit(url).path.startswith('/stores/'):
            raise SourceBlocked('Kanata Central factual listing/profile schema differs')
        factual = {'name': name, 'published_profile_url': url, 'source_page': page,
                   'source_row_on_page': ordinal, 'source_page_body_sha256': body_hash}
        rows.append({'name': name, 'source_record_id': url, 'source_record_id_basis': 'publisher_internal_profile_url',
                     'source_url': ENTRY, 'observed_at': observed_at, 'raw_payload': factual,
                     'website': None, 'address': None, 'city': None, 'province': None, 'country': None,
                     'email': None, 'phone': None, 'categories': [], 'source_published_at': None,
                     'physical_site_verified': False, 'current_operation_verified': False,
                     'ownership_or_tenancy_inferred': False, 'source_listed_role': 'listed_in_bia_directory'})
    return rows


def read_saved(folder, stem):
    receipt = json.loads((folder / (stem + '.receipt.json')).read_text())
    path = folder / receipt['file']
    if hashlib.sha256(path.read_bytes()).hexdigest() != receipt['gzip_sha256']:
        raise SourceBlocked('Kanata Central saved original gzip differs')
    body = gzip.open(path, 'rb').read()
    if hashlib.sha256(body).hexdigest() != receipt['body_sha256']:
        raise SourceBlocked('Kanata Central saved original body differs')
    return body, receipt


def original(folder, name, body, metadata):
    path = folder / (name + '.private.gz')
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('wb') as out, gzip.GzipFile(filename='', fileobj=out, mode='wb', mtime=0) as zipped:
        zipped.write(body)
    temporary.replace(path)
    receipt = {**metadata, 'observed_at': stamp(), 'file': path.name,
               'body_sha256': hashlib.sha256(body).hexdigest(), 'gzip_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
               'source_bytes': len(body), 'private_traceability_receipt': True,
               'public_redistribution_permission': 'not_established', 'nonce_or_cookie_values_logged': False}
    save(folder / (name + '.receipt.json'), receipt)
    return receipt


def inspect(folder):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    require_space(folder)
    t = Transport(allowed_hosts=['kanatacentral.com'], anonymous_directory_session=True,
                  max_requests=12, max_bytes=10000000, max_response_bytes=3000000,
                  min_interval=.5, timeout=25, retries=1)
    nonce = ''
    try:
        # Check exact action before even reading or transmitting its nonce.
        t._guard(ACTION, {'kanatacentral.com'})
        t._check_robots(ACTION, {'kanatacentral.com'})
        response = t.fetch(ENTRY)
        receipt = original(folder, 'entry', response.body, {'url': ENTRY, 'method': 'GET'})
        doc = html.fromstring(response.body, parser=html.HTMLParser(encoding='utf-8'))
        settings = []
        for node in doc.xpath('//script[not(@src)]'):
            match = re.search(r'var directory_ajax\s*=\s*(\{[^;]+\});', node.text_content())
            if match:
                settings.append(json.loads(match.group(1)))
        if len(settings) != 1 or settings[0].get('ajax_url') != ACTION:
            raise SourceBlocked('Kanata Central normal directory controls differ')
        nonce = settings[0].get('nonce', '')
        require_space(folder)
        response = t.fetch_directory_form(ACTION, {'action': 'filter_stores', 'search': '', 'nonce': nonce}, operation_context=CONTEXT)
        metadata = original(folder, 'first-result', response.body, {'url': ACTION, 'method': 'POST',
                             'safe_query_parameters': {'action': 'filter_stores', 'search': ''}, 'source_page': ENTRY})
        result = html.fromstring(response.body, parser=html.HTMLParser(encoding='utf-8'))
        for node in result.xpath('//script|//style'):
            node.drop_tree()
        inspection = {'status': 'first_native_directory_page_inspected', 'source_url': ENTRY,
                      'entry_receipt': receipt, 'first_page_receipt': metadata,
                      'source_inventory_exhausted': False, 'market_completeness_verified': False,
                      'canonical_database_mutated': False,
                      'native_load_more_controls': [{k: v for k, v in n.attrib.items() if k in {'class', 'data-page', 'data-industries', 'data-search'}} for n in result.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," load-more-btn ")]')],
                      'element_class_counts': {}, 'safe_internal_profile_links': sorted(set(result.xpath('//a[starts-with(@href,"https://kanatacentral.com/")]/@href')))}
        classes = {}
        for value in result.xpath('//*[@class]/@class'):
            for key in value.split():
                classes[key] = classes.get(key, 0) + 1
        inspection['element_class_counts'] = classes
        save(folder / 'schema-inspection.json', inspection)
        print(json.dumps({k: v for k, v in inspection.items() if k not in {'safe_internal_profile_links', 'element_class_counts'}}), flush=True)
        return inspection
    except Exception as exc:
        error = str(exc).replace(nonce, '[redacted]') if nonce else str(exc)
        save(folder / 'inspection-error.json', {'error': error, 'checked_at': stamp(), 'canonical_database_mutated': False})
        raise SourceBlocked(error) from None
    finally:
        save(folder / ('http-metrics-' + stamp().replace(':', '-') + '.json'), t.metrics())


def collect(folder):
    """Follow the source's documented page parameter through a terminal empty page.

    Native UI currently omits its Load more button. The page argument itself is
    explicitly published in its read-only filter_stores client. Missing button
    is not used as proof of a complete50-row inventory.
    """
    folder = Path(folder)
    require_space(folder)
    rights = json.loads((folder / 'rights-review.json').read_text())
    if rights.get('rights_status') != 'limited_factual_review_only' or not rights.get('internal_factual_research_approved'):
        raise SourceBlocked('Kanata Central reviewed internal factual scope missing')
    entry, entry_receipt = read_saved(folder, 'entry')
    initial = parse_listing(entry, page='initial-entry', observed_at=entry_receipt['observed_at'], body_hash=entry_receipt['body_sha256'], initial=True)
    doc = html.fromstring(entry, parser=html.HTMLParser(encoding='utf-8'))
    settings = [json.loads(m.group(1)) for node in doc.xpath('//script[not(@src)]')
                if (m := re.search(r'var directory_ajax\s*=\s*(\{[^;]+\});', node.text_content()))]
    if len(settings) != 1 or settings[0].get('ajax_url') != ACTION:
        raise SourceBlocked('Kanata Central source controls differ')
    nonce = settings[0].get('nonce', '')
    t = Transport(allowed_hosts=['kanatacentral.com'], anonymous_directory_session=True, max_requests=1500,
                  max_bytes=100000000, max_response_bytes=3000000, min_interval=.5, timeout=25, retries=1)
    appearances, receipts, page_sets = [], [], set()
    status = {'source_id': 'kanata-central-bia-directory', 'status': 'acquired_partial',
              'source_inventory_exhausted': False, 'market_completeness_verified': False,
              'canonical_database_mutated': False, 'native_missing_load_more_button': True}
    try:
        for number in range(1, 10001):
            stem = 'first-result' if number == 1 else 'result-page-' + str(number)
            if (folder / (stem + '.receipt.json')).exists():
                body, receipt = read_saved(folder, stem)
            else:
                require_space(folder)
                response = t.fetch_directory_form(ACTION, {'action': 'filter_stores', 'search': '', 'page': number, 'nonce': nonce}, operation_context=CONTEXT)
                body = response.body
                receipt = original(folder, stem, body, {'url': ACTION, 'method': 'POST',
                    'safe_query_parameters': {'action': 'filter_stores', 'search': '', 'page': number}, 'source_page': ENTRY})
            rows = parse_listing(body, page=number, observed_at=receipt['observed_at'], body_hash=receipt['body_sha256'])
            receipts.append(receipt)
            if not rows:
                # Empty body alone could be an error. The normal source's
                # explicit empty-results wording must appear too.
                text = ' '.join(html.fromstring(body, parser=html.HTMLParser(encoding='utf-8')).text_content().split()).casefold()
                if not any(wording in text for wording in ['no stores found', 'no results found', 'no stores match', 'no matching stores']):
                    raise SourceBlocked('Kanata Central terminal response lacks reviewed explicit empty-results marker')
                break
            signature = tuple(row['source_record_id'] for row in rows)
            if signature in page_sets:
                raise SourceBlocked('Kanata Central page loop/repeated profile inventory; partial receipt retained')
            page_sets.add(signature)
            appearances.extend(rows)
            status.update(processed_listing_appearances=len(appearances), completed_nonempty_pages=number)
            save(folder / 'acquisition-status.json', status)
            print(json.dumps({'page': number, 'source_appearances': len(appearances), 'page_rows': len(rows)}), flush=True)
        else:
            raise SourceBlocked('Reviewed directory pagination budget reached before source exhaustion')
        ids = {row['source_record_id'] for row in appearances}
        initial_ids = {row['source_record_id'] for row in initial}
        if not initial_ids or not initial_ids.issubset(ids):
            raise SourceBlocked('Kanata Central initial-entry profile inventory is not reconciled with all native action pages')
        output = folder / 'directory-facts.jsonl.gz'
        temporary = output.with_suffix(output.suffix + '.tmp')
        with temporary.open('wb') as out, gzip.GzipFile(filename='', fileobj=out, mode='wb', mtime=0) as zipped:
            for row in appearances:
                zipped.write((json.dumps(row, ensure_ascii=False) + '\n').encode())
        temporary.replace(output)
        status.update(status='acquired_complete', source_inventory_exhausted=True, observed_source_rows=len(appearances),
                      unique_published_profile_urls=len(ids), publisher_native_numeric_ids_exposed=False,
                      initial_entry_named_profiles=len(initial_ids), initial_entry_profiles_all_reconciled=True,
                      normalized_file=output.name, normalized_sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                      source_url=ENTRY, source_date=None, publisher='Kanata Central Business Improvement Area',
                      rights_status='limited_factual_review_only', pages=receipts, terminal_empty_page=number,
                      reported_row_count=None, record_unit='Source BIA directory listing appearance; unique published profile URLs separately counted',
                      source_inventory_scope='All unfiltered native filter_stores pages through explicit empty terminal result, reconciled with initial entry named profiles. Profile detail pages remain unsearched.',
                      completed_at=stamp(), public_redistribution_permission='not_established')
        save(folder / 'manifest.json', status)
        return status
    except Exception as exc:
        status.update(error=str(exc).replace(nonce, '[redacted]'), stopped_at=stamp())
        raise SourceBlocked(status['error']) from None
    finally:
        save(folder / 'acquisition-status.json', status)
        save(folder / ('http-metrics-' + stamp().replace(':', '-') + '.json'), t.metrics())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--collect', action='store_true')
    args = parser.parse_args()
    if args.collect:
        result = collect(args.output)
        print(json.dumps({key: value for key, value in result.items() if key != 'pages'}), flush=True)
    else:
        inspect(args.output)


if __name__ == '__main__':
    main()
