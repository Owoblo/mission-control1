"""Export an allowlisted snapshot; never include production data or credentials."""
import hashlib,json,shutil,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
destination=Path(sys.argv[1]).resolve()
if destination.exists():raise SystemExit('Destination must be new')
paths=set(json.loads(Path('/tmp/extraction-stage-paths.json').read_text().splitlines()[-1]))
paths.update(['lib/partnership-core/markets.mjs','tests/extraction/network_sandbox.py','tests/extraction/run_corrective_processes.py','tests/extraction/corrections_measure.py','tests/extraction/pr17_measure.py','tests/extraction/tranche5_results/PR-16/frozen-candidate.json','tests/extraction/tranche5_results/PR-16/candidate.json'])
paths.update(str(p.relative_to(ROOT)) for p in (ROOT/'staging/extraction-evaluation').glob('*') if p.is_file())
manifest={}
for name in sorted(paths):
    source=ROOT/name
    if source.is_symlink() or any(part in {'.env','.runtime','.git','node_modules','artifacts'} for part in Path(name).parts):raise SystemExit('Forbidden path '+name)
    body=source.read_bytes();target=destination/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(body);manifest[name]=hashlib.sha256(body).hexdigest()
for name in ['Dockerfile','railway.toml']:
    shutil.copyfile(ROOT/'staging/extraction-evaluation'/name,destination/name)
    manifest[name]=hashlib.sha256((destination/name).read_bytes()).hexdigest()
(destination/'staging-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'files':len(manifest),'bytes':sum((destination/p).stat().st_size for p in manifest),'destination':str(destination)}))
