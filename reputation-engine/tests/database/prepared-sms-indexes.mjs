import test from 'node:test';
import assert from 'node:assert/strict';
import {preparedSmsDatabase} from '../helpers/prepared-sms-db.mjs';

test('indexed identity guards admit 416 atomically against a populated CRM and preserve duplicates',async()=>{
 const db=await preparedSmsDatabase();try{
 await db.exec(`insert into market_contacts(name,company,phone,city,stage) select 'Existing '||g,'Existing '||g,'+1519'||lpad(g::text,7,'0'),'Windsor','target' from generate_series(1,15000) g; analyze market_contacts;`);
 const rows=Array.from({length:416},(_,i)=>({phone:'+1226555'+String(1000+i),company:'Prepared '+i,city:'Windsor',category:'contractor',sender:'+12267746581',body:'Fixture only',execution_key:i.toString(16).padStart(64,'0'),scheduled_at:new Date(Date.now()+86400000).toISOString()}));
 const enqueue=async list=>(await db.query("select enqueue_prepared_sms('indexed-fixture','Fixture',$1::jsonb,1000) as r",[JSON.stringify(list)])).rows[0].r;
 const start=Date.now();const result=await enqueue(rows);assert.equal(result.jobs.length,416);
 console.log('416-row local transaction ms:',Date.now()-start);
 assert.equal((await db.query('select count(*)::int n from sequence_jobs')).rows[0].n,416);
 const replay=await enqueue(rows);assert.ok(replay.jobs.every(j=>j.replay));
 await assert.rejects(enqueue([{...rows[0],phone:'+12265559999',company:' prepared 0 ',execution_key:'f'.repeat(64)}]),/Existing name requires identity review/);
 await db.exec("insert into market_contacts(name,company,phone,city) values('Duplicate fixture','Duplicate fixture','1 (226) 555-1000','Windsor')");
 await assert.rejects(enqueue([{...rows[0],execution_key:'e'.repeat(64)}]),/Ambiguous recipient identity/);
 const plans=await db.query(`explain (format json) select * from market_contacts where lower(trim(name))='prepared 2' or lower(trim(company))='prepared 2'`);
 assert.match(JSON.stringify(plans.rows),/market_contacts_sms_name_identity_idx/);
 assert.match(JSON.stringify(plans.rows),/market_contacts_sms_company_identity_idx/);
 const phonePlan=await db.query(`explain (format json) select * from market_contacts where right(regexp_replace(coalesce(phone,''),'\\D','','g'),10)='2265551002'`);
 assert.match(JSON.stringify(phonePlan.rows),/market_contacts_sms_phone_identity_idx/);
 }finally{await db.close()}
});
