"""Explicit read-only-source, new-file identity rebuild. Never invoked by Engine.

CLI execution on a real ledger requires separate operator authorization. Rebuilt
ledgers remain write-held until reconciliation is approved. No historical merges.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
from engine import Engine, key, source_identity


def rebuild(source_path, target_path):
    source_path, target_path = Path(source_path).resolve(), Path(target_path).resolve()
    if source_path == target_path or target_path.exists():
        raise ValueError('Rebuild requires a distinct new destination')
    original = sqlite3.connect(source_path.as_uri() + '?mode=ro', uri=True)
    original.row_factory = sqlite3.Row
    original.execute('PRAGMA query_only=ON'); original.execute('BEGIN')
    target = None
    try:
        tables = {r[0] for r in original.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'identity_schema' in tables:
            raise ValueError('Source is already versioned; this is a legacy-only rebuild')
        # Reserve destination exclusively before opening SQLite; never overwrite.
        with target_path.open('xb'): pass
        target = Engine(target_path)
        target.db.executescript('''CREATE TABLE legacy_archive(table_name TEXT,row_key TEXT,payload TEXT,PRIMARY KEY(table_name,row_key));
            CREATE TABLE identity_mapping(old_observation_id TEXT PRIMARY KEY,old_entity_id TEXT,new_entity_id TEXT,status TEXT,reason TEXT);
            CREATE TABLE migration_state(status TEXT NOT NULL);
            INSERT INTO migration_state VALUES('rebuild_incomplete_hold');''')
        # Preserve an exact logical snapshot, including tasks and unsupported tables.
        snapshot = hashlib.sha256()
        for table in sorted(tables):
            if table.startswith('sqlite_'): continue
            quoted = '"' + table.replace('"','""') + '"'
            rows = [dict(r) for r in original.execute('SELECT * FROM ' + quoted)]
            for i, row in enumerate(sorted(rows, key=lambda r:json.dumps(r,sort_keys=True))):
                payload=json.dumps(row,sort_keys=True)
                snapshot.update((table+'\n'+payload+'\n').encode())
                target.db.execute('INSERT INTO legacy_archive VALUES(?,?,?)',(table,str(i),payload))
        target.db.commit()
        owners = {}
        for observation in original.execute('SELECT o.*,r.source FROM observations o JOIN runs r ON r.id=o.run_id'):
            try:
                row=json.loads(observation['payload'])
                namespace='overture_gers' if row.get('external_scheme')=='overture_gers' else row.get('source_namespace') or observation['source']
                publisher,record_key,_=source_identity(row,namespace)
                if record_key: owners.setdefault((publisher,record_key),set()).add(observation['entity_id'])
            except (ValueError,TypeError,AttributeError): pass
        # Temporary bypass only inside this explicit rebuild; no persisted ready state.
        target._identity_rebuild = True
        for run in original.execute('SELECT * FROM runs ORDER BY captured_at,id'):
            observations = list(original.execute('SELECT * FROM observations WHERE run_id=? ORDER BY captured_at,id',(run['id'],)))
            rows = []
            for observation in observations:
                try:
                    row=json.loads(observation['payload'])
                    if not isinstance(row,dict): raise ValueError('not a row')
                except (ValueError,TypeError):
                    target.db.execute('INSERT INTO identity_mapping VALUES(?,?,?,?,?)',(observation['id'],observation['entity_id'],None,'unresolved','unreadable_original_row'))
                    continue
                if row.get('external_scheme')=='overture_gers': row['source_namespace']='overture_gers'
                publisher,record_key,_=source_identity(row,row.get('source_namespace') or run['source'])
                if record_key and len(owners[(publisher,record_key)])>1:
                    target.db.execute('INSERT INTO identity_mapping VALUES(?,?,?,?,?)',(observation['id'],observation['entity_id'],None,'unresolved','historical_identity_collision_no_merge'))
                    continue
                rows.append((observation,row))
            target.db.commit()
            if not rows: continue
            result=target.ingest(source=run['source'],family=run['family'],scope=run['scope'],category=run['category'],
                rows=[r for _,r in rows],kind=run['kind'],cost=run['cost'],captured_at=run['captured_at'],
                attempt_id='legacy-run:'+run['id'],coverage_complete=False,allow_cross_source_match=False)
            for observation,row in rows:
                namespace,record_key,_=source_identity(row,row.get('source_namespace') or run['source'])
                match=target.db.execute('SELECT entity_id FROM source_records WHERE namespace=? AND record_key=?',(namespace,record_key)).fetchone() if record_key else None
                target.db.execute('INSERT INTO identity_mapping VALUES(?,?,?,?,?)',
                    (observation['id'],observation['entity_id'],match[0] if match else None,'review_required' if match else 'unresolved',
                     'new_projection_not_authorized_for_use' if match else 'insufficient_original_identity'))
            target.db.commit()
        with target.db:
            for row in original.execute('SELECT * FROM tasks'):
                target.db.execute('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?)',tuple(row))
            splits=[r[0] for r in target.db.execute('SELECT old_entity_id FROM identity_mapping GROUP BY old_entity_id HAVING count(DISTINCT new_entity_id)>1')]
            for old_id in splits:
                target.db.execute("UPDATE identity_mapping SET reason='historical_collision_requires_split_review' WHERE old_entity_id=?",(old_id,))
            target.db.execute("UPDATE migration_state SET status='review_required'")
        return {'source':str(source_path),'target':str(target_path),'source_logical_sha256':snapshot.hexdigest(),
                'status':'review_required','historical_split_candidates':splits,
                'mapping':[dict(r) for r in target.db.execute('SELECT * FROM identity_mapping ORDER BY old_observation_id')],
                'tasks_preserved':target.db.execute('SELECT count(*) FROM tasks').fetchone()[0],
                'worker_jobs':'archived_only; no active workers copied','automatic_merges':0}
    finally:
        if target is not None: target.db.close()
        original.close()


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True);parser.add_argument('--target',required=True)
    args=parser.parse_args();print(json.dumps(rebuild(args.source,args.target),indent=2))
