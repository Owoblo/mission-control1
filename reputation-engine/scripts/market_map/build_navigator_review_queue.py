"""Group provisional listing observations for review without merging identities."""
import argparse
import collections
import hashlib
import json
import re
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', default='artifacts/city-category-source-14day-20261028/navigator-listing-candidates.jsonl')
    parser.add_argument('--output', default='artifacts/city-category-source-14day-20261028/navigator-review-queue.jsonl')
    args = parser.parse_args()
    out = Path(args.output)
    if out.exists():
        raise SystemExit('Output exists; choose a new immutable snapshot path')
    groups = collections.defaultdict(list)
    for line in Path(args.input).open(encoding='utf8'):
        row = json.loads(line)
        name = re.sub(r'[^a-z0-9]', '', (row['listing_name'] or '').lower())
        key = (row['search_location'], name, row['public_phone_candidate'])
        groups[key].append(row)
    with out.open('w', encoding='utf8') as stream:
        for key, observations in groups.items():
            first = observations[0]
            digest = hashlib.sha256(json.dumps(key).encode()).hexdigest()[:24]
            row = {
                'review_id': 'navigator_review_' + digest,
                'listing_name': first['listing_name'],
                'search_location': first['search_location'],
                'public_phone_candidate': first['public_phone_candidate'],
                'google_categories': sorted({r['google_category'] for r in observations}),
                'search_categories': sorted({r['search_category'] for r in observations if r['search_category']}),
                'capture_refs': [{'capture_id': r['capture_id'], 'source_file': r['source_file'],
                                  'source_page_url': r['source_page_url'], 'captured_at': r['captured_at']}
                                 for r in observations],
                'observation_count': len(observations),
                'size_band': 'unknown', 'physical_location': 'unverified',
                'company_identity': 'unverified', 'website': None, 'email': None,
                'next_steps': ['Confirm distinct company or branch and actual locality',
                               'Resolve official website and organizational relationships',
                               'Find published role-appropriate contact evidence',
                               'Verify email and check suppression before outreach admission'],
                'outreach_eligible': False,
            }
            stream.write(json.dumps(row, ensure_ascii=False) + '\n')
    print(json.dumps({'review_groups': len(groups), 'source_observations': sum(map(len, groups.values())),
                      'verified_businesses': 0, 'send_ready': 0, 'output': str(out)}, indent=2))


if __name__ == '__main__':
    main()
