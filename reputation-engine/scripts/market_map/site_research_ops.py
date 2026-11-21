"""Consistent backup and evidence-preserving transfer for the source-first queue."""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile

from .site_research_queue import SiteResearchQueue


def backup(db, root, destination):
    root=Path(root).resolve();destination=Path(destination).resolve()
    destination.parent.mkdir(parents=True,exist_ok=True)
    if destination.exists():raise ValueError('Backup destination already exists')
    source=sqlite3.connect(Path(db).resolve().as_uri()+'?mode=ro',uri=True)
    with tempfile.TemporaryDirectory() as temporary:
        snapshot=Path(temporary)/'sites.sqlite3';target=sqlite3.connect(snapshot)
        try:
            source.backup(target)
            # The archive contains a standalone DB, never live WAL/SHM sidecars.
            target.execute('PRAGMA journal_mode=DELETE')
        finally:source.close();target.close()
        conn=sqlite3.connect(snapshot)
        files={}
        try:
            for row in conn.execute('SELECT receipt FROM evidence'):
                receipt=json.loads(row[0]);path=(root/receipt['body_path']).resolve()
                if root not in path.parents:raise ValueError('Evidence outside project')
                data=path.read_bytes()
                if hashlib.sha256(data).hexdigest()!=receipt['sha256']:raise ValueError('Evidence hash mismatch')
                files[str(path.relative_to(root))]=data
        finally:conn.close()
        files['sites.sqlite3']=snapshot.read_bytes()
        for path in sorted((root/'scripts/market_map').glob('site_*.py')):
            files[str(path.relative_to(root))]=path.read_bytes()
        for name in ('building_address_work_groups.py','trusted_source_capture.py','source_capture_cache.py',
                     'research_model_benchmark.py','transport.py','relationship_browser_capture.mjs','requirements.txt'):
            path=root/'scripts/market_map'/name
            if path.exists():files[str(path.relative_to(root))]=path.read_bytes()
        files['docs/source-first-current-contract.md']=(root/'docs/source-first-current-contract.md').read_bytes()
        manifest={'created_at':datetime.now(timezone.utc).isoformat(),'credentials_included':False,
            'scope':'Consistent site queue and referenced evidence, current site modules and contract; runtime dependencies remain separately installed.',
            'files':{name:hashlib.sha256(data).hexdigest() for name,data in files.items()}}
        partial=destination.with_suffix(destination.suffix+'.partial')
        with tarfile.open(partial,'w:gz') as archive:
            for name,data in list(files.items())+[('manifest.json',json.dumps(manifest,indent=2).encode())]:
                info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o600
                archive.addfile(info,io.BytesIO(data))
        partial.replace(destination);destination.chmod(0o600)
    return {'path':str(destination),'files':len(files),'bytes':destination.stat().st_size}


def restore(archive, destination):
    """Restore hash-checked regular files into a new, never-existing directory."""
    destination=Path(destination).resolve()
    if destination.exists():raise ValueError('Restore destination must not exist')
    destination.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        staging=Path(temporary)/'restore';staging.mkdir()
        with tarfile.open(archive,'r:gz') as source:
            members=source.getmembers()
            if sum(m.size for m in members)>1024**3:raise ValueError('Backup exceeds restore size limit')
            for m in members:
                path=Path(m.name)
                if not m.isfile() or path.is_absolute() or '..' in path.parts:
                    raise ValueError('Unsafe archive member')
            if len({m.name for m in members})!=len(members):raise ValueError('Duplicate archive entries')
            manifest=json.load(source.extractfile('manifest.json'))
            expected=manifest['files']
            if set(m.name for m in members)!=set(expected)|{'manifest.json'}:
                raise ValueError('Archive differs from manifest')
            for name,digest in expected.items():
                path=staging/name;path.parent.mkdir(parents=True,exist_ok=True)
                hasher=hashlib.sha256()
                with source.extractfile(name) as body,path.open('xb') as output:
                    while True:
                        chunk=body.read(65536)
                        if not chunk:break
                        output.write(chunk);hasher.update(chunk)
                if hasher.hexdigest()!=digest:raise ValueError('Restore hash mismatch')
                path.chmod(0o600)
            conn=sqlite3.connect((staging/'sites.sqlite3').as_uri()+'?mode=ro',uri=True)
            try:
                if conn.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise ValueError('Restored database integrity failure')
            finally:conn.close()
        staging.rename(destination)
    return {'restored':str(destination),'files':len(expected),'database_integrity':'ok'}


def transfer(source_db, target_db, root, site_ids=None):
    """Transfer existing results after evaluation; never complete legacy footprints."""
    root=Path(root).resolve()
    source=sqlite3.connect(Path(source_db).resolve().as_uri()+'?mode=ro',uri=True)
    target=SiteResearchQueue(target_db)
    copied=0
    if isinstance(site_ids,(str,Path)):site_ids=json.loads(Path(site_ids).read_text())
    try:
        rows=source.execute('SELECT site_id,result,saved_at FROM research_results').fetchall()
        target.db.execute('BEGIN IMMEDIATE')
        for sid,raw,stamp in rows:
            if site_ids is not None and sid not in site_ids:continue
            existing=target.db.execute('SELECT state,addresses,municipality,district FROM sites WHERE site_id=?',(sid,)).fetchone()
            if existing is None or existing['state']=='claimed':raise ValueError('Missing or active target site')
            if target.db.execute('SELECT 1 FROM research_results WHERE site_id=?',(sid,)).fetchone():continue
            original=source.execute('SELECT addresses,municipality,district FROM sites WHERE site_id=?',(sid,)).fetchone()
            if tuple(existing[k] for k in ('addresses','municipality','district'))!=original:raise ValueError('Site scope changed')
            result=json.loads(raw)
            if result.get('occupancy_verified') is not False or result.get('tenant_coverage_complete') is not False:
                raise ValueError('Cannot transfer automatic occupancy certification')
            for eid,receipt,saved in source.execute('SELECT evidence_id,receipt,saved_at FROM evidence WHERE site_id=?',(sid,)):
                r=json.loads(receipt);path=(root/r['body_path']).resolve()
                if root not in path.parents or hashlib.sha256(path.read_bytes()).hexdigest()!=r['sha256']:
                    raise ValueError('Transferred evidence failed validation')
                target.db.execute('INSERT OR IGNORE INTO evidence VALUES(?,?,?,?)',(sid,eid,receipt,saved))
            target.db.execute('INSERT INTO research_results VALUES(?,?,?)',(sid,raw,stamp))
            target.db.execute('INSERT OR IGNORE INTO result_history VALUES(?,?,?,?)',
                (hashlib.sha256((sid+raw).encode()).hexdigest(),sid,raw,stamp))
            target._index_assertions(sid,result,stamp)
            target.db.execute('UPDATE sites SET state=?,updated_at=? WHERE site_id=?',
                ('needs_review' if result.get('requires_review',True) else 'sources_collected',stamp,sid))
            copied+=1
        target.db.commit()
    except Exception:
        target.db.rollback();raise
    finally:
        source.close();target.close()
    return {'copied_source_assertion_results':copied,'legacy_queue_mutations':0,'verified_occupants_asserted':0}


def main():
    p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest='command',required=True)
    b=s.add_parser('backup');b.add_argument('--db',required=True);b.add_argument('--root',required=True);b.add_argument('--destination',required=True)
    t=s.add_parser('transfer');t.add_argument('--source-db',required=True);t.add_argument('--target-db',required=True);t.add_argument('--root',required=True);t.add_argument('--site-ids')
    r=s.add_parser('requeue');r.add_argument('--db',required=True);r.add_argument('--site-id',required=True);r.add_argument('--reason',required=True)
    r=s.add_parser('restore');r.add_argument('--archive',required=True);r.add_argument('--destination',required=True)
    a=vars(p.parse_args());command=a.pop('command')
    if command=='requeue':
        queue=SiteResearchQueue(a.pop('db'))
        try:result=queue.requeue(**a)
        finally:queue.close()
    else:result={'backup':backup,'transfer':transfer,'restore':restore}[command](**a)
    print(json.dumps(result,indent=2))


if __name__=='__main__':main()
