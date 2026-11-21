import fs from 'node:fs';import{createHmac,randomBytes}from'node:crypto';import assert from'node:assert/strict';import{parseEnv}from'node:util';
const base='/Users/owoblo/Downloads/mission-control1/reputation-engine/';for(const f of ['.env.partnership-runtime.local','.vercel/.env.production.local','.env.supabase-admin.local'])process.loadEnvFile(base+f);
// Dedicated mailbox connections override placeholder values in downloaded deployment settings.
// loadEnvFile does not replace existing environment variables, so apply only the matching profile keys explicitly.
for(const [file,prefix] of [['.env.zoho-reconnect.local','ZOHO_PARTNERSHIP_'],['.env.zoho-ottawa.local','ZOHO_OTTAWA_']]){
 if(!fs.existsSync(base+file))continue;
 for(const [key,value] of Object.entries(parseEnv(fs.readFileSync(base+file,'utf8'))))if(key.startsWith(prefix))process.env[key]=value;
}
const dir=base+'artifacts/partnership-opportunities-20261007/';
const ids=['e15a8de4-a8d9-4cd1-b074-56cffb5d560c','053721a8-830a-4eb2-818f-ef822c1061cb','fba2cd2f-e2ed-4654-b01e-5b1c616ed649','c95059ad-9efb-470d-8c6d-094024aad28a','caaaa570-30d3-43d9-aa18-66a2eecf2b87','ea15c6d9-b6b1-41ef-95cd-5acea2a59a07','0c5c5ade-09c0-4ede-a97d-b430bdb339ee','3c80494f-f80f-4630-8fdc-eedc581828c0','00f26953-ab69-4b85-bca3-d577b89f33b6','f1cd485d-3f85-4e6b-8fc0-0542f0d16aac','da1369c5-1704-4e03-9140-ba293d002638'];
function cookie(){const p=Buffer.from(JSON.stringify({role:'owner',name:'John',exp:Date.now()+600000})).toString('base64url');return'mc_session='+p+'.'+createHmac('sha256',process.env.AUTH_SECRET.replace(/\\n|\\r/g,'').trim()).update(p).digest('base64url')}
async function api(path,body){const r=await fetch('https://go.quote2move.com'+path,{headers:{Cookie:cookie(),'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const t=await r.text();if(!r.ok)throw Error(r.status+' '+t.slice(0,500));return JSON.parse(t)}
async function db(table,q){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+table+'?'+new URLSearchParams(q),{headers:{apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY}});if(!r.ok)throw Error(await r.text());return r.json()}
export{fs,api,db};
