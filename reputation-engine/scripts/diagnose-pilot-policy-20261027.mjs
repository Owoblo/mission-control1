import './gta-email-recovery-runtime.mjs';
import {db,base,headers} from './reply-runtime-20261015.mjs';
process.loadEnvFile('.env.ses.local');
const realFetch=globalThis.fetch;
globalThis.fetch=async(...args)=>{const r=await realFetch(...args);if(!r.ok&&String(args[0]).endsWith('/rpc/reserve_partnership_action')){const b=await r.clone().json();console.log(JSON.stringify({status:r.status,code:b.code,message:b.message,hint:b.hint}));}return r;};
const {reserveAction}=await import('/private/tmp/ssm-prepared-email-release-20261027/reputation-engine/lib/partnership-core/reserve.mjs');
const [j]=await db('sequence_jobs',{id:'eq.6137c2ed-2b1e-4fdc-9107-d3cdf7a5e761'});const p=j.email_payload;
try{console.log(await reserveAction({url:base,headers,contactId:p.contactId,channel:'email',key:p.actionKey,content:p.text,sender:p.sender,emailProvider:'ses'}));}catch(e){console.log(e.message)}
