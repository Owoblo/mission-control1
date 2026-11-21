"""Pure/temporary-data tranche replay, including saved implementation snapshots."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def score_contract(stage, results):
    """Hand-labeled synthetic contracts, independent of the candidate parsers."""
    errors = []
    for index, row in enumerate(results):
        if stage == 'email':
            expected = [None, None, None, None, 'Sales@business.test', 'sales@business.test',
                        'Sales+Tag@xn--bcher-kva.test', None, None, None][index]
            actual = {'normalized': row['normalized'], 'extracted': [x['email'] for x in row['extracted']]}
            wanted = {'normalized': expected, 'extracted': [expected] if expected else []}
            category = 'Normalization error'
        elif stage == 'phone':
            value, extension, status = [('+15195550123','','normalized'), ('+4422345678','','normalized'),
                ('+442079460123','09','normalized'), (None,'','invalid'), (None,'','unsupported'),
                ('+15195550123','42','normalized'), (None,'','invalid')][index]
            wanted = {'channels': [value] if value else [], 'extension': extension, 'status': status,
                      'raw_preserved': True}
            observation = row.get('phone_observations', [{}])[0]
            actual = {'channels': [r['value'] for r in row['channels']],
                      'extension': observation.get('extension'), 'status': observation.get('format_status'),
                      'raw_preserved': observation.get('raw_value') == row['raw']}
            category = 'Unsupported format' if status == 'unsupported' else 'Normalization error'
        else:
            entities, conflicts, unresolved = {'shared_ids':(2,0,0), 'shared_composites':(2,0,0),
                'stable_conflict':(1,1,0), 'ambiguous_missing':(0,0,2)}[row['case']]
            wanted = {'entities': entities, 'conflicts': conflicts, 'unresolved': unresolved}
            actual = {'entities':len(row['entities']), 'conflicts':row['result']['conflicts'],
                      'unresolved':row['result'].get('unresolved_rows',0)}
            category = 'Duplicate/entity resolution error'
        row['contract_expected'], row['contract_actual'] = wanted, actual
        if actual != wanted:
            errors.append({'case': row.get('case', row.get('raw')), 'category': category, 'basis':'observed',
                'evidence':'Controlled input and literal expected contract differ from replay output; no acquisition cause inferred',
                'expected':wanted,'actual':actual,'source_record':row, 'hypotheses':[]})
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--implementation-root', default=str(ROOT))
    parser.add_argument('--stage', choices=['email', 'phone', 'identity'], required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    implementation = Path(args.implementation_root).resolve()
    output = Path(args.output).resolve()
    if output.exists() or not output.is_relative_to(Path(tempfile.gettempdir()).resolve()):
        parser.error('output must be a new temporary directory')
    sys.path[:0] = [str(ROOT)]
    from scripts.market_map.offline_guard import OfflineGuard
    guard = OfflineGuard(output); guard.install(); output.mkdir()
    tempfile.tempdir = str(output)
    sys.path[:0] = [str(implementation / 'scripts'), str(implementation / 'scripts/discovery_v2')]
    result = []
    if args.stage == 'email':
        from market_map.email_extraction import clean_email, extract_published_emails
        values = ['élise@fictional.test', 'e\u0301lise@fictional.test', 'a@foo.-bar.test', 'a@foo..test',
                  'Sales@BUSINESS.test', 'sales@business.test', 'Sales+Tag@BÜCHER.test', 'a@faß.test',
                  '"a b"@fictional.test', 'a@[127.0.0.1]']
        for raw in values:
            result.append({'raw': raw, 'normalized': clean_email(raw),
                           'extracted': extract_published_emails('<meta charset="utf-8"><p>'+raw+'</p>', 'https://fictional.test/')})
    elif args.stage == 'phone':
        from market_map.store import MarketMap
        from market_map.adapters import normalize
        values = ['5195550123', '+4422345678', '+44 20 7946 0123 ext. 09', '+11234567890',
                  'Phone unavailable', 'tel:5195550123;ext=42', '++442079460123']
        for raw in values:
            store = MarketMap(':memory:')
            source = {'id':'fixture','name':'Fixture','source_url':'https://directory.test/'}
            sid = store.upsert_source(source)
            mapped = normalize({'id':'one','name':'Fictional Office','phone':raw},source,observed_at='2026-01-01T00:00:00Z')
            store.ingest(sid,[mapped])
            row = {'raw':raw,'adapter':mapped,'channels':[dict(r) for r in store.db.execute('SELECT * FROM contact_channels')]}
            if store.db.execute("SELECT 1 FROM sqlite_master WHERE name='phone_observations'").fetchone():
                row['phone_observations']=[dict(r) for r in store.db.execute('SELECT * FROM phone_observations')]
                row['details']=[dict(r) for r in store.db.execute('SELECT * FROM phone_channel_details')]
            result.append(row);store.close()
    else:
        from engine import Engine
        cases = [
            ('shared_ids',[{'name':'Alpha Office','source_record_id':'a'},{'name':'Beta Office','source_record_id':'b'}]),
            ('shared_composites',[{'name':'Alpha Office','city':'Windsor','address':'10 Main St'}, {'name':'Beta Office','city':'Windsor','address':'20 Main St'}]),
            ('stable_conflict',[{'name':'Alpha Office','source_record_id':'a'},{'name':'Changed Office','source_record_id':'a'}]),
            ('ambiguous_missing',[{'name':'Alpha Office'},{'name':'Beta Office'}])]
        for name, rows in cases:
            engine=Engine(':memory:')
            rows=[dict(r,source_url='https://directory.test/list') for r in rows]
            run=engine.ingest(source='publisher',family='directory',scope='fixture',category='*',rows=rows,captured_at='2026-01-01T00:00:00Z')
            result.append({'case':name,'input':rows,'result':run,'entities':[dict(r) for r in engine.db.execute('SELECT * FROM entities')],
                           'claims':[dict(r) for r in engine.db.execute('SELECT * FROM claims')],
                           'observations':[dict(r) for r in engine.db.execute('SELECT * FROM observations')]})
            engine.db.close()
    files = ['market_map/email_extraction.py','market_map/contact_normalization.py','market_map/store.py','market_map/adapters.py','discovery_v2/engine.py']
    errors=score_contract(args.stage,result)
    artifact={'stage':args.stage,'corpus':'synthetic development contract cases; not population accuracy',
              'implementation_sha256':{f:hashlib.sha256((implementation/'scripts'/f).read_bytes()).hexdigest() for f in files},
              'results':result,'errors':errors,'case_count':len(result),'failing_cases':len(errors)}
    (output/'run.json').write_text(json.dumps(artifact,indent=2,sort_keys=True,ensure_ascii=False)+'\n')
    if guard.violations: raise RuntimeError(guard.violations)
    print(str(output/'run.json'))


if __name__ == '__main__': main()
