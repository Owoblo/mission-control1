"""Explicit maintenance on approved roots. No discovery, default deletion or production CLI."""
import contextlib,fcntl,hashlib,hmac,json,os,shutil,sqlite3,time,uuid
from datetime import datetime
from pathlib import Path
from .source_capture_cache import atomic,canonical

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

@contextlib.contextmanager
def maintenance_lock(root,*,exclusive=False):
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    with (root/'.maintenance.lock').open('a+b') as lock:
        fcntl.flock(lock,(fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)|fcntl.LOCK_NB)
        yield

def cleanup_capture_cache(root,*,apply=False,now=None,policy_check=None):
    """Only signed, explicitly deletion-approved expired receipts; protect all unknown references."""
    root=Path(root).resolve();now=time.time() if now is None else now
    if apply and policy_check is None:return {'status':'held_current_policy_required','applied':False,'files':[]}
    with maintenance_lock(root,exclusive=True):
        if (root/'objects').is_symlink() or (root/'capture.key').is_symlink():return {'status':'held_symlink','applied':False,'files':[]}
        key=(root/'capture.key').read_bytes();entries=[];protected=set();eligible=[]
        for path in root.glob('*.json'):
            if '.deleted-' in path.name:continue
            try:
                if path.is_symlink():raise ValueError('symlink')
                envelope=json.loads(path.read_text());p=envelope['payload']
                if not hmac.compare_digest(envelope['signature'],hmac.new(key,canonical(p),hashlib.sha256).hexdigest()):raise ValueError('signature')
                digest=p['receipt']['sha256']
                if len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest):raise ValueError('digest')
                r=p.get('retention',{})
                if policy_check is not None:
                    current=policy_check(p['receipt']['url'])
                    deadline=datetime.fromisoformat(current['retain_until'].replace('Z','+00:00')).timestamp()
                    valid=datetime.fromisoformat(current['valid_until'].replace('Z','+00:00')).timestamp()
                    r={**r,'retain_until':min(r.get('retain_until',float('inf')),deadline),
                       'delete_expired':r.get('delete_expired') is True and current.get('delete_expired') is True and bool(current.get('retention_approval_id')) and valid>now,
                       'legal_hold':r.get('legal_hold') or current.get('legal_hold') or bool(current.get('holds')),
                       'suppression_evidence':r.get('suppression_evidence') or current.get('suppression_evidence')}
                delete=(r.get('delete_expired') is True and r.get('approval_id') and isinstance(r.get('retain_until'),(int,float)) and r['retain_until']<=now and not r.get('legal_hold') and not r.get('suppression_evidence'))
                entries.append((path,digest,r))
                if delete:eligible.append((path,digest,r))
                else:protected.add(digest)
            except (ValueError,KeyError,TypeError):
                # Unknown or corrupt metadata may conceal an active/legally protected reference.
                return {'status':'held_unknown_metadata','applied':False,'files':[]}
        actions=[]
        for path,digest,r in eligible:
            body=root/'objects'/(digest+'.body')
            if body.is_symlink() or (body.exists() and sha(body)!=digest):return {'status':'held_body_integrity','applied':False,'files':[]}
            actions.append({'receipt':path.name,'body':str(body.relative_to(root)) if digest not in protected else None,'sha256':digest,'approval_id':r['approval_id']})
        if apply:
            for path,digest,r in eligible:
                current=policy_check(json.loads(path.read_text())['payload']['receipt']['url'])
                if current.get('legal_hold') or current.get('suppression_evidence') or current.get('holds') or current.get('delete_expired') is not True or not current.get('retention_approval_id') or datetime.fromisoformat(current['valid_until'].replace('Z','+00:00')).timestamp()<=now:
                    return {'status':'held_policy_changed','applied':False,'files':[]}
            # Tombstones commit before unlink; interruption never erases the deletion decision.
            for row in actions:
                atomic(root/(row['receipt']+'.deleted-'+uuid.uuid4().hex),canonical({'decision':row,'deleted_at':now}))
                (root/row['receipt']).unlink(missing_ok=True)
            for filename in sorted({r['body'] for r in actions if r['body']}):(root/filename).unlink(missing_ok=True)
        return {'status':'applied' if apply else 'dry_run','applied':apply,'files':actions,'protected_body_count':len(protected)}

def contained(root,relative):
    path=(root/relative).resolve()
    if not path.is_relative_to(root) or path==root:raise ValueError('Path outside approved root')
    return path

def backup_bundle(root,destination,*,queues,cache_roots):
    """Quiesce explicitly listed local coordinators and caches; snapshot all files, including holds."""
    root=Path(root).resolve();dest=Path(destination).resolve()
    if dest.exists() or dest.is_relative_to(root) or root.is_relative_to(dest):raise ValueError('New disjoint backup destination required')
    queue_paths={contained(root,p) for p in queues};cache_paths=[contained(root,p) for p in cache_roots]
    locks={Path(str(p)+'.workers.lock') for p in queue_paths}|{p.parent/'collector.lock' for p in queue_paths}
    with contextlib.ExitStack() as stack:
        for path in sorted(locks):
            stream=stack.enter_context(path.open('a+b'));fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for path in sorted(cache_paths):stack.enter_context(maintenance_lock(path,exclusive=True))
        dest.mkdir(parents=True,mode=0o700);files={};databases={}
        for path in sorted(root.rglob('*')):
            if path.is_symlink():raise ValueError('Backup refuses symlinks')
            if not path.is_file():continue
            if path.name.endswith(('.lock','-wal','-shm','.tmp')):continue
            rel=str(path.relative_to(root));target=dest/rel;target.parent.mkdir(parents=True,exist_ok=True)
            if path in queue_paths:
                source=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True);copy=sqlite3.connect(target)
                try:
                    source.backup(copy)
                    copy.execute('PRAGMA journal_mode=DELETE') # Portable snapshot has no WAL sidecars.
                    if copy.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Backup database integrity failure')
                    databases[rel]=hashlib.sha256('\n'.join(copy.iterdump()).encode()).hexdigest()
                finally:source.close();copy.close()
            else:
                if path.suffix in {'.sqlite','.sqlite3','.db'}:raise ValueError('Unregistered database; enumerate every queue')
                shutil.copy2(path,target)
            files[rel]=sha(target)
        manifest={'version':1,'files':files,'database_logical_sha256':databases,'queues':list(queues),'cache_roots':list(cache_roots),'source_root':str(root)}
        atomic(dest/'backup-manifest.json',canonical(manifest))
        return manifest

def restore_bundle(backup,destination):
    backup=Path(backup).resolve();dest=Path(destination).resolve()
    if dest.exists():raise ValueError('Restore requires new destination; never overwrite live evidence')
    m=json.loads((backup/'backup-manifest.json').read_text())
    for rel,digest in m['files'].items():
        source=contained(backup,rel)
        if source.is_symlink() or sha(source)!=digest:raise ValueError('Backup hash mismatch')
    dest.mkdir(parents=True,mode=0o700)
    for rel,digest in m['files'].items():
        target=contained(dest,rel);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(contained(backup,rel),target)
    for rel,digest in m['database_logical_sha256'].items():
        db=sqlite3.connect(contained(dest,rel).as_uri()+'?mode=ro',uri=True)
        try:
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or hashlib.sha256('\n'.join(db.iterdump()).encode()).hexdigest()!=digest:raise ValueError('Restored database differs')
        finally:db.close()
    return {'restored_files':len(m['files']),'restored_databases':len(m['database_logical_sha256']),'verified':True}
