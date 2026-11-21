import fs from 'node:fs';import{spawn}from'node:child_process';
const dir='artifacts/realtor-batch-20261019';
const only=process.argv.find(a=>a.startsWith('--restart-lane='))?.split('=')[1];if(only&&!['1','2','3'].includes(only))throw Error('Invalid lane');
for(const lane of only?[only]:['1','2','3']){
 if(fs.existsSync(dir+'/fast-worker-'+lane+'-launch.json')){const status=JSON.parse(fs.readFileSync(dir+'/fast-worker-'+lane+'-status.json'));if(status.state!=='held_requires_review'||(!only&&(status.sent!==0||!status.error?.includes('fetch failed')))||fs.existsSync(dir+'/fast-worker-'+lane+'.lock'))throw Error('Unsafe worker restart');fs.renameSync(dir+'/fast-worker-'+lane+'-launch.json',dir+'/fast-worker-'+lane+'-launch.previous-'+Date.now()+'.json');}
 const log=fs.openSync(dir+'/fast-worker-'+lane+'.log','a');
 const child=spawn(process.execPath,['--import','./scripts/realtor-runtime-20261019.mjs','--import','tsx','scripts/realtor-fast-worker-20261019.ts','--lane='+lane,'--max=2200'],{cwd:process.cwd(),detached:true,stdio:['ignore',log,log]});child.unref();fs.closeSync(log);
 fs.writeFileSync(dir+'/fast-worker-'+lane+'-launch.json',JSON.stringify({pid:child.pid,at:new Date().toISOString(),cutoff:'2026-10-19T17:45:00Z'}));console.log(JSON.stringify({lane,pid:child.pid}));
}
