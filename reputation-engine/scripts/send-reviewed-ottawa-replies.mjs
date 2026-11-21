import fs from 'node:fs/promises';import {createHmac} from 'node:crypto';
const root='partnership-system/markets/ca/on/ottawa';
const batch=process.argv.find(a=>a.startsWith('--batch='))?.slice(8);if(!/^[a-z0-9-]+$/.test(batch||''))throw Error('Reviewed batch required');
const plans=JSON.parse(await fs.readFile(root+'/'+batch+'-reply-plans.json'));
const headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY};
const secret=process.env.AUTH_SECRET?.replace(/\\r|\\n|\r|\n/g,'').trim();if(!secret||secret.includes('SENSITIVE'))throw Error('Missing auth');
const p=Buffer.from(JSON.stringify({role:'owner',name:'John — authorized Dexa response',exp:Date.now()+900000})).toString('base64url');const cookie='mc_session='+p+'.'+createHmac('sha256',secret).update(p).digest('base64url');
for(const plan of plans){
 const path=root+'/response-'+plan.expectedTouchId+'.json';
 try{await fs.access(path);console.log(plan.name+': prior response reservation; no resend');continue}catch(e){if(e.code!=='ENOENT')throw e}
 const q=new URLSearchParams({contact_id:'eq.'+plan.contactId,order:'created_at.desc',limit:'1',select:'id'});
 const check=await fetch(process.env.SUPABASE_URL+'/rest/v1/market_touches?'+q,{headers});if(!check.ok)throw Error('Freshness check failed');
 if((await check.json())[0]?.id!==plan.expectedTouchId){console.log(plan.name+': new activity; review again');continue}
 await fs.writeFile(path,JSON.stringify({...plan,status:'reserved'},null,2),{flag:'wx'});
 const r=await fetch(`https://go.quote2move.com/api/marketing/contacts/${plan.contactId}/send-reply`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({body:plan.body,from_number:'+15482908695',media_urls:plan.mediaUrls||[]}),signal:AbortSignal.timeout(60000)});
 const result=await r.json();await fs.writeFile(path,JSON.stringify({...plan,status:r.ok?'accepted':'held',http:r.status,result,at:new Date().toISOString()},null,2));console.log(JSON.stringify({name:plan.name,status:r.status,sid:result.sid,error:result.error}));
}
