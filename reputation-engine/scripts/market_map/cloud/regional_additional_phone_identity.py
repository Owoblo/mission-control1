"""Source-only association of additional phones; never assert carrier or person identity."""
import datetime
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
from scripts.market_map.cloud.regional_identity_review import check, norm, street
from scripts.market_map.cloud.additional_visible_decisions import apply_reviews
from scripts.market_map.visible_contact_evidence import blocks_for_numbers

ROOT = Path('/data/research/artifacts/regional-contact-enrichment-20261104')
CONFLICTS = {'business_name_requires_review', 'street_address_requires_review', 'locality_requires_review',
             'province_conflict', 'country_conflict', 'website_host_requires_review',
             'source_bytes_unavailable_or_changed', 'fax_or_extension_requires_route_review',
             'missing_or_mismatched_source_hash'}

def review(candidates, receipts, now, proof_valid):
    targets = {r['phone']: r for r in candidates if not r['also_in_captured_map_phone_fields']}
    results = {n: {'phone': n, 'matches': [], 'source_holds': set()} for n in targets}
    for receipt in receipts:
        for page in receipt['pages']:
            observations = [o for o in page['phones'] if o.get('phone') in targets]
            if not observations:
                continue
            if not proof_valid(page):
                for obs in observations:
                    results[obs['phone']]['source_holds'].add('source_bytes_unavailable_or_changed')
                continue
            for obs in observations:
                number = obs['phone']
                result = results[number]
                if not re.fullmatch(r'\+1[2-9]\d{2}[2-9]\d{6}', number):
                    result['source_holds'].add('phone_format_requires_review')
                    continue
                for record in receipt['records']:
                    # Temporary comparison input only. Never overwrite the map phone.
                    comparison = {**record, 'phone_base': number[2:]}
                    reasons, evidence = check(comparison, page, obs, now)
                    result['source_holds'].update(reasons)
                    if not reasons:
                        result['matches'].append({**evidence, 'mapped_phone_base': record.get('phone_base'),
                                                  'association_basis': 'explicit_scoped_website_phone_not_map_phone_match'})
    rows = []
    for number, result in sorted(results.items()):
        matches = list({(m['source_record_id'], m['source_url'], m['source_sha256']): m for m in result['matches']}.values())
        scopes = {(norm(m['organization']), street(m['street']), norm(m['locality'])) for m in matches}
        holds = result['source_holds']
        if len(targets[number]['publishing_hosts']) > 1:
            holds.add('multiple_publishing_hosts_require_review')
        if len(scopes) > 1:
            holds.add('shared_phone_multiple_locations')
        passed = len(scopes) == 1 and not holds.intersection(CONFLICTS | {'multiple_publishing_hosts_require_review', 'shared_phone_multiple_locations'})
        rows.append({'phone': number, 'matches': matches, 'source_holds': sorted(holds),
            'state': 'source_association_passed_carrier_and_crm_pending' if passed else 'source_association_review_required',
            'contact_kind': 'business_route', 'person_name': None, 'carrier_checked': False,
            'send_ready': False, 'owner_send_hold': True,
            'release_holds': ['country_and_line_type_review', 'crm_history_and_suppression_review',
                              'fresh_source_and_channel_check_before_release', 'category_message_approval_required', 'owner_send_hold']})
    return {'summary': {'checked_at': now.isoformat(), 'additional_numbers_reviewed': len(rows),
        'source_association_passed': sum(r['state']=='source_association_passed_carrier_and_crm_pending' for r in rows),
        'verified_unique_contacts': 0, 'carrier_calls': 0, 'messages_sent': 0, 'send_ready': 0, 'owner_send_hold': True}, 'rows': rows}

def main():
    candidates = json.loads((ROOT/'additional-website-phone-inventory.json').read_text())['rows']
    def valid(page):
        try:
            return hashlib.sha256(Path(page['body_path']).read_bytes()).hexdigest() == page['sha256']
        except OSError:
            return False
    receipts = (json.loads(p.read_text()) for p in sorted((ROOT/'sources').glob('*/receipt.json')))
    report = review(candidates, receipts, datetime.datetime.now(datetime.timezone.utc), valid)
    decision_file = ROOT/'additional-visible-reviewed-decisions.json'
    if decision_file.exists():
        def visible_proof(record, evidence, number):
            try:
                host=(urlsplit(record['website']).hostname or '').removeprefix('www.')
                if (urlsplit(evidence['source_url']).hostname or '').removeprefix('www.')!=host:return False
                receipt=json.loads((ROOT/'sources'/hashlib.sha256(host.encode()).hexdigest()[:20]/'receipt.json').read_text())
                if record not in receipt['records']:return False
                page=next(p for p in receipt['pages'] if p['url']==evidence['source_url'] and p['sha256']==evidence['page_content_sha256'] and p['captured_at']==evidence['captured_at'])
                matches=blocks_for_numbers(Path(page['body_path']).read_bytes(),record,{number},page['sha256']).get(number,[])
                return any(m['excerpt']==evidence['excerpt'] and m['source_dom_locator']==evidence['source_dom_locator'] for m in matches)
            except (OSError,ValueError,KeyError,StopIteration):return False
        report=apply_reviews(report,json.loads(decision_file.read_text())['rows'],datetime.datetime.now(datetime.timezone.utc),visible_proof)
    target = ROOT/'additional-phone-source-review.json'
    temp = target.with_suffix('.tmp');temp.write_text(json.dumps(report, indent=2));temp.replace(target)
    print(json.dumps(report['summary']))

if __name__ == '__main__':
    main()
