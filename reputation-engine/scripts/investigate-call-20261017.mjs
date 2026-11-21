import './gta-email-recovery-runtime.mjs';
import {db} from './reply-runtime-20261015.mjs';
import fs from 'node:fs/promises';
const sid=process.env.TWILIO_ACCOUNT_SID, token=process.env.TWILIO_AUTH_TOKEN;
const root=`https://api.twilio.com/2010-04-01/Accounts/${sid}`;
async function get(path){const r=await fetch(root+path,{headers:{Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64')}});if(!r.ok)throw Error('Twilio '+r.status);return r.json();}
const calls=await get('/Calls.json?'+new URLSearchParams({To:'+12262419853',PageSize:'15'}));
await fs.mkdir('artifacts/call-investigation-20261017',{recursive:true});
await fs.writeFile('artifacts/call-investigation-20261017/calls.json',JSON.stringify(calls,null,2));
for(const c of calls.calls.slice(0,5)){
 const contacts=await db('market_contacts',{phone:'ilike.*'+c.from.replace(/\D/g,'').slice(-10)+'*',select:'id,name,company,phone,city'});
 console.log(JSON.stringify({sid:c.sid,from:c.from,to:c.to,status:c.status,direction:c.direction,start:c.start_time,end:c.end_time,duration:c.duration,contacts}));
}
const numbers=await get('/IncomingPhoneNumbers.json?'+new URLSearchParams({PhoneNumber:'+12262419853'}));
console.log(JSON.stringify({routing:numbers.incoming_phone_numbers.map(n=>({voice_url:n.voice_url,status_callback:n.status_callback,friendly_name:n.friendly_name}))}));
