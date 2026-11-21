"""Inventory existing Navigator captures without treating pages as business records."""
import argparse
import collections
import glob
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pattern', default='/Users/owoblo/Downloads/ssm-google-data-navigator*.json')
    parser.add_argument('--output', default='artifacts/city-category-source-14day-20261028/navigator-capture-inventory.json')
    args = parser.parse_args()
    rows = []
    files = []
    for name in sorted(glob.glob(args.pattern)):
        path = Path(name)
        data = json.loads(path.read_text())
        captures = data.get('captures', [])
        files.append({'path': str(path), 'exported_at': data.get('exportedAt'), 'captures': len(captures)})
        for capture in captures:
            rows.append({
                'capture_id': capture.get('id'), 'file': str(path),
                'category_id': capture.get('categoryId'), 'category': capture.get('category'),
                'location_id': capture.get('locationId'), 'location': capture.get('location'),
                'region': capture.get('region'), 'captured_at': capture.get('capturedAt'),
                'captured_page_url': capture.get('capturedPageUrl'),
                'capture_method': capture.get('captureMethod'),
                'text_characters': len(capture.get('rawText') or ''),
                'link_count': len(capture.get('links') or []),
                'status': 'raw_capture_unparsed',
            })
    groups = collections.Counter((r['location'], r['category']) for r in rows)
    result = {
        'files': files, 'raw_capture_rows': len(rows),
        'unique_capture_ids': len({r['capture_id'] for r in rows if r['capture_id']}),
        'location_category_pairs': len(groups),
        'windsor_capture_rows': sum(r['location'] == 'Windsor' for r in rows),
        'verified_businesses': 0, 'send_ready_contacts': 0,
        'rules': ['Historical exports only', 'Duplicate IDs across exports remain separate provenance rows',
                  'Page text and link counts are not business or contact counts'],
        'captures': rows,
    }
    out = Path(args.output)
    if out.exists():
        raise SystemExit('Output exists; choose a new immutable snapshot path')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k not in {'captures', 'files'}}, indent=2))


if __name__ == '__main__':
    main()
