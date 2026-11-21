"""Cross-reference Navigator listings and current Windsor directory without merging identities."""
import argparse
import collections
import csv
import json
import re
from pathlib import Path


def norm(value):
    return re.sub(r'[^a-z0-9]', '', (value or '').lower())


def phone(value):
    digits = re.sub(r'\D', '', value or '')
    return digits[-10:] if len(digits) >= 10 else ''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', default='partnership-system/markets/ca/on/windsor-essex/runs/2026-10-28/accounts-and-locations.csv')
    parser.add_argument('--navigator', default='artifacts/city-category-source-14day-20261028/navigator-review-queue.jsonl')
    parser.add_argument('--output', default='artifacts/city-category-source-14day-20261028/windsor-google-directory-crosscheck.jsonl')
    args = parser.parse_args()
    out = Path(args.output)
    if out.exists():
        raise SystemExit('Output exists; choose a new immutable snapshot path')
    with Path(args.directory).open(newline='', encoding='utf8') as stream:
        directory = list(csv.DictReader(stream))
    by_phone = collections.defaultdict(list)
    by_name = collections.defaultdict(list)
    for row in directory:
        if phone(row.get('phone')):
            by_phone[phone(row['phone'])].append(row)
        if norm(row.get('name')):
            by_name[norm(row['name'])].append(row)
    counts = collections.Counter()
    with out.open('w', encoding='utf8') as stream:
        for line in Path(args.navigator).open(encoding='utf8'):
            lead = json.loads(line)
            matches = {}
            for row in by_phone.get(phone(lead.get('public_phone_candidate')), []):
                matches[row['source_id']] = (row, {'same_public_phone'})
            for row in by_name.get(norm(lead.get('listing_name')), []):
                if row['source_id'] in matches:
                    matches[row['source_id']][1].add('same_normalized_name')
                else:
                    matches[row['source_id']] = (row, {'same_normalized_name'})
            if not matches:
                continue
            match_rows = []
            for row, reasons in matches.values():
                match_rows.append({
                    'directory_source_id': row['source_id'], 'directory_account_id': row['account_id'],
                    'directory_name': row['name'], 'directory_city': row['city'],
                    'directory_website': row['website'], 'directory_source_url': row['source_url'],
                    'directory_retrieved_at': row['retrieved_at'], 'match_reasons': sorted(reasons),
                    'identity_verified': False,
                })
            strength = 'phone_and_name_candidate' if any(len(m['match_reasons']) == 2 for m in match_rows) else 'single_field_candidate'
            counts[strength] += 1
            stream.write(json.dumps({'navigator_review_id': lead['review_id'],
                                     'listing_name': lead['listing_name'],
                                     'search_location': lead['search_location'],
                                     'public_phone_candidate': lead['public_phone_candidate'],
                                     'crosscheck_strength': strength, 'directory_candidates': match_rows,
                                     'status': 'research_only_identity_review_required',
                                     'outreach_eligible': False}, ensure_ascii=False) + '\n')
    print(json.dumps({'directory_records': len(directory), 'matched_review_groups': sum(counts.values()),
                      'match_strengths': dict(counts), 'identity_verified': 0, 'send_ready': 0,
                      'output': str(out)}, indent=2))


if __name__ == '__main__':
    main()
