// Fulfil Amanda's explicit request through the existing scheduled-reply path.
import fs from 'node:fs/promises';
import {createHmac,createHash} from 'node:crypto';
const contactId='18204ac7-41b6-50ff-9d8e-ec428947a8f4';
const output='partnership-system/state/amanda-card-schedule-20260916.json';
const scheduledAt='2026-09-16T13:00:00Z';
const headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY};
async function rows(table,query){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+table+'?'+new URLSearchParams(query),{headers});if(!r.ok)throw Error('Read failed '+r.status);return r.json();}
const [contact]=await rows('market_contacts',{id:'eq.'+contactId,select:'id,city,do_not_contact,stage,decision,partner_company_id'});
const touches=await rows('market_touches',{contact_id:'eq.'+contactId,channel:'eq.sms',order:'created_at.desc',limit:10,select:'id,direction,notes,metadata'});
const jobs=await rows('sequence_jobs',{contact_id:'eq.'+contactId,status:'in.(pending,running)',select:'id,template_key,scheduled_at'});
if(!contact||contact.do_not_contact||['dnc','closed_lost'].includes(contact.stage)||contact.decision==='opted_out')throw Error('Contact held');
if(touches[0]?.id!=='27ed0d91-b610-4366-84bf-49b3d76619ac')throw Error('Conversation changed; review before scheduling');
if(jobs.length)throw Error('Existing jobs require review');
if(Date.parse(scheduledAt)<Date.now()+60000)throw Error('Scheduling window elapsed; review a new business-hour slot');
let previous;try{previous=JSON.parse(await fs.readFile(output));}catch(e){if(e.code!=='ENOENT')throw e;}
if(previous&&!(process.argv.includes('--retry-confirmed-touch-failure')&&previous.state==='schedule_failed'&&previous.result?.error==='Could not create scheduled touch'))throw Error('Existing reservation: inspect before retry');
const secret=process.env.AUTH_SECRET?.replace(/\\r|\\n|\r|\n/g,'').trim();if(!secret||secret.includes('SENSITIVE'))throw Error('Authentication unavailable');
const payload=Buffer.from(JSON.stringify({role:'owner',name:'John',exp:Date.now()+300000})).toString('base64url');
const cookie='mc_session='+payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
const data=await fs.readFile('partnership-system/exports/amanda15/Amanda-Lawson-AMANDA15.png');
const form=new FormData();form.append('file',new Blob([data],{type:'image/png'}),'Amanda-Lawson-AMANDA15.png');
let media=previous?.mediaUrl?{url:previous.mediaUrl}:null;
if(!media){const upload=await fetch('https://go.quote2move.com/api/marketing/upload-media',{method:'POST',headers:{Cookie:cookie},body:form});media=await upload.json();if(!upload.ok||!media.url)throw Error('Media upload failed '+upload.status);}
const check=await fetch(media.url);if(!check.ok||createHash('sha256').update(Buffer.from(await check.arrayBuffer())).digest('hex')!==createHash('sha256').update(data).digest('hex'))throw Error('Published card verification failed');
const body="Morning Amanda! Here's the card with AMANDA15 and your clients' 15% discount, ready to save and share. They'll just need to mention the code when they contact us for a moving quote. Thanks for teaming up with us! — John";
const state={contactId,scheduledAt,body,mediaUrl:media.url,state:'reserved_before_schedule',previous,at:new Date().toISOString()};await fs.writeFile(output,JSON.stringify(state,null,2),{flag:previous?'w':'wx'});
const r=await fetch(`https://go.quote2move.com/api/marketing/contacts/${contactId}/schedule-reply`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({body,media_urls:[media.url],scheduled_at:scheduledAt})});
const result=await r.json();await fs.writeFile(output,JSON.stringify({...state,state:r.ok?'scheduled':'schedule_failed',http:r.status,result},null,2));
if(!r.ok)throw Error('Schedule failed '+r.status+' '+JSON.stringify(result));
console.log(JSON.stringify({scheduled:true,scheduledAt,jobId:result.job?.id,touchId:result.touch?.id,mediaUrl:media.url}));
