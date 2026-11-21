"""Independent browser evidence lane; never promotes claims or writes MAIN."""
import argparse
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import time
from urllib.parse import urlsplit

from .relationship_observations import guard, parse_claim_page, stamp


def capture_job(job, output, *, deadline_seconds=150):
    directory = Path(output) / 'pages' / job['id']
    directory.mkdir(parents=True, exist_ok=True)
    config = directory / 'config.json'
    host=urlsplit(job['source_url']).hostname
    root=host.removeprefix('www.')
    config.write_text(json.dumps({'url': job['source_url'], 'output': str(directory.resolve()),'allowed_hosts':[root,'www.'+root]}))
    started = time.monotonic()
    with (directory / 'worker.log').open('a') as log:
        process = subprocess.Popen(['node', 'scripts/market_map/relationship_browser_capture.mjs', str(config)],
                                   stdout=log, stderr=log, start_new_session=True)
        try:
            process.wait(timeout=deadline_seconds)
            status = 'captured_requires_review' if process.returncode == 0 else 'browser_error_review'
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            status = 'browser_timeout_review'
    manifest_path=directory/'browser-capture-manifest.json'
    manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    if status=='captured_requires_review':
        state=manifest.get('status')
        status='captured_requires_review' if state=='captured_pending_relationship_review' else 'captured_with_rendering_gaps' if state=='captured_with_rendering_gaps' else 'browser_capture_incomplete_review'
    report = {'capture_status':manifest.get('status'),'source_url': job['source_url'], 'status': status, 'observed_at': stamp(),
              'elapsed_seconds': round(time.monotonic()-started, 3), 'returncode': process.returncode,
              'input_evidence': job, 'verified_relationships': 0, 'main_database_writes': 0}
    rendered = directory / 'rendered-dom.html'
    if status in {'captured_requires_review','captured_with_rendering_gaps'} and rendered.exists():
        body = rendered.read_bytes()
        parsed = parse_claim_page(body, job['source_url'])
        claims = [{'source_url': job['source_url'], 'rendered_dom_sha256': hashlib.sha256(body).hexdigest(),
                   'evidence_type': 'browser_rendered_candidate', 'review_status': 'requires_context_and_identity_review',
                   **claim} for claim in parsed['assertions']]
        (directory / 'relationship-candidates.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in claims))
        report['relationship_candidates'] = len(claims)
        report['visual_review_status'] = parsed.get('visual_review_status')
    (directory / 'queue-receipt.json').write_text(json.dumps(report, indent=2)+'\n')
    return report


def run(input_path, output, overlay_path, *, workers=2, max_pages=100):
    if not 1 <= workers <= 2 or not 1 <= max_pages <= 1000:
        raise ValueError('Browser lane limited to two workers and 1000 pages per invocation')
    output = Path(output); output.mkdir(parents=True, exist_ok=True); guard(output)
    with (output/'collector.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
        db = sqlite3.connect(output/'queue.sqlite', timeout=30)
        db.row_factory = sqlite3.Row
        db.execute('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,source_url TEXT,domain TEXT,status TEXT,payload TEXT,receipt TEXT)')
        overlay = json.loads(Path(overlay_path).read_text()).get('reviews', {})
        with db:
            db.execute("UPDATE jobs SET status='pending' WHERE status='running'")
            for line in Path(input_path).read_text().splitlines():
                row = json.loads(line); url = row['source_url']; host = urlsplit(url).hostname or ''
                key = hashlib.sha256((url+'\n'+row.get('page_content_sha256','')).encode()).hexdigest()
                note = overlay.get(host, overlay.get(host.removeprefix('www.'), {}))
                held = note.get('reuse_status') in {'hold_pending_permission','do_not_apply_to_candidate'}
                state = 'source_policy_hold' if held else 'pending' if urlsplit(url).scheme=='https' else 'non_https_review'
                db.execute('INSERT OR IGNORE INTO jobs VALUES(?,?,?,?,?,NULL)',(key,url,host,state,json.dumps({**row,'id':key})))
                if held:db.execute("UPDATE jobs SET status='source_policy_hold' WHERE id=? AND status='pending'",(key,))
        completed = 0
        with ThreadPoolExecutor(max_workers=workers) as pool:
            pending = {}
            while completed < max_pages or pending:
                active_hosts = {j['domain'].removeprefix('www.') for j in pending.values()}
                for row in db.execute("SELECT * FROM jobs WHERE status='pending' ORDER BY id LIMIT 100").fetchall():
                    if len(pending)>=workers or completed+len(pending)>=max_pages: break
                    if row['domain'].removeprefix('www.') in active_hosts: continue
                    guard(output)
                    job = json.loads(row['payload'])
                    with db: db.execute("UPDATE jobs SET status='running' WHERE id=?",(row['id'],))
                    pending[pool.submit(capture_job,job,output)] = dict(row)
                    active_hosts.add(row['domain'].removeprefix('www.'))
                if not pending: break
                done,_ = wait(pending,timeout=10,return_when=FIRST_COMPLETED)
                for future in done:
                    row = pending.pop(future)
                    try: report = future.result()
                    except Exception as error:
                        report = {'status':'browser_error_review','source_url':row['source_url'],'error':str(error),'observed_at':stamp()}
                    with db: db.execute('UPDATE jobs SET status=?,receipt=? WHERE id=?',(report['status'],json.dumps(report),row['id']))
                    completed += 1
                    print(json.dumps({'stage':'browser_review',**report}),flush=True)
                    statuses = dict(db.execute('SELECT status,COUNT(*) FROM jobs GROUP BY status'))
                    (output/'status.json').write_text(json.dumps({'updated_at':stamp(),'workers':workers,'job_status_counts':statuses,'verified_relationships':0,'main_database_writes':0},indent=2)+'\n')
        db.close()


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--overlay',required=True);parser.add_argument('--workers',type=int,default=2)
    parser.add_argument('--max-pages',type=int,default=100)
    parser.add_argument('--continuous',action='store_true')
    args=parser.parse_args()
    while True:
        run(args.input,args.output,args.overlay,workers=args.workers,max_pages=args.max_pages)
        if not args.continuous:break
        time.sleep(30)
