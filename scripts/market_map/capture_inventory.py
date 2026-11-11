"""Read-only local capture discovery. Never opens databases, credentials, or remote sources."""
import argparse,hashlib,json,os,tempfile
from pathlib import Path

def file_hash(p):
    h=hashlib.sha256()
    with p.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def inventory(roots):
    rows=[];manifests=[];excluded=0
    for supplied in roots:
        root=Path(supplied).resolve()
        if not root.is_dir():continue
        for directory,dirs,files in os.walk(root,followlinks=False):
            dirs[:]=[d for d in dirs if not d.startswith('.') and d.lower() not in {'node_modules','credentials','backups','exports','tests','venv','dist','build'}]
            for name in files:
                path=Path(directory)/name
                if path.is_symlink() or any(word in name.lower() for word in ['credential','secret','token','password']):continue
                is_capture=path.suffix.lower() in {'.html','.pdf','.body'} and any(word in str(path.relative_to(root)).lower() for word in ['source','capture','browser'])
                is_meta=path.suffix=='.json' and any(word in name.lower() for word in ['manifest','receipt']) and any(word in str(path.relative_to(root)).lower() for word in ['source','capture','heldout'])
                if not (is_capture or is_meta):continue
                if path.stat().st_size>20_000_000:excluded+=1;continue
                if is_capture:rows.append({'path':str(path),'bytes':path.stat().st_size,'sha256':file_hash(path),'metadata':[]})
                if is_meta:
                    try:data=json.loads(path.read_text())
                    except (ValueError,UnicodeError):continue
                    items=data if isinstance(data,list) else sum([data.get(k,[]) for k in ['sources','captures','pages','receipts'] if isinstance(data.get(k),list)],[])
                    if isinstance(data,dict) and any(k in data for k in ['body_path','source_url','raw_evidence_reference']):items.append(data)
                    for item in items:
                        if not isinstance(item,dict):continue
                        filename=item.get('body_path') or item.get('path') or item.get('file') or item.get('raw_evidence_reference')
                        if not isinstance(filename,str):continue
                        candidates=[Path(filename),path.parent/filename,root/filename]
                        resolved=next((p.resolve() for p in candidates if p.resolve().is_relative_to(root) and p.is_file()),None)
                        manifests.append({'manifest':str(path),'referenced_path':filename,'resolved_path':str(resolved) if resolved else None,'source_url':item.get('source_url') or item.get('url'),'claimed_sha256':item.get('body_sha256') or item.get('sha256'),
                          'capture_version':item.get('capture_version'),'captured_at':item.get('retrieved_at') or item.get('captured_at'),
                          'rights_statement':item.get('rights_status') or item.get('licence_status') or item.get('rights'),
                          'owner_approval_recorded':isinstance(item.get('permission'),dict) and item['permission'].get('owner_approved') is True,
                          'retention_deadline_recorded':isinstance(item.get('permission'),dict) and bool(item['permission'].get('retain_until')),
                          'review_adjudication_recorded':isinstance(item.get('review'),dict) and item['review'].get('adjudicated') is True})
    bypath={r['path']:r for r in rows}
    for meta in manifests:
        if meta['resolved_path'] in bypath:
            row=bypath[meta['resolved_path']];meta['hash_matches']=meta['claimed_sha256']==row['sha256'];row['metadata'].append(meta)
    for r in rows:
        r['eligibility']='review_required_not_approved'
        r['missing']=['independent exhaustive PR17 labels','reviewed domain/template split','validated approval and retention evidence']
        if not any(m['hash_matches'] for m in r['metadata']):r['missing'].append('matching original-capture receipt hash')
    return {'scan_mode':'read_only_files_only_no_databases','roots':[str(Path(r).resolve()) for r in roots],
       'source_bearing_files':len(rows),'bytes':sum(r['bytes'] for r in rows),'files_with_matching_receipt_hash':sum(any(m['hash_matches'] for m in r['metadata']) for r in rows),
       'approved_for_pr17':0,'oversize_excluded':excluded,'files':rows,'unresolved_metadata':[m for m in manifests if m['resolved_path'] not in bypath]}

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',action='append',required=True);p.add_argument('--output',required=True);args=p.parse_args();out=Path(args.output).resolve()
    if out.exists() or not out.is_relative_to(Path(tempfile.gettempdir()).resolve()):p.error('new temporary output file required')
    from .offline_guard import OfflineGuard
    guard=OfflineGuard(out.parent);guard.install();report=inventory(args.root);out.write_text(json.dumps(report,indent=2)+'\n')
    if guard.violations:raise RuntimeError(guard.violations)
    print(json.dumps({k:report[k] for k in ['source_bearing_files','bytes','files_with_matching_receipt_hash','approved_for_pr17']}))
if __name__=='__main__':main()
