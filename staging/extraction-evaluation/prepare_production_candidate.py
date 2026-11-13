"""Build a source-only compatibility candidate. Never mutate a deployment or data."""
import argparse
import hashlib
import json
from pathlib import Path

SUFFIXES = {'.py', '.mjs', '.js', '.html', '.css', '.sql', '.json', '.txt'}
PROTECTED = 'scripts/market_map/cloud/railway_entry.py'


def digest(body):
    return hashlib.sha256(body).hexdigest()


def safe_file(root, name):
    relative = Path(name)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('Unsafe manifest path')
    path = root / relative
    if not path.resolve().is_relative_to(root.resolve()) or any(
            (root / Path(*relative.parts[:i])).is_symlink()
            for i in range(1, len(relative.parts) + 1)):
        raise ValueError('Symlink or escaped source path')
    return path


def prepare(baseline, snapshot, output):
    baseline, snapshot, output = map(lambda p: Path(p).resolve(), (baseline, snapshot, output))
    if output.exists() or any(output.is_relative_to(p) or p.is_relative_to(output) for p in (baseline, snapshot)):
        raise ValueError('New, separate candidate destination required')
    manifest = json.loads((snapshot / 'staging-manifest.json').read_text())
    files, changes, base_hashes = {}, [], {}
    for path in sorted((baseline / 'scripts').rglob('*')):
        if path.is_symlink():
            raise ValueError('Symlink in baseline')
        if not path.is_file() or path.suffix not in SUFFIXES or '__pycache__' in path.parts:
            continue
        name = str(path.relative_to(baseline))
        body = safe_file(baseline, name).read_bytes()
        files[name] = body
        base_hashes[name] = digest(body)
    if PROTECTED not in files:
        raise ValueError('Production entrypoint missing')
    for name, expected in manifest.items():
        body = safe_file(snapshot, name).read_bytes()
        if digest(body) != expected:
            raise ValueError('Snapshot hash mismatch: ' + name)
        if not name.startswith(('scripts/', 'tests/', 'lib/', 'partnership-system/')):
            continue
        if name == PROTECTED:
            raise ValueError('Overlay must not replace production entrypoint')
        before = digest(files[name]) if name in files else None
        if before != expected:
            changes.append({'path': name, 'before': before, 'after': expected,
                            'action': 'add' if before is None else 'replace'})
        files[name] = body
    # No Dockerfile, inputs, secrets, startup command, or customer databases are copied.
    output.mkdir(parents=True)
    for name, body in files.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    report = {'deployable': False, 'purpose': 'source-only offline compatibility evaluation',
              'baseline_hashes': base_hashes, 'changes': changes,
              'candidate_hashes': {n: digest(b) for n, b in sorted(files.items())},
              'entrypoint_preserved': digest(files[PROTECTED]) == base_hashes[PROTECTED],
              'release_gate': 'NO_GO', 'production_mutations': False}
    (output / 'integration-manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('baseline', 'snapshot', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    result = prepare(args.baseline, args.snapshot, args.output)
    print(json.dumps({k: result[k] for k in ('deployable', 'entrypoint_preserved', 'release_gate')}))
