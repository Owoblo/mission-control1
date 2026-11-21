#!/usr/bin/env python3
"""Verify and restore a research bundle into a NEW empty directory, always paused."""
import argparse,hashlib,json,re
from pathlib import Path,PurePosixPath
import sqlite3,tarfile


def restore(archive_path,destination):
    destination=Path(destination).resolve()
    if destination.exists() and any(destination.iterdir()):raise ValueError('Restore requires an empty destination')
    destination.mkdir(parents=True,exist_ok=True)
    with tarfile.open(archive_path,'r:gz') as archive:
        members=archive.getmembers();names=set()
        for member in members:
            path=PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not member.isfile() or member.name in names:raise ValueError('Unsafe or duplicate archive entry')
            if ('.runtime' in path.parts and not re.fullmatch(r'\.runtime/trusted-source-cache/objects/[0-9a-f]{64}\.(body|receipt\.json)',member.name)) or path.name.startswith('.env'):raise ValueError('Credential entry forbidden')
            names.add(member.name)
        manifest_member=archive.getmember('backup-manifest.json');manifest=json.load(archive.extractfile(manifest_member))
        expected={r['path']:r['sha256'] for r in manifest['files']}
        expected[manifest['sqlite_backup']]=manifest['sqlite_sha256']
        if names != set(expected)|{'backup-manifest.json'}:raise ValueError('Archive and manifest inventory differ')
        # Validate every member before materializing anything.
        for member in members:
            if member.name=='backup-manifest.json':continue
            digest=hashlib.sha256(archive.extractfile(member).read()).hexdigest()
            if '.runtime' in PurePosixPath(member.name).parts and digest!=PurePosixPath(member.name).name.split('.')[0]:raise ValueError('Cache content checksum mismatch')
            if digest!=expected[member.name]:raise ValueError('Archive checksum mismatch')
        for member in members:
            target=destination/member.name;target.parent.mkdir(parents=True,exist_ok=True)
            with target.open('xb') as out:out.write(archive.extractfile(member).read())
            target.chmod(0o600)
    database=destination/manifest['sqlite_backup'];db=sqlite3.connect(database)
    try:
        integrity=db.execute('PRAGMA integrity_check').fetchone()[0]
        if integrity!='ok':raise ValueError('Restored SQLite integrity check failed')
        binding=db.execute("SELECT value FROM building_queue_meta WHERE key='export_path'").fetchone()
        counts=dict(db.execute('SELECT state,count(*) FROM building_items GROUP BY state').fetchall())
    finally:db.close()
    paused=destination/'artifacts/windsor-building-ledger-20261029/PAUSED'
    paused.write_text(json.dumps({'reason':'Restored queue: verify export-path binding, copied receipts, credentials and single scheduler ownership before activation'})+'\n')
    return {'destination':str(destination),'integrity_check':integrity,'queue_states':counts,'prior_export_binding':binding[0] if binding else None,'paused':True,'credentials_restored':False}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('archive',type=Path);p.add_argument('destination',type=Path);a=p.parse_args();print(json.dumps(restore(a.archive,a.destination),indent=2))
