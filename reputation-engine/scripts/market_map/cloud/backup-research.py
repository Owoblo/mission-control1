#!/usr/bin/env python3
"""Consistent SQLite backup plus state and referenced receipts; no credentials.

Use after stopping the coordinator for cutover. Routine backups may run while
research runs; source files are copied only after hash-bound durable submissions.
Restore extracts into an EMPTY directory; inspect before replacing a live queue.
"""
import argparse,datetime,hashlib,io,json,os
from pathlib import Path
import sqlite3,tarfile,tempfile,re


def references(value):
    if isinstance(value,list):
        for item in value:yield from references(item)
    elif isinstance(value,dict):
        for key,item in value.items():
            if key in ('raw_evidence_reference','worker_interpretation_reference'):
                if isinstance(item,str):yield item
                elif isinstance(item,dict) and isinstance(item.get('path'),str):yield item['path']
            elif key in ('receipt_path','body_path') and isinstance(item,str):yield item
            yield from references(item)


def allowed_runtime(rel):
    return bool(re.fullmatch(r"\.runtime/trusted-source-cache/objects/[0-9a-f]{64}\.(body|receipt\.json)",str(rel)))



def backup(root,output):
    root=Path(root).resolve();output=Path(output).resolve()
    state=root/'artifacts/windsor-building-ledger-20261029';database=state/'research-queue.sqlite3'
    output.mkdir(parents=True,exist_ok=True)
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    target=output/('research-'+stamp+'.tar.gz');partial=target.with_suffix(target.suffix+'.partial')
    with tempfile.TemporaryDirectory() as temp:
        snapshot=Path(temp)/'research-queue.sqlite3'
        source=sqlite3.connect(database.as_uri()+'?mode=ro',uri=True);dest=sqlite3.connect(snapshot)
        try:source.backup(dest)
        finally:source.close();dest.close()
        db=sqlite3.connect(snapshot);events=[json.loads(r[0]) for r in db.execute('SELECT body FROM building_events')];db.close()
        paths={p for p in state.rglob('*') if p.is_file() and not p.is_symlink() and not p.name.endswith(('.sqlite3','.sqlite3-wal','.sqlite3-shm','.lock','.partial'))}
        # Include older exported receipts even if they predate queue staging.
        for file in paths:
            if file.suffix=='.jsonl':
                for line in file.read_text(errors='replace').splitlines():
                    try:events.append(json.loads(line))
                    except ValueError:pass  # Live logs may have an incomplete final line.
        for ref in references(events):
            p=(root/ref).resolve()
            if root not in p.parents or not p.is_file():raise ValueError('Missing/outside-root evidence dependency: '+ref)
            paths.add(p)
        paths.update(p for p in (root/'scripts/market_map').rglob('*') if p.is_file() and p.suffix in ('.py','.sh','.json','.txt','.service','.timer') and '__pycache__' not in p.parts)
        paths.add(root/'docs/coverage-expansion-operating-playbook-20261028.txt')
        manifest={'created_at':stamp,'sqlite_backup':str(database.relative_to(root)),'files':[], 'scope':'State, evidence dependencies, research code and full playbook. No API/AWS credentials.'}
        with tarfile.open(partial,'w:gz') as archive:
            archive.add(snapshot,arcname=str(database.relative_to(root)))
            manifest['sqlite_sha256']=hashlib.sha256(snapshot.read_bytes()).hexdigest()
            for p in sorted(paths):
                rel=p.relative_to(root)
                if ('.runtime' in rel.parts and not allowed_runtime(rel)) or p.name.startswith('.env') or p.is_symlink():raise ValueError('Secret or symlink dependency rejected')
                content=p.read_bytes()
                if allowed_runtime(rel) and hashlib.sha256(content).hexdigest()!=p.name.split('.')[0]:raise ValueError('Content-addressed cache checksum mismatch')
                info=tarfile.TarInfo(str(rel));info.size=len(content);info.mode=0o600;archive.addfile(info,io.BytesIO(content))
                manifest['files'].append({'path':str(rel),'sha256':hashlib.sha256(content).hexdigest()})
            receipt=Path(temp)/'backup-manifest.json';receipt.write_text(json.dumps(manifest,indent=2)+'\n');archive.add(receipt,arcname='backup-manifest.json')
        with partial.open('rb') as stream:os.fsync(stream.fileno())
        partial.replace(target)
    target.chmod(0o600)
    return {'backup':str(target),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'files':len(paths)+1}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[3]);p.add_argument('--output',type=Path,required=True);a=p.parse_args();print(json.dumps(backup(a.root,a.output),indent=2))
