"""Append-only research history. No network, automatic backfill or freshness inference."""
import base64
import hashlib
import json
import zlib
from .email_extraction import VERSION, extract_published_emails


def encoded(value):
    return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'))


def identity(*parts):
    return hashlib.sha256(encoded(parts).encode()).hexdigest()


def initialize(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS captures(
      id TEXT PRIMARY KEY,source_url TEXT NOT NULL,fetched_at TEXT,content_sha256 TEXT,
      raw_body BLOB,provenance TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS extraction_runs(
      id TEXT PRIMARY KEY,capture_id TEXT NOT NULL REFERENCES captures(id),
      extractor_version TEXT NOT NULL,processed_at TEXT,mode TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS email_occurrences(
      id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES extraction_runs(id),
      context_id TEXT NOT NULL,email TEXT NOT NULL,source_occurrence_id TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS legacy_observation_links(
      legacy_key TEXT NOT NULL,occurrence_id TEXT NOT NULL REFERENCES email_occurrences(id),
      PRIMARY KEY(legacy_key,occurrence_id));
    CREATE INDEX IF NOT EXISTS occurrence_email ON email_occurrences(email);
    ''')
    for table in ('captures','extraction_runs','email_occurrences','legacy_observation_links'):
        for action in ('UPDATE','DELETE'):
            db.execute(f"CREATE TRIGGER IF NOT EXISTS {table}_no_{action.lower()} BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT,'append-only contact history'); END")


def capture(db, page):
    """Receipt assigned before checkpoint; old receipts stay explicitly partial."""
    raw = base64.b64decode(page['raw_body_base64'],validate=True) if page.get('raw_body_base64') is not None else None
    digest = hashlib.sha256(raw).hexdigest() if raw is not None else page.get('content_sha256')
    if raw is not None and page.get('content_sha256') != digest:
        raise ValueError('capture content hash mismatch')
    receipt = page.get('capture_id') or identity('legacy-page',page)
    provenance = 'source_fetch' if page.get('capture_id') and raw is not None else 'legacy_partial'
    fetched = page.get('checked_at') if provenance == 'source_fetch' else None
    payload = encoded({k:v for k,v in page.items() if k!='raw_body_base64'})
    values=(receipt,page['url'],fetched,digest,zlib.compress(raw) if raw is not None else None,provenance,payload)
    existing=db.execute('SELECT * FROM captures WHERE id=?',(receipt,)).fetchone()
    if existing and tuple(existing)[:6]!=values[:6]:raise ValueError('capture receipt reused with different evidence')
    db.execute('INSERT OR IGNORE INTO captures VALUES(?,?,?,?,?,?,?)',values)
    return receipt


def run(db, capture_id, version, processed_at=None, mode='extraction'):
    if not db.execute('SELECT 1 FROM captures WHERE id=?',(capture_id,)).fetchone():raise ValueError('unknown capture')
    rid=identity(capture_id,version)
    db.execute('INSERT OR IGNORE INTO extraction_runs VALUES(?,?,?,?,?)',(rid,capture_id,version,processed_at,mode))
    return rid


def append_email(db, record, domain, context_id):
    cid=record.get('capture_id')
    if not cid:
        # Imports without an actual fetch receipt cannot establish fetched_at.
        cid=capture(db,{'url':record['source_url'],'content_sha256':record.get('page_content_sha256'),
                        'legacy_record':record,'context_id':context_id,'domain':domain})
    rid=run(db,cid,record.get('extraction_version','legacy-partial/1'),record.get('processed_at'),record.get('processing_mode','legacy_import'))
    legacy_key=identity(record['email'],record['source_url'],context_id)
    for occurrence in record.get('occurrences') or [dict(record,evidence_completeness='legacy_partial')]:
        source_id=occurrence.get('occurrence_id') or identity(occurrence)
        oid=identity(rid,context_id,source_id)
        payload=encoded({'occurrence':occurrence,'source_record_context':{k:v for k,v in record.items() if k!='occurrences'},'domain':domain})
        values=(oid,rid,context_id,record['email'],source_id,payload)
        old=db.execute('SELECT * FROM email_occurrences WHERE id=?',(oid,)).fetchone()
        if old and tuple(old)!=values:raise ValueError('occurrence replay changed; use a new extraction version')
        db.execute('INSERT OR IGNORE INTO email_occurrences VALUES(?,?,?,?,?,?)',values)
        db.execute('INSERT OR IGNORE INTO legacy_observation_links VALUES(?,?)',(legacy_key,oid))


def _reprocess(db, capture_id, *, processed_at):
    """Caller owns transaction. Never updates page/job freshness or legacy source times."""
    row=db.execute('SELECT * FROM captures WHERE id=?',(capture_id,)).fetchone()
    if not row or row['raw_body'] is None:raise ValueError('raw capture unavailable; cannot reprocess partial evidence')
    existing=db.execute('SELECT id FROM extraction_runs WHERE id=?',(identity(capture_id,VERSION),)).fetchone()
    if existing:return {'capture_id':capture_id,'run_id':existing[0],'replayed':True,'source_fetches':0}
    body=zlib.decompress(row['raw_body'])
    run(db,capture_id,VERSION,processed_at,'reparse')
    # Keep the original source context(s); do not infer owners from URL alone.
    contexts={}
    for old in db.execute('SELECT o.context_id,o.payload FROM email_occurrences o JOIN extraction_runs r ON r.id=o.run_id WHERE r.capture_id=?',(capture_id,)):
        data=json.loads(old['payload']);contexts[old['context_id']]=data
    if not contexts:contexts={'capture:'+capture_id:{'domain':'','source_record_context':{}}}
    findings=extract_published_emails(body,row['source_url'])
    for context_id,data in contexts.items():
        for finding in findings:
            record={**data['source_record_context'],**finding,'capture_id':capture_id,
                    'observed_at':row['fetched_at'],'processed_at':processed_at,'processing_mode':'reparse'}
            append_email(db,record,data['domain'],context_id)
    return {'capture_id':capture_id,'run_id':identity(capture_id,VERSION),'unique_emails':len(findings),'source_fetches':0}


def backfill(db):
    """Explicit resumable temporary-copy/approved backfill; never called on connect."""
    count=0
    with db:
        for row in db.execute('SELECT * FROM email_evidence'):
            append_email(db,json.loads(zlib.decompress(row['payload'])),row['domain'],row['context_id']);count+=1
    return {'legacy_rows_reconciled':count,'legacy_links':db.execute('SELECT count(*) FROM legacy_observation_links').fetchone()[0]}


def history_rows(db):
    for row in db.execute('SELECT o.*,r.capture_id,r.extractor_version,r.processed_at,r.mode,c.fetched_at,c.provenance FROM email_occurrences o JOIN extraction_runs r ON r.id=o.run_id JOIN captures c ON c.id=r.capture_id ORDER BY o.id'):
        yield {**dict(row),'projection':'append_only_history; not a current-presence or withdrawal assertion'}


def reprocess(db, capture_id, *, processed_at):
    db.execute('SAVEPOINT reprocess_capture')
    try:
        result=_reprocess(db,capture_id,processed_at=processed_at)
        db.execute('RELEASE reprocess_capture')
        return result
    except Exception:
        db.execute('ROLLBACK TO reprocess_capture');db.execute('RELEASE reprocess_capture');raise
