"""Read-only identity baseline; source ID overlap is not verified business yield."""
import argparse
import collections
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3


def compare(database, places, output):
    if output.exists():raise ValueError('Choose a new output folder')
    output.mkdir(parents=True)
    db=sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True)
    db.row_factory=sqlite3.Row
    db.execute('BEGIN')
    geo=db.execute("SELECT id FROM geographies WHERE name='Windsor' AND province='ON'").fetchall()
    if len(geo)!=1:raise ValueError('Canonical Windsor identity ambiguous')
    gid=geo[0]['id']
    existing=db.execute('SELECT l.id,l.organisation_id,l.address_raw,l.manually_verified,l.status,o.trading_name FROM locations l JOIN organisations o ON o.id=l.organisation_id WHERE l.municipality_id=?',(gid,)).fetchall()
    sources=[r['id'] for r in db.execute("SELECT id FROM sources WHERE id LIKE '%overture%'")]
    counts=collections.Counter()
    with places.open() as src,(output/'source-identity-comparison.jsonl').open('w') as out:
        for line in src:
            p=json.loads(line); matches=[]
            for source in sources:
                matches.extend(dict(r) for r in db.execute('SELECT source_id,source_record_id,organisation_id,location_id FROM source_identities WHERE source_id=? AND source_record_id=?',(source,p['gers'])))
            counts['geography_screened_place_records']+=1
            counts['source_ids_already_in_existing_store' if matches else 'source_ids_not_found_in_existing_store']+=1
            out.write(json.dumps({'source_record_id':p['gers'],'existing_identity_links':matches,'verified_new_organisation':False})+'\n')
    report={'canonical_geography_id':gid,'snapshot_at':datetime.now(timezone.utc).isoformat(),'database':str(database),
            'existing_windsor_location_records':len(existing),'existing_distinct_organisation_ids':len({r['organisation_id'] for r in existing}),
            'existing_location_manual_verification_flags':sum(bool(r['manually_verified']) for r in existing),
            'comparison':dict(counts),'net_new_verified_organisations':None,
            'limits':['Existing municipality assignment is a baseline, not independently verified geography.',
                      'Exact source IDs establish prior ingestion, not independent cross-source verification.',
                      'Missing IDs may still represent existing organizations under another source ID.',
                      'No company is merged or marked verified by this comparison.'],
            'database_writes':0}
    db.rollback();db.close()
    (output/'summary.json').write_text(json.dumps(report,indent=2)+'\n')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--database',type=Path,required=True);p.add_argument('--places',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();print(json.dumps(compare(a.database,a.places,a.output)))
