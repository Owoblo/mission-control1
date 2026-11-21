"""Small, complete native public directory rosters for configured eastern areas.

Uses ordinary GET pagination and a private source-receipt archive. Only short
published organisation facts are structured; no people, biographies, descriptions,
emails, ownership or verified occupancy inference. No canonical DB is opened.
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
from urllib.parse import urljoin, urlsplit

from lxml import html

from .store import stamp
from .transport import Transport, SourceBlocked

VERSION = 'eastern-native-public-rosters/2026-10-27.3'
MIN_FREE = 2 * 1024**3
SOURCES = {
    'mcnab': {'id': 'mcnab-braeside-public-business-category-roster', 'label': 'McNab/Braeside',
        'publisher': 'Township of McNab/Braeside', 'family': 'municipal_directory',
        'url': 'https://www.mcnabbraeside.com/business-directory/'},
    'rockland': {'id': 'clarence-rockland-public-business-directory', 'label': 'Rockland',
        'publisher': 'City of Clarence-Rockland', 'family': 'municipal_directory',
        'url': 'https://choisir-choose.clarence-rockland.com/business-resources/business-directory'},
    'lanark': {'id': 'lanark-highlands-bta-public-directory', 'label': 'Lanark Highlands',
        'publisher': 'Lanark Highlands Business and Tourism Association', 'family': 'economic_development',
        'url': 'https://www.lanarkhighlandsbta.ca/listings/'},
}


def text(node):
    return ' '.join(node.text_content().split()) if node is not None else None


def parse_page(kind, body, url, *, include_lanark_address=True):
    doc = html.fromstring(body)
    rows, counts, next_urls = [], [], []
    if kind == 'mcnab':
        sections = doc.xpath('//div[contains(concat(" ",normalize-space(@class)," ")," business-summary ")]')
        if not sections: raise SourceBlocked('McNab category roster sections missing')
        detail_page = bool(sections[0].xpath('./a/strong'))
        if detail_page:
            headings = doc.xpath('//h1')
            if len(headings) != 1: raise SourceBlocked('McNab source category heading missing')
            category = text(headings[0])
            for section in sections:
                anchors = section.xpath('./a[@href]')
                if len(anchors) != 1: raise SourceBlocked('McNab native category listing identity differs')
                profile = urljoin(url, anchors[0].get('href'));native = re.fullmatch(r'/business-directory/(\d+)/', urlsplit(profile).path)
                if not native: raise SourceBlocked('McNab native source profile ID missing')
                address_nodes = section.xpath('./div[contains(@class,"business-summary-address")]')
                address_lines = [' '.join(v.split()) for v in address_nodes[0].itertext() if v.strip()] if len(address_nodes) == 1 else []
                web = section.xpath('./div[contains(@class,"business-summary-contact")]//a[@href]/@href')
                rows.append({'source_record_id': native.group(1), 'profile_url': profile, 'name': text(anchors[0]),
                    'address': '\n'.join(address_lines) or None, 'published_address_lines': address_lines,
                    'location_type': 'mailing_address_candidate' if address_lines and re.match(r'(?i)^P\.?\s*O\.?\s*Box', address_lines[0]) else 'source_reported_address_candidate',
                    'website': web[0] if len(web) == 1 else None, 'categories': [category], 'source_category_url': url})
            counts.append({'category': category, 'parsed_rows': len(rows), 'expanded_native_category': True})
            sections = []
        for section in sections:
            category_nodes = section.xpath('./div/strong/a[@href]')
            controls = section.xpath('./div[contains(@class,"control")]/a')
            if len(category_nodes) != 1 or len(controls) != 1:
                raise SourceBlocked('McNab category/count schema differs')
            category = text(category_nodes[0]);match = re.fullmatch(r'(\d+) listings? - see all', text(controls[0]) or '')
            if not match: raise SourceBlocked('McNab literal category listing count missing')
            current = []
            for a in section.xpath('./div/a[@href]'):
                profile = urljoin(url, a.get('href'));match_id = re.fullmatch(r'/business-directory/(\d+)/', urlsplit(profile).path)
                if not match_id: continue
                current.append({'source_record_id': match_id.group(1), 'profile_url': profile,
                    'name': text(a), 'categories': [category], 'source_category_url': urljoin(url, category_nodes[0].get('href'))})
            expected = int(match.group(1))
            if len(current) != expected:
                if len(current) == 10 and expected > 10:
                    pass
                else:
                    raise SourceBlocked('McNab category entries do not reconcile with printed source count')
            counts.append({'category': category, 'reported_rows': expected, 'parsed_rows': len(current), 'complete_in_index': len(current) == expected})
            # Every advertised category is traversed, including small sections;
            # their ordinary source cards contain additional address facts.
            next_urls.append(urljoin(url, category_nodes[0].get('href')))
            rows += current
    elif kind == 'rockland':
        cards = doc.xpath('//article[contains(concat(" ",normalize-space(@class)," ")," node--type-business ")]')
        if not cards: raise SourceBlocked('Rockland native business cards missing')
        for card in cards:
            profile = urljoin(url, card.get('about') or '')
            if not urlsplit(profile).path.startswith('/business-resources/business-directory/'):
                raise SourceBlocked('Rockland publisher business profile identity missing')
            def field(cls):
                nodes = card.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," ' + cls + ' ")]')
                return text(nodes[0]) if len(nodes) == 1 else None
            website = card.xpath('.//*[contains(@class,"field--name-field-business-website")]//a/@href')
            rows.append({'source_record_id': profile, 'profile_url': profile,
                'name': field('field--name-title'), 'address': field('address-line1'), 'city': field('locality'),
                'province': field('administrative-area'), 'country': field('country'), 'postal_code': field('postal-code'),
                'website': website[0] if len(website) == 1 else None, 'categories': []})
        next_urls = [urljoin(url, a.get('href')) for a in doc.xpath('//a[contains(@title,"Go to next page") or contains(@rel,"next") or parent::li[contains(@class,"pager__item--next")]]')]
    elif kind == 'lanark':
        cards = doc.xpath('//div[starts-with(@id,"wpbdp-listing-")]')
        if not cards: raise SourceBlocked('Lanark publisher native listing cards missing')
        for card in cards:
            match = re.fullmatch(r'wpbdp-listing-(\d+)', card.get('id') or '')
            if not match: raise SourceBlocked('Lanark native listing ID differs')
            headings = card.xpath('./div[contains(@class,"listing-title")]//h3/a[@href]')
            if len(headings) != 1: raise SourceBlocked('Lanark native business title missing')
            def values(name):
                return card.xpath('.//div[contains(concat(" ",normalize-space(@class)," ")," wpbdp-field-' + name + ' ")]/div[contains(@class,"value")]')
            category = values('business_genre');websites = values('business_website_address');addresses = values('business_address')
            if include_lanark_address:
                # This publisher renders the exact Business Address field in
                # a separate address-info block rather than a WPBDP meta class.
                addresses = card.xpath('.//div[contains(@class,"wpbdp-field-display")][span[contains(@class,"field-label") and normalize-space(.)="Business Address"]]/div')
            website_links = websites[0].xpath('.//a/@href') if len(websites) == 1 else []
            rows.append({'source_record_id': match.group(1), 'profile_url': urljoin(url, headings[0].get('href')),
                'name': text(headings[0]), 'categories': [text(a) for a in category[0].xpath('.//a')] if len(category) == 1 else [],
                'website': website_links[0] if len(website_links) == 1 else None,
                'address': text(addresses[0]) if len(addresses) == 1 else None})
        next_urls = [urljoin(url, a.get('href')) for a in doc.xpath('//a[@href]')
            if re.match(r'(?i)^Next\b', text(a) or '') and re.search(r'/listings/page/\d+/', urljoin(url, a.get('href')))]
    else: raise SourceBlocked('Unreviewed eastern roster schema')
    for row in rows:
        for key in ['address', 'city', 'province', 'country', 'postal_code', 'website']:
            row.setdefault(key, None)
        row.update(source_url=url, record_type='publisher_directory_listing_candidate', entity_type='organisation_candidate',
            source_published_at=None, physical_presence_verified=False, legal_company_verified=False,
            current_operation_verified=False, campaign_ready=False, phone=None, email=None,
            source_record_id_basis='Publisher native listing ID' if kind != 'rockland' else 'Publisher native public business profile URL')
    next_urls = sorted(set(next_urls))
    if len(next_urls) > 1 and kind != 'mcnab': raise SourceBlocked('Ambiguous native Next link')
    return rows, next_urls, counts


def save_json(path, value):
    path = Path(path);temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n');temporary.replace(path)


def guard(folder):
    if shutil.disk_usage(folder).free < MIN_FREE:
        raise SourceBlocked('Minimum2GiB free required before a source write')


def acquire(folder, kind):
    """Anonymous native GET traversal only, source exhaustion never market completeness."""
    if kind not in SOURCES: raise SourceBlocked('Unknown eastern public roster')
    folder = Path(folder);folder.mkdir(parents=True, exist_ok=True);guard(folder)
    config = SOURCES[kind];manifest_file = folder / 'manifest.json'
    if manifest_file.exists():
        old = json.loads(manifest_file.read_text())
        if old.get('source_inventory_exhausted') is True:
            # A later parser version does not authorise overwriting a frozen
            # completed capture. Revisions use a new folder and explicit audit.
            if hashlib.sha256((folder / old['records_file']).read_bytes()).hexdigest() != old['records_sha256']:
                raise SourceBlocked('Completed source selected-fact bytes drifted')
            for receipt in old['raw_receipts']:
                if hashlib.sha256((folder / receipt['file']).read_bytes()).hexdigest() != receipt['gzip_sha256']:
                    raise SourceBlocked('Completed source original receipt drifted')
            return old
        # Keep failed native acquisition attempts visible when resuming.
        prior = folder / ('previous-attempt-' + hashlib.sha256(manifest_file.read_bytes()).hexdigest()[:16] + '.json')
        if not prior.exists(): prior.write_bytes(manifest_file.read_bytes())
    save_json(manifest_file, {'source_id': config['id'], 'status': 'running',
        'parser_version': VERSION, 'source_inventory_exhausted': False, 'started_at': stamp(),
        'market_completeness_verified': False, 'canonical_database_mutated': False})
    host = urlsplit(config['url']).hostname
    transport = Transport(max_requests=150, max_bytes=50_000_000, max_response_bytes=4_000_000,
        retries=1, min_interval=.7, allowed_hosts=[host], timeout=25)
    appearances, receipts, counts, visited = [], [], [], set()
    url = config['url'];pending = [];status = 'acquired_partial';error = None
    try:
        while url:
            if url in visited: raise SourceBlocked('Native directory pagination repeated a page URL')
            if urlsplit(url).hostname != host: raise SourceBlocked('Native next page left reviewed publisher host')
            guard(folder);visited.add(url);response = transport.fetch(url);observed = stamp()
            # Only anonymous response bytes/hash are archived; no cookies/headers.
            path = folder / ('page-' + hashlib.sha256(url.encode()).hexdigest()[:12] + '-' + hashlib.sha256(response.body).hexdigest()[:12] + '.private.html.gz')
            path.write_bytes(gzip.compress(response.body, mtime=0))
            receipt = {'source_url': url, 'response_url': response.url, 'observed_at': observed,
                'status': response.status, 'file': path.name, 'gzip_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'source_body_sha256': hashlib.sha256(response.body).hexdigest(), 'source_bytes': len(response.body)}
            receipts.append(receipt)
            notice_doc = html.fromstring(response.body)
            new_policy_links = [urljoin(response.url, a.get('href')) for a in notice_doc.xpath('//a[@href]')
                if re.search(r'\b(?:privacy|terms of use|terms and conditions|disclaimer)\b', text(a) or '', re.I)]
            if new_policy_links:
                raise SourceBlocked('New linked publisher policy requires independent review before facts: ' + ', '.join(sorted(set(new_policy_links))))
            rows, next_urls, page_counts = parse_page(kind, response.body, response.url)
            page_ids = [r['source_record_id'] for r in rows]
            if len(receipts) > 1 and kind != 'mcnab' and set(page_ids).intersection(r['source_record_id'] for r in appearances):
                raise SourceBlocked('Native directory pages overlap source IDs; hold snapshot for review')
            for row in rows: row.update(observed_at=observed, original_source_receipt=receipt)
            appearances += rows;counts += page_counts
            save_json(folder / 'checkpoint.json', {'status': 'running', 'pages': len(receipts), 'source_rows': len(appearances), 'next': next_urls})
            pending += [next_url for next_url in next_urls if next_url not in visited and next_url not in pending]
            url = pending.pop(0) if pending else None
        if kind == 'mcnab':
            summaries = {v['category']: v for v in counts if 'reported_rows' in v}
            expanded = {v['category']: v for v in counts if v.get('expanded_native_category')}
            if not summaries or set(summaries) != set(expanded) or any(v['reported_rows'] != expanded[key]['parsed_rows'] for key, v in summaries.items()):
                raise SourceBlocked('McNab entire advertised category count/expanded row inventory differs')
        status = 'acquired_complete'
    except Exception as exc:
        error = type(exc).__name__ + ': ' + str(exc)
    grouped = {}
    for row in appearances:
        key = row['source_record_id']
        if key not in grouped: grouped[key] = {**row, 'categories': [], 'source_appearances': []}
        for field in ['address', 'published_address_lines', 'location_type', 'city', 'province', 'country', 'postal_code', 'website']:
            if not grouped[key].get(field) and row.get(field): grouped[key][field] = row[field]
        grouped[key]['categories'] = sorted(set(grouped[key]['categories']) | set(row['categories']))
        grouped[key]['source_appearances'].append(row)
    guard(folder);facts = folder / 'factual-observations.jsonl.gz'
    with gzip.open(facts, 'wt', encoding='utf-8') as handle:
        for row in grouped.values(): handle.write(json.dumps(row, ensure_ascii=False) + '\n')
    # Explicitly bounded internal factual research, not an open licence/reuse grant.
    review = {'rights_status': 'limited_factual_review_only', 'use_scope': 'internal_business_research',
        'open_licence': False, 'public_redistribution_permission': 'not_established',
        'reviewed_source_pages': [r['source_url'] for r in receipts],
        'basis': 'Available source entry/footer notices independently reviewed on2026-10-27: no linked privacy/terms grant or explicit factual-copy/automation ban identified. User-authorised bounded internal minimal facts only; copyright retained, no open/public redistribution grant. Newly linked policies halt collection for review. No descriptions, people, email, media or biographies structured.',
        'source_receipts_preserved_privately': True}
    save_json(folder / 'rights-review.json', review)
    result = {'source_id': config['id'], 'publisher': config['publisher'], 'source_url': config['url'],
        'configured_labels': [config['label']], 'source_family': config['family'], 'status': status,
        'observed_at': receipts[0]['observed_at'] if receipts else stamp(), 'parser_version': VERSION,
        'source_inventory_exhausted': status == 'acquired_complete', 'source_inventory_scope': 'Entire ordinary native published directory index traversal, not every city business or detail field',
        'raw_listing_appearances': len(appearances), 'unique_source_ids': len(grouped), 'pages': len(receipts),
        'records_file': facts.name, 'records_sha256': hashlib.sha256(facts.read_bytes()).hexdigest(),
        'rights_status': review['rights_status'], 'rights_review': 'rights-review.json', 'raw_receipts': receipts,
        'category_count_reconciliations': counts, 'metrics': transport.metrics(), 'error': error,
        'market_completeness_verified': False, 'canonical_database_mutated': False, 'unique_company_count': None,
        'names_only_or_organisation_facts': True, 'no_people_contacts_ownership_or_tenancy_enrichment': True}
    save_json(manifest_file, result)
    save_json(folder / 'source-registry-fragment.json', {'id': config['id'], 'name': config['publisher'] + ' public directory',
        'source_type': config['family'], 'source_url': config['url'], 'publisher': config['publisher'],
        'rights_status': review['rights_status'], 'source_date': None, 'last_checked_at': result['observed_at'],
        'config': {'rights_scope': review['use_scope'], 'public_redistribution_authorised': False}})
    operation = {'schema_version': 1, 'operation_id': config['id'] + ':' + result['observed_at'],
        'checked_at': result['observed_at'], 'operational_area': 'ottawa', 'configured_labels': [config['label']],
        'source_family': config['family'], 'status': status, 'query_or_entry_url': config['url'],
        'evidence_urls': [r['source_url'] for r in receipts], 'source_id': config['id'],
        'rights_status': review['rights_status'], 'record_unit': 'Publisher public directory listing candidate',
        'acquired_raw_rows': len(appearances), 'unique_source_ids': len(grouped),
        'source_inventory_exhausted': result['source_inventory_exhausted'], 'market_completeness_verified': False,
        'artifact_paths': [str(manifest_file)], 'block_reason': error}
    with (folder / 'discovery-operations.jsonl').open('a') as handle: handle.write(json.dumps(operation) + '\n')
    return result


def audit_saved_roster(folder, kind):
    """Reparse every original page; verify native Next/category counts and CSV."""
    folder = Path(folder);guard(folder)
    manifest = json.loads((folder / 'manifest.json').read_text())
    if manifest.get('source_id') != SOURCES[kind]['id'] or manifest.get('source_inventory_exhausted') is not True:
        raise SourceBlocked('Only completed source-native rosters can pass independent saved-source audit')
    appearances, counts, traversed, expected = [], [], [], [SOURCES[kind]['url']]
    for receipt in manifest['raw_receipts']:
        if not expected or receipt['source_url'] != expected.pop(0):
            raise SourceBlocked('Saved source pages differ from exact advertised native traversal')
        path = folder / receipt['file']
        if path.is_symlink() or not path.resolve().is_relative_to(folder.resolve()):
            raise SourceBlocked('Original source receipt left reviewed folder')
        if hashlib.sha256(path.read_bytes()).hexdigest() != receipt['gzip_sha256']:
            raise SourceBlocked('Saved source gzip checksum differs')
        body = gzip.open(path, 'rb').read()
        if len(body) != receipt['source_bytes'] or hashlib.sha256(body).hexdigest() != receipt['source_body_sha256']:
            raise SourceBlocked('Saved original publisher bytes differ')
        rows, next_urls, page_counts = parse_page(kind, body, receipt['response_url'],
            include_lanark_address=manifest.get('parser_version') not in {'eastern-native-public-rosters/2026-10-27.1', 'eastern-native-public-rosters/2026-10-27.2'})
        traversed.append(receipt['source_url'])
        expected += [url for url in next_urls if url not in expected and url not in traversed]
        for row in rows: row.update(observed_at=receipt['observed_at'], original_source_receipt=receipt)
        appearances += rows;counts += page_counts
    if expected: raise SourceBlocked('A publisher-advertised native page/category remains uncollected')
    if kind == 'mcnab':
        reported = {v['category']: v['reported_rows'] for v in counts if 'reported_rows' in v}
        expanded = {v['category']: v['parsed_rows'] for v in counts if v.get('expanded_native_category')}
        if reported != expanded: raise SourceBlocked('Every McNab source category must reconcile exactly')
    facts = folder / manifest['records_file']
    if hashlib.sha256(facts.read_bytes()).hexdigest() != manifest['records_sha256']:
        raise SourceBlocked('Saved selected fact file checksum differs')
    rows = [json.loads(line) for line in gzip.open(facts, 'rt') if line.strip()]
    by_id = {row['source_record_id']: row for row in rows}
    if len(by_id) != len(rows) or len(rows) != manifest['unique_source_ids'] or len(appearances) != manifest['raw_listing_appearances']:
        raise SourceBlocked('All publisher appearances/native source keys do not reconcile')
    for row in appearances:
        if row['source_record_id'] not in by_id or row not in by_id[row['source_record_id']]['source_appearances']:
            raise SourceBlocked('Reparsed original source fact does not occur exactly in selected evidence')
    if sum(len(r['source_appearances']) for r in rows) != len(appearances):
        raise SourceBlocked('Selected rows include appearances absent from original publisher pages')
    columns = ['source_record_id', 'name', 'profile_url', 'address', 'city', 'province', 'country', 'postal_code',
               'website', 'categories', 'observed_at', 'record_type', 'physical_presence_verified', 'current_operation_verified']
    csv_file = folder / 'usable-published-facts.csv'
    with csv_file.open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=columns);writer.writeheader()
        for row in rows:
            values = {key: row.get(key) for key in columns};values['categories'] = json.dumps(values['categories'], ensure_ascii=False);writer.writerow(values)
    result = {'status': 'passed', 'independently_reparsed_original_pages': len(traversed),
        'raw_listing_appearances': len(appearances), 'unique_source_ids': len(rows),
        'source_category_counts_reconciled': len([v for v in counts if 'reported_rows' in v]),
        'records_sha256': manifest['records_sha256'], 'usable_csv': csv_file.name,
        'usable_csv_sha256': hashlib.sha256(csv_file.read_bytes()).hexdigest(),
        'rows_with_printed_address': sum(bool(r.get('address')) for r in rows),
        'rows_with_printed_country': sum(bool(r.get('country')) for r in rows),
        'rows_with_printed_website': sum(bool(r.get('website')) for r in rows),
        'source_inventory_exhausted': True, 'market_completeness_verified': False,
        'main_database_opened_or_mutated': False, 'native_traversal_checked_without_arbitrary_sample': True,
        'publisher_snapshot_atomicity_not_guaranteed': True, 'unique_company_count': None}
    save_json(folder / 'independent-saved-source-audit.json', result)
    return result


def main():
    parser = argparse.ArgumentParser();parser.add_argument('--folder', required=True, type=Path)
    parser.add_argument('--source', choices=sorted(SOURCES), required=True);parser.add_argument('--audit', action='store_true');args = parser.parse_args()
    print(json.dumps(audit_saved_roster(args.folder, args.source) if args.audit else acquire(args.folder, args.source), indent=2), flush=True)


if __name__ == '__main__': main()
