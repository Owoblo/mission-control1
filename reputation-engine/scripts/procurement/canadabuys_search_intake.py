"""Parse saved CanadaBuys search pages into a sourced procurement review queue.

Search result rows are discovery leads only. Status, scope, awardee and buyer role
must be confirmed from each notice before CRM admission or outreach.
"""

import argparse
import hashlib
import html
import json
import re
from pathlib import Path


BASE = 'https://canadabuys.canada.ca'


def plain(fragment):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', fragment)).split())


def parse_search(source: Path, query: str):
    raw = source.read_bytes()
    page = raw.decode('utf-8', 'replace')
    summary = re.search(r'class="search-total-count"[^>]*>([^<]+)', page)
    body = re.search(r'<tbody>(.*?)</tbody>', page, re.S)
    if not body:
        raise ValueError(f'No result table in {source}')
    records = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', body.group(1), re.S):
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
        link = re.search(r'href="(/en/tender-opportunities/tender-notice/[^\"]+)', row)
        if not link or len(cells) < 5:
            continue
        url = BASE + html.unescape(link.group(1))
        records.append({
            'notice_url': url, 'notice_id': url.rsplit('/', 1)[-1],
            'title_from_search': plain(cells[0]), 'category_from_search': plain(cells[1]),
            'posted_or_amended_from_search': plain(cells[2]),
            'closing_from_search': plain(cells[3]),
            'buyer_from_search': plain(cells[4]),
            'query': query, 'search_snapshot': str(source),
            'search_snapshot_sha256': hashlib.sha256(raw).hexdigest(),
            'query_total_reported': int(plain(summary.group(1)).replace(',', '')) if summary else None,
            'status': 'unverified_search_result', 'buyer_verified': False,
            'scope_verified': False, 'awardee_verified': False,
            'next_action': 'review_official_notice_and_related_awards',
        })
    return records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', action='append', required=True, help='query=local saved HTML path')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    by_id = {}
    for entry in args.snapshot:
        query, path = entry.split('=', 1)
        for record in parse_search(Path(path), query):
            old = by_id.get(record['notice_id'])
            if old:
                old['matched_queries'].append(query)
            else:
                record['matched_queries'] = [query]
                by_id[record['notice_id']] = record
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in by_id.values()))
    print(json.dumps({'unique_notices': len(by_id), 'queries': len(args.snapshot), 'admitted': 0, 'outreach': 0}))


if __name__ == '__main__':
    main()
