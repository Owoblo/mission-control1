"""Inventory saved website phones omitted by map-phone matching. No provider calls."""
import datetime
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path('/data/research/artifacts/regional-contact-enrichment-20261104')

def inventory(receipts, proof_valid):
    grouped = {}
    mapped = set()
    invalid_pages = 0
    for receipt in receipts:
        local = {'+1' + str(r['phone_base']) for r in receipt['records'] if r.get('phone_base')}
        mapped.update(local)
        for page in receipt['pages']:
            observations = [o for o in page['phones'] if o.get('phone') and o['phone'] not in local
                            and o.get('kind') != 'fax' and not o.get('extension')]
            if not observations:
                continue
            if (urlsplit(page['url']).hostname or '').removeprefix('www.') != receipt['host'] or not proof_valid(page):
                invalid_pages += 1
                continue
            for observation in observations:
                if observation.get('page_content_sha256') != page['sha256']:
                    continue
                number = observation['phone']
                row = grouped.setdefault(number, {'phone': number, 'publishing_hosts': set(),
                    'candidate_source_record_ids': set(), 'candidate_organizations': set(), 'municipalities': set(),
                    'evidence': {}, 'send_ready': False, 'owner_send_hold': True})
                row['publishing_hosts'].add(receipt['host'])
                for record in receipt['records']:
                    row['candidate_source_record_ids'].add(record['source_record_id'])
                    row['candidate_organizations'].add(record['organization'])
                    row['municipalities'].add(record['municipality'])
                key = (page['url'], page['sha256'], observation.get('extraction_method'), observation.get('source_dom_locator'), observation.get('context'))
                row['evidence'][key] = {'source_url': page['url'], 'source_sha256': page['sha256'],
                    'captured_at': page['captured_at'], 'context': observation.get('context'),
                    'extraction_method': observation.get('extraction_method'),
                    'source_dom_locator': observation.get('source_dom_locator')}
    rows = []
    for number, row in sorted(grouped.items()):
        row['also_in_captured_map_phone_fields'] = number in mapped
        row['holds'] = ['business_branch_and_person_association_review', 'country_and_line_type_review',
                        'source_context_and_extension_review', 'crm_history_and_suppression_review',
                        'category_message_approval_required', 'owner_send_hold']
        if len(row['publishing_hosts']) > 1:
            row['holds'].append('phone_published_on_multiple_sites')
        row['evidence'] = list(row['evidence'].values())
        rows.append({k: sorted(v) if isinstance(v, set) else v for k, v in row.items()})
    return {'summary': {'additional_website_numbers': len(rows),
        'absent_from_all_captured_map_phone_fields': sum(not r['also_in_captured_map_phone_fields'] for r in rows),
        'multiple_publishing_hosts': sum(len(r['publishing_hosts']) > 1 for r in rows),
        'invalid_or_out_of_scope_pages': invalid_pages, 'verified_unique_contacts': 0,
        'provider_calls': 0, 'messages_sent': 0, 'send_ready': 0, 'owner_send_hold': True}, 'rows': rows}

def main():
    def valid(page):
        try:
            return hashlib.sha256(Path(page['body_path']).read_bytes()).hexdigest() == page['sha256']
        except OSError:
            return False
    receipts = (json.loads(p.read_text()) for p in sorted((ROOT/'sources').glob('*/receipt.json')))
    report = inventory(receipts, valid)
    report['summary']['checked_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    target = ROOT/'additional-website-phone-inventory.json'
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps(report, indent=2))
    temp.replace(target)
    print(json.dumps(report['summary']))

if __name__ == '__main__':
    main()
