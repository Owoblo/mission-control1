"""Offline structured evidence extraction. A matched assertion is NOT verified occupancy.

Consumes coordinator-captured bytes only; never fetches URLs. The caller must keep
capture receipt validation, source permissions and occupancy review in place.
"""
import hashlib
from html.parser import HTMLParser
import io
import json
import re
import unicodedata

MAX_BYTES = 8 * 1024 * 1024
from .schema_types import ORGANIZATION_TYPES


def normalize(value):
    return ' '.join(unicodedata.normalize('NFKC', value).upper().split()) if isinstance(value, str) else ''


class _HTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks, self.text, self.current = [], [], None
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1
        if tag == 'script' and dict(attrs).get('type', '').lower().split(';')[0].strip() == 'application/ld+json':
            self.current = []

    def handle_endtag(self, tag):
        if tag == 'script' and self.current is not None:
            self.blocks.append(''.join(self.current))
            self.current = None
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)
        elif not self.hidden:
            self.text.append(data)


def _walk(value, path='$', depth=0):
    if depth > 64:
        raise ValueError('structured_data_depth_limit')
    if isinstance(value, dict):
        yield path, value
        for key, child in value.items():
            yield from _walk(child, path + '/' + key.replace('~', '~0').replace('/', '~1'), depth + 1)
    elif isinstance(value, list):
        for i, child in enumerate(value):
            yield from _walk(child, path + '/' + str(i), depth + 1)


def extract_source(body, *, source_url, retrieved_at, target_addresses,
                   target_locality, content_type='text/html', expected_sha256=None):
    """Return source assertions and routing; no identity merging or admission.

    Exact normalized street AND locality matches qualify for deterministic evidence
    review. Suite spelling, street abbreviations and ranges are deliberately not
    fuzzily equated. PDF/plain text requires AI; optional pypdf is lazy-loaded.
    A deterministic route never means all tenants have been found or are current.
    """
    if not isinstance(body, bytes) or len(body) > MAX_BYTES:
        raise ValueError('Expected captured bytes within 2 MiB limit')
    if not target_locality or not isinstance(target_addresses, (list, tuple)) or not all(isinstance(a, str) and a.strip() for a in target_addresses):
        raise ValueError('Explicit target address list and locality required')
    digest = hashlib.sha256(body).hexdigest()
    if expected_sha256 is not None and digest != expected_sha256:
        raise ValueError('Captured source hash mismatch')
    result = dict(schema_version=1, source_url=source_url, retrieved_at=retrieved_at,
                  body_sha256=digest, candidates=[], gaps=[], route='ai_research',
                  routing_reasons=[], current_occupancy_verified=False,
                  tenant_coverage_complete=False)
    blocks, text = [], ''
    mime = content_type.split(';')[0].strip().lower()
    if mime == 'application/pdf' or body.startswith(b'%PDF-'):
        try:
            from pypdf import PdfReader
        except ImportError:
            result['gaps'].append('pdf_extractor_unavailable')
        else:
            try:
                reader = PdfReader(io.BytesIO(body))
                if len(reader.pages) > 100:
                    raise ValueError('PDF exceeds 100-page extraction limit')
                text = '\n'.join(page.extract_text() or '' for page in reader.pages)
            except Exception:
                result['gaps'].append('pdf_extraction_failed')
        result['routing_reasons'].append('pdf_requires_semantic_address_review')
    else:
        raw = body.decode('utf-8', errors='replace')
        if mime in ('application/json', 'application/ld+json'):
            blocks = [raw]
        elif mime in ('text/html', 'application/xhtml+xml'):
            parser = _HTML()
            parser.feed(raw)
            blocks, text = parser.blocks, ' '.join(parser.text)
            if parser.current is not None:
                result['gaps'].append('unterminated_jsonld_script')
        else:
            text = raw
            result['routing_reasons'].append('unstructured_source_requires_review')
    targets = {normalize(a): a for a in target_addresses}
    for block_index, block in enumerate(blocks):
        try:
            nodes = list(_walk(json.loads(block)))
        except (ValueError, RecursionError):
            result['gaps'].append('invalid_jsonld_block:' + str(block_index))
            continue
        # References are block-local; duplicate ids cannot be safely resolved.
        refs = {}
        for _, node in nodes:
            if isinstance(node.get('@id'), str):
                key = node['@id']
                if len(node) > 1:
                    refs[key] = None if key in refs else node
        for path, node in nodes:
            types = node.get('@type', [])
            types = [types] if isinstance(types, str) else types
            if not isinstance(types, list):
                continue
            types = [t.rsplit('/', 1)[-1].split(':')[-1] for t in types if isinstance(t, str)]
            if not isinstance(node.get('name'), str) or not node['name'].strip():
                continue
            if 'Person' in types:
                continue
            if not ORGANIZATION_TYPES.intersection(types):
                if node.get('address') and 'Person' not in types and 'PostalAddress' not in types:
                    result['gaps'].append('unsupported_entity_type:' + path)
                continue
            addresses = node.get('address', [])
            address_is_list = isinstance(addresses, list)
            addresses = addresses if address_is_list else [addresses]
            if not addresses:
                addresses = [None]
            for address_index, address in enumerate(addresses):
                if isinstance(address, dict) and set(address) == {'@id'}:
                    address = refs.get(address['@id']) if isinstance(address['@id'], str) else None
                explicit = address if isinstance(address, dict) else {}
                street, locality = explicit.get('streetAddress'), explicit.get('addressLocality')
                matched = normalize(street) in targets and normalize(locality) == normalize(target_locality)
                country=explicit.get('addressCountry')
                if isinstance(country,dict):country=country.get('name',country.get('identifier'))
                region=explicit.get('addressRegion')
                geographic_conflict=(bool(country) and normalize(country) not in ('CA','CAN','CANADA')) or (bool(region) and normalize(region) not in ('ON','ONTARIO'))
                if geographic_conflict:
                    matched=False
                    result['gaps'].append('structured_country_or_province_conflict')
                # Separate unit fields need review even when base street matches.
                unit_fields = {k: explicit[k] for k in ('unitNumber', 'suite', 'floor', 'postOfficeBoxNumber', 'extendedAddress') if explicit.get(k)}
                if unit_fields:
                    matched = False
                reason = ('structured_country_or_province_conflict' if geographic_conflict else
                          'explicit_address_match' if matched else
                          'unit_or_postal_box_requires_review' if unit_fields else
                          'missing_structured_address' if not street else
                          'missing_locality' if not locality else
                          'address_or_locality_mismatch')
                evidence = json.dumps({'name': node['name'], '@type': node.get('@type'), 'address': address}, ensure_ascii=False, sort_keys=True)
                candidate = dict(organization_name=node['name'], schema_types=types,
                                 address_assertion=address, explicit_unit_fields=unit_fields,
                                 source_url=source_url, retrieved_at=retrieved_at,
                                 body_sha256=digest, evidence_text=evidence,
                                 evidence_text_sha256=hashlib.sha256(evidence.encode()).hexdigest(),
                                 source_pointer=f'block:{block_index}{path}/address' + (f'/{address_index}' if address_is_list else ''),
                                 matched_target_address=targets.get(normalize(street)) if matched else None,
                                 match_status='explicit_source_assertion' if matched else 'unresolved',
                                 routing_reason=reason, current_occupancy_verified=False)
                result['candidates'].append(candidate)
    result['text'] = ' '.join(text.split())
    if re.search(r'\b(ceased operations|permanently closed|no longer operating|has relocated|have relocated|closed permanently)\b',result['text'],re.I):
        result['gaps'].append('operating_status_notice_requires_temporal_review')
    result['text_sha256'] = hashlib.sha256(result['text'].encode()).hexdigest()
    if not result['candidates']:
        result['routing_reasons'].append('no_supported_organization_assertions')
    else:
        result['routing_reasons'].extend(sorted({c['routing_reason'] for c in result['candidates']}))
        if all(c['match_status'] == 'explicit_source_assertion' for c in result['candidates']) and not result['gaps']:
            result['route'] = 'deterministic_evidence_review'
    return result
