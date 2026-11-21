#!/usr/bin/env python3
"""Explicit, backed-up integration of the shared GTA locality catalog into Navigator."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
REGION = 'GTA_HAMILTON'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def plan(target):
    names = json.loads((ROOT / 'lib/data/gta-service-cities.json').read_text())
    assert len(names) == len(set(names)) == 29
    result = {}
    def edit(path, transform):
        file = target / path
        if not file.resolve().is_relative_to(target.resolve()):
            raise ValueError(f'Path escapes target: {path}')
        original = file.read_bytes()
        updated = transform(original.decode()).encode()
        if original != updated:
            result[path] = (original, updated)
    def geography(text):
        entry = f"  ['{REGION}', 'Toronto / GTA / Hamilton', `{ '|'.join(names) }`],\n"
        if REGION in text:
            if entry not in text:
                raise ValueError('Existing GTA region differs; manual reconciliation required')
            return text
        if text.count('];\nexport const slug') != 1:
            raise ValueError('Unrecognized geography seed boundary')
        return text.replace('];\nexport const slug', entry + '];\nexport const slug')
    edit('src/geography.ts', geography)
    edit('src/panel.ts', lambda s: s.replace("new Option('All Locations (212)', 'ALL')", "new Option(`All Locations (${locations.length})`, 'ALL')"))
    edit('tests/core.test.ts', lambda s: re.sub(r'\b216\b', '245', re.sub(r'\b212\b', '241', s)).replace('[22, 22, 31, 45, 30, 42, 20]', '[22, 22, 31, 45, 30, 42, 20, 29]'))
    edit('tests/workflow.browser.ts', lambda s: s.replace('toHaveLength(212)', 'toHaveLength(241)'))
    note = '\nThe GTA / Hamilton group adds 29 configured service labels from the partnership system catalog. These are search localities, not a claim that each label is a distinct municipality. Toronto, Scarborough, Etobicoke and North York remain separate search labels. Existing location IDs and the original 212-location order are preserved. The four Ottawa listing areas remain separate. Blandford Blenheim is a spelling alias of Blandford-Blenheim; Mitchell’s Bay and Mitchell\'s Bay are the same label. GTA and Greater Toronto Area are metro search aliases, not additional localities.\n'
    def readme(s):
        s = s.replace('all 212 locations', 'all 241 locations')
        s = s.replace('No prior repository or CRM configuration existed to reuse.', 'The original seed is supplemented by the partnership system GTA service-locality catalog.')
        s = s.replace('| **Total** | **212** |', '| Toronto / GTA / Hamilton | 29 |\n| **Total** | **241** |')
        if note.strip() not in s:
            s = s.replace('\n## Permissions', note + '\n## Permissions')
        return s
    edit('README.md', readme)
    edit('hub/geography/README.md', lambda s: s.replace('212-location matrix', '241-location matrix') + ('' if note.strip() in s else note))
    fixture = (ROOT / 'scripts/market_map/navigator-geography-upgrade.test.ts').read_bytes()
    path = 'tests/geography-upgrade.test.ts'
    file = target / path
    original = file.read_bytes() if file.exists() else None
    if original is not None and original != fixture:
        raise ValueError('Existing geography upgrade test differs; refusing overwrite')
    if original != fixture:
        result[path] = (original, fixture)
    return result

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--target', required=True, type=Path)
    p.add_argument('--apply', action='store_true')
    p.add_argument('--backup-dir', type=Path, default=ROOT / 'artifacts/navigator-geography-backups')
    args = p.parse_args()
    target = args.target.resolve()
    changes = plan(target)
    manifest = {'target':str(target), 'region':REGION, 'added_labels':29, 'primary_locations':241, 'listing_areas':4, 'files':[{'path':path,'before_sha256':digest(old) if old is not None else None,'after_sha256':digest(new)} for path,(old,new) in changes.items()]}
    if args.apply and changes:
        backup = args.backup_dir / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup.mkdir(parents=True)
        for path,(old,new) in changes.items():
            if old is not None:
                dest = backup / path
                dest.parent.mkdir(parents=True,exist_ok=True)
                dest.write_bytes(old)
        (backup/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        for path,(old,new) in changes.items():
            file = target / path
            actual = file.read_bytes() if file.exists() else None
            if actual != old:
                raise RuntimeError(f'Concurrent change detected: {path}')
            temporary = file.with_name(file.name + '.geography-patch-tmp')
            temporary.write_bytes(new)
            temporary.replace(file)
        manifest['backup'] = str(backup)
    manifest['applied'] = args.apply
    print(json.dumps(manifest,indent=2))

if __name__ == '__main__':
    main()
