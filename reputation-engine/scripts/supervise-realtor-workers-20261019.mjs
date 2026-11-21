import fs from 'node:fs';import{spawnSync}from'node:child_process';
const dir='artifacts/realtor-batch-20261019';
for(const lane of ['1','2','3']){
 const s=JSON.parse(fs.readFileSync(dir+'/fast-worker-'+lane+'-status.json'));
 if(s.state!=='held_requires_review'||!s.error?.includes('Policy reservation unavailable (500)')||fs.existsSync(dir+'/fast-worker-'+lane+'.lock'))continue;
 const r=spawnSync(process.execPath,['--import','./scripts/realtor-runtime-20261019.mjs','scripts/start-realtor-workers-20261019.mjs','--restart-lane='+lane],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);console.log(r.stdout);
}
