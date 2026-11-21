"""Small primary-source/policy inspection for Ottawa and configured eastern areas.

This command acquires entry-page receipts only. It never calls a canonical store,
does not infer reuse permission, and does not call a first page a full roster.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import shutil
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from lxml import html

from .store import stamp
from .transport import Transport

SOURCES = {
    'arnprior-directory': ('Arnprior', 'municipal_directory', 'https://www.arnprior.ca/business-directory/'),
    'north-grenville-directory': ('North Grenville', 'municipal_directory', 'https://www.northgrenville.ca/things-to-do/shopping-services/business-directory/shop/all?start=0'),
    'ottawa-board-trade': ('Ottawa', 'chamber', 'https://business.ottawabot.ca/list'),
    'mississippi-mills-park': ('Mississippi Mills', 'industrial_park_roster', 'https://www.mississippimills.ca/build-and-invest/economic-development-department/business-park/'),
    'mississippi-mills-support': ('Mississippi Mills', 'economic_development', 'https://www.mississippimills.ca/build-and-invest/economic-development-department/helping-your-business-succeed/'),
    'carleton-place-employers': ('Carleton Place', 'economic_development', 'https://carletonplace.ca/community-profile'),
    'ottawa-open-data': ('Ottawa', 'open_data_locations', 'https://open.ottawa.ca/'),
    'rockland-directory': ('Rockland', 'municipal_directory', 'https://choisir-choose.clarence-rockland.com/business-resources/business-directory'),
    'mcnab-braeside-directory': ('McNab/Braeside', 'municipal_directory', 'https://www.mcnabbraeside.com/business-directory/'),
    'north-dundas-referrals': ('North Dundas', 'economic_development', 'https://www.northdundas.com/business-development/economic-development'),
    'lanark-highlands-bta': ('Lanark Highlands', 'economic_development', 'https://www.lanarkhighlandsbta.ca/listings/'),
    'kanata-north-directory': ('Kanata', 'bia', 'https://www.kanatanorthba.com/member-directory/'),
    'kanata-central-directory': ('Kanata', 'bia', 'https://kanatacentral.com/directory/'),
    'barrhaven-bia': ('Barrhaven', 'bia', 'https://barrhavenbia.ca/'),
    'orleans-bia': ('Orleans', 'bia', 'https://heartoforleans.ca/'),
    'ottawa-bia-umbrella': ('Ottawa', 'bia', 'https://ocobia.org/bia-members/'),
}
HOSTS = ['www.arnprior.ca', 'arnprior.ca', 'www.northgrenville.ca', 'northgrenville.ca',
         'business.ottawabot.ca', 'ottawabot.ca', 'www.ottawabot.ca',
         'www.mississippimills.ca', 'mississippimills.ca', 'carletonplace.ca',
         'www.carletonplace.ca', 'open.ottawa.ca', 'ottawa.ca', 'www.ottawa.ca',
         'choisir-choose.clarence-rockland.com', 'www.clarence-rockland.com',
         'www.mcnabbraeside.com', 'mcnabbraeside.com', 'www.northdundas.com',
         'www.lanarkhighlandsbta.ca', 'lanarkhighlandsbta.ca', 'www.kanatanorthba.com',
         'kanatanorthba.com', 'kanatacentral.com', 'www.kanatacentral.com',
         'barrhavenbia.ca', 'www.barrhavenbia.ca', 'heartoforleans.ca', 'www.heartoforleans.ca', 'ocobia.org']
MINIMUM_FREE = 2 * 1024**3


def save(path, payload):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def inspect_html(body, url):
    """Inspect pagination and exact linked policies, excluding named-person data."""
    doc = html.fromstring(body)
    anchors = []
    for node in doc.xpath('//a[@href]'):
        href = urljoin(url, node.get('href'))
        label = ' '.join(node.text_content().split())
        if urlsplit(href).scheme == 'https':
            anchors.append((href, label, node.get('rel', ''), node.get('aria-label', '')))
    policies = sorted({href for href, label, _, _ in anchors
                       if re.search(r'privacy|terms|disclaimer|copyright|conditions|licen[cs]e', href + ' ' + label, re.I)})
    pagination = [{'url': href, 'label': label, 'rel': rel, 'aria_label': aria}
                  for href, label, rel, aria in anchors
                  if re.search(r'next|previous|last|page\s*\d|pagination', label + ' ' + rel + ' ' + aria, re.I)
                  or re.fullmatch(r'\d+', label)]
    text = ' '.join(doc.text_content().split())
    counts = re.findall(r'.{0,35}(?:Results?\s+\d[\d,]*\s*[-–]\s*\d[\d,]*\s+of\s+\d[\d,]*|\d[\d,]*\s*[-–]\s*\d[\d,]*\s+of\s+\d[\d,]*\s+Results?).{0,30}', text, re.I)
    return {'title': doc.xpath('string(//title)').strip(), 'linked_policy_urls': policies,
            'published_count_text': counts, 'pagination': pagination,
            'forms': [{'action': f.get('action'), 'method': f.get('method'),
                       'field_names': f.xpath('.//*[@name]/@name')} for f in doc.xpath('//form')],
            'same_host_links': sorted({href for href, _, _, _ in anchors if urlsplit(href).hostname == urlsplit(url).hostname})}


def parse_named_section(body, source_key):
    """Minimal named business facts; never use a municipal footer as a site."""
    doc = html.fromstring(body)
    rows = []
    if source_key == 'mississippi-mills-park':
        intro = doc.xpath('//p[contains(normalize-space(.), "Many successful and innovative companies call the Mississippi Mills Business Park home")]')
        if len(intro) != 1:
            raise ValueError('Business park roster section marker missing or ambiguous')
        for node in intro[0].itersiblings():
            if node.tag != 'p':
                break
            anchors = node.xpath('./a[@href]')
            if len(anchors) != 1:
                raise ValueError('Business park factual row schema differs')
            a = anchors[0]
            name = ' '.join(a.text_content().split())
            street = ' '.join(''.join(a.xpath('following-sibling::text()')).split()).strip(' -')
            if not name or not street:
                raise ValueError('Business park name/street source fact missing')
            rows.append({'name': name, 'source_website': a.get('href'), 'source_street_label': street,
                         'source_listed_role': 'listed_in_mississippi_mills_business_park',
                         'source_section_scope': 'Complete explicitly linked business list in inspected municipal page'})
    elif source_key == 'carleton-place-employers':
        headings = doc.xpath('//h2[normalize-space(.)="Major Employers"]')
        if len(headings) != 1:
            raise ValueError('Major Employers section marker missing or ambiguous')
        roster = headings[0].getnext()
        while roster is not None and not isinstance(roster.tag, str):
            roster = roster.getnext()
        if roster is None or roster.tag != 'ul':
            raise ValueError('Major Employers list schema differs')
        for node in roster.xpath('./li'):
            name = ' '.join(node.text_content().split())
            if not name:
                raise ValueError('Empty named employer')
            rows.append({'name': name, 'source_listed_role': 'source_listed_major_employer',
                         'source_section_scope': 'Complete Major Employers section in inspected municipal community profile'})
    else:
        raise ValueError('Unreviewed short-roster parser')
    for ordinal, row in enumerate(rows, 1):
        row.update(source_row_ordinal=ordinal, address=None, city=None, province=None, country=None,
                   source_record_id=source_key + ':section-row:' + str(ordinal),
                   source_record_id_basis='pinned_page_section_row_ordinal_not_publisher_identifier',
                   ownership_inferred=False, tenancy_inferred=False, physical_site_verified=False,
                   current_operation_verified=False, employee_count=None, contact_eligibility='research_only')
    return rows


def freeze_short_rosters(inspection_folder, output_folder):
    """Freeze complete finite named sections under reviewed internal-factual use."""
    source_folder, output = Path(inspection_folder), Path(output_folder)
    output.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(output).free < MINIMUM_FREE:
        raise RuntimeError('Minimum 2 GiB free required before factual normalization')
    specifications = {'mississippi-mills-park': (18, ['https://www.mississippimills.ca/municipal-hall/privacy-policy/']),
                      'carleton-place-employers': (12, ['https://carletonplace.ca/privacy-policy', 'https://carletonplace.ca/terms-of-use'])}
    groups = []
    for key, (expected, policy_urls) in specifications.items():
        receipt = json.loads((source_folder / (key + '.receipt.json')).read_text())
        path = source_folder / receipt['file']
        if hashlib.sha256(path.read_bytes()).hexdigest() != receipt['gzip_sha256']:
            raise ValueError('Primary source gzip hash differs')
        with gzip.open(path, 'rb') as handle:
            body = handle.read()
        if hashlib.sha256(body).hexdigest() != receipt['source_body_sha256']:
            raise ValueError('Primary source body hash differs')
        policies = []
        for url in policy_urls:
            policy_key = 'policy-' + hashlib.sha256(url.encode()).hexdigest()[:16]
            policy = json.loads((source_folder / (policy_key + '.receipt.json')).read_text())
            if policy['status'] != 'entry_page_inspected' or policy.get('response_status') != 200:
                raise ValueError('Reviewed linked policy was not acquired successfully')
            policy_path = source_folder / policy['file']
            if hashlib.sha256(policy_path.read_bytes()).hexdigest() != policy['gzip_sha256']:
                raise ValueError('Linked policy gzip hash differs')
            policies.append({'url': url, 'receipt': str(source_folder / (policy_key + '.receipt.json')),
                             'gzip_sha256': policy['gzip_sha256'], 'source_body_sha256': policy['source_body_sha256']})
        rows = parse_named_section(body, key)
        if len(rows) != expected:
            raise ValueError('Inspected finite section count changed; independent review required')
        for row in rows:
            row['source_record_id'] = key + ':page:' + receipt['source_body_sha256'] + ':section-row:' + str(row['source_row_ordinal'])
            row.update(source_url=receipt['url'], source_page_sha256=receipt['source_body_sha256'],
                       observed_at=receipt['checked_at'], source_published_at=None,
                       source_locality_context=receipt['configured_label'],
                       raw_payload=dict(row))
        output_path = output / (key + '.jsonl.gz')
        temporary = output_path.with_suffix(output_path.suffix + '.tmp')
        with temporary.open('wb') as out, gzip.GzipFile(filename='', fileobj=out, mode='wb', mtime=0) as zipped:
            for row in rows:
                zipped.write((json.dumps(row, ensure_ascii=False) + '\n').encode())
        temporary.replace(output_path)
        groups.append({'source_id': key, 'source_url': receipt['url'], 'publisher': 'Municipality of Mississippi Mills' if key.startswith('mississippi') else 'Town of Carleton Place',
                       'rows': len(rows), 'path': output_path.name, 'sha256': hashlib.sha256(output_path.read_bytes()).hexdigest(),
                       'original_receipt': str(source_folder / (key + '.receipt.json')), 'source_body_sha256': receipt['source_body_sha256'],
                       'observed_at': receipt['checked_at'], 'source_date': None, 'rights_status': 'limited_factual_review_only',
                       'rights_basis': 'Internal assessment of minimal factual names/source-listed role/street labels and links under reviewed linked policies, with no explicit automated/reuse ban found; no open licence or public redistribution permission inferred.',
                       'rights_evidence': policies, 'source_inventory_exhausted': True,
                       'exhaustion_scope': rows[0]['source_section_scope'], 'market_completeness_verified': False})
    manifest = {'schema_version': 1, 'frozen_at': stamp(), 'cohorts': groups, 'raw_factual_observations': sum(g['rows'] for g in groups),
                'canonical_database_mutated': False, 'people_or_contact_channels_collected': False,
                'inferred_sites_owners_tenants_or_franchisees': False, 'public_redistribution_permission': 'not_established',
                'all_named_entries_in_two_exact_source_sections_preserved': True,
                'market_completeness_verified': False}
    save(output / 'manifest.json', manifest)
    return manifest


def apply_named_sections(store, folder, *, progress=None):
    """Promote only two reviewed finite named sections, with no guessed sites."""
    from .place_import import _guard_storage, _committed_batch
    folder = Path(folder)
    manifest = json.loads((folder / 'manifest.json').read_text())
    proof = json.loads((folder / 'independent-verification.json').read_text())
    groups = manifest.get('cohorts', [])
    if proof.get('status') != 'passed' or {g.get('source_id') for g in groups} != {'mississippi-mills-park', 'carleton-place-employers'}:
        raise ValueError('Named-section source/independent verification gate differs')
    checked = []
    for group in groups:
        if group.get('rights_status') != 'limited_factual_review_only':
            raise ValueError('Named section factual-use rights differ')
        path = folder / group['path']
        if hashlib.sha256(path.read_bytes()).hexdigest() != group['sha256']:
            raise ValueError('Named section source-row checksum differs before writes')
        original_receipt_path = Path(group['original_receipt'])
        receipt = json.loads(original_receipt_path.read_text())
        original_path = original_receipt_path.parent / receipt['file']
        if hashlib.sha256(original_path.read_bytes()).hexdigest() != receipt['gzip_sha256']:
            raise ValueError('Named section original checksum differs before writes')
        body = gzip.open(original_path, 'rb').read()
        if hashlib.sha256(body).hexdigest() != group['source_body_sha256']:
            raise ValueError('Named section original body differs before writes')
        for policy in group['rights_evidence']:
            policy_path = Path(policy['receipt'])
            actual = json.loads(policy_path.read_text())
            if hashlib.sha256((policy_path.parent / actual['file']).read_bytes()).hexdigest() != policy['gzip_sha256']:
                raise ValueError('Named section policy original checksum differs before writes')
        rows = [json.loads(line) for line in gzip.open(path, 'rt')]
        expected = parse_named_section(body, group['source_id'])
        if len(rows) != group['rows'] or [r['name'] for r in rows] != [r['name'] for r in expected]:
            raise ValueError('Named section names/count differ from complete primary section')
        if not all(all(row.get(field) is None for field in ['address', 'city', 'province', 'country']) for row in rows):
            raise ValueError('Named section must not invent physical-site/jurisdiction fields')
        checked.append((group, rows))
    result = []
    for group, rows in checked:
        _guard_storage(store, rows, {'source_folder': str(folder), 'source_id': group['source_id'], 'chunk': 'preflight'})
        source = {'id': group['source_id'], 'name': group['publisher'] + ' finite named business section',
                  'publisher': group['publisher'], 'source_url': group['source_url'], 'source_type': SOURCES[group['source_id']][1],
                  'geography_scope': [SOURCES[group['source_id']][0]], 'sector_scope': ['*'],
                  'rights_status': group['rights_status'], 'retrieval_status': 'accessible',
                  'adapter_name': 'eastern_finite_named_sections', 'source_date': None, 'last_checked_at': group['observed_at'],
                  'reported_count': group['rows'], 'count_definition': group['exhaustion_scope'],
                  'notes': 'Minimal internal factual use only. Source-listed role is retained without inferred ownership, tenancy, employee count, current operation or physical site.',
                  'config': {'source_inventory_exhausted': True, 'exhaustion_scope': group['exhaustion_scope'],
                             'market_coverage_complete': False, 'public_redistribution_authorised': False,
                             'original_manifest': str(folder / 'manifest.json')}}
        source_id = store.upsert_source(source)
        metadata = {'batch_id': group['sha256'], 'observed_at': group['observed_at'],
                    'adapter_name': source['adapter_name'], 'parser_version': 'eastern-named-sections/2026-10-27.1',
                    'source_inventory_exhausted': True, 'coverage_complete': False, 'expected_count': len(rows),
                    'requests': 0, 'bytes_fetched': 0, 'estimated_cost': 0,
                    'acquisition_cost_scope': 'Read-only normalization/import; original public entry/policy requests metered separately in source-inspection.'}
        if not _committed_batch(store, source_id, rows, metadata):
            _guard_storage(store, rows, {'source_folder': str(folder), 'source_id': source_id, 'chunk': 0})
        with store.transaction():
            imported = store.ingest(source_id, rows, run_metadata=metadata)
            if not imported.get('replayed'):
                with store._buffer_field_assertions():
                    for row in rows:
                        identity = store.db.execute('SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?', (source_id, row['source_record_id'])).fetchone()
                        quarantine = store.db.execute("SELECT 1 FROM source_run_items WHERE run_id=? AND source_record_id=? AND outcome='quarantined'", (imported['run_id'], row['source_record_id'])).fetchone()
                        if not identity or quarantine:
                            continue
                        for field in ['source_record_id_basis', 'source_listed_role', 'source_street_label', 'source_locality_context', 'physical_site_verified', 'current_operation_verified', 'employee_count', 'source_website']:
                            store.assert_field(identity['organisation_id'], 'organisation', field, row.get(field), identity['last_evidence_id'], row['observed_at'], method='publisher_finite_named_business_section', review_status='source_supported')
        result.append({'source_id': source_id, **imported,
                       'new_organisations': 0 if imported.get('replayed') else imported.get('inserted_count', 0),
                       'new_locations': 0 if imported.get('replayed') else imported.get('new_locations', 0)})
        if progress:
            progress({'sources_completed': len(result), 'total_sources': len(groups), 'last_source_id': source_id})
    return result


def inspect(folder, only=None, *, policy_urls=None, retry_blocked=False):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(folder).free < MINIMUM_FREE:
        raise RuntimeError('Minimum 2 GiB free required before source inspection')
    t = Transport(max_requests=45, max_bytes=18000000, max_response_bytes=3000000,
                  timeout=25, retries=1, min_interval=.5, allowed_hosts=HOSTS)
    jobs = [(key, *spec) for key, spec in SOURCES.items()
            if (not only or key in only) and (only or not policy_urls)]
    jobs += [('policy-' + hashlib.sha256(url.encode()).hexdigest()[:16], '', '', url) for url in (policy_urls or [])]
    rows = []
    try:
        for key, label, family, url in jobs:
            if shutil.disk_usage(folder).free < MINIMUM_FREE:
                raise RuntimeError('Storage guard paused source inspection')
            receipt_path = folder / (key + '.receipt.json')
            if receipt_path.exists():
                receipt = json.loads(receipt_path.read_text())
                if receipt.get('file'):
                    path = folder / receipt['file']
                    if hashlib.sha256(path.read_bytes()).hexdigest() != receipt['gzip_sha256']:
                        raise ValueError('Saved source receipt checksum differs')
                if receipt.get('status') != 'blocked' or not retry_blocked:
                    rows.append(receipt)
                    continue
                history = folder / (key + '.failed-attempt-' + receipt['checked_at'].replace(':', '-') + '.json')
                if not history.exists():
                    save(history, receipt)
            row = {'source_key': key, 'configured_label': label, 'source_family': family,
                   'url': url, 'checked_at': stamp(), 'rights_status': 'unverified',
                   'source_inventory_exhausted': False, 'market_completeness_verified': False,
                   'canonical_database_mutated': False, 'business_rows_promoted': 0}
            try:
                response = t.fetch(url)
                row.update(status='entry_page_inspected', response_status=response.status,
                           response_url=response.url, source_body_bytes=len(response.body),
                           source_body_sha256=hashlib.sha256(response.body).hexdigest())
                path = folder / (key + '.private.response.gz')
                with path.open('wb') as out, gzip.GzipFile(filename='', fileobj=out, mode='wb', mtime=0) as zipped:
                    zipped.write(response.body)
                row.update(file=path.name, gzip_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                           private_traceability_receipt=True, public_redistribution_permission='not_established')
                if 'html' in response.headers.get('Content-Type', '').lower() and response.body:
                    row.update(inspect_html(response.body, response.url))
            except Exception as exc:
                row.update(status='blocked', error=str(exc))
            save(receipt_path, row)
            rows.append(row)
            print(json.dumps({k: v for k, v in row.items() if k not in ('same_host_links', 'forms', 'pagination')}), flush=True)
    finally:
        save(folder / ('http-metrics-' + stamp().replace(':', '-') + '.json'), t.metrics())
    return rows


def write_ledger(folder):
    """Expose all 24 configured labels ×24 families without inventing searches."""
    from .geography import configured_footprint
    folder = Path(folder)
    schema = json.loads((Path(__file__).parent / 'config/discovery-ledger-schema.json').read_text())
    labels = [r['label'] for r in configured_footprint() if r['configured_runtime'] and 'ottawa' in r['areas']]
    families = schema['properties']['source_family']['enum']
    rows = []
    now = stamp()
    for label in labels:
        for family in families:
            rows.append({'schema_version': 1, 'operation_id': 'east-unsearched-' + hashlib.sha256((label + '|' + family).encode()).hexdigest()[:20],
                         'checked_at': now, 'operational_area': 'ottawa', 'configured_labels': [label],
                         'source_family': family, 'status': 'unsearched', 'query_or_entry_url': '', 'evidence_urls': [],
                         'industry_families': ['*'], 'market_completeness_verified': False, 'planned_lane': True,
                         'actual_query_executed': False, 'next_action': 'Execute source-family search or link a source with documented geographic scope; this is a planned lane only.'})
    for path in sorted(folder.glob('*.receipt.json')):
        receipt = json.loads(path.read_text())
        if not receipt.get('source_family'):
            continue
        rows.append({'schema_version': 1, 'operation_id': 'east-inspection-' + receipt['source_key'],
                     'checked_at': receipt['checked_at'], 'operational_area': 'ottawa',
                     'configured_labels': [receipt['configured_label']], 'source_family': receipt['source_family'],
                     'status': 'blocked' if receipt['status'] == 'blocked' else 'source_identified',
                     'query_or_entry_url': receipt['url'], 'evidence_urls': [receipt['url']],
                     'rights_status': receipt['rights_status'], 'acquired_raw_rows': 0,
                     'record_unit': 'Source entry-page inspection; no full business roster has been normalized',
                     'source_inventory_exhausted': False, 'market_completeness_verified': False,
                     'artifact_paths': [str(path)], 'block_reason': receipt.get('error'),
                     'next_action': 'Review exact linked terms and documented full pagination/export route before roster collection.'})
    discovered = folder / 'web-discovery-operations.jsonl'
    if discovered.exists():
        for line in discovered.read_text().splitlines():
            row = json.loads(line)
            if row.get('source_family') not in families or not set(row.get('configured_labels', [])).issubset(labels):
                raise ValueError('Eastern discovery scope or source family differs from configured footprint')
            if row.get('market_completeness_verified') is not False:
                raise ValueError('Source discovery cannot verify market completeness')
            rows.append(row)
    for key, label, family in [('north-grenville-directory', 'North Grenville', 'municipal_directory'),
                               ('kanata-north-bia', 'Kanata', 'bia')]:
        path = folder.parent / key / 'manifest.json'
        if not path.exists():
            continue
        acquired = json.loads(path.read_text())
        if acquired.get('status') != 'acquired_complete':
            continue
        rows.append({'schema_version': 1, 'operation_id': 'east-full-roster-' + key,
                     'checked_at': acquired['completed_at'], 'operational_area': 'ottawa',
                     'configured_labels': [label], 'source_family': family, 'status': 'acquired_complete',
                     'query_or_entry_url': acquired['source_url'], 'evidence_urls': [acquired['source_url']],
                     'source_id': acquired['source_id'], 'rights_status': acquired['rights_status'],
                     'publisher': acquired['publisher'], 'record_unit': acquired['record_unit'],
                     'reported_row_count': acquired['reported_row_count'],
                     'acquired_raw_rows': acquired.get('observed_listing_appearances', acquired.get('observed_source_rows')),
                     'unique_source_ids': acquired.get('unique_source_profile_keys'),
                     'source_inventory_exhausted': True, 'market_completeness_verified': False,
                     'publisher_scope': acquired.get('exhaustion_scope', acquired.get('source_inventory_scope')),
                     'source_publication_or_reference_period': None, 'artifact_paths': [str(path)],
                     'next_action': 'Keep raw staged until root-assigned sole writer; retain unknowns and internal factual rights limit. This is not complete market coverage.'})
    short = folder.parent / 'municipal-named-sections/manifest.json'
    if short.exists():
        for group in json.loads(short.read_text())['cohorts']:
            label, family = SOURCES[group['source_id']][:2]
            rows.append({'schema_version': 1, 'operation_id': 'east-finite-section-' + group['source_id'],
                         'checked_at': group['observed_at'], 'operational_area': 'ottawa',
                         'configured_labels': [label], 'source_family': family, 'status': 'acquired_complete',
                         'query_or_entry_url': group['source_url'], 'evidence_urls': [group['source_url']],
                         'source_id': group['source_id'], 'rights_status': group['rights_status'],
                         'record_unit': 'Named entity with source-listed employer/business-park role; not a verified physical site',
                         'acquired_raw_rows': group['rows'], 'source_inventory_exhausted': True,
                         'publisher_scope': group['exhaustion_scope'], 'source_publication_or_reference_period': None,
                         'market_completeness_verified': False, 'artifact_paths': [str(short)],
                         'next_action': 'Preserve finite source-listed role and unknown site/ownership/current status; root-assigned sole-writer promotion only.'})
    action = 'https://www.arnprior.ca/umbraco/surface/BusinessDirectory/GetBDListingByFilters'
    arnprior = folder / ('policy-' + hashlib.sha256(action.encode()).hexdigest()[:16] + '.receipt.json')
    if arnprior.exists():
        blocked = json.loads(arnprior.read_text())
        if blocked.get('status') == 'blocked':
            rows.append({'schema_version': 1, 'operation_id': 'east-arnprior-native-pagination-robots-hold',
                         'checked_at': blocked['checked_at'], 'operational_area': 'ottawa', 'configured_labels': ['Arnprior'],
                         'source_family': 'municipal_directory', 'status': 'blocked', 'query_or_entry_url': action,
                         'evidence_urls': [SOURCES['arnprior-directory'][2], action], 'rights_status': 'unverified',
                         'record_unit': 'Municipal directory listing; complete native pagination inaccessible under robots',
                         'reported_row_count': 172, 'acquired_raw_rows': 0, 'inspected_entry_page_rows': 10,
                         'source_inventory_exhausted': False, 'market_completeness_verified': False,
                         'block_reason': blocked['error'], 'artifact_paths': [str(arnprior)],
                         'next_action': 'Publisher-authorised/manual official export route. No forbidden action request, POST, token workaround or complete-roster claim.'})
    output = folder / 'discovery-operations.jsonl'
    temporary = output.with_suffix(output.suffix + '.tmp')
    temporary.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows))
    temporary.replace(output)
    save(folder / 'discovery-ledger-summary.json', {'configured_labels': labels, 'source_families': families,
         'planned_unsearched_lanes': len(labels) * len(families), 'actual_source_discovery_inspection_or_acquisition_operations': len(rows) - len(labels) * len(families),
         'rows': len(rows), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
         'market_completeness_verified': False, 'canonical_database_mutated': False,
         'other_existing_provincewide_cohorts_not_recounted_here': True})
    return rows


def inspect_robots_route(folder, url):
    """Check an exact documented action before any action request or form data."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(folder).free < MINIMUM_FREE:
        raise RuntimeError('Minimum 2 GiB free required')
    t = Transport(max_requests=5, max_bytes=1000000, max_response_bytes=300000,
                  min_interval=.5, timeout=25, retries=1, allowed_hosts=HOSTS)
    result = {'url': url, 'checked_at': stamp(), 'action_requested': False, 'form_data_or_tokens_sent': False}
    try:
        t._guard(url, set(HOSTS))
        t._check_robots(url, set(HOSTS))
        result['robots_route_allowed'] = True
    except Exception as exc:
        result.update(robots_route_allowed=False, error=str(exc))
    result['metrics'] = t.metrics()
    save(folder / ('robots-route-' + hashlib.sha256(url.encode()).hexdigest()[:16] + '.json'), result)
    print(json.dumps(result), flush=True)
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--only', nargs='+', choices=sorted(SOURCES))
    p.add_argument('--policy-url', action='append', default=[])
    p.add_argument('--retry-blocked', action='store_true', help='Preserve previous failure receipt and retry only after access/environment review')
    p.add_argument('--ledger', action='store_true')
    p.add_argument('--freeze-short-rosters', type=Path, help='Normalize two reviewed finite named sections into this folder, using saved receipts only')
    p.add_argument('--robots-route')
    a = p.parse_args()
    if a.robots_route:
        inspect_robots_route(a.output, a.robots_route)
    elif a.freeze_short_rosters:
        print(json.dumps(freeze_short_rosters(a.output, a.freeze_short_rosters)), flush=True)
    elif a.ledger:
        write_ledger(a.output)
    else:
        inspect(a.output, a.only, policy_urls=a.policy_url, retry_blocked=a.retry_blocked)


if __name__ == '__main__':
    main()
