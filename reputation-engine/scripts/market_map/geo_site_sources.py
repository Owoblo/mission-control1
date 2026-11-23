"""Discover and acquire municipal GIS sources for the daily site worker."""
from collections import Counter
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import re
import shutil
from urllib.parse import urlencode, urlsplit

from scripts.market_map.transport import BudgetExceeded, SourceBlocked, Transport
from scripts.market_map.windsor_physical import collect, save

ARCGIS = 'www.arcgis.com'
TORONTO = 'ckan0.cf.opendata.inter.prod-toronto.ca'
TORONTO_PRODUCTS = {
    'addresses': 'address-points-municipal-toronto-one-address-repository',
    'buildings': 'topographic-mapping-building-outlines',
    'parcels': 'property-boundaries',
    'streets': 'toronto-centreline-tcl',
    'zoning': 'zoning-by-law',
}
LAYER_TERMS = {
    'addresses': r'\b(civic address|address points?|municipal address|address locations?)\b',
    'buildings': r'\b(building (footprints?|outlines?|polygons?)|buildings)\b',
    'parcels': r'\b(property boundar(?:y|ies)|parcels?|parcel fabric|assessment fabric)\b',
    'streets': r'\b(street cent(?:er|re)lines?|road network|road cent(?:er|re)lines?)\b',
    'zoning': r'\b(zoning|land use zoning)\b',
}
CATALOG_HOLDS = {
    'source_discovery_pending', 'county_download_excluded_municipal_access_unconfirmed',
    'empty_source_requires_review', 'downloaded_not_yet_spatially_validated',
    'display_tiles_ready', 'available_in_linked_physical_pilot',
}


def read(path, default):
    return json.loads(path.read_text()) if path.is_file() else default


def issue(exc):
    return str(getattr(exc, 'code', None) or type(exc).__name__)


def catalogue_candidates(city, layers, transport):
    if city['municipality'] == 'Toronto':
        matches = {}
        for layer in layers:
            slug = TORONTO_PRODUCTS[layer]
            payload = transport.fetch(f'https://{TORONTO}/api/3/action/package_show?' +
                                      urlencode({'id': slug})).json()['result']
            resources = [row for row in payload['resources']
                         if row.get('name', '').endswith('4326.geojson')]
            matches[layer] = [{'id': payload['id'], 'title': payload['title'], 'publisher': 'City of Toronto',
                               'catalogue_url': f'https://open.toronto.ca/dataset/{slug}/',
                               'resources': [{k: row.get(k) for k in ('id', 'url', 'format', 'size')}
                                             for row in resources]}]
        return matches

    name = city['municipality'].replace('"', '')
    query = f'title:"{name}" AND (zoning OR parcel OR address OR building OR centreline) AND access:public'
    url = f'https://{ARCGIS}/sharing/rest/search?' + urlencode({'f': 'json', 'q': query, 'num': 50})
    payload = transport.fetch(url).json()
    matches = {layer: [] for layer in layers}
    for item in payload['results']:
        extent = item.get('extent')
        if extent and (extent[1][0] < -96 or extent[0][0] > -74 or
                       extent[1][1] < 41 or extent[0][1] > 57):
            continue
        title = item.get('title', '')
        if not re.search(r'(?<!\w)' + re.escape(name) + r'(?!\w)', title, re.I):
            continue
        if item.get('type') not in ('Feature Service', 'Map Service', 'GeoJson', 'Shapefile'):
            continue
        native_id = item['id']
        if not re.fullmatch(r'[0-9a-f]{32}', native_id):
            continue
        for layer in layers:
            if re.search(LAYER_TERMS[layer], title.replace('_', ' '), re.I):
                matches[layer].append({
                    'id': native_id, 'title': title, 'publisher': item.get('owner'),
                    'catalogue_url': f'https://{ARCGIS}/home/item.html?id={native_id}',
                    'service_url': item.get('url'), 'catalogue_query': url,
                    'additional_results_available': payload.get('nextStart', -1) > 0,
                })
    return matches


def acquire_reviewed(base, config, day):
    """Resume one reviewed ArcGIS layer each day and publish completed bundles atomically."""
    approved = config.get('reviewed_arcgis_layers', [])
    specs = {spec['municipality_code']: spec for spec in config['municipalities']}
    root = base/'source-acquisition'
    root.mkdir(exist_ok=True)
    attempts = []
    for index, row in enumerate(approved):
        code, layer = row['municipality_code'], row['layer']
        if code not in specs or layer not in LAYER_TERMS or not row.get('review_evidence'):
            raise ValueError('Source acquisition requires an enrolled boundary, supported layer and review evidence')
        source, licence = map(urlsplit, (row['url'], row['licence_url']))
        if any(u.scheme != 'https' or not u.hostname for u in (source, licence)):
            raise ValueError('Approved source and licence must be public HTTPS URLs')
        if not re.fullmatch(r'.+/(?:MapServer|FeatureServer)/\d+', source.path):
            raise ValueError('Reviewed acquisition must point to an exact ArcGIS layer')
        if Path(specs[code]['bundle']).parts != ('sources', code):
            raise ValueError('Municipal bundle path differs from its registry identity')
        target = base/'sources'/code/layer
        if (target/'manifest.json').is_file():
            continue
        revision = hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()
        stage = root/revision
        prior = read(stage/'attempt.json', {})
        if prior.get('day') == day or prior.get('state') in ('acquisition_held', 'empty_source_requires_review'):
            continue
        attempts.append((prior.get('day', ''), index, revision, row, target, stage))
    if not attempts:
        return None
    _, _, revision, row, target, stage = min(attempts)
    stage.mkdir(exist_ok=True)
    result = {'day': day, 'revision': revision, 'municipality_code': row['municipality_code'],
              'layer': row['layer'], 'source_url': row['url'], 'review_evidence': row['review_evidence']}
    # Keep the raw pages and cursor after time, request or byte limits.
    try:
        if shutil.disk_usage(root).free < 2_000_000_000:
            raise BudgetExceeded('Volume reserve reached')
        hosts = [urlsplit(row[key]).hostname for key in ('url', 'licence_url')]
        hosts.extend(row.get('licence_redirect_hosts', []))
        transport = Transport(max_requests=26, max_bytes=35_000_000, max_response_bytes=8_000_000,
                              timeout=8, retries=0, allowed_hosts=hosts)
        layer = row['layer']
        counts = collect(stage, transport=transport, layers={layer: (row['url'], row['fields'])},
                         licence=row['licence_url'], attribution=row['attribution'],
                         batch_size=row.get('batch_size', 100))
        result['count'] = counts[layer]
        result['transport'] = transport.metrics()
        if counts[layer]:
            target.parent.mkdir(parents=True, exist_ok=True)
            (stage/layer).rename(target)
            result['state'] = 'publisher_inventory_acquired'
        else:
            result['state'] = 'empty_source_requires_review'
    except BudgetExceeded as exc:
        result.update(state='acquisition_checkpointed', issue=issue(exc))
    except (SourceBlocked, OSError, ValueError, KeyError) as exc:
        result.update(state='acquisition_held', issue=issue(exc))
    save(stage/'attempt.json', result)
    return result


def run(base, config, day, transport=None):
    """Rotate through gaps before revisiting recently checked municipalities."""
    foundation = read(base.parent/'physical-foundation.json', {})
    municipalities = foundation.get('municipalities', [])
    if not municipalities:
        return {'day': day, 'state': 'foundation_missing', 'municipalities_tracked': 0}
    folder = base/'source-coverage'
    folder.mkdir(exist_ok=True)
    daily = folder/f'{day}.json'
    if daily.is_file():
        return read(daily, {})
    catalogue = transport or Transport(max_requests=40, max_bytes=12_000_000, max_response_bytes=1_000_000,
                                       timeout=5, retries=0, allowed_hosts=[ARCGIS, TORONTO])
    eligible = []
    receipts = {}
    for city in municipalities:
        code = city['municipality_code']
        if not re.fullmatch(r'\d+', code):
            raise ValueError('Invalid canonical municipality code')
        path = folder/f'city-{code}.json'
        previous = read(path, {})
        receipts[code] = previous
        layers = [row['layer'] for row in city['layers']
                  if row['layer'] in LAYER_TERMS and row['state'] in CATALOG_HOLDS
                  and not read(base/'sources'/code/row['layer']/'manifest.json', {}).get('count')]
        if layers and (not previous or date.fromisoformat(previous['day']) <= date.fromisoformat(day) - timedelta(days=14)):
            eligible.append((previous.get('day', ''), city['municipality'] != 'Toronto', code, city, layers))
    checked = sum(row.get('day') == day for row in receipts.values())
    for _, _, code, city, layers in sorted(eligible)[:max(0, 16 - checked)]:
        entry = {'day': day, 'municipality': city['municipality'], 'layers': {}}
        try:
            matches = catalogue_candidates(city, layers, catalogue)
            for layer, candidates in matches.items():
                entry['layers'][layer] = {'state': 'candidate_scope_and_licence_review' if candidates
                                          else 'no_catalogue_match', 'candidates': candidates}
        except BudgetExceeded:
            break
        except (SourceBlocked, OSError, ValueError, KeyError) as exc:
            entry['layers'] = {layer: {'state': 'catalogue_access_or_format_held', 'issue': issue(exc)}
                               for layer in layers}
        save(folder/f'city-{code}.json', entry)
        receipts[code] = entry
        checked += 1
    acquisition = acquire_reviewed(base, config, day)
    # Keep every city and every declared layer in the rollup, including those
    # still waiting for their turn and those already acquired.
    cities = []
    for city in municipalities:
        code = city['municipality_code']
        receipt = receipts[code]
        layers = {}
        for row in city['layers']:
            layer = row['layer']
            cached = read(base/'sources'/code/layer/'manifest.json', {})
            if cached.get('count') and cached.get('source_id_inventory_reconciled'):
                layers[layer] = {'state': 'publisher_inventory_acquired', 'source_url': cached['source_url']}
            else:
                layers[layer] = receipt.get('layers', {}).get(layer, {'state': row['state']})
        cities.append({'municipality': city['municipality'], 'municipality_code': code,
                       'last_catalogue_check': receipt.get('day'), 'layers': layers})
    result = {'day': day, 'state': 'source_coverage_recorded', 'municipalities_tracked': len(cities),
              'municipalities_checked_today': checked,
              'municipalities_ever_checked': sum(bool(row['last_catalogue_check']) for row in cities),
              'layer_states': dict(Counter(layer['state'] for city in cities for layer in city['layers'].values())),
              'reviewed_acquisition': acquisition, 'municipalities': cities}
    save(folder/'latest-status.json', result)
    save(daily, result)
    return result
