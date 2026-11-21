"""Source-specific reviewed Josslin grid recovery; never guesses linked domains."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from lxml import html

from .transport import SourceBlocked

VERSION = 'josslin-reviewed-partner-grid/2'
SCOPE_XPATH = "//div[contains(concat(' ',normalize-space(@class),' '),' Page107497 ')]"
# Human-reviewed visible logo labels, in the exact source grid order. The two
# supplied screenshots corroborate the labels; link titles/alt stay unmodified.
REVIEWED_LABELS = (
    'Aviva', 'Ayr Farmers Mutual', 'Echelon', 'Economical',
    'The Edge Disability', 'Edge Mutual', 'Empire Life', 'Germania',
    'Gore Mutual', 'The Guarantee', 'HD Mutual', 'Heartland',
    'Howick Mutual', 'Intact', 'Jevco', 'Manulife Bank', 'Pafco',
    'Peel Mutual', 'Pembridge', 'Premier', 'Sentry', 'Trillium',
    'Unica', 'Wawanesa', 'Zurich',
)
EXPECTED_SRC_STEMS = (
    'Aviva_Logo_Horiz', 'ayr_farmers', 'echelon_logo', 'economical_rb-rgb',
    'edge_disability', 'edge_rgb_full_trans144', 'empire', 'Germania_logo_no-tag',
    'gore-web', 'the-guarantee-logo', 'hdmutual_insurance_company',
    'heartland_logo-small635925952826066767', 'howick-eps-web', 'intact',
    'Jevco-Logo', 'manulife_0', 'pafco-logo-web', 'peelheaderlogo',
    'pem_bridge_0', 'premier', 'sentry-2018-web',
    'trillium-mutual-insurance-logo-web', 'unica-logo', 'wawanesa', 'zurich-logo',
)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def domain(url):
    return (urlsplit(url or '').hostname or '').lower().removeprefix('www.')


def spreadsheet_cell(value):
    return "'" + value if isinstance(value, str) and value and value[0] in '=+-@' else value


def enumerate_grid(body, *, page_url, expected_count=None):
    """Capture every scoped image, including empty/missing alt and href."""
    tree = html.fromstring(body)
    scopes = tree.xpath(SCOPE_XPATH)
    if len(scopes) != 1 or not scopes[0].xpath('.//h1[normalize-space(.)="Our Partners"]'):
        raise SourceBlocked('Unique Josslin Our Partners source scope not found')
    scope = scopes[0]
    statement = ' '.join(scope.text_content().split())
    if 'pleased to have partnered with leaders in the industry' not in statement:
        raise SourceBlocked('Explicit publisher partner context not found')
    images = scope.xpath('.//table//img')
    if expected_count is not None and len(images) != expected_count:
        raise SourceBlocked(f'Partner grid changed: expected {expected_count}, found {len(images)}')
    rows = []
    for ordinal, img in enumerate(images, 1):
        anchors = img.xpath('ancestor::a[1]')
        anchor = anchors[0] if anchors else None
        href = anchor.get('href') if anchor is not None else None
        target = urljoin(page_url, href) if href else None
        if target and urlsplit(target).scheme not in ('http', 'https'):
            target = None
        rows.append({
            'source_element_ordinal': ordinal,
            'source_element_xpath': tree.getroottree().getpath(img),
            'published_img_alt': img.get('alt'),
            'published_img_title': img.get('title'),
            'published_img_src': img.get('src'),
            'published_img_attributes': dict(img.attrib),
            'published_anchor_title': anchor.get('title') if anchor is not None else None,
            'published_anchor_href': href,
            'published_anchor_attributes': dict(anchor.attrib) if anchor is not None else None,
            'object_website': target,
            'source_role': 'partner_grid',
        })
    return rows, len(tree.xpath('//img'))


def build(inspection, output, current_records):
    inspection, output, current_records = map(Path, (inspection, output, current_records))
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / 'manifest.json'
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        for path, checksum in manifest['input_hashes'].items():
            if digest(path) != checksum:
                raise SourceBlocked('Reviewed partner input changed')
        for name, checksum in manifest['files'].items():
            if digest(output / name) != checksum:
                raise SourceBlocked('Reviewed partner output changed')
        return manifest
    source = inspection / 'josslin-public-partner-grid.response'
    receipt = next(r for r in json.loads((inspection / 'inspection.json').read_text())['receipts']
                   if r['id'] == 'josslin-public-partner-grid')
    if digest(source) != receipt['sha256']:
        raise SourceBlocked('Partner HTML receipt checksum mismatch')
    screenshots = [inspection / f'user-screenshot-{n}.png' for n in (1, 2)]
    if not all(p.is_file() for p in screenshots):
        raise SourceBlocked('Human-reviewed screenshot evidence must be preserved')
    rows, all_image_count = enumerate_grid(source.read_bytes(), page_url=receipt['url'], expected_count=25)
    previous = json.loads(current_records.read_text())
    prior_page = [r for r in previous['claims'] if r.get('source_page_url') == receipt['url']]
    prior = [r for r in prior_page if r.get('logo_only')]
    prior_domains = {domain(r.get('target_website')) for r in prior}
    screenshot_proof = [{'path': str(p), 'sha256': digest(p)} for p in screenshots]
    for i, row in enumerate(rows):
        actual = Path(urlsplit(row['published_img_src']).path).stem
        if actual != EXPECTED_SRC_STEMS[i]:
            raise SourceBlocked(f'Reviewed logo sequence changed at slot {i + 1}')
        label = REVIEWED_LABELS[i]
        row.update({
            'predicate': 'listed_partner_of', 'direction': 'source_to_target',
            'subject_name': 'Josslin Insurance', 'object_name_published': label,
            'object_name_from_literal_alt_or_title': row['published_anchor_title'] or row['published_img_alt'],
            'label_resolution_method': ('published_anchor_title_with_screenshot_logo_corroboration'
                                        if row['published_anchor_title'] else
                                        'published_img_alt_with_reviewed_screenshot_logo_label'),
            'reviewed_label_proof': screenshot_proof,
            'source_id': 'josslin-published-partner-grid',
            'source_record_id': f'partner-grid:{i + 1}:{actual}',
            'source_url': receipt['url'], 'observed_at': receipt['observed_at'],
            'source_artifact': str(source), 'source_artifact_sha256': receipt['sha256'],
            'source_statement': 'Josslin is pleased to have partnered with leaders in the industry that provide expertise and professionalism.',
            'status': 'source_reported_unverified', 'rights_status': 'limited_factual_review_only_no_open_licence',
            'current_relationship_verified': False, 'contract_verified': False,
            'legal_ownership_verified': False, 'outreach_eligibility': 'research_only',
            'campaign_ready': False, 'previous_grid_record_present': domain(row['object_website']) in prior_domains,
        })
    jsonl = output / 'reviewed-partner-grid-claims.jsonl'
    jsonl.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows))
    fields = ['source_element_ordinal', 'object_name_published', 'object_website',
              'published_img_alt', 'published_img_title', 'published_img_src',
              'published_anchor_title', 'published_anchor_href', 'previous_grid_record_present',
              'source_element_xpath', 'source_record_id', 'source_url', 'observed_at',
              'source_artifact_sha256', 'label_resolution_method', 'rights_status']
    with (output / 'reviewed-partner-grid.csv').open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        for row in rows:
            writer.writerow({k: spreadsheet_cell(v) for k, v in row.items()})
    # Include excluded page images explicitly so the completeness denominator is auditable.
    tree = html.fromstring(source.read_bytes())
    grid_paths = {r['source_element_xpath'] for r in rows}
    with (output / 'all-page-images.jsonl').open('w') as stream:
        for img in tree.xpath('//img'):
            xpath = tree.getroottree().getpath(img)
            stream.write(json.dumps({'xpath': xpath, 'attributes': dict(img.attrib),
                                     'partner_grid': xpath in grid_paths,
                                     'nearest_anchor_href': img.xpath('ancestor::a[1]/@href')}) + '\n')
    missing = [r['object_name_published'] for r in rows if not r['previous_grid_record_present']]
    manifest = {
        'parser_version': VERSION, 'source_url': receipt['url'], 'observed_at': receipt['observed_at'],
        'source_scope_xpath': SCOPE_XPATH, 'grid_image_xpath': './/table//img',
        'all_page_images': all_image_count, 'partner_grid_slots': len(rows),
        'excluded_non_grid_images': all_image_count - len(rows),
        'blank_alt_partner_logos': sum(not (r['published_img_alt'] or '').strip() for r in rows),
        'published_target_websites': sum(bool(r['object_website']) for r in rows),
        'unresolved_target_websites': sum(not r['object_website'] for r in rows),
        'previous_page_records_including_navigation': len(prior_page),
        'previous_grid_records': len(prior), 'newly_recovered_slots': len(missing),
        'newly_recovered_labels': missing, 'grid_capture_complete': True,
        'market_completeness_verified': False, 'not_verified_contracts_or_current_legal_relationships': True,
        'rights_status': 'limited_factual_review_only_no_open_licence',
        'raw_capture_metrics_receipt': str(inspection / 'inspection.json'),
        'derived_metrics': {'network_requests': 0, 'main_writes': 0, 'paid_service_calls': 0},
        'input_hashes': {str(p): digest(p) for p in [source, inspection / 'inspection.json', current_records, *screenshots]},
        'files': {p.name: digest(p) for p in output.iterdir() if p.is_file()},
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--inspection', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--current-records', required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.inspection, args.output, args.current_records), indent=2))
