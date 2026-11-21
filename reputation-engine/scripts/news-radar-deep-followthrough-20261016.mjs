import './gta-email-recovery-runtime.mjs';
import {db} from './reply-runtime-20261015.mjs';
import fs from 'node:fs/promises';
const dir='artifacts/news-radar-deep-20261016';
const results=[];
for(const file of await fs.readdir(dir+'/receipts')){
 const r=JSON.parse(await fs.readFile(dir+'/receipts/'+file));
 if(r.state!=='accepted')continue;
 const id=r.plan.actionKey+'-response-review';
 if(!(await db('crm_tasks',{id:'eq.'+id})).length)await db('crm_tasks',{},'POST',{id,title:r.plan.company+': review response to news-radar introduction',description:JSON.stringify({sent_at:r.at,recipient:r.plan.email,provider_message_id:r.messageId,source_url:r.plan.source,next_action:'Check recipient reply, both mailboxes and delivery receipt before deciding next step. Follow actual response; no automatic chase.',suggested_review_date:'2026-10-23',artifact:dir+'/receipts/'+file}),status:'open',priority:'normal',category:'partnership_conversation_followthrough',owner_name:r.plan.city==='Ottawa'?'Dr. Courage':'John',related_type:'partner',related_id:r.contactId,related_label:r.plan.name,source:'manual',source_key:id,created_by_name:'John via Codex'});
 results.push({contact:r.plan.name,taskId:id});
}
await fs.writeFile(dir+'/followthrough-tasks.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({response_review_tasks:results.length}));
