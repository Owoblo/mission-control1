"""Guarded identical-capture replay against selected saved implementation trees."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[2]

def structured_edges(predictions):
    rows=set()
    for page,result in predictions.items():
        for summary in result['emails']:
            for occurrence in summary.get('occurrences',[]):
                owner=occurrence.get('candidate_owner',{})
                if owner.get('ownership_status')!='explicit_document_edge_not_verified':continue
                for candidate in owner.get('candidate_owners',[]):
                    rows.add((page,summary['email'],candidate.get('name'),candidate.get('json_pointer')))
    return rows

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--implementation-root',default=str(ROOT))
    parser.add_argument('--output',required=True);args=parser.parse_args()
    implementation=Path(args.implementation_root).resolve();output=Path(args.output).resolve()
    if output.exists() or not output.is_relative_to(Path(tempfile.gettempdir()).resolve()):parser.error('new directory beneath system temp required')
    sys.path.insert(0,str(implementation))
    from scripts.market_map.offline_guard import OfflineGuard
    guard=OfflineGuard(output);guard.install();output.mkdir()
    from scripts.market_map.extraction_benchmark import benchmark,counts
    fixtures=ROOT/'tests/extraction/tranche3_fixtures'
    run=benchmark(fixtures/'manifest.json',fixtures/'labels.jsonl')
    labels=[json.loads(line) for line in (fixtures/'labels.jsonl').read_text().splitlines()]
    expected={(r['id'],e['channel'],e['owner'],e['owner_pointer']) for r in labels for e in r['structured_attribution']}
    actual=structured_edges(run['predictions'])
    run['structured_attribution']={**counts(actual,expected),'scope':'explicit document node/edge only; not verified business ownership or employment'}
    run['structured_edges']=[list(row) for row in sorted(actual)]
    for outcome,items in [('false_positive',actual-expected),('false_negative',expected-actual)]:
        for row in sorted(items):run['errors'].append({'id':row[0],'channel':'structured_attribution','outcome':outcome,'value':list(row[1:]),'category':'Incorrect attribution','basis':'observed','evidence':'Literal labeled document edge mismatch; no acquisition cause inferred'})
    run['implementation_sha256']={str(p.relative_to(implementation)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (implementation/'scripts/market_map').glob('*.py')}
    (output/'run.json').write_text(json.dumps(run,indent=2,ensure_ascii=False,sort_keys=True)+'\n')
    if guard.violations:raise RuntimeError(guard.violations)
    print(json.dumps({k:run[k] for k in ('capture_count','extraction','attribution','structured_attribution')}))

if __name__=='__main__':main()
