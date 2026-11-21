import fs from 'node:fs'
import {spawn} from 'node:child_process'
const dir='artifacts/realtor-batch-20261015'
if(fs.existsSync(dir+'/monitor.lock'))throw Error('Monitor already has a lock; inspect before starting another')
const log=fs.openSync(dir+'/monitor.log','a')
const child=spawn(process.execPath,['scripts/monitor-realtor-delivery-20261015.mjs'],{cwd:process.cwd(),detached:true,stdio:['ignore',log,log]})
child.unref();fs.closeSync(log)
fs.writeFileSync(dir+'/monitor-launch.json',JSON.stringify({pid:child.pid,at:new Date().toISOString(),target:1650,scope:'GTA realtor delivery receipts and confirmed-failure replacements',cutoff:'2026-10-15T21:00:00Z'}))
console.log(JSON.stringify({started_pid:child.pid}))
