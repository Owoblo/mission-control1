import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
import {fs} from '/Users/owoblo/Downloads/mission-control1/reputation-engine/scripts/gta-email-recovery-runtime.mjs';
const base=process.env.CHECK_BASE||'http://localhost:3127';
const secret=process.env.AUTH_SECRET.replace(/\\n|\\r/g,'').trim();
function cookie(role){const p=Buffer.from(JSON.stringify({role,name:'John',exp:Date.now()+600000})).toString('base64url');return 'mc_session='+p+'.'+createHmac('sha256',secret).update(p).digest('base64url')}
const receipts=[23,40,17].map(row=>JSON.parse(fs.readFileSync(`/Users/owoblo/Downloads/mission-control1/reputation-engine/artifacts/gta-subcontractor-recruiting-20261014/receipt-${row}.json`)));
for(const c of receipts){
 const path=`/api/sales/subcontractors/${c.contractor_id}/messages`;
 const r=await fetch(base+path,{headers:{Cookie:cookie('owner')}});
 assert.equal(r.status,200,await r.clone().text());
 const data=await r.json();assert.ok(data.messages.length>=2);assert.ok(data.messages.some(m=>m.direction==='inbound'));assert.ok(data.messages.some(m=>m.direction==='outbound'));
 for(const m of data.messages)assert.ok([m.from_number,m.to_number].includes(c.phone));
 assert.deepEqual(data.messages.map(m=>m.created_at),data.messages.map(m=>m.created_at).sort());
 console.log(JSON.stringify({name:c.name,id:c.contractor_id,messages:data.messages.length,replyVisible:true}));
 for(const role of ['sales_rep','partner_admin']){const denied=await fetch(base+path,{headers:{Cookie:cookie(role)}});assert.ok([401,403].includes(denied.status))}
}
const missing=await fetch(base+'/api/sales/subcontractors/00000000-0000-0000-0000-000000000000/messages',{headers:{Cookie:cookie('owner')}});assert.equal(missing.status,404);
console.log('Access boundaries and missing-contractor handling passed; no messages sent.');
