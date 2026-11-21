"""Licensed civic/institution site candidates, with source scope kept explicit.

Acquisition never writes the canonical database. Source service-location rows,
properties and legal/operator organisations are separate units. A health-service
listing is not proof of public ownership, a unique building, current occupancy,
legal parenthood, or purchasing authority. No personal contacts are collected.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import re
import sqlite3
import uuid
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlencode

from .geography import resolve_geography, municipality_for, configured_footprint
from .spatial_context import _save, _hash, _require_space
from .store import stable_id, stamp
from .transport import Transport, SourceBlocked, BudgetExceeded

MOH_LAYER = 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open09/MapServer/26'
MOH_ITEM = 'https://www.arcgis.com/sharing/rest/content/items/e1e5983c59ff497baddf75f1d2bb4add?f=json'
OGL_ON = 'https://www.ontario.ca/page/open-government-licence-ontario'
OGL_CA = 'https://open.canada.ca/en/open-government-licence-canada'
VERSION = 'civic-sites/2026-10-27.1'
# Field names are reviewed against the actual official MOHSERLO schema. No
# patients, staff, appointees, officers or individual contact fields are queried.
MOH_FIELDS = ['OBJECTID', 'OGF_ID', 'MOH_SERVICE_PROVIDER_IDENT', 'SERVICE_TYPE', 'SERVICE_TYPE_DETAIL',
    'ENGLISH_NAME', 'FRENCH_NAME', 'ENGLISH_NAME_ALT', 'FRENCH_NAME_ALT', 'ADDRESS_LINE_1', 'ADDRESS_LINE_2',
    'ADDRESS_DESCRIPTOR', 'COMMUNITY', 'POSTAL_CODE', 'GEOMETRY_UPDATE_DATETIME', 'EFFECTIVE_DATETIME', 'SYSTEM_DATETIME']
EXTRA_ASSERTIONS = ['civic_record_unit', 'source_facility_type', 'source_facility_subtype', 'source_address_role',
    'source_effective_datetime', 'source_geometry_update_datetime', 'source_capture_date', 'current_occupancy_verified',
    'public_ownership_status', 'legal_entity_identity_status', 'source_parent_inferred', 'service_scope_status',
    'service_scope_geography_id', 'service_scope_municipality_id', 'scope_basis', 'source_registry_id',
    'source_reporting_command', 'source_office_designation', 'source_respondent_city', 'source_respondent_type',
    'physical_location_asserted']


def _get(row, *names):
    keys = {re.sub(r'[^a-z0-9]', '', str(k).casefold()): k for k in row}
    for name in names:
        key = keys.get(re.sub(r'[^a-z0-9]', '', name.casefold()))
        if key is not None:
            return str(row.get(key) or '').strip()
    return ''


def _csv_rows(body):
    try:
        body.decode('utf-8-sig')
        encoding = 'utf-8-sig'
    except UnicodeDecodeError:
        encoding = 'cp1252'
    return csv.DictReader(io.TextIOWrapper(io.BytesIO(body), encoding=encoding, newline=''))


def library_xlsx_csv(body):
    """Read the official survey workbook with bounded stdlib ZIP/XML parsing."""
    ns = {'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        if sum(i.file_size for i in archive.infolist()) > 100000000:
            raise SourceBlocked('Library workbook exceeds reviewed uncompressed size bound')
        strings=[]
        if 'xl/sharedStrings.xml' in archive.namelist():
            for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si',ns):
                strings.append(''.join(item.itertext()))
        rows=[]
        for element in ET.fromstring(archive.read('xl/worksheets/sheet1.xml')).findall('.//m:sheetData/m:row',ns):
            cells={}
            for cell in element.findall('m:c',ns):
                column=re.match('[A-Z]+',cell.get('r',''))
                if not column:
                    continue
                index=0
                for letter in column.group(0):index=index*26+ord(letter)-64
                value=cell.find('m:v',ns)
                text=value.text or '' if value is not None else ''.join(cell.find('m:is',ns).itertext()) if cell.find('m:is',ns) is not None else ''
                cells[index-1]=strings[int(text)] if cell.get('t')=='s' and text else text
            if cells:
                rows.append([cells.get(i,'') for i in range(max(cells)+1)])
    header=next((i for i,r in enumerate(rows) if 'Library Full Name' in r and 'Library Number' in r),None)
    if header is None:
        raise SourceBlocked('Official library workbook headers differ from reviewed survey schema')
    destination=io.StringIO(newline='')
    writer=csv.writer(destination)
    width=len(rows[header])
    writer.writerow(rows[header])
    for row in rows[header+1:]:
        if any(str(v).strip() for v in row):writer.writerow((row+['']*width)[:width])
    return destination.getvalue().encode()


def _date(value):
    from datetime import datetime, timezone
    if isinstance(value, (int, float)) and math.isfinite(value):
        return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat()
    return None


def normalise_moh_feature(feature, *, observed_at, source_url=MOH_LAYER, raw_reference=None):
    attrs = feature.get('attributes') or {}
    if not attrs.get('OGF_ID') or not (attrs.get('ENGLISH_NAME') or attrs.get('FRENCH_NAME')):
        raise SourceBlocked('Official health-service location identifier/name is missing')
    role = str(attrs.get('ADDRESS_DESCRIPTOR') or '')
    service = str(attrs.get('SERVICE_TYPE') or '')
    detail = str(attrs.get('SERVICE_TYPE_DETAIL') or '')
    # Source categories define this sector mapping; names are never mined for a
    # guessed operator, legal owner or sub-sector classification.
    service_key = re.sub('[^a-z]', '', service.casefold())
    family = 'senior_living' if service_key in {'longtermcarehome','longtermcarehomes','licensedretirementhome','licensedretirementhomes','retirementhome','retirementhomes'} else 'healthcare'
    if 'mail' in role.casefold() and not any(v in role.casefold() for v in ('practice', 'service', 'physical')):
        location_type = 'mailing_address'
    elif 'billing' in role.casefold() or 'administrat' in role.casefold():
        location_type = 'healthcare_practice_or_administration_address_candidate'
    else:
        location_type = 'healthcare_service_location_candidate'
    geometry = feature.get('geometry') or {}
    x, y = geometry.get('x'), geometry.get('y')
    valid = all(isinstance(v, (int, float)) and math.isfinite(v) for v in (x, y)) and -180 <= x <= 180 and -90 <= y <= 90
    return {'source_record_id': 'ogf:' + str(attrs['OGF_ID']), 'source_registry_id': str(attrs.get('MOH_SERVICE_PROVIDER_IDENT') or ''),
        'name': attrs.get('ENGLISH_NAME') or attrs.get('FRENCH_NAME'), 'aliases': [v for k in ('FRENCH_NAME', 'ENGLISH_NAME_ALT', 'FRENCH_NAME_ALT') if (v := attrs.get(k))],
        'entity_type': 'institution_site_candidate', 'location_name': attrs.get('ENGLISH_NAME') or attrs.get('FRENCH_NAME'),
        'address': ', '.join(str(attrs[k]).strip() for k in ['ADDRESS_LINE_1', 'ADDRESS_LINE_2'] if attrs.get(k)),
        'city': attrs.get('COMMUNITY'), 'province': 'ON', 'country': 'CA', 'postal_code': attrs.get('POSTAL_CODE'),
        'longitude': x if valid else None, 'latitude': y if valid else None, 'coordinates_source': source_url,
        'location_type': location_type, 'categories': [v for v in [service, detail] if v], 'taxonomy': 'Ontario-MOHSERLO-service-type',
        'industry_family': family, 'source_facility_type': service, 'source_facility_subtype': detail,
        'civic_record_unit': 'publisher_health_service_location_not_unique_legal_company_or_building', 'source_address_role': role,
        'source_effective_datetime': _date(attrs.get('EFFECTIVE_DATETIME')), 'source_geometry_update_datetime': _date(attrs.get('GEOMETRY_UPDATE_DATETIME')),
        'source_capture_date': observed_at, 'observed_at': observed_at, 'source_url': source_url,
        'current_occupancy_verified': False, 'public_ownership_status': 'not_asserted_by_this_source', 'legal_entity_identity_status': 'unverified',
        'source_parent_inferred': False, 'raw_payload': {'attributes': attrs, 'geometry': geometry, 'raw_response_reference': raw_reference}}


def normalise_civic_csv(body, *, kind, observed_at, source_url, source_date=None):
    """Reviewed CSV schemas; keep missing street records as roster facts only."""
    reader = _csv_rows(body)
    headers = reader.fieldnames or []
    if not headers:
        raise SourceBlocked('Official civic CSV headers missing')
    rows, seen = [], set()
    for index, raw in enumerate(reader, 1):
        if not any(str(value or '').strip() for value in raw.values()):
            continue
        if kind == 'opp':
            name = _get(raw, 'name_en', 'Detachment Name', 'Detachment', 'Bureau Name', 'Office Name', 'Name', 'DETACHMENT_BUREAU', 'DETACHMENT / BUREAU')
            address = _get(raw, 'Street Address', 'Address', 'Street', 'LOCATION_ADDRESS')
            city = _get(raw, 'location', 'City', 'City/Town', 'Municipality', 'Community')
            key = _get(raw, 'DETACHMENT_ID', 'Detachment ID', 'Office ID', 'ID')
            location_type, family, category = 'police_office_location_candidate', 'government_agencies', 'Ontario Provincial Police office/detachment listing'
            entity_type, unit = 'public_service_site_candidate', 'publisher_police_office_not_separate_legal_police_service'
        elif kind == 'court':
            name = _get(raw, 'Bldg_Ministry_Official_Name', 'Court Name', 'Courthouse', 'Court', 'Name', 'Court Location', 'Location')
            address = _get(raw, 'Street Address', 'Address', 'Court Address')
            city = _get(raw, 'Bldg_City', 'City', 'City/Town', 'Municipality', 'Town')
            if not address and re.match(r'^\d',name) and ' - ' in name:
                address = name.split(' - ',1)[0]
            key = _get(raw, 'Court ID', 'Court Number', 'ID')
            location_type, family, category = 'courthouse_location_candidate', 'government_agencies', 'Ontario courthouse source listing'
            entity_type, unit = 'public_service_site_candidate', 'publisher_courthouse_not_separate_legal_court_operator'
        elif kind == 'library':
            name = _get(raw, 'Library Full Name', 'Library Name')
            address = _get(raw, 'A1.9 Street Address', 'Street Address')
            city = _get(raw, 'A1.10 City/Town', 'City/Town', 'City')
            key = _get(raw, 'Library Number')
            location_type, family, category = 'library_board_administration_address_candidate', 'arts_culture_events_media', 'Ontario public-library survey respondent'
            entity_type, unit = 'institution', 'library_system_or_survey_respondent_not_all_branches'
            respondent_type = _get(raw, 'A1.4 Type of Library Service (English)')
            if respondent_type.startswith('Contracting'):
                entity_type, family, location_type = 'public_service_roster_body_candidate', 'government_agencies', 'library_contracting_body_administration_address_candidate'
                unit = 'library_service_contracting_body_survey_respondent_not_library_branch'
        else:
            raise ValueError('Unreviewed civic CSV kind: ' + kind)
        if not name:
            raise SourceBlocked(f'{kind} official row {index} has no name under the reviewed schema; headers={headers}')
        if not key:
            # Content-based source row key, explicitly not an official registry ID.
            key = 'content:' + hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest()[:24]
        if key in seen:
            raise SourceBlocked('Duplicate civic source row identifier; review before importing')
        seen.add(key)
        row = {'source_record_id': kind + ':' + key, 'name': name, 'entity_type': entity_type, 'location_name': name if address else None,
            'address': address or None, 'city': city or None, 'province': 'ON', 'country': 'CA',
            'postal_code': _get(raw, 'Bldg_Postal_Code', 'Postal Code', 'PostalCode', 'A1.12 Postal Code') or None,
            'location_type': location_type if address else 'unknown', 'categories': [category], 'taxonomy': 'Ontario-civic-source-record-type',
            'industry_family': family, 'source_facility_type': category, 'civic_record_unit': unit,
            'source_address_role': 'source_street_address' if address else 'no_street_address_in_source', 'source_effective_datetime': source_date,
            'source_capture_date': observed_at, 'observed_at': observed_at, 'source_url': source_url,
            'current_occupancy_verified': False, 'public_ownership_status': 'institutional_service_source_not_property_ownership_proof',
            'legal_entity_identity_status': 'unverified', 'source_parent_inferred': False, 'raw_payload': {'source_row': raw, 'source_csv_line': index + 1}}
        if kind == 'opp':
            row['source_reporting_command'] = _get(raw, 'command') or None
            row['source_office_designation'] = _get(raw, 'designation') or None
        if kind == 'library':
            row['source_respondent_type'] = respondent_type
            row['source_respondent_city'] = city or None
            row['physical_location_asserted'] = bool(address)
            if not address:
                # A respondent's locality/postcode is an organisation fact, not
                # enough evidence to create a physical site or branch record.
                row['city'], row['postal_code'] = None, None
        if not row['postal_code'] and address:
            postal = re.search(r'\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b', address, re.I)
            row['postal_code'] = postal.group(0) if postal else None
        for name, alternatives in [('latitude', ('Bldg_Latitude','Latitude', 'Lat')), ('longitude', ('Bldg_Longitude','Longitude', 'Long', 'Lon'))]:
            value = _get(raw, *alternatives)
            if value:
                try:
                    number = float(value)
                    if math.isfinite(number) and abs(number) <= (90 if name == 'latitude' else 180):
                        row[name] = number
                        row['coordinates_source'] = source_url
                except ValueError:
                    pass
        rows.append(row)
    return rows


def _scope_rows(rows, database=None):
    """A small label/ancestor lookup; coordinates never overwrite locality."""
    if database is None:
        for row in rows:
            row.update({'service_scope_status': 'unknown_unresolved_without_geography_database', 'scope_basis': 'no_geography_lookup_performed'})
        return
    db = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    store = SimpleNamespace(db=db)
    parents = {r['id']: r['parent_id'] for r in db.execute('SELECT id,parent_id FROM geographies')}
    configured = {r[0] for r in db.execute('SELECT DISTINCT geography_id FROM geography_service_areas')}
    def current_scope(ident):
        seen = set()
        while ident and ident not in seen:
            if ident in configured:
                return True
            seen.add(ident)
            ident = parents.get(ident)
        return False
    cache = {}
    for row in rows:
        city = row.get('city') or row.get('source_respondent_city') or ''
        if city not in cache:
            ident = resolve_geography(store, city)
            muni = municipality_for(store, ident)
            cache[city] = (ident, muni, current_scope(ident))
        ident, muni, matched = cache[city]
        row.update({'service_scope_geography_id': ident, 'service_scope_municipality_id': muni,
            'service_scope_status': 'configured_service_context' if matched else 'resolved_not_in_configured_context' if ident else 'unknown_unresolved_locality',
            'scope_basis': 'publisher_locality_exact_reviewed_alias_and_administrative_ancestors; not spatial or occupancy verification'})
    db.close()


def _write_rows(folder, rows, source, *, raw_receipts, source_count, observed_at, metrics, acquisition_id, database=None, extra=None):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    _scope_rows(rows, database)
    target = folder / 'normalised-records.jsonl.gz'
    temporary = target.with_suffix(target.suffix + '.tmp')
    with temporary.open('wb') as rawout, gzip.GzipFile(filename='', fileobj=rawout, mode='wb', mtime=0) as zipped:
        for row in rows:
            zipped.write((json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n').encode())
    temporary.replace(target)
    city_sector = Counter((row.get('city') or row.get('source_respondent_city') or '', row.get('industry_family') or '', row['service_scope_status']) for row in rows)
    summary_rows = [{'publisher_city': city, 'industry_family': sector, 'service_scope_status': status, 'source_record_count': n} for (city, sector, status), n in sorted(city_sector.items())]
    _small_csv(folder / 'city-sector-summary.csv', summary_rows)
    _small_csv(folder / 'record-sample.csv', [{k: row.get(k) for k in ['source_record_id','name','entity_type','location_type','address','city','source_respondent_city','source_respondent_type','postal_code','source_facility_type','source_address_role','source_effective_datetime','service_scope_status']} for row in rows[:100]])
    command_names={}
    for row in rows:
        command_names.setdefault(row['name'],[]).append(row['source_record_id'])
    command_links=[]
    for row in rows:
        command=row.get('source_reporting_command')
        matches=command_names.get(command,[])
        if command and len(matches)==1 and matches[0]!=row['source_record_id']:
            command_links.append({'subject_source_record_id':row['source_record_id'],'predicate':'reports_to_command',
                'object_source_record_id':matches[0],'source_reporting_command':command,
                'evidence_scope':'Explicit command column plus one exact same-source office name; not property ownership, legal parenthood or purchasing authority.'})
    link_path=folder/'explicit-command-relationships.jsonl'
    with link_path.open('w',encoding='utf-8') as handle:
        for row in command_links:handle.write(json.dumps(row,ensure_ascii=False)+'\n')
    manifest = {'status': 'acquired', 'source': source, 'observed_at': observed_at, 'parser_version': VERSION,
        'acquisition_id': acquisition_id, 'records_file': target.name, 'records_sha256': _hash(target), 'records_count': len(rows),
        'official_source_observations': source_count, 'source_count_reconciled': source_count == len(rows), 'raw_receipts': raw_receipts,
        'scope_counts': dict(Counter(row['service_scope_status'] for row in rows)),
        'source_category_counts': dict(Counter(row.get('source_facility_type') or 'unknown' for row in rows)),
        'location_type_counts': dict(Counter(row.get('location_type') for row in rows)),
        'rows_with_street_address': sum(bool(row.get('address')) for row in rows),
        'explicit_relationships_file':link_path.name,'explicit_relationships_sha256':_hash(link_path),'explicit_command_relationships':len(command_links),
        'metrics': metrics, 'canonical_database_mutated': False, 'people_collected': 0,
        'limitations': ['Source record count is not a unique-company or unique-building count.', 'Service locations and addresses are source reported; current occupancy and legal identity remain unverified.', 'Public ownership and parent/operator relations are not inferred.', 'Province-wide acquisition is separate from configured service-context matching.'], **(extra or {})}
    _save(folder / 'manifest.json', manifest)
    return manifest


def _small_csv(path, rows):
    if not rows:
        return
    with Path(path).open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        for row in rows:
            writer.writerow({k: "'" + v if isinstance(v, str) and v.lstrip().startswith(('=', '+', '-', '@', '\t', '\r')) else v for k, v in row.items()})


def write_blocked_source_handoff(output, records):
    """Publish only actual recorded blocks/restrictions, never unsearched leads."""
    from urllib.parse import urlsplit
    for row in records:
        if row.get('retrieval_status') not in {'blocked','restricted','access_policy_unresolved'} or not row.get('latest_recorded_error') or not row.get('observation_reference'):
            raise ValueError('Blocked handoff needs an actual recorded error/restriction and evidence reference')
        if urlsplit(row.get('source_url','')).scheme!='https' or not row.get('rights_status') or not row.get('permitted_next_step'):
            raise ValueError('Blocked handoff needs exact source URL, rights status and a grounded next step')
    output=Path(output)
    _save(output/'blocked-source-handoff.json',records)
    with (output/'blocked-source-handoff.jsonl').open('w',encoding='utf-8') as handle:
        for row in records:handle.write(json.dumps(row,ensure_ascii=False)+'\n')
    _small_csv(output/'blocked-source-handoff.csv',records)
    return {'blocked_or_restricted_sources':len(records),'unsearched_sources_present':False}


def _metric_delta(before, after):
    return {**{k: after.get(k, 0) - before.get(k, 0) for k in ['requests','bytes_fetched','cache_hits','elapsed_seconds']},
            'estimated_cost': 0, 'paid_service_calls': 0, 'model_tokens': 0}


def acquire_moh(output, transport, *, database=None):
    folder = Path(output) / 'ontario-moh-service-locations'
    folder.mkdir(parents=True, exist_ok=True)
    before = transport.metrics()
    receipts = []
    def fetch(url, filename):
        response = transport.fetch(url)
        if response.status != 200:
            raise SourceBlocked(f'Official civic source HTTP{response.status}: {url}')
        path = folder / filename
        path.write_bytes(response.body)
        receipts.append({'file': filename, 'source_url': url, 'sha256': _hash(path), 'bytes': len(response.body)})
        return response.json()
    item = fetch(MOH_ITEM, 'publisher-item-metadata.json')
    if item.get('url') != MOH_LAYER or 'open-government-licence-ontario' not in str(item.get('licenseInfo')):
        raise SourceBlocked('Official health layer identity or Ontario open licence changed')
    layer = fetch(MOH_LAYER + '?f=json', 'layer-metadata.json')
    fields = {f['name'] for f in layer.get('fields', [])}
    if not set(MOH_FIELDS).issubset(fields) or layer.get('geometryType') != 'esriGeometryPoint':
        raise SourceBlocked('Official health schema differs from reviewed public facility fields')
    if 'open-government-licence-ontario' not in str(layer.get('copyrightText', '')):
        raise SourceBlocked('Layer reuse licence is not established')
    base = MOH_LAYER + '/query?'
    count = fetch(base + urlencode({'f':'json','where':'1=1','returnCountOnly':'true'}), 'official-count.json').get('count')
    inventory = fetch(base + urlencode({'f':'json','where':'1=1','returnIdsOnly':'true'}), 'official-id-inventory.json')
    ids = inventory.get('objectIds') or []
    if not isinstance(count, int) or not ids or len(ids) != len(set(ids)) or len(ids) != count:
        raise SourceBlocked('Official health count and unique source IDs do not reconcile')
    max_records = int(layer.get('maxRecordCount') or 0)
    if max_records < 1:
        raise SourceBlocked('Official response limit is missing')
    rows, returned_ids, stable_ids = [], set(), set()
    observed = stamp()
    for offset in range(0, len(ids), min(max_records, 1000)):
        selected = sorted(ids)[offset:offset + min(max_records, 1000)]
        filename = f'raw-page-{offset:06d}.json'
        # Short numeric object-ID windows avoid an oversized GET query while
        # retaining exact inventory reconciliation. Newly inserted IDs or any
        # unexpected row in a window cause a stop rather than a silent skip.
        page = fetch(base + urlencode({'f':'json','where':f'OBJECTID >= {selected[0]} AND OBJECTID <= {selected[-1]}', 'outFields':','.join(MOH_FIELDS), 'returnGeometry':'true', 'outSR':'4326'}), filename)
        projection = page.get('spatialReference') or {}
        if page.get('exceededTransferLimit') or projection.get('wkid') != 4326:
            raise SourceBlocked('Health page truncated or output projection unconfirmed')
        actual = {f['attributes']['OBJECTID'] for f in page.get('features', [])}
        if actual != set(selected) or len(page.get('features', [])) != len(selected) or returned_ids & actual:
            raise SourceBlocked('Health page source IDs differ from requested inventory')
        returned_ids.update(actual)
        for feature in page['features']:
            row = normalise_moh_feature(feature, observed_at=observed, raw_reference=filename)
            if row['source_record_id'] in stable_ids:
                raise SourceBlocked('Duplicate official OGF identity; source unit needs review')
            stable_ids.add(row['source_record_id'])
            rows.append(row)
        print(json.dumps({'source':'ontario-moh-service-locations','stage':'acquiring','received':len(rows),'official_expected':count}), flush=True)
    if returned_ids != set(ids) or len(rows) != count:
        raise SourceBlocked('Health collection did not exhaust official source inventory')
    effective_dates = [r['source_effective_datetime'] for r in rows if r.get('source_effective_datetime')]
    source = {'id':'ontario-moh-service-locations','name':'Ontario Ministry of Health Service Provider Locations (MOHSERLO)',
        'publisher':'Ontario Ministry of Health / Land Information Ontario', 'source_url':MOH_LAYER, 'source_type':'institutional_directory',
        'geography_scope':['Ontario'], 'sector_scope':['healthcare','senior_living'], 'access_method':'documented_open_data_endpoint',
        'retrieval_status':'accessible','rights_status':'licensed_open','terms_url':OGL_ON,'cost_model':'free','adapter_name':'civic_moh_arcgis',
        'last_checked_at':observed,'last_success_at':observed,'source_date':None,'refresh_interval':365,
        'reported_count':count,'count_definition':'Official OGF service-location rows; services can share a site, address can include administration/billing, and public/private ownership is not asserted.',
        'notes':'Contains information licensed under the Open Government Licence – Ontario. Publisher specifies planning purposes, not operational/navigation use. Underlying effective/geometry dates retained per row; fresh capture does not prove current occupancy or one legal organisation per row.',
        'config':{'identifier_namespace':'Ontario-LIO-OGF_ID','publisher_item_url':MOH_ITEM,'maxRecordCount':max_records,'source_inventory_exhausted':True,'market_coverage_complete':False}}
    return _write_rows(folder, rows, source, raw_receipts=receipts, source_count=count, observed_at=observed,
        metrics=_metric_delta(before, transport.metrics()), acquisition_id=str(uuid.uuid4()), database=database,
        extra={'publisher_item_modified_at':_date(item.get('modified')),'source_effective_date_min':min(effective_dates) if effective_dates else None,
               'source_effective_date_max':max(effective_dates) if effective_dates else None,'official_id_inventory_exhausted':True})


def acquire_csv_resource(output, transport, *, kind, package, database=None, resource=None):
    """Use an official federated package receipt and its documented CSV URL."""
    if package.get('license_id') != 'on-oglo':
        raise SourceBlocked('Civic CSV package does not explicitly carry OGL Ontario')
    resources = [r for r in package.get('resources',[]) if r.get('format','').upper() == 'CSV' and 'en' in r.get('language',[])]
    resource = resource or (resources[0] if len(resources) == 1 else None)
    if resource not in resources:
        raise SourceBlocked('One exact reviewed English CSV resource must be selected')
    folder = Path(output) / ('ontario-' + kind + '-locations')
    folder.mkdir(parents=True, exist_ok=True)
    before = transport.metrics()
    response = transport.fetch(resource['url'])
    if response.status != 200:
        raise SourceBlocked(f'Official civic CSV HTTP{response.status}')
    path = folder / 'original.csv'
    path.write_bytes(response.body)
    _save(folder / 'federated-package-receipt.json', package)
    observed = stamp()
    rows = normalise_civic_csv(response.body, kind=kind, observed_at=observed, source_url=resource['url'], source_date=resource.get('last_modified') or None)
    source = {'id':'ontario-' + kind + '-locations','name':package.get('title'),'publisher':'Government of Ontario',
        'source_url':resource['url'],'source_type':'institutional_directory','geography_scope':['Ontario'],
        'sector_scope':['arts_culture_events_media'] if kind == 'library' else ['government_agencies'],
        'access_method':'documented_open_data_download','retrieval_status':'accessible','rights_status':'licensed_open','terms_url':OGL_ON,
        'cost_model':'free','adapter_name':'civic_official_csv','last_checked_at':observed,'last_success_at':observed,
        'source_date':resource.get('last_modified') or None,'refresh_interval':365,'reported_count':len(rows),
        'count_definition':'Parsed published CSV observations; no independent authoritative total advertised.',
        'notes':'Contains information licensed under the Open Government Licence – Ontario. Federated catalogue is metadata only; underlying resource dates and rows preserved. Site records are not presumed separate legal entities or currently occupied buildings.',
        'config':{'official_federated_package_id':package['id'],'official_resource_id':resource['id'],'source_inventory_exhausted':True,'market_coverage_complete':False}}
    return _write_rows(folder, rows, source, raw_receipts=[{'file':path.name,'source_url':resource['url'],'sha256':_hash(path),'bytes':len(response.body)}],
        source_count=len(rows), observed_at=observed, metrics=_metric_delta(before, transport.metrics()), acquisition_id=str(uuid.uuid4()), database=database,
        extra={'independent_official_total':None,'source_count_basis':'all nonempty rows in saved complete resource; not an external benchmark','source_publisher_metadata_modified':package.get('metadata_modified')})


def acquire_library_report(output, transport, *, database=None):
    """Latest explicitly selected 2025 survey: administration, never all branches."""
    from lxml import html
    from urllib.parse import urljoin
    folder=Path(output)/'ontario-library-locations'
    folder.mkdir(parents=True,exist_ok=True)
    before=transport.metrics()
    page_url='https://data.ontario.ca/dataset/ontario-public-library-statistics/resource/f0ba384f-d8ff-427a-a8a2-29c921e19e9d'
    page=transport.fetch(page_url)
    if page.status!=200:raise SourceBlocked('Official 2025 library survey resource page unavailable')
    (folder/'publisher-resource-page.html').write_bytes(page.body)
    document=html.fromstring(page.body)
    if 'opengovernmentlicenceontario' not in re.sub(r'[^a-z]','',document.text_content().casefold()):
        raise SourceBlocked('Library survey resource does not identify OGL Ontario')
    urls={urljoin(page_url,a) for a in document.xpath('//a/@href') if '/download/' in a and a.lower().endswith('.xlsx')}
    if len(urls)!=1:raise SourceBlocked('One published 2025 survey workbook link was not established')
    url=next(iter(urls))
    response=transport.fetch(url)
    if response.status!=200 or not response.body.startswith(b'PK'):
        raise SourceBlocked('Official 2025 library workbook unavailable or wrong format')
    original=folder/'original-2025.xlsx'
    original.write_bytes(response.body)
    observed=stamp()
    rows=normalise_civic_csv(library_xlsx_csv(response.body),kind='library',observed_at=observed,source_url=url,source_date='2025')
    source={'id':'ontario-library-locations','name':'Ontario public library statistics: 2025 survey respondents and administration addresses',
        'publisher':'Government of Ontario, Ministry of Tourism, Culture and Gaming','source_url':url,'source_type':'institutional_directory',
        'geography_scope':['Ontario'],'sector_scope':['arts_culture_events_media'],'access_method':'documented_open_data_download',
        'retrieval_status':'accessible','rights_status':'licensed_open','terms_url':OGL_ON,'cost_model':'free','adapter_name':'civic_library_survey_xlsx',
        'source_date':'2025','last_checked_at':observed,'last_success_at':observed,'refresh_interval':365,'reported_count':len(rows),
        'count_definition':'Library-system/survey respondent rows; not a branch inventory or one physical library building per row.',
        'notes':'Contains information licensed under the Open Government Licence – Ontario. 2025 survey year is retained at year precision; 2026 acquisition/publication does not make the underlying reporting year current. Street address is the respondent/system administration address. Branch campuses, bookmobiles and contracting municipalities are not inferred as separate physical branches.',
        'config':{'official_resource_page':page_url,'survey_year':2025,'source_inventory_exhausted':True,'market_coverage_complete':False}}
    return _write_rows(folder,rows,source,raw_receipts=[{'file':'publisher-resource-page.html','source_url':page_url,'sha256':_hash(folder/'publisher-resource-page.html'),'bytes':len(page.body)},
        {'file':original.name,'source_url':url,'sha256':_hash(original),'bytes':len(response.body)}],source_count=len(rows),observed_at=observed,
        metrics=_metric_delta(before,transport.metrics()),acquisition_id=str(uuid.uuid4()),database=database,
        extra={'survey_year':2025,'record_unit':'library_system_or_survey_respondent_not_all_branches','independent_official_total':None})


def finalize_saved_civic_batches(output, *, database=None):
    """Refresh staged parsing from unchanged receipts; no HTTP or main writes.

    Caller must keep these batches staged until finalisation completes. The
    verified raw receipt hashes remain unchanged and every source row is retained.
    """
    from lxml import html
    import shutil
    output=Path(output)
    manifests=[]
    for path in sorted(output.glob('*/manifest.json')):
        old=json.loads(path.read_text())
        if old.get('status')!='acquired':continue
        for receipt in old['raw_receipts']:
            if _hash(path.parent/receipt['file'])!=receipt['sha256']:
                raise SourceBlocked('Staged raw receipt changed before final civic parsing')
        source=dict(old['source'])
        source['source_type']='institutional_directory'
        source_id=source['id']
        dates={'ontario-court-locations':('court-public-page.html','2015-04-30','April 30, 2015','https://data.ontario.ca/dataset/latitude-and-longitude-of-ontario-courthouses'),
               'ontario-opp-locations':('opp-public-page.html','2026-10-06','October 6, 2026','https://data.ontario.ca/dataset/ontario-provincial-police-detachments-and-bureau-listing')}
        receipts=list(old['raw_receipts'])
        if source_id in dates:
            filename,date,label,url=dates[source_id]
            original=output/filename
            if original.exists():
                document=html.fromstring(original.read_bytes())
                if label not in document.text_content() or 'Last Updated:' not in document.text_content():
                    raise SourceBlocked('Explicit publisher resource update date not found in saved page')
                target=path.parent/'publisher-date-receipt.html'
                shutil.copyfile(original,target)
                receipts=[r for r in receipts if r['file']!=target.name]+[{'file':target.name,'source_url':url,'sha256':_hash(target),'bytes':target.stat().st_size}]
                source['source_date']=date
                source['config']={**source.get('config',{}),'source_date_basis':'publisher_resource_last_updated_date; not verified operational/capture date','source_date_evidence':target.name}
                if source_id=='ontario-court-locations' and 'Original publisher identifies the CSV' not in source['notes']:
                    source['notes']+=' Original publisher identifies the CSV as last updated April 30, 2015; this is historical location evidence and current court operation/occupancy is unverified.'
                if source_id=='ontario-opp-locations' and 'excludes satellite' not in source['notes']:
                    source['notes']+=' The documented CSV filename explicitly excludes satellite locations. Bureau/command offices can share an address; each is not a separate police force or property.'
        if source_id=='ontario-moh-service-locations':
            rows=[]
            for receipt in receipts:
                if receipt['file'].startswith('raw-page-'):
                    page=json.loads((path.parent/receipt['file']).read_text())
                    rows.extend(normalise_moh_feature(f,observed_at=old['observed_at'],raw_reference=receipt['file']) for f in page['features'])
        elif source_id=='ontario-library-locations':
            rows=normalise_civic_csv(library_xlsx_csv((path.parent/'original-2025.xlsx').read_bytes()),kind='library',observed_at=old['observed_at'],source_url=source['source_url'],source_date='2025')
        else:
            kind='opp' if source_id=='ontario-opp-locations' else 'court'
            rows=normalise_civic_csv((path.parent/'original.csv').read_bytes(),kind=kind,observed_at=old['observed_at'],source_url=source['source_url'],source_date=source.get('source_date'))
        if len(rows)!=old['records_count'] or len({r['source_record_id'] for r in rows})!=old['records_count']:
            raise SourceBlocked('Final civic source identity/count reconciliation failed')
        reserved={'status','source','observed_at','parser_version','acquisition_id','records_file','records_sha256','records_count','official_source_observations','source_count_reconciled','raw_receipts','scope_counts','source_category_counts','location_type_counts','rows_with_street_address','metrics','canonical_database_mutated','people_collected','limitations','explicit_relationships_file','explicit_relationships_sha256','explicit_command_relationships'}
        extra={k:v for k,v in old.items() if k not in reserved}
        extra['normalisation_reviewed_at']=stamp()
        extra['normalisation_review_note']='Source inventory and original receipt hashes retained; address roles and respondent-versus-branch unit reviewed; no source-parent/property/occupancy inference.'
        manifests.append(_write_rows(path.parent,rows,source,raw_receipts=receipts,source_count=old['official_source_observations'],observed_at=old['observed_at'],
            metrics=old['metrics'],acquisition_id=old['acquisition_id'],database=database,extra=extra))
    return manifests


def apply_civic_acquisition(store, folder, *, batch_size=250, progress=None):
    """Explicit guarded local apply; stable source keys and committed-batch replay.

    Caller owns the main write window. No network occurs. No parent/property
    relationship is added unless a future reviewed row supplies explicit evidence.
    """
    from .place_import import _guard_storage, _committed_batch
    if not 1 <= batch_size <= 1000:
        raise ValueError('Civic apply batches must contain 1–1000 source rows')
    folder = Path(folder)
    manifests = [folder / 'manifest.json'] if (folder / 'manifest.json').exists() else sorted(folder.glob('*/manifest.json'))
    reports = []
    for path in manifests:
        manifest = json.loads(path.read_text())
        if manifest.get('status') != 'acquired' or manifest['source'].get('rights_status') != 'licensed_open':
            raise SourceBlocked('Civic source is not an acquired reviewed open-licence batch')
        records_path = path.parent / manifest['records_file']
        if _hash(records_path) != manifest['records_sha256']:
            raise SourceBlocked('Saved civic normalisation artifact checksum differs')
        for receipt in manifest['raw_receipts']:
            if _hash(path.parent / receipt['file']) != receipt['sha256']:
                raise SourceBlocked('Original civic source receipt checksum differs')
        validated_count, validated_ids = 0, set()
        with gzip.open(records_path,'rt',encoding='utf-8') as handle:
            for line in handle:
                if line.strip():
                    candidate = json.loads(line)
                    if not candidate.get('source_record_id') or not candidate.get('name') or candidate['source_record_id'] in validated_ids:
                        raise SourceBlocked('Civic source keys/names are missing or duplicated')
                    validated_ids.add(candidate['source_record_id'])
                    validated_count += 1
        if validated_count != manifest['records_count']:
            raise SourceBlocked('Civic verified row count differs before any write')
        relationship_path=path.parent/manifest['explicit_relationships_file'] if manifest.get('explicit_relationships_file') else None
        if relationship_path and _hash(relationship_path)!=manifest['explicit_relationships_sha256']:
            raise SourceBlocked('Civic explicit relationship artifact checksum differs before writes')
        if relationship_path:
            with relationship_path.open() as handle:
                for line in handle:
                    relation=json.loads(line)
                    if relation.get('predicate')!='reports_to_command' or any(relation.get(key) not in validated_ids for key in ['subject_source_record_id','object_source_record_id']):
                        raise SourceBlocked('Civic explicit relationship references/predicate are unreviewed')
        source_id = store.upsert_source(manifest['source'])
        report = {'source_id':source_id,'rows':0,'new_organisations':0,'new_locations':0,'quarantined':0,'replayed_batches':0,'operator_or_property_relationships_inferred':0,'new_explicit_command_relationships':0}
        quarantined_keys=set()
        def apply(rows, start):
            metrics = manifest['metrics']
            metadata = {'adapter_name':manifest['source']['adapter_name'],'parser_version':manifest['parser_version'],
                'batch_id':manifest['records_sha256'] + ':' + str(start), 'observed_at':manifest['observed_at'],
                'acquisition_id':manifest['acquisition_id'], 'coverage_complete':False,'source_inventory_exhausted':True,
                'expected_count':manifest['records_count'], **{key:metrics.get(key) for key in ['requests','bytes_fetched','elapsed_seconds','estimated_cost']}}
            if not _committed_batch(store, source_id, rows, metadata):
                _guard_storage(store, rows, {'source_folder':str(path.parent),'area':source_id,'chunk':start // batch_size})
            with store.transaction():
                result = store.ingest(source_id, rows, run_metadata=metadata)
                quarantined_keys.update(r[0] for r in store.db.execute("SELECT source_record_id FROM source_run_items WHERE run_id=? AND outcome='quarantined'",(result['run_id'],)))
                if not result.get('replayed'):
                    with store._buffer_field_assertions():
                        for row in rows:
                            identity = store.db.execute('SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?', (source_id,row['source_record_id'])).fetchone()
                            quarantined=store.db.execute("SELECT 1 FROM source_run_items WHERE run_id=? AND source_record_id=? AND outcome='quarantined'",(result['run_id'],row['source_record_id'])).fetchone()
                            if not identity or quarantined:
                                continue
                            org, evidence = identity['organisation_id'], identity['last_evidence_id']
                            for field in EXTRA_ASSERTIONS:
                                if field in row:
                                    store.assert_field(org,'organisation',field,row[field],evidence,row['observed_at'],method='official_civic_source_assertion',review_status='source_supported')
                                    if identity['location_id'] and field in {'source_address_role','source_effective_datetime','source_geometry_update_datetime','current_occupancy_verified','scope_basis','civic_record_unit'}:
                                        store.assert_field(identity['location_id'],'location',field,row[field],evidence,row['observed_at'],method='official_civic_source_assertion',review_status='source_supported')
                            if row.get('industry_family'):
                                store.db.execute("INSERT OR IGNORE INTO classifications(id,entity_id,entity_type,taxonomy,category,classification_method,confidence,evidence_id,review_status) VALUES(?,?,?,'ssm_industry_family',?,'official_civic_source_category',NULL,?,'source_mapped')", (stable_id('civic-family',org,evidence,row['industry_family']),org,'organisation',row['industry_family'],evidence))
            report['rows'] += len(rows)
            replayed = bool(result.get('replayed'))
            report['replayed_batches'] += int(replayed)
            for out, key in [('new_organisations','inserted_count'),('new_locations','new_locations'),('quarantined','quarantined_count')]:
                report[out] += 0 if replayed else result.get(key,0)
            if progress:
                progress({'source_id':source_id,'processed':report['rows'],'total':manifest['records_count'],'run_id':result['run_id'],'replayed':replayed})
        rows, start = [], 0
        with gzip.open(records_path,'rt',encoding='utf-8') as handle:
            for line in handle:
                if line.strip():
                    rows.append(json.loads(line))
                if len(rows) >= batch_size:
                    apply(rows,start); start += len(rows); rows = []
            if rows:
                apply(rows,start)
        if report['rows'] != manifest['records_count']:
            raise SourceBlocked('Civic normalisation row count differs from verified manifest')
        if relationship_path:
            with relationship_path.open() as handle, store.transaction():
                for line in handle:
                    relation=json.loads(line)
                    if relation.get('predicate')!='reports_to_command':raise SourceBlocked('Unreviewed civic relationship predicate')
                    if relation['subject_source_record_id'] in quarantined_keys or relation['object_source_record_id'] in quarantined_keys:continue
                    subject=store.db.execute('SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?',(source_id,relation['subject_source_record_id'])).fetchone()
                    parent=store.db.execute('SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?',(source_id,relation['object_source_record_id'])).fetchone()
                    if not subject or not parent:continue
                    ident=stable_id('civic-explicit-command',source_id,subject['organisation_id'],parent['organisation_id'],subject['last_evidence_id'])
                    inserted=store.db.execute("INSERT OR IGNORE INTO relationships(id,subject_id,subject_type,predicate,object_id,object_type,asserted_by_source_id,evidence_id,observed_at,review_status) VALUES(?,?,'organisation','reports_to_command',?,'organisation',?,?,?,'source_listed_unverified')",(ident,subject['organisation_id'],parent['organisation_id'],source_id,subject['last_evidence_id'],manifest['observed_at']))
                    report['new_explicit_command_relationships']+=inserted.rowcount
        reports.append(report)
    return {'sources':reports,'source_rows_processed':sum(r['rows'] for r in reports),'current_occupancy_verified':False}


def acquire(output, *, database=None):
    output = Path(output)
    output.mkdir(parents=True,exist_ok=True)
    _require_space(output, 1073741824)
    prior = [json.loads(p.read_text()) for pattern in ['scout*-metrics.json','http-invocation-*.json','ancillary-probe-metrics.json'] for p in output.glob(pattern)]
    used_requests = sum(x.get('requests',0) for x in prior)
    used_bytes = sum(x.get('bytes_fetched',0) for x in prior)
    if used_requests >= 100 or used_bytes >= 50000000:
        raise BudgetExceeded('Initial civic acquisition ceiling exhausted')
    transport = Transport(output/'http-cache',max_requests=100-used_requests,max_bytes=50000000-used_bytes,max_response_bytes=12000000,
        timeout=30,min_interval=.3,retries=1,allowed_hosts=['ws.lioservices.lrc.gov.on.ca','www.arcgis.com','open.canada.ca','data.ontario.ca','files.ontario.ca'])
    manifests, blocked = [], []
    for kind in ['moh','opp','court','library']:
        try:
            existing = output/('ontario-moh-service-locations' if kind=='moh' else 'ontario-'+kind+'-locations')/'manifest.json'
            if existing.exists():
                manifest = json.loads(existing.read_text())
                if manifest.get('status')=='acquired' and _hash(existing.parent/manifest['records_file']) == manifest['records_sha256']:
                    manifests.append(manifest)
                    continue
            if kind == 'moh':
                manifest = acquire_moh(output,transport,database=database)
            else:
                package_file = output/(kind+'-package.json')
                if not package_file.exists():
                    if kind=='library':manifest=acquire_library_report(output,transport,database=database)
                    else:continue
                else:
                    package = json.loads(package_file.read_text())
                    package = package.get('result',package)
                    manifest = acquire_csv_resource(output,transport,kind=kind,package=package,database=database)
            manifests.append(manifest)
        except (SourceBlocked,BudgetExceeded,ValueError) as error:
            blocked.append({'source_kind':kind,'status':'blocked_requires_review','error':str(error)})
            _save(output/(kind+'-blocked.json'),blocked[-1])
        print(json.dumps({'source_kind':kind,'acquired_rows':sum(m['records_count'] for m in manifests),'blocked':blocked[-1:] if blocked else []}),flush=True)
    if not (output/'opp-public-page.html').exists():
        try:
            response=transport.fetch('https://data.ontario.ca/dataset/ontario-provincial-police-detachments-and-bureau-listing')
            if response.status==200:(output/'opp-public-page.html').write_bytes(response.body)
        except (SourceBlocked,BudgetExceeded) as error:
            _save(output/'opp-date-metadata-blocked.json',{'status':'date_metadata_unresolved','error':str(error),'source_date_not_inferred':True})
    manifests=finalize_saved_civic_batches(output,database=database)
    summary = {'status':'acquired_with_explicit_limits','generated_at':stamp(),'sources':[{'id':m['source']['id'],'records_count':m['records_count'],'scope_counts':m['scope_counts'],'rows_with_street_address':m['rows_with_street_address']} for m in manifests],
        'source_rows':sum(m['records_count'] for m in manifests),'blocked':blocked,'current_invocation_metrics':transport.metrics(),
        'prior_discovery_metrics':prior,'initial_request_cap':100,'initial_byte_cap':50000000,'canonical_database_mutated':False}
    _save(output/('http-invocation-'+str(uuid.uuid4())+'.json'),transport.metrics())
    _save(output/'acquisition-manifest.json',summary)
    _save(output/'source-registry-fragment.json',{'sources':[m['source'] for m in manifests]})
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--database',type=Path)
    args = parser.parse_args()
    print(json.dumps(acquire(args.output,database=args.database)),flush=True)


if __name__=='__main__':
    main()
