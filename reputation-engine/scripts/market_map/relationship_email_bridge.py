"""Queue evidenced relationship website candidates without creating MAIN entities."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from .email_acquisition import connect, add_seed
from .verification_pilot import file_hash, stamp
from .relationship_context import utility_reason


def ingest(path, queue):
    source_hash = file_hash(path)
    db = connect(queue)
    counts = {'rows': 0, 'new_provenance_rows': 0, 'queued_candidates': 0, 'held_candidates': 0}
    seen_candidates=set();eligible_candidates=set()
    try:
        db.execute('''CREATE TABLE IF NOT EXISTS relationship_discovery_evidence(
            evidence_key TEXT PRIMARY KEY, candidate_id TEXT, disposition TEXT,
            ingestion_artifact_sha256 TEXT, payload TEXT NOT NULL)''')
        db.execute('CREATE INDEX IF NOT EXISTS relationship_evidence_candidate_disposition ON relationship_discovery_evidence(candidate_id,disposition)')
        db.execute("CREATE INDEX IF NOT EXISTS relationship_evidence_association_disposition ON relationship_discovery_evidence(('relationship-candidate:' || candidate_id),disposition)")
        with Path(path).open() as stream:
            for line in stream:
                row = json.loads(line)
                if row.get('candidate_id'):seen_candidates.add(str(row['candidate_id']))
                counts['rows'] += 1
                key = hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()
                url = row.get('website_url', '')
                source_url = row.get('source_url', '')
                valid = all(row.get(k) for k in ('candidate_id', 'name', 'evidence_id', 'relationship_type'))
                valid = valid and row.get('resolution_status') == 'direct_link_candidate'
                for value in (url, source_url):
                    parsed = urlsplit(value)
                    valid = valid and parsed.scheme in ('https', 'http') and bool(parsed.hostname) and not parsed.username and not parsed.password
                host = urlsplit(url).hostname or ''
                utility = utility_reason(row.get('name'),url,source_url)
                valid = valid and not utility
                with db:
                    disposition = 'relationship_identity_or_url_review'
                    if valid:
                        host = urlsplit(url).hostname.removeprefix('www.')
                        already_queued = db.execute('SELECT 1 FROM jobs WHERE domain=?', (host,)).fetchone()
                        disposition = add_seed(db, 'relationship-candidate:' + str(row['candidate_id']), row['name'], url)
                        # A newly discovered route can reopen an already observed domain.
                        if disposition == 'queued_candidate':
                            eligible_candidates.add(str(row['candidate_id']))
                            db.execute("UPDATE frontier SET status='pending',error=NULL WHERE domain=? AND url=? AND status='relationship_quality_review_hold'",(host,url))
                            if not already_queued:
                                # Promptly inspect newly discovered domains. Attempts
                                # still sort first, so revisits cannot displace untouched
                                # original-inventory domains indefinitely.
                                db.execute("UPDATE jobs SET priority='!' || priority WHERE domain=?", (host,))
                            db.execute("UPDATE jobs SET status='pending' WHERE domain=? AND status='known_frontier_processed' AND EXISTS(SELECT 1 FROM frontier WHERE domain=? AND status='pending')", (host, host))
                            db.execute("UPDATE jobs SET status='pending' WHERE domain=? AND status='relationship_quality_review_hold' AND EXISTS(SELECT 1 FROM frontier WHERE domain=? AND status='pending')",(host,host))
                    counts['new_provenance_rows'] += db.execute(
                        'INSERT OR IGNORE INTO relationship_discovery_evidence VALUES(?,?,?,?,?)',
                        (key, row.get('candidate_id'), disposition, source_hash, json.dumps(row, sort_keys=True))).rowcount
                    db.execute('UPDATE relationship_discovery_evidence SET disposition=? WHERE evidence_key=? AND disposition<>?',(disposition,key,disposition))
                    counts['queued_candidates' if disposition == 'queued_candidate' else 'held_candidates'] += 1
        # Reconcile this full evidence handoff: withdrawn candidate links must
        # not remain runnable merely because an earlier snapshot accepted them.
        held_domains=set()
        with db:
            for candidate in seen_candidates-eligible_candidates:
                db.execute("UPDATE relationship_discovery_evidence SET disposition='relationship_quality_review_hold' WHERE candidate_id=? AND disposition='queued_candidate'",(candidate,))
                for association in db.execute('SELECT domain,url FROM associations WHERE organisation_id=?',('relationship-candidate:'+candidate,)).fetchall():
                    host,route=association
                    others=db.execute('SELECT organisation_id FROM associations WHERE domain=? AND url=?',(host,route)).fetchall()
                    supported=any(not r[0].startswith('relationship-candidate:') or r[0].split(':',1)[1] in eligible_candidates for r in others)
                    if not supported:
                        db.execute("UPDATE frontier SET status='relationship_quality_review_hold',error='Source relationship evidence requalified; raw evidence retained' WHERE domain=? AND url=? AND status='pending'",(host,route))
                    original=db.execute("SELECT 1 FROM associations WHERE domain=? AND organisation_id NOT LIKE 'relationship-candidate:%' LIMIT 1",(host,)).fetchone()
                    active=db.execute("SELECT 1 FROM associations a JOIN relationship_discovery_evidence e ON a.organisation_id='relationship-candidate:' || e.candidate_id WHERE a.domain=? AND e.disposition='queued_candidate' LIMIT 1",(host,)).fetchone()
                    if not original and not active:
                        db.execute("UPDATE jobs SET status='relationship_quality_review_hold' WHERE domain=? AND status IN ('pending','known_frontier_processed')",(host,));held_domains.add(host)
        counts['candidate_only_domains_held_after_review']=len(held_domains)
        return dict(counts, checked_at=stamp(), source_sha256=source_hash,
                    main_entities_created=0, identity_verified=False, messages_sent=0)
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--queue', required=True)
    parser.add_argument('--receipt')
    args = parser.parse_args()
    result = ingest(args.input, args.queue)
    if args.receipt:
        Path(args.receipt).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
