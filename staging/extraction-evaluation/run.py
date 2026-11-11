"""One-shot, fail-closed staging evaluation. No service or crawler is started."""
import hashlib,json,os,subprocess,sys,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tests/extraction'))
from network_sandbox import deny_linux_network

def main():
    deny_linux_network()
    print('STAGING_OS_NETWORK_DENIAL_VERIFIED',flush=True)
    manifest=json.loads((ROOT/'staging-manifest.json').read_text())
    for name,digest in manifest.items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest:
            raise RuntimeError('Package integrity failure: '+name)
    results=[]
    with tempfile.TemporaryDirectory(prefix='staging-evaluation-') as folder:
        base=Path(folder)
        commands=[('cumulative',['tests/extraction/run_offline.py','--pr','CORRECTIONS']),
                  ('processes',['tests/extraction/run_corrective_processes.py','--output',str(base/'processes')]),
                  ('maintenance',['tests/extraction/corrections_measure.py','--output',str(base/'maintenance')]),
                  ('accuracy',['tests/extraction/pr17_measure.py','--output',str(base/'accuracy')])]
        for name,args in commands:
            start=time.monotonic()
            result=subprocess.run([sys.executable,'-B',*args],cwd=ROOT,timeout=300,check=False)
            results.append({'suite':name,'exit':result.returncode,'elapsed_seconds':round(time.monotonic()-start,3)})
            print('STAGING_SUITE_RESULT '+json.dumps(results[-1]),flush=True)
            if result.returncode:break
        for path in sorted(base.rglob('*.json')):
            if path.name in {'corrective-process-results.json','maintenance-measurements.json','release-evaluation.json','frozen.json','extended.json'}:
                value=json.loads(path.read_text())
                if path.name in {'frozen.json','extended.json'}:
                    value={k:value[k] for k in ['extraction','attribution','prediction_changes','errors'] if k in value}
                print('STAGING_ARTIFACT '+json.dumps({'name':path.name,'result':value}),flush=True)
        print('STAGING_FINAL '+json.dumps({'suites':results,'runtime_network':'OS-denied','production_release':'NO-GO','real_corpus_captures':0}),flush=True)
    return 0 if len(results)==4 and all(r['exit']==0 for r in results) else 1
if __name__=='__main__':sys.exit(main())
