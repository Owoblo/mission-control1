import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {preparedSmsDatabase} from '../helpers/prepared-sms-db.mjs';
test('paused realtor import is atomic, resumable, and preserves existing relationships',async()=>{
 const db=await preparedSmsDatabase();try{
 await db.exec('alter table market_contacts add column title text, add column notes text, add column sequence_paused_reason text');
 await db.exec(await readFile('supabase/migrations/20260926000300_paused_realtor_import.sql','utf8'));
 const row={individual_id:'12345',name:'Sarah Example',brokerage:'Example Realty',city:'Hamilton',phone:'+14165551234',phone2:'+14165551235',email:'unverified@example.com',market:'toronto'};
 const run=async(rows,dry=true)=>(await db.query('select import_paused_realtors($1::jsonb,$2,$3) as r',[JSON.stringify(rows),'a'.repeat(64),dry])).rows[0].r;
 assert.equal((await run([row])).rows[0].status,'would_import_paused');assert.equal((await db.query('select * from market_contacts')).rows.length,0);
 const first=await run([row],false);assert.equal(first.rows[0].status,'imported_paused');
 const contact=(await db.query('select * from market_contacts')).rows[0];assert.equal(contact.sequence_paused,true);assert.equal(contact.email,null);assert.equal(contact.company,'Example Realty');assert.equal(contact.name,'Sarah Example');assert.ok(contact.partner_company_id);
 assert.equal((await run([row],false)).rows[0].replay,true);assert.equal((await db.query('select * from market_contacts')).rows.length,1);
 assert.equal((await run([{...row,name:'Changed'}],false)).rows[0].status,'held_source_changed');
 assert.equal((await run([{...row,individual_id:'23456',name:'Someone Else'}],false)).rows[0].status,'held_existing_route');
 await db.exec("insert into market_contacts(name,phone,do_not_contact,notes) values('Restricted','416-555-9999',true,'keep history')");
 assert.equal((await run([{...row,individual_id:'34567',name:'Another Person',phone:'+14165558888',phone2:'+14165559999'}],false)).rows[0].status,'held_existing_route');
 await assert.rejects(run([{...row,individual_id:'45678',name:'New Person',phone:'+14165557777',phone2:''},{...row,individual_id:'bad'}],false));
 assert.equal((await db.query("select * from market_contacts where name='New Person'")).rows.length,0);
 assert.equal((await db.query('select * from sequence_jobs')).rows.length,0);assert.equal((await db.query('select * from market_touches')).rows.length,0);
 assert.equal((await db.query("select notes from market_contacts where name='Restricted'")).rows[0].notes,'keep history');
 }finally{await db.close()}
});
