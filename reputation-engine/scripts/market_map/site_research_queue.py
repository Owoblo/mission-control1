"""Separate address-source queue. Collection never completes a building review.

Exact address reuse is scoped to municipality and district. Unit strings and
building identities are retained. Legacy queue access is strictly read-only.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import threading
from functools import wraps
import time
import uuid
from urllib.parse import urlparse

from scripts.market_map.building_address_work_groups import build_manifest

_WRITER_LOCKS = {}
_WRITER_GUARD = threading.Lock()


def serialized_write(method):
    """SQLite has one writer; coordinate local workers before taking DB locks."""
    @wraps(method)
    def wrapped(self, *args, **kwargs):
        key = str(self.path.resolve())
        with _WRITER_GUARD:
            lock = _WRITER_LOCKS.setdefault(key, threading.RLock())
        with lock:
            return method(self, *args, **kwargs)
    return wrapped


class SiteResearchQueue:
    def __init__(self, path):
        self.path = Path(path)
        self.db = sqlite3.connect(str(path), timeout=20, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        if self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='building_items'").fetchone():
            self.db.close()
            raise ValueError('Refusing to modify a legacy building queue')
        self.db.execute('PRAGMA foreign_keys=ON')
        self._initialize_schema()

    @serialized_write
    def _initialize_schema(self):
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS sites (
          site_id TEXT PRIMARY KEY, municipality TEXT NOT NULL, district TEXT NOT NULL,
          addresses TEXT NOT NULL, category TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('pending','claimed','sources_collected','needs_review','exhausted')),
          attempts INTEGER NOT NULL DEFAULT 0, available_at REAL NOT NULL DEFAULT 0,
          worker TEXT, token TEXT, lease_until REAL, last_error TEXT, updated_at REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS site_claim ON sites(municipality,district,state,available_at);
        CREATE TABLE IF NOT EXISTS members (
          site_id TEXT NOT NULL REFERENCES sites(site_id), building_id TEXT NOT NULL,
          context TEXT NOT NULL, PRIMARY KEY(site_id,building_id));
        CREATE TABLE IF NOT EXISTS imports (
          import_id TEXT PRIMARY KEY, provenance TEXT NOT NULL, imported_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS evidence (
          site_id TEXT NOT NULL REFERENCES sites(site_id), evidence_id TEXT NOT NULL,
          receipt TEXT NOT NULL, saved_at REAL NOT NULL, PRIMARY KEY(site_id,evidence_id));
        CREATE TABLE IF NOT EXISTS research_results (
          site_id TEXT PRIMARY KEY REFERENCES sites(site_id), result TEXT NOT NULL,
          saved_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS result_history (
          result_id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(site_id),
          result TEXT NOT NULL, saved_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS research_revisions (
          site_id TEXT PRIMARY KEY REFERENCES sites(site_id), revision INTEGER NOT NULL,
          reason TEXT NOT NULL, changed_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS occupant_assertions (
          assertion_id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(site_id),
          organization_name TEXT NOT NULL, address TEXT NOT NULL, unit TEXT NOT NULL,
          assertion TEXT NOT NULL, first_observed REAL NOT NULL);
        ''')

    def close(self):
        self.db.close()

    @serialized_write
    def import_legacy(self, ledger_path, queue_path, municipality):
        """Import pending footprints; uncertain records remain held for review."""
        if not municipality.strip():
            raise ValueError('Explicit municipality required')
        if self.path.resolve() in (Path(ledger_path).resolve(), Path(queue_path).resolve()):
            raise ValueError('New queue must be separate from legacy inputs')
        raw = Path(ledger_path).read_bytes()
        ledger = [json.loads(x) for x in raw.splitlines() if x.strip()]
        old = sqlite3.connect(Path(queue_path).resolve().as_uri() + '?mode=ro', uri=True)
        old.row_factory = sqlite3.Row
        try:
            old.execute('PRAGMA query_only=ON')
            old.execute('BEGIN')
            items = [dict(r) for r in old.execute('SELECT building_id,state,snapshot,attempts,available_at FROM building_items ORDER BY building_id')]
        finally:
            old.close()
        manifest = build_manifest(ledger, items)
        snapshots = {r['building_id']: json.loads(r['snapshot']) if isinstance(r['snapshot'], str) else r['snapshot'] for r in items}
        mismatch = set(manifest['queue_ledger_address_mismatch_ids'])
        provenance = {'ledger': str(ledger_path), 'ledger_sha256': hashlib.sha256(raw).hexdigest(),
                      'queue': str(queue_path), 'queue_snapshot_sha256': hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest(),
                      'municipality': municipality, 'legacy_mutations': 0}
        import_id = hashlib.sha256(json.dumps(provenance, sort_keys=True).encode()).hexdigest()
        now = time.time()
        self.db.execute('BEGIN IMMEDIATE')
        try:
            for group in manifest['groups']:
                for member in group['members']:
                    bid = member['building_id']
                    snap = snapshots[bid]
                    district = snap.get('research_district') or ''
                    if not isinstance(district, str):
                        raise ValueError('research_district must be a string')
                    safe = group['reusable_address_query_candidate'] and bid not in mismatch and bool(district.strip()) and member['ledger_present']
                    category = group['category'] if safe else ('address_snapshot_conflict' if bid in mismatch else 'requires_context_review')
                    key = [municipality.strip().casefold(), district.strip().casefold(), group['normalized_candidate_addresses'], '' if safe else bid]
                    sid = 'site:' + hashlib.sha256(json.dumps(key).encode()).hexdigest()
                    previous = self.db.execute('SELECT site_id FROM members WHERE building_id=? AND site_id<>?', (bid, sid)).fetchone()
                    if previous:
                        raise ValueError('Building scope/address changed; explicit reconciliation required: ' + bid)
                    self.db.execute('INSERT OR IGNORE INTO sites(site_id,municipality,district,addresses,category,state,updated_at) VALUES(?,?,?,?,?,?,?)',
                                    (sid, municipality.strip(), district.strip(), json.dumps(group['normalized_candidate_addresses']), category, 'pending' if safe else 'needs_review', now))
                    context = dict(member, queue_snapshot=snap, import_id=import_id, identity_merge_permitted=False)
                    # Preserve earlier context on repeat imports; avoid invalidating a live lease.
                    self.db.execute('INSERT OR IGNORE INTO members VALUES(?,?,?)', (sid, bid, json.dumps(context)))
            self.db.execute('INSERT OR IGNORE INTO imports VALUES(?,?,?)', (import_id, json.dumps(provenance), now))
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return self.status()

    @serialized_write
    def claim(self, municipality, district, worker, lease_seconds=300, max_attempts=3, now=None,
              include_review=False, site_ids=None):
        if not municipality or not district or not worker or not 1 <= lease_seconds <= 3600 or max_attempts < 1:
            raise ValueError('Explicit scope, worker and valid limits required')
        now = time.time() if now is None else now
        self.db.execute('BEGIN IMMEDIATE')
        try:
            self.db.execute("UPDATE sites SET state='exhausted',worker=NULL,token=NULL,lease_until=NULL,updated_at=? WHERE municipality=? AND district=? AND attempts>=? AND (state='pending' OR (state='claimed' AND lease_until<=?))", (now, municipality, district, max_attempts, now))
            scope = ''
            parameters = [municipality, district, max_attempts, now, now]
            if site_ids is not None:
                if not site_ids:
                    self.db.commit()
                    return None
                scope = ' AND site_id IN (' + ','.join('?' for _ in site_ids) + ')'
                parameters.extend(site_ids)
            eligible = "state IN ('pending','needs_review')" if include_review else "state='pending'"
            row = self.db.execute("SELECT * FROM sites WHERE municipality=? AND district=? AND attempts<? AND (("+eligible+" AND available_at<=?) OR (state='claimed' AND lease_until<=?)) AND COALESCE(last_error,'') NOT IN ('interrupted_request_uncertain','resume_existing_checkpoint_required') AND site_id NOT IN (SELECT site_id FROM research_results)"+scope+" ORDER BY available_at,site_id LIMIT 1", parameters).fetchone()
            if row is None:
                self.db.commit()
                return None
            token = uuid.uuid4().hex
            self.db.execute("UPDATE sites SET state='claimed',attempts=attempts+1,worker=?,token=?,lease_until=?,updated_at=? WHERE site_id=?", (worker, token, now+lease_seconds, now, row['site_id']))
            result = dict(self.db.execute('SELECT * FROM sites WHERE site_id=?', (row['site_id'],)).fetchone())
            revision=self.db.execute('SELECT revision FROM research_revisions WHERE site_id=?',(row['site_id'],)).fetchone()
            result['research_revision']=revision[0] if revision else 0
            result['members'] = [json.loads(x[0]) for x in self.db.execute('SELECT context FROM members WHERE site_id=? ORDER BY building_id', (row['site_id'],))]
            self.db.commit()
            return result
        except Exception:
            self.db.rollback()
            raise

    def _owned(self, site_id, token, now):
        if not self.db.execute("SELECT 1 FROM sites WHERE site_id=? AND token=? AND state='claimed' AND lease_until>?", (site_id, token, now)).fetchone():
            raise ValueError('Missing, expired or replaced lease')

    @serialized_write
    def heartbeat(self, site_id, token, lease_seconds=300, now=None):
        if not 1 <= lease_seconds <= 3600:
            raise ValueError('Invalid lease duration')
        now = time.time() if now is None else now
        self.db.execute('BEGIN IMMEDIATE')
        try:
            self._owned(site_id, token, now)
            self.db.execute('UPDATE sites SET lease_until=?,updated_at=? WHERE site_id=?', (now+lease_seconds, now, site_id))
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    @serialized_write
    def finish(self, site_id, token, receipts, needs_review=True, now=None):
        """Save source receipts, not occupant assertions or legacy completions."""
        now = time.time() if now is None else now
        if not isinstance(receipts, list) or not receipts:
            raise ValueError('At least one source receipt required')
        for r in receipts:
            if urlparse(r.get('url', '')).scheme not in ('http', 'https') or not r.get('retrieved_at') or not r.get('sha256') or len(r['sha256']) != 64 or any(c not in '0123456789abcdef' for c in r['sha256']):
                raise ValueError('Source URL, retrieval time and lowercase SHA256 required')
        self.db.execute('BEGIN IMMEDIATE')
        try:
            self._owned(site_id, token, now)
            for receipt in receipts:
                r = dict(receipt, occupancy_verified=False)
                encoded = json.dumps(r, sort_keys=True)
                eid = hashlib.sha256(encoded.encode()).hexdigest()
                self.db.execute('INSERT OR IGNORE INTO evidence VALUES(?,?,?,?)', (site_id, eid, encoded, now))
            self.db.execute('UPDATE sites SET state=?,worker=NULL,token=NULL,lease_until=NULL,updated_at=? WHERE site_id=?', ('needs_review' if needs_review else 'sources_collected', now, site_id))
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    @serialized_write
    def fail(self, site_id, token, reason, retry_delay=60, max_attempts=3, now=None):
        if retry_delay < 0 or max_attempts < 1:
            raise ValueError('Invalid retry policy')
        now = time.time() if now is None else now
        self.db.execute('BEGIN IMMEDIATE')
        try:
            self._owned(site_id, token, now)
            self.db.execute("UPDATE sites SET state=CASE WHEN attempts>=? THEN 'exhausted' ELSE 'pending' END,available_at=?,last_error=?,worker=NULL,token=NULL,lease_until=NULL,updated_at=? WHERE site_id=?", (max_attempts, now+retry_delay, str(reason)[:2000], now, site_id))
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    def status(self):
        return {'sites_by_state': {r[0]: r[1] for r in self.db.execute('SELECT state,count(*) FROM sites GROUP BY state')},
                'building_memberships': self.db.execute('SELECT count(*) FROM members').fetchone()[0],
                'source_receipts': self.db.execute('SELECT count(*) FROM evidence').fetchone()[0],
                'legacy_queue_mutations': 0, 'verified_occupants_asserted': 0}

    @serialized_write
    def save_result(self, site_id, token, result, receipts, now=None):
        """Durable evidence assertions; unknown coverage is not task failure/vacancy."""
        now = time.time() if now is None else now
        if result.get('occupancy_verified') is not False or result.get('tenant_coverage_complete') is not False:
            raise ValueError('Research cannot automatically certify occupancy/completeness')
        encoded = json.dumps(result, sort_keys=True)
        self.db.execute('BEGIN IMMEDIATE')
        try:
            self._owned(site_id, token, now)
            for receipt in receipts:
                if not receipt.get('sha256') or len(receipt['sha256']) != 64 or not receipt.get('url'):
                    raise ValueError('Malformed evidence receipt')
                raw=json.dumps(dict(receipt, occupancy_verified=False),sort_keys=True)
                self.db.execute('INSERT OR IGNORE INTO evidence VALUES(?,?,?,?)',
                    (site_id,hashlib.sha256(raw.encode()).hexdigest(),raw,now))
            self.db.execute('INSERT OR REPLACE INTO research_results VALUES(?,?,?)',(site_id,encoded,now))
            self.db.execute('INSERT OR IGNORE INTO result_history VALUES(?,?,?,?)',
                (hashlib.sha256((site_id+encoded).encode()).hexdigest(),site_id,encoded,now))
            self._index_assertions(site_id,result,now)
            state='needs_review' if result.get('requires_review',True) else 'sources_collected'
            self.db.execute('UPDATE sites SET state=?,worker=NULL,token=NULL,lease_until=NULL,updated_at=? WHERE site_id=?',(state,now,site_id))
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    def _index_assertions(self, site_id, result, now):
        for claim in result.get('claims',[]):
            name=claim.get('organization',claim.get('organization_name',''))
            address=claim.get('address',claim.get('matched_target_address','')) or ''
            unit=claim.get('unit','')
            if not isinstance(name,str) or not name.strip() or not isinstance(address,str):continue
            raw=json.dumps(claim,sort_keys=True)
            aid=hashlib.sha256((site_id+raw).encode()).hexdigest()
            self.db.execute('INSERT OR IGNORE INTO occupant_assertions VALUES(?,?,?,?,?,?,?)',
                (aid,site_id,name,address,unit,raw,now))

    @serialized_write
    def requeue(self, site_id, reason):
        """Explicit new investigation revision; retain prior results and evidence."""
        if not isinstance(reason,str) or not reason.strip():raise ValueError('Refresh reason required')
        self.db.execute('BEGIN IMMEDIATE')
        try:
            row=self.db.execute('SELECT state FROM sites WHERE site_id=?',(site_id,)).fetchone()
            if row is None or row[0]=='claimed':raise ValueError('Cannot refresh missing or actively leased site')
            previous=self.db.execute('SELECT revision FROM research_revisions WHERE site_id=?',(site_id,)).fetchone()
            revision=(previous[0] if previous else 0)+1
            self.db.execute('INSERT OR REPLACE INTO research_revisions VALUES(?,?,?,?)',(site_id,revision,reason,time.time()))
            self.db.execute('DELETE FROM research_results WHERE site_id=?',(site_id,))
            self.db.execute("UPDATE sites SET state='pending',attempts=0,available_at=0,last_error=NULL,updated_at=? WHERE site_id=?",(time.time(),site_id))
            self.db.commit()
            return {'site_id':site_id,'research_revision':revision,'history_preserved':True}
        except Exception:self.db.rollback();raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, required=True)
    parser.add_argument('--ledger', type=Path)
    parser.add_argument('--legacy-queue', type=Path)
    parser.add_argument('--municipality')
    args = parser.parse_args()
    if any((args.ledger, args.legacy_queue, args.municipality)) and not all((args.ledger, args.legacy_queue, args.municipality)):
        parser.error('Import requires ledger, legacy-queue and municipality')
    if args.ledger and args.db.resolve() in (args.ledger.resolve(), args.legacy_queue.resolve()):
        parser.error('New queue must not overwrite legacy inputs')
    queue = SiteResearchQueue(args.db)
    try:
        print(json.dumps(queue.import_legacy(args.ledger, args.legacy_queue, args.municipality) if args.ledger else queue.status(), indent=2))
    finally:
        queue.close()


if __name__ == '__main__':
    main()
