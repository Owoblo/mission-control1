"""Concurrent, first-pass building research queue. No network, outreach or ledger writes.

Workers lease snapshots and submit three scoped review events per building. Only
export() appends to a review-event file, under an exclusive advisory file lock.
All mutators accept an injected epoch-seconds ``now`` for deterministic tests.
Evidence validation is provenance validation, never a claim of full occupancy.
Run as ``python -m scripts.market_map.building_research_queue --help``.
"""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import time
import uuid

DEFAULT_DB = Path('artifacts/windsor-building-ledger-20261029/research-queue.sqlite3')
STAGES = ('address', 'occupants', 'contacts')

def required_stages(record):
    return ('address', 'occupants') if record.get('research_phase') == 'foundation_occupants' else STAGES



def _now(value):
    value = time.time() if value is None else float(value)
    if not math.isfinite(value):
        raise ValueError('now must be finite epoch seconds')
    return value


def _json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False)


def connect(path=DEFAULT_DB):
    """Return an independent SQLite connection; share the path, not connections."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(path), timeout=30, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA synchronous=FULL')
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''
      CREATE TABLE IF NOT EXISTS building_items (
        building_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL,
        state TEXT NOT NULL, reason TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL, worker TEXT, lease_token TEXT,
        lease_until REAL, available_at REAL NOT NULL, updated_at REAL NOT NULL);
      CREATE INDEX IF NOT EXISTS building_ready ON building_items(state,available_at,building_id);
      CREATE INDEX IF NOT EXISTS building_lease ON building_items(lease_token);
      CREATE TABLE IF NOT EXISTS building_submissions (
        lease_token TEXT PRIMARY KEY, worker TEXT NOT NULL, submitted_at REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS building_events (
        event_id TEXT PRIMARY KEY, lease_token TEXT NOT NULL,
        building_id TEXT NOT NULL, body TEXT NOT NULL,
        exported_at REAL, FOREIGN KEY(lease_token) REFERENCES building_submissions(lease_token));
      CREATE TABLE IF NOT EXISTS building_queue_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    ''')
    return db


@contextmanager
def _transaction(db):
    db.execute('BEGIN IMMEDIATE')
    try:
        yield
    except BaseException:
        db.rollback()
        raise
    else:
        db.commit()


def _read_jsonl(path):
    with Path(path).open() as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def seed(db, ledger_path, excluded_ids=(), now=None, max_attempts=3):
    """Idempotently add all target ledger rows; never reset attempts.

    Existing review stages/events, explicit in-progress states and excluded IDs
    are barred even if seed is rerun while a worker holds a lease. Completion
    and active queue leases otherwise survive reseeding unchanged.
    """
    now = _now(now)
    if not isinstance(max_attempts, int) or isinstance(max_attempts, bool) or not 1 <= max_attempts <= 20:
        raise ValueError('max_attempts must be 1..20')
    excluded = set(excluded_ids)
    seen = set()
    with _transaction(db):
        for row in _read_jsonl(ledger_path):
            bid = row.get('building_id')
            if not isinstance(bid, str) or not bid.strip() or bid in seen:
                raise ValueError('Ledger must contain unique nonempty building IDs')
            seen.add(bid)
            reason = None
            if bid in excluded:
                reason = 'explicitly_excluded'
            elif row.get('review_events') or row.get('review_stages') or row.get('investigation_status') not in (None, '', 'not_individually_reviewed'):
                reason = 'already_reviewed_or_in_progress'
            old = db.execute('SELECT state FROM building_items WHERE building_id=?', (bid,)).fetchone()
            if old:
                if reason and old['state'] in ('pending', 'claimed', 'exhausted'):
                    db.execute("UPDATE building_items SET state='excluded',reason=?,worker=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE building_id=?", (reason, now, bid))
                continue
            db.execute('''INSERT INTO building_items
                (building_id,snapshot,state,reason,max_attempts,available_at,updated_at)
                VALUES(?,?,?,?,?,?,?)''', (bid, _json(row), 'excluded' if reason else 'pending', reason, max_attempts, now, now))
    return status(db)


def status(db):
    return {'states': dict(db.execute('SELECT state,count(*) FROM building_items GROUP BY state').fetchall()),
            'pending_events': db.execute('SELECT count(*) FROM building_events WHERE exported_at IS NULL').fetchone()[0],
            'exported_events': db.execute('SELECT count(*) FROM building_events WHERE exported_at IS NOT NULL').fetchone()[0]}


def _validate_worker(worker, lease_seconds):
    if not isinstance(worker, str) or not worker.strip():
        raise ValueError('Named worker required')
    if not isinstance(lease_seconds, (int, float)) or not math.isfinite(lease_seconds) or not 1 <= lease_seconds <= 86400:
        raise ValueError('lease_seconds must be between 1 and 86400')


def claim(db, worker, count=5, lease_seconds=3600, now=None):
    """Atomically reclaim expired leases and assign a bounded disjoint batch."""
    now = _now(now)
    _validate_worker(worker, lease_seconds)
    if not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= 100:
        raise ValueError('count must be 1..100')
    token = uuid.uuid4().hex
    with _transaction(db):
        db.execute('''UPDATE building_items SET state=CASE WHEN attempts>=max_attempts THEN 'exhausted' ELSE 'pending' END,
            reason='lease_expired',worker=NULL,lease_token=NULL,lease_until=NULL,available_at=?,updated_at=?
            WHERE state='claimed' AND lease_until<=?''', (now, now, now))
        area = db.execute("SELECT value FROM building_queue_meta WHERE key='active_district'").fetchone()
        district = area['value'] if area else None
        rows = db.execute("SELECT * FROM building_items WHERE state='pending' AND available_at<=? AND attempts<max_attempts AND (? IS NULL OR json_extract(snapshot,'$.research_district')=?) ORDER BY CASE WHEN json_extract(snapshot,'$.original_zoning_scope') THEN 0 ELSE 1 END,building_id LIMIT ?", (now, district, district, count)).fetchall()
        for row in rows:
            db.execute("UPDATE building_items SET state='claimed',worker=?,lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE building_id=?", (worker, token, now+lease_seconds, now, row['building_id']))
    return {'lease_token': token if rows else None, 'worker': worker,
            'lease_until': now+lease_seconds if rows else None,
            'records': [{**json.loads(r['snapshot']), 'attempts': r['attempts']+1} for r in rows]}


def _owned(db, token, worker, now):
    if not isinstance(token, str) or not token or not isinstance(worker, str) or not worker.strip():
        raise ValueError('Valid lease token and worker required')
    rows = db.execute("SELECT * FROM building_items WHERE lease_token=? AND state='claimed'", (token,)).fetchall()
    if not rows or any(r['worker'] != worker or r['lease_until'] <= now for r in rows):
        raise ValueError('Lease missing, stale, completed or owned by another worker')
    return rows


def heartbeat(db, token, worker, lease_seconds=3600, now=None):
    now = _now(now)
    _validate_worker(worker, lease_seconds)
    with _transaction(db):
        rows = _owned(db, token, worker, now)
        until = max(now+lease_seconds, max(r['lease_until'] for r in rows))
        db.execute('UPDATE building_items SET lease_until=?,updated_at=? WHERE lease_token=?', (until, now, token))
    return {'lease_token': token, 'lease_until': until, 'buildings': len(rows)}


def release(db, token, worker, reason, backoff_seconds=60, now=None):
    """Release a failed attempt with backoff; the attempt count never resets."""
    now = _now(now)
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError('Explicit failure reason required')
    if not isinstance(backoff_seconds, (int, float)) or not math.isfinite(backoff_seconds) or not 0 <= backoff_seconds <= 604800:
        raise ValueError('backoff_seconds must be 0..604800')
    with _transaction(db):
        rows = _owned(db, token, worker, now)
        db.execute('''UPDATE building_items SET state=CASE WHEN attempts>=max_attempts THEN 'exhausted' ELSE 'pending' END,
            reason=?,worker=NULL,lease_token=NULL,lease_until=NULL,available_at=?,updated_at=? WHERE lease_token=?''', (reason, now+backoff_seconds, now, token))
    return {'released': len(rows), **status(db)}


def submit(db, token, worker, events, now=None, root=None, blocked=None, backoff_seconds=3600, captures=None):
    """Validate complete buildings, then stage and release explicit blocked IDs atomically.

    Invalid or incomplete batches leave the lease intact. Additional evidence
    must be full reference mappings under ``additional_evidence_references``.
    Validation computes hashes; it does not verify semantic truth or eligibility.
    """
    from .windsor_building_ledger import apply_reviews
    from .windsor_batch_merge import validate_reference
    if root is None:
        root = Path(__file__).resolve().parents[2]
    root = Path(root).resolve()
    now = _now(now)
    if not isinstance(events, list) or not all(isinstance(e, dict) for e in events):
        raise ValueError('events must be a list of review event objects')
    blocked = {} if blocked is None else blocked
    if not isinstance(blocked, dict) or any(not isinstance(k, str) or not isinstance(v, str) or not v.strip() for k, v in blocked.items()):
        raise ValueError('blocked must map building IDs to explicit nonempty reasons')
    if not isinstance(backoff_seconds, (int, float)) or not math.isfinite(backoff_seconds) or not 0 <= backoff_seconds <= 604800:
        raise ValueError('backoff_seconds must be 0..604800')
    with _transaction(db):
        rows = _owned(db, token, worker, now)
        assigned = {r['building_id'] for r in rows}
        ids = {e.get('building_id') for e in events}
        if ids & set(blocked) or ids | set(blocked) != assigned:
            raise ValueError('Submission and explicit blocked IDs must partition exactly the assigned building IDs')
        accepted = []
        for bid in sorted(ids):
            batch = [e for e in events if e['building_id'] == bid]
            expected = required_stages(json.loads(next(r['snapshot'] for r in rows if r['building_id'] == bid)))
            if len(batch) != len(expected) or {e.get('stage') for e in batch} != set(expected):
                raise ValueError('Exactly one address, occupants and contacts outcome per building required')
            if any(e.get('reviewer') != worker for e in batch):
                raise ValueError('Event reviewer must match the lease worker')
            _, validated, rejected = apply_reviews(bid, batch, root=root)
            if rejected or len(validated) != len(expected):
                raise ValueError('Review validation failed: '+_json(rejected))
            for event in validated:
                if captures is not None:
                    from .trusted_source_capture import validate_admission, validate_excerpt
                    receipt = validate_admission(event, captures, root)
                    validate_excerpt(event, receipt, root)
                    event['source_capture_trust'] = 'coordinator_https_capture'
                    event['semantic_support'] = 'excerpt_present_requires_relationship_review'
                else:
                    event['source_capture_trust'] = 'legacy_unattested'
                refs = event.get('additional_evidence_references', [])
                if not isinstance(refs, list) or not all(isinstance(ref, dict) for ref in refs):
                    raise ValueError('additional_evidence_references must be reference objects')
                extra = []
                for ref in refs:
                    if captures is not None:
                        validate_admission(ref, captures, root)
                    extra.append({**ref, **validate_reference(ref, root=root)})
                if refs:
                    event['additional_evidence_references'] = extra
                event['outreach_eligible'] = False
                event['queue_event_id'] = hashlib.sha256((token+'\0'+bid+'\0'+event['stage']).encode()).hexdigest()
                accepted.append(event)
        db.execute('INSERT INTO building_submissions VALUES(?,?,?)', (token, worker, now))
        for event in accepted:
            db.execute('INSERT INTO building_events(event_id,lease_token,building_id,body) VALUES(?,?,?,?)', (event['queue_event_id'], token, event['building_id'], _json(event)))
        for bid in ids:
            db.execute("UPDATE building_items SET state='submitted',reason=NULL,worker=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE lease_token=? AND building_id=?", (now, token, bid))
        for bid, reason in blocked.items():
            db.execute("""UPDATE building_items SET state=CASE WHEN attempts>=max_attempts THEN 'exhausted' ELSE 'pending' END,
                reason=?,worker=NULL,lease_token=NULL,lease_until=NULL,available_at=?,updated_at=?
                WHERE lease_token=? AND building_id=?""", ('blocked: '+reason, now+backoff_seconds, now, token, bid))
    return {'lease_token': token, 'buildings': len(ids), 'events': len(accepted),
            'released': len(blocked), 'blocked': blocked, 'state': 'pending_export' if ids else 'blocked'}


def _scan_export(stream):
    """Recover only an unterminated final JSONL fragment from a crashed append."""
    stream.seek(0)
    existing = {}
    while True:
        start = stream.tell()
        line = stream.readline()
        if not line:
            break
        if not line.endswith(b'\n'):
            # Preserve a complete external/queue record lacking only a newline.
            # Only a malformed final fragment is safe to truncate and replay.
            try:
                tail = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                stream.seek(start)
                stream.truncate()
                stream.flush()
                os.fsync(stream.fileno())
                break
            if not isinstance(tail, dict):
                raise ValueError('Export file contains a non-object final event')
            stream.seek(0, os.SEEK_END)
            stream.write(b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except (ValueError, UnicodeDecodeError) as error:
            raise ValueError('Malformed complete JSONL record; manual repair required') from error
        if not isinstance(event, dict):
            raise ValueError('Export file contains a non-object event')
        key = event.get('queue_event_id')
        if key:
            if key in existing and existing[key] != event:
                raise ValueError('Conflicting existing queue event IDs')
            existing[key] = event
    return existing


def export(db, path, now=None):
    """Single-writer durable append; crash replay deduplicates queue_event_id.

    All writers to this event file must honor ``<path>.lock``. The destination
    binds to this queue at first successful export to prevent silent event loss
    from switching destinations. Workers never call this to modify the ledger.
    """
    now = _now(now)
    path = Path(path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    written = recovered = 0
    with Path(str(path)+'.lock').open('a+b') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        with _transaction(db):
            bound = db.execute("SELECT value FROM building_queue_meta WHERE key='export_path'").fetchone()
            if bound and bound['value'] != str(path):
                raise ValueError('Queue is already bound to another export path')
            pending = db.execute('SELECT event_id,body FROM building_events WHERE exported_at IS NULL ORDER BY rowid').fetchall()
            with path.open('a+b') as stream:
                existing = _scan_export(stream)
                stream.seek(0, os.SEEK_END)
                for row in pending:
                    body = json.loads(row['body'])
                    if row['event_id'] in existing:
                        if existing[row['event_id']] != body:
                            raise ValueError('Existing export payload differs from durable submission')
                        recovered += 1
                    else:
                        stream.write((row['body']+'\n').encode('utf-8'))
                        written += 1
                stream.flush()
                os.fsync(stream.fileno())
            # Persist the new directory entry before marking the DB exported.
            directory_fd = os.open(str(path.parent), os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            db.executemany('UPDATE building_events SET exported_at=? WHERE event_id=?', [(now, r['event_id']) for r in pending])
            db.execute("INSERT OR IGNORE INTO building_queue_meta VALUES('export_path',?)", (str(path),))
    return {'written': written, 'recovered': recovered, 'path': str(path), **status(db)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=DEFAULT_DB)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('seed'); p.add_argument('ledger', type=Path); p.add_argument('--exclude-id', action='append', default=[]); p.add_argument('--max-attempts', type=int, default=3)
    p = sub.add_parser('claim'); p.add_argument('--worker', required=True); p.add_argument('--count', type=int, default=5); p.add_argument('--lease-seconds', type=float, default=3600)
    for name in ('heartbeat', 'submit', 'release'):
        p = sub.add_parser(name); p.add_argument('--worker', required=True); p.add_argument('--token', required=True)
        if name == 'heartbeat': p.add_argument('--lease-seconds', type=float, default=3600)
        if name == 'submit': p.add_argument('events', type=Path); p.add_argument('--root', type=Path)
        if name == 'release': p.add_argument('--reason', required=True); p.add_argument('--backoff-seconds', type=float, default=60)
    sub.add_parser('status')
    p = sub.add_parser('export'); p.add_argument('path', type=Path)
    args = parser.parse_args(argv)
    db = connect(args.db)
    try:
        if args.command == 'seed': result = seed(db, args.ledger, args.exclude_id, max_attempts=args.max_attempts)
        elif args.command == 'claim': result = claim(db, args.worker, args.count, args.lease_seconds)
        elif args.command == 'heartbeat': result = heartbeat(db, args.token, args.worker, args.lease_seconds)
        elif args.command == 'submit': result = submit(db, args.token, args.worker, list(_read_jsonl(args.events)), root=args.root)
        elif args.command == 'release': result = release(db, args.token, args.worker, args.reason, args.backoff_seconds)
        elif args.command == 'export': result = export(db, args.path)
        else: result = status(db)
        print(_json(result))
    finally:
        db.close()


if __name__ == '__main__':
    main()
