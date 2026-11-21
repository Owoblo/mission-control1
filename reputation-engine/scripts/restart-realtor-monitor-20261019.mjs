import fs from 'node:fs';import{spawnSync}from'node:child_process';
const dir='artifacts/realtor-batch-20261019';const lock=dir+'/monitor.lock';
const launch=JSON.parse(fs.readFileSync(dir+'/monitor-launch.json'));const pid=Number(fs.readFileSync(lock,'utf8'));if(pid!==launch.pid)throw Error('Monitor identity mismatch');
process.kill(pid,'SIGTERM');
for(let i=0;i<20;i++){try{process.kill(pid,0)}catch(e){if(e.code==='ESRCH')break;throw e}if(i===19)throw Error('Old monitor still active');await new Promise(r=>setTimeout(r,250));}
if(fs.existsSync(lock))fs.renameSync(lock,lock+'.previous-'+Date.now());
const result=spawnSync(process.execPath,['--import','./scripts/realtor-runtime-20261019.mjs','scripts/start-realtor-monitor-20261019.mjs'],{encoding:'utf8'});console.log(result.stdout);if(result.status!==0)throw Error(result.stderr);
