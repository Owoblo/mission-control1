"""Stage provisional Google listing blocks with exact capture provenance, never send-ready."""
import argparse
import glob
import json
import re
from pathlib import Path

RATING = re.compile(r'^\d(?:\.\d)?\s*\([\d,]+\)\s*[·•]\s*(.+)$')
PHONE = re.compile(r'(?<!\d)(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})(?!\d)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pattern', default='/Users/owoblo/Downloads/ssm-google-data-navigator*.json')
    parser.add_argument('--output', default='artifacts/city-category-source-14day-20261028/navigator-listing-candidates.jsonl')
    args = parser.parse_args()
    out = Path(args.output)
    if out.exists():
        raise SystemExit('Output exists; choose a new immutable snapshot path')
    out.parent.mkdir(parents=True, exist_ok=True)
    seen = set()
    count = 0
    with out.open('w', encoding='utf8') as stream:
        for name in sorted(glob.glob(args.pattern)):
            data = json.loads(Path(name).read_text())
            for capture in data.get('captures', []):
                cid = capture.get('id')
                if not cid or cid in seen:
                    continue
                seen.add(cid)
                lines = [s.strip() for s in (capture.get('rawText') or '').splitlines() if s.strip()]
                for i in range(1, len(lines)):
                    match = RATING.match(lines[i])
                    if not match or i+1 >= len(lines):
                        continue
                    business = lines[i-1]
                    if business in {'Website', 'Directions', 'Sponsored', 'Ad'} or len(business) > 180:
                        continue
                    block = []
                    for line in lines[i+1:i+10]:
                        if RATING.match(line):
                            break
                        block.append(line)
                    phone = PHONE.search(' '.join(block))
                    row = {
                        'listing_name': business,
                        'google_category': match.group(1),
                        'public_phone_candidate': '+1' + ''.join(phone.groups()) if phone else None,
                        'search_location': capture.get('location'),
                        'region': capture.get('region'),
                        'search_category': capture.get('category'),
                        'capture_id': cid, 'source_file': name,
                        'source_page_url': capture.get('capturedPageUrl'),
                        'captured_at': capture.get('capturedAt'),
                        'raw_block': [business, lines[i], *block],
                        'size_band': 'unknown',
                        'status': 'provisional_listing_needs_identity_and_location_review',
                        'email_verified': False, 'outreach_eligible': False,
                    }
                    stream.write(json.dumps(row, ensure_ascii=False) + '\n')
                    count += 1
    print(json.dumps({'unique_capture_ids_processed': len(seen), 'provisional_listing_blocks': count,
                      'verified_businesses': 0, 'send_ready': 0, 'output': str(out)}, indent=2))


if __name__ == '__main__':
    main()
