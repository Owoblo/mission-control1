import {createHmac} from 'node:crypto';import fs from 'node:fs/promises';
const clean=s=>String(s||'').replace(/\\r|\\n|\r|\n/g,'').trim();
const sid=clean(process.env.TWILIO_ACCOUNT_SID),token=clean(process.env.TWILIO_AUTH_TOKEN);
const headers={Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64')};
const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=%2B15482908695`,{headers});if(!r.ok)throw Error('Twilio number read failed');
const [line]=(await r.json()).incoming_phone_numbers;if(!line)throw Error('Ottawa line missing');
let voiceUrl=line.voice_url;
if(line.voice_application_sid){const a=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Applications/${line.voice_application_sid}.json`,{headers});if(!a.ok)throw Error('Twilio voice app read failed');voiceUrl=(await a.json()).voice_url;}
if(!/^https:\/\/(go\.quote2move\.com|mission-control1-reputation-engine\.vercel\.app)\//.test(voiceUrl))throw Error('Unexpected voice handler; review URL before testing');
// Requests only the routing XML. Empty From cannot match a CRM person and no call is placed.
const body=new URLSearchParams({To:'+15482908695'});
const signature=createHmac('sha1',token).update(voiceUrl+'To+15482908695').digest('base64');
const response=await fetch(voiceUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':signature},body,redirect:'error'});
const xml=await response.text();
const result={line:line.phone_number,voiceUrl,http:response.status,forwardsToCourage:xml.includes('<Number>+13435513167</Number>'),destinations:[...xml.matchAll(/<(?:Number|Client)>([^<]+)<\/(?:Number|Client)>/g)].map(m=>m[1]),checkedAt:new Date().toISOString(),actualCallPlaced:false};
await fs.writeFile('partnership-system/markets/ca/on/ottawa/call-routing-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.forwardsToCourage)process.exitCode=1;
