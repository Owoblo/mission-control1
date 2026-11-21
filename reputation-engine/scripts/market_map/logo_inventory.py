"""Lossless DOM occurrence inventory for saved HTML image/logo review.

This module performs no network or inventory writes. A linked, unnamed logo is
an unresolved source observation; its domain/filename never becomes a name.
Grid slots and image occurrences have different units (responsive variants may
produce several occurrences in one slot). Selectors are source-reviewed XPath.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urljoin, urlsplit

from lxml import etree, html

VERSION = 'saved-html-logo-inventory/2026-10-27.1'
_URL_STYLE = re.compile(r'url\(\s*[\'"]?(.*?)[\'"]?\s*\)', re.I)
_LOGO = re.compile(r'logo', re.I)
_LABELS = {'alt', 'title', 'aria-label', 'data-alt', 'data-title', 'data-name',
           'data-company', 'data-partner', 'data-label', 'data-caption'}
_GENERIC_LABEL = re.compile(r'^(?:image|logo|partner|client|sponsor|brand|icon|picture|photo)(?:\s+\d+)?$', re.I)
_FILE_LABEL = re.compile(r'\.(?:png|jpe?g|gif|svg|webp|ico|avif)(?:\?.*)?$', re.I)


def _tag(node):
    return etree.QName(node).localname.lower() if isinstance(node.tag, str) else ''


def _text(node, limit=500):
    # Script/style text is not visible local context.
    values = node.xpath('.//text()[not(ancestor::script) and not(ancestor::style)]')
    return ' '.join(' '.join(values).split())[:limit]


def _stable(*values):
    return hashlib.sha256(json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def _resolve(value, page_url):
    """Resolve ordinary navigation/image URLs, preserving other raw values only."""
    if not value:
        return None
    candidate = urljoin(page_url, value.strip())
    return candidate if urlsplit(candidate).scheme.lower() in {'http', 'https'} else None


def _select(document, expression, label):
    if expression is None:
        return []
    try:
        nodes = document.xpath(expression)
    except etree.XPathError as error:
        raise ValueError(f'Invalid {label}: {error}') from error
    if not isinstance(nodes, list) or any(not isinstance(node, etree._Element) for node in nodes):
        raise ValueError(f'{label} must select DOM elements')
    return nodes


def _inside(node, containers):
    return any(ancestor is container for ancestor in [node, *node.iterancestors()] for container in containers)


def _kind(node):
    tag = _tag(node)
    if not tag:  # Comments/processing instructions are retained by HTML parsing.
        return None
    if tag == 'img':
        return 'img'
    if tag == 'svg':
        return 'inline_svg'
    if tag == 'image':
        return 'svg_image'
    if tag == 'source' and any(_tag(parent) == 'picture' for parent in node.iterancestors()):
        return 'picture_source'
    if tag == 'input' and node.get('type', '').lower() == 'image':
        return 'image_input'
    if tag in {'object', 'embed'} and node.get('type', '').lower().startswith('image/'):
        return 'embedded_image'
    if _URL_STYLE.search(node.get('style', '')):
        return 'inline_style_image'
    if _LOGO.search(' '.join([node.get('class', ''), node.get('id', ''), node.get('role', '')])):
        # Keep empty/lazy logo markers, but do not count a logo wrapper and its
        # nested image as two visual slots. The nested image is audited itself.
        if not any(_tag(child) in {'img', 'svg', 'image', 'picture'} for child in node.iterdescendants()):
            return 'logo_marker'
    return None


def _heading(node, tree):
    headings = node.xpath('preceding::*[self::h1 or self::h2 or self::h3 or self::h4 or self::h5 or self::h6][1]')
    if not headings:
        return None
    heading = headings[0]
    return {'text': _text(heading, 240), 'dom_locator': tree.getpath(heading),
            'method': 'nearest_preceding_dom_heading_not_relationship_proof'}


def _image(node, kind, tree, page_url, page_sha, source_id, observed_at, scoped):
    locator = tree.getpath(node)
    anchor = next((parent for parent in node.iterancestors() if _tag(parent) == 'a'), None)
    labels = [{'attribute': key, 'value': value, 'dom_locator': locator}
              for key, value in node.attrib.items() if key in _LABELS and value.strip()]
    if _tag(node) == 'svg':
        for title in node.xpath('./*[local-name()="title"]'):
            if _text(title):
                labels.append({'attribute': 'svg/title', 'value': _text(title), 'dom_locator': tree.getpath(title)})
    if anchor is not None:
        labels.extend({'attribute': 'ancestor_anchor/' + key, 'value': anchor.get(key), 'dom_locator': tree.getpath(anchor)}
                      for key in ['aria-label', 'title'] if anchor.get(key, '').strip())
    for entry in labels:
        entry['filename_like_label'] = bool(_FILE_LABEL.search(entry['value'].strip()))
    informative_labels = [entry for entry in labels if not entry['filename_like_label']
                          and not _GENERIC_LABEL.fullmatch(entry['value'].strip())]
    resources = []
    for key, value in node.attrib.items():
        if key in {'src', 'srcset', 'lazy-src', 'lazy-srcset', 'ng-src', 'href', '{http://www.w3.org/1999/xlink}href', 'data'} or key.startswith('data-') and any(token in key for token in ['src', 'lazy', 'image', 'original', 'background']):
            resources.append({'attribute': key, 'value': value,
                              'resolved_url': None if 'srcset' in key else _resolve(value, page_url)})
    for value in _URL_STYLE.findall(node.get('style', '')):
        resources.append({'attribute': 'style/url', 'value': value, 'resolved_url': _resolve(value, page_url)})
    parent = node.getparent()
    disposition = ('held_scope_unspecified' if scoped is None else
                   'outside_requested_logo_scope' if not scoped else
                   'source_label_candidate_requires_review' if informative_labels else 'held_identity_unknown')
    return {'image_occurrence_id': _stable(VERSION, source_id, page_url, page_sha, locator, kind),
            'image_kind': kind, 'dom_locator': locator, 'source_id': source_id,
            'source_url': page_url, 'observed_at': observed_at, 'source_page_sha256': page_sha,
            'attributes': dict(node.attrib), 'alt_attribute_present': 'alt' in node.attrib,
            'alt': node.get('alt'), 'title': node.get('title'),
            'data_attributes': {key: value for key, value in node.attrib.items() if key.startswith('data-')},
            'resource_candidates': resources,
            'ancestor_anchor': None if anchor is None else {
                'dom_locator': tree.getpath(anchor), 'href': anchor.get('href'),
                'resolved_href': _resolve(anchor.get('href'), page_url),
                'title': anchor.get('title'), 'aria_label': anchor.get('aria-label')},
            'nearest_heading': _heading(node, tree),
            'local_context': None if parent is None else {'dom_locator': tree.getpath(parent), 'text': _text(parent),
                                                          'text_limit': 500},
            'source_label_candidates': labels, 'has_non_generic_source_label': bool(informative_labels),
            'in_requested_logo_scope': scoped, 'disposition': disposition,
            'resolved_organisation_name': None, 'identity_status': 'unresolved',
            'automatic_partner_claim_eligible': False,
            'filename_domain_or_visual_identity_inferred': False}


def inventory_logos(body, *, page_url, source_id=None, observed_at=None,
                    scope_xpath=None, grid_item_xpath=None, expected_grid_count=None):
    """Inventory a saved HTML page, without inferring companies or relationships.

    ``scope_xpath`` selects reviewed logo-grid container(s). ``grid_item_xpath``
    independently selects actual visual slots (including empty placeholders).
    An expected count is a supplied comparison assertion, never a DOM fact.
    No selector means all image occurrences remain in an unscoped review lane.
    """
    if not isinstance(body, (str, bytes)):
        raise TypeError('body must be saved HTML bytes or text')
    if expected_grid_count is not None and (isinstance(expected_grid_count, bool) or not isinstance(expected_grid_count, int) or expected_grid_count < 0):
        raise ValueError('expected_grid_count must be a nonnegative integer')
    raw = body.encode('utf-8') if isinstance(body, str) else body
    page_sha = hashlib.sha256(raw).hexdigest()
    document = html.document_fromstring(raw or b'<html></html>',
                                       parser=html.HTMLParser(encoding='utf-8' if isinstance(body, str) else None))
    tree = document.getroottree()
    scopes = _select(document, scope_xpath, 'scope_xpath')
    if grid_item_xpath is not None and grid_item_xpath.startswith('.') and scope_xpath is not None:
        # A source-reviewed relative selector is evaluated inside each scope,
        # never against unrelated page-wide navigation/footer tables.
        slots = list(dict.fromkeys(node for scope in scopes
                                  for node in _select(scope, grid_item_xpath, 'grid_item_xpath')))
    else:
        slots = _select(document, grid_item_xpath, 'grid_item_xpath')
    # The supplied selector is evidence, even if it accidentally matches zero.
    images = [_image(node, kind, tree, page_url, page_sha, source_id, observed_at,
                     _inside(node, scopes) if scope_xpath is not None else None)
              for node in document.iter() if (kind := _kind(node)) is not None]
    selected = [image for image in images if image['in_requested_logo_scope']]
    by_locator = {image['dom_locator']: image for image in images}
    slot_rows = []
    for node in slots:
        contained = [by_locator[tree.getpath(child)] for child in node.iter()
                     if tree.getpath(child) in by_locator]
        in_scope = _inside(node, scopes) if scope_xpath is not None else None
        disposition = ('held_slot_outside_requested_scope' if in_scope is False else
                       'held_no_image_candidate' if not contained else
                       'held_identity_unknown' if not any(row['has_non_generic_source_label'] for row in contained) else
                       'source_label_candidate_requires_review')
        slot_rows.append({'grid_slot_id': _stable(VERSION, page_sha, page_url, source_id, 'grid_slot', tree.getpath(node)),
                          'dom_locator': tree.getpath(node), 'in_requested_logo_scope': in_scope,
                          'image_occurrence_ids': [row['image_occurrence_id'] for row in contained],
                          'image_occurrences': len(contained), 'disposition': disposition,
                          'local_context': _text(node), 'source_page_sha256': page_sha,
                          'automatic_partner_claim_eligible': False})
    observed_slots = len(slot_rows) if grid_item_xpath is not None else None
    comparison = ('not_requested' if expected_grid_count is None else
                  'held_grid_slot_selector_required' if observed_slots is None else
                  'matched' if observed_slots == expected_grid_count else 'mismatch_requires_review')
    issues = []
    if scope_xpath is None:
        issues.append('logo_scope_unspecified')
    elif not scopes:
        issues.append('logo_scope_selector_matched_zero_elements')
    if comparison in {'held_grid_slot_selector_required', 'mismatch_requires_review'}:
        issues.append(comparison)
    if any(row['disposition'].startswith('held_') for row in selected + slot_rows):
        issues.append('unresolved_image_or_grid_slot_retained_for_review')
    return {'version': VERSION, 'source_url': page_url, 'source_id': source_id, 'observed_at': observed_at,
            'source_page_sha256': page_sha, 'page_hash_input': 'exact_saved_bytes' if isinstance(body, bytes) else 'provided_text_utf8',
            'scope_xpath': scope_xpath, 'grid_item_xpath': grid_item_xpath,
            'all_images': images, 'scoped_logo_candidate_ids': [row['image_occurrence_id'] for row in selected],
            'grid_slots': slot_rows, 'eligible_partner_claims': [],
            'counts': {'all_image_occurrences': len(images), 'scoped_image_occurrences': len(selected),
                       'all_img_elements': sum(row['image_kind'] == 'img' for row in images),
                       'scoped_img_elements': sum(row['image_kind'] == 'img' for row in selected),
                       'scoped_img_missing_or_blank_alt': sum(row['image_kind'] == 'img' and not (row['alt'] or '').strip() for row in selected),
                       'scoped_missing_or_blank_alt': sum(not (row['alt'] or '').strip() for row in selected),
                       'scoped_non_generic_source_labels': sum(row['has_non_generic_source_label'] for row in selected),
                       'scoped_identity_unknown': sum(not row['has_non_generic_source_label'] for row in selected),
                       'selected_grid_slots': observed_slots, 'eligible_partner_claims': 0},
            'grid_comparison': {'expected_grid_count': expected_grid_count, 'observed_grid_slots': observed_slots,
                                'status': comparison,
                                'missing_expected_slot_count': max(0, expected_grid_count - observed_slots) if expected_grid_count is not None and observed_slots is not None else None,
                                'expected_count_is_supplied_not_html_proof': True},
            'coverage_status': 'review_required' if issues else 'inventory_complete_identity_review_pending',
            'review_issues': issues,
            'limitations': ['DOM image occurrences and selected grid slots are different units; responsive or duplicate images remain separate.',
                           'External stylesheets, script-created DOM and raster-only text are not interpreted; empty selected slots remain held.',
                           'Labels, links and nearby headings are source context, not verified identity, ownership, sponsorship or a current contract.'],
            'network_requests': 0, 'organisations_created': 0, 'canonical_relationships_created': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=Path, required=True)
    parser.add_argument('--page-url', required=True)
    parser.add_argument('--source-id')
    parser.add_argument('--observed-at')
    parser.add_argument('--scope-xpath')
    parser.add_argument('--grid-item-xpath')
    parser.add_argument('--expected-grid-count', type=int)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = inventory_logos(args.html.read_bytes(), page_url=args.page_url, source_id=args.source_id,
                             observed_at=args.observed_at, scope_xpath=args.scope_xpath,
                             grid_item_xpath=args.grid_item_xpath, expected_grid_count=args.expected_grid_count)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'output': str(args.output), 'source_page_sha256': result['source_page_sha256'],
                      'counts': result['counts'], 'grid_comparison': result['grid_comparison']}))


if __name__ == '__main__':
    main()
