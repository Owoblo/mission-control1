import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
test('reply capabilities allow one atomic claim and one email ID across tokens',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon; create role authenticated; create role service_role; create table market_contacts(id uuid primary key); create table market_touches(id uuid primary key);');
 await db.exec(fs.readFileSync('supabase/migrations/20260922000100_email_sms_replies.sql','utf8'));
 await db.exec("insert into market_touches values ('00000000-0000-4000-8000-000000000002'); insert into market_contacts values ('00000000-0000-4000-8000-000000000001'); insert into partnership_email_sms_replies(token_hash,source_touch_id,contact_id,operator_email,from_number,to_number,expires_at) select n,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','john@example.com','+12268870667','+19055182999',now()+interval '7 days' from unnest(array['a','b']) as n;");
 const claim="update partnership_email_sms_replies set status='processing',inbound_message_id='same-email' where token_hash='a' and status='pending' returning token_hash";
 assert.equal((await db.query(claim)).rows.length,1);assert.equal((await db.query(claim)).rows.length,0);
 await assert.rejects(()=>db.exec("update partnership_email_sms_replies set inbound_message_id='same-email' where token_hash='b'"));
 await assert.rejects(()=>db.exec("update partnership_email_sms_replies set status='processing',inbound_message_id='different-email' where token_hash='b'"));
 }finally{await db.close()}
});
