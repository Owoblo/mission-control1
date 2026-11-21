import fs from 'node:fs/promises';
const scheduled=JSON.parse(await fs.readFile('partnership-system/state/amanda-card-schedule-20260916.json'));const sent=JSON.parse(await fs.readFile('partnership-system/state/city-facilities-routing-send.json'));
const h={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
async function db(t,q={},method='GET',body){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+t+'?'+new URLSearchParams(q),{method,headers:h,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(t+' '+r.status);return r.json();}
const job=await db('sequence_jobs',{id:'eq.'+scheduled.result.job.id,select:'id,status,scheduled_at,error'});
const events=await db('email_provider_events',{provider_message_id:'eq.'+sent.messageId,select:'event_type,occurred_at'});
for(const [id,next_action,evidence] of [
 ['0ab14a7c-ba8b-4cf6-b0e9-116d1bcde2d9','AMANDA15 card queued for September 16 at 09:00 Toronto via scheduled MMS. Check provider delivery after execution; do not send a duplicate.',{jobId:scheduled.result.job.id,touchId:scheduled.result.touch.id,mediaUrl:scheduled.mediaUrl}],
 ['474355a0-2cf9-46f9-a325-fafa6e58479d','Facilities routing request sent to the official Community Services address following Purchasing referral. Await reply; do not contact other City employees in parallel. Review September 18.',{contactId:sent.contactId,messageId:sent.messageId,events}]
]){const [task]=await db('crm_tasks',{id:'eq.'+id});if(!task)throw Error('Missing task');if(task.description?.includes('followthrough-execution-20260916'))continue;await db('crm_tasks',{id:'eq.'+id},'PATCH',{description:JSON.stringify({review_key:'followthrough-execution-20260916',next_action,evidence,previous_description:task.description}),due_at:id==='0ab14a7c-ba8b-4cf6-b0e9-116d1bcde2d9'?'2026-09-16T13:30:00Z':'2026-09-18T13:00:00Z'});}
await fs.writeFile('partnership-system/state/followthrough-execution-20260916.json',JSON.stringify({at:new Date().toISOString(),job,events},null,2));console.log(JSON.stringify({job,events}));
