"""Replay synthetic raw candidates against the saved pre-change implementation."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.market_map.offline_guard import OfflineGuard
from scripts.market_map.contact_normalization import parse_phone_candidate
from scripts.market_map.phone_extraction import normalize_phone


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, help='New directory under system temp')
    args = parser.parse_args()
    output = Path(args.output).resolve()
    temp = Path(tempfile.gettempdir()).resolve()
    if output == temp or not output.is_relative_to(temp) or output.exists():
        parser.error('output must be a new child directory under ' + str(temp))
    guard = OfflineGuard(output)
    guard.install()
    directory = Path(__file__).parent
    source = (directory / 'results/original-phone-extractor.py.txt').read_bytes()
    if hashlib.sha256(source).hexdigest() != 'eae9a9a705b07d561b9cf6a2ed845256bf58cc0f2cf967b4e76199b9ef2927ca':
        raise ValueError('original implementation hash mismatch')
    legacy = {'__name__': 'offline_original_phone'}
    exec(compile(source, '<saved-original-phone-extractor>', 'exec'), legacy)
    candidates = (directory / 'fixtures/phone_candidates.json').read_bytes()
    rows = []
    for raw in json.loads(candidates):
        before, after = legacy['normalize_phone'](raw), normalize_phone(raw)
        rows.append({'raw': raw, 'before': before, 'after': after, 'changed': before != after,
                     'newly_rejected': before is not None and after is None, 'candidate': parse_phone_candidate(raw)})
    output.mkdir()
    result = {'original_source_sha256': hashlib.sha256(source).hexdigest(),
              'candidates_sha256': hashlib.sha256(candidates).hexdigest(),
              'candidate_source_sha256': hashlib.sha256((ROOT / 'scripts/market_map/contact_normalization.py').read_bytes()).hexdigest(),
              'results': rows}
    (output / 'normalization-comparison.json').write_text(json.dumps(result, sort_keys=True, indent=2, ensure_ascii=False) + '\n')
    if guard.violations:
        raise RuntimeError('unexpected blocked IO')
    print(json.dumps({'inputs': len(rows), 'changed': sum(r['changed'] for r in rows),
                      'newly_rejected': sum(r['newly_rejected'] for r in rows)}))


if __name__ == '__main__':
    main()
