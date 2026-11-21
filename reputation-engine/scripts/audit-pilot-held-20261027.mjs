import './gta-email-recovery-runtime.mjs';
const {db}=await import('./reply-runtime-20261015.mjs');
const [job]=await db('sequence_jobs',{id:'eq.e5c20276-2691-4f8f-988c-6459465df382'});
const key=job.email_payload.actionKey;
const dispatch=await db('prepared_email_dispatches',{action_key:'eq.'+key});
const requests=await db('crm_email_requests',{request_key:'eq.prepared-email:'+key});
console.log(JSON.stringify({jobStatus:job.status,error:job.error,dispatch,requests},null,2));
