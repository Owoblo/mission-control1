"""Re-extract saved public pages, with a frozen baseline and no network/API calls."""
import argparse
import csv
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import time
import urllib.parse
from worker import EMAIL, PARSER_VERSION, atomic, parse_page
AUDIT_VERSION = 2


def extract(raw):
    page, _ = parse_page(raw)
    found = {e.lower(): {'visible_text'} for e in EMAIL.findall(page.text)}
    for href, label in page.links:
        if href.lower().startswith('mailto:'):
            for email in EMAIL.findall(urllib.parse.unquote(href[7:]).split('?')[0]):
                found.setdefault(email.lower(), set()).add(label if label.startswith('Published email:') or 'JavaScript' in label else 'mailto_link')
    return found


def write_csv(path, rows, fields):
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader(); writer.writerows(rows)
    atomic(path, stream.getvalue())


def run(root):
    root = Path(root); out = root/'cache-recheck'; out.mkdir(exist_ok=True)
    lock = (out/'run.lock').open('a'); fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if (out/'status.json').exists():
        previous=json.loads((out/'status.json').read_text())
        if previous.get('state')=='completed' and previous.get('audit_version')==AUDIT_VERSION:return
    manifest_path = out/'manifest.json'
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
    else:
        pages = []; baseline = set()
        for folder in (root, root/'profile-sweep'):
            dbpath = folder/'research.sqlite3'
            if not dbpath.exists(): continue
            db = sqlite3.connect(dbpath.as_uri()+'?mode=ro', uri=True)
            db.execute('BEGIN')
            captures = db.execute('SELECT url,path,status FROM captures').fetchall()
            baseline.update(r[0].strip().lower() for r in db.execute("SELECT email FROM records WHERE email != ''"))
            db.close()
            for url, path, status in captures:
                pages.append(dict(folder=str(folder), url=url, metadata=path, capture_status=status))
        sweep = root/'profile-sweep/profile-emails.csv'
        if sweep.exists():
            with sweep.open() as source:
                baseline.update(r['email'].strip().lower() for r in csv.DictReader(source) if r['email'].strip())
        manifest = dict(started_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                        baseline_emails=sorted(baseline), pages=pages, parser_version=PARSER_VERSION)
        atomic(manifest_path, json.dumps(manifest))
    baseline = set(manifest['baseline_emails']); rows = []; gaps = []; unique = set(); seen = set()
    status = dict(state='running', started_at=manifest['started_at'], parser_version=PARSER_VERSION,audit_version=AUDIT_VERSION,
                  pages_total=len(manifest['pages']), pages_checked=0, raw_documents_parsed=0,
                  pages_without_saved_html=0, non_html_documents_skipped=0,parse_failures=0, baseline_unique_emails=len(baseline),
                  unique_emails_found=0, additional_unique_emails=0, network_requests=0, model_calls=0,
                  note='Saved-page snapshot only; addresses are not assigned to people or mailbox-verified.')
    atomic(out/'status.json', json.dumps(status, indent=2))
    for item in manifest['pages']:
        folder = Path(item['folder']); digest = hashlib.sha256(item['url'].encode()).hexdigest()
        paths = [folder/'sources'/(digest+'.html'), folder/'rendered'/digest/'rendered-dom.html']
        existing = [path for path in paths if path.exists()]
        if not existing:
            status['pages_without_saved_html'] += 1
            gaps.append(dict(source_url=item['url'], reason='No saved HTML; requires separate capture review'))
        for path in existing:
            try:
                raw = path.read_bytes(); checksum = hashlib.sha256(raw).hexdigest()
                # Older captures used .html even for PDF/binary downloads. Never
                # treat compressed document bytes as visible website text.
                prefix=raw.lstrip()[:20]
                if prefix.startswith((b'%PDF',b'PK\x03\x04',b'\x89PNG',b'\xff\xd8',b'\x1f\x8b')) or b'\x00' in raw[:4096]:
                    status['non_html_documents_skipped']+=1
                    gaps.append(dict(source_url=item['url'],reason='Saved non-HTML document; needs document-specific extraction'))
                    continue
                for email, methods in extract(raw.decode('utf-8', errors='replace')).items():
                    key = (email, item['url'], checksum)
                    if key in seen: continue
                    seen.add(key); unique.add(email)
                    rows.append(dict(email=email, source_url=item['url'], source_sha256=checksum,
                                     extraction_methods=' | '.join(sorted(methods)),
                                     new_vs_start_baseline=str(email not in baseline).lower(),
                                     association_status='Unassigned source-page address; review owner and purpose'))
                status['raw_documents_parsed'] += 1
            except Exception as exc:
                status['parse_failures'] += 1
                gaps.append(dict(source_url=item['url'], reason=type(exc).__name__))
        status['pages_checked'] += 1
        status.update(unique_emails_found=len(unique), additional_unique_emails=len(unique-baseline))
        if status['pages_checked'] % 50 == 0:
            atomic(out/'status.json', json.dumps(status, indent=2))
    rows.sort(key=lambda r: (r['email'], r['source_url']))
    fields = ['email','source_url','source_sha256','extraction_methods','new_vs_start_baseline','association_status']
    write_csv(out/'all-recovered-email-evidence.csv', rows, fields)
    write_csv(out/'new-email-evidence.csv', [r for r in rows if r['new_vs_start_baseline']=='true'], fields)
    write_csv(out/'new-email-addresses.csv', [{'email':e} for e in sorted(unique-baseline)], ['email'])
    write_csv(out/'coverage-gaps.csv', gaps, ['source_url','reason'])
    status.update(state='completed', finished_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
    atomic(out/'status.json', json.dumps(status, indent=2))


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--root', required=True); a = p.parse_args()
    os.umask(0o077); run(a.root)
