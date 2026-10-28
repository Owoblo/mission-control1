import {createHash} from 'node:crypto';
// Independent mailbox profiles: Ottawa must never inherit Saturn credentials.
const clean=v=>String(v||'').replace(/\\r|\\n|\r|\n/g,'').trim();
export function zohoProfile(market='saturn',env=process.env){
 if(!['saturn','ottawa'].includes(market))throw Error('Unknown mailbox market');
 const prefix=market==='ottawa'?'ZOHO_OTTAWA_':'ZOHO_PARTNERSHIP_';
 const get=k=>clean(env[prefix+k]);
 return {market,mailbox:market==='ottawa'?'hello@dexamovers.ca':'business@starmovers.ca',clientId:get('CLIENT_ID'),clientSecret:get('CLIENT_SECRET'),refreshToken:get('REFRESH_TOKEN'),accountsOrigin:zohoServiceOrigin(get('ACCOUNTS_URL')||'https://accounts.zohocloud.ca','accounts'),mailOrigin:zohoServiceOrigin(get('MAIL_URL')||'https://mail.zohocloud.ca','mail')};
}
export function zohoServiceOrigin(value,service){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||!new RegExp(`^${service}\\.zoho(cloud)?\\.(com|ca|eu|in|com\\.au|jp|com\\.cn|sa)$`).test(u.hostname))throw Error('Invalid Zoho service URL');
 return u.origin;
}
// Isolate caches by fetch transport and the complete credential/profile identity.
// Cache only in memory; never persist access tokens or include them in errors.
const tokenCaches=new WeakMap();
function tokenCache(fetcher,p){
 let cache=tokenCaches.get(fetcher);if(!cache){cache=new Map();tokenCaches.set(fetcher,cache)}
 const key=createHash('sha256').update(JSON.stringify(p)).digest('hex');
 return {cache,key};
}
async function accessToken(fetcher,p){
 const {cache,key}=tokenCache(fetcher,p),prior=cache.get(key),now=Date.now();
 if(prior?.pending)return prior.pending;
 if(prior?.retryAfter>now)throw Error('Zoho mailbox authorization temporarily throttled');
 if(prior?.accessToken&&prior.expiresAt>now)return prior;
 const pending=(async()=>{
  const auth=await fetcher(p.accountsOrigin+'/oauth/v2/token',{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),body:new URLSearchParams({grant_type:'refresh_token',client_id:p.clientId,client_secret:p.clientSecret,refresh_token:p.refreshToken})});
  const token=await auth.json();
  if(!auth.ok||!token.access_token){
   if(auth.status===429||/too many requests/i.test(String(token.error_description||''))){
    cache.set(key,{retryAfter:Date.now()+60000});
    throw Error('Zoho mailbox authorization temporarily throttled');
   }
   throw Error('Zoho mailbox authorization failed');
  }
  const seconds=Number(token.expires_in);
  // Missing expiry is reusable for only 30 seconds, never treated as indefinite.
  const ttl=Number.isFinite(seconds)&&seconds>0?Math.max(0,Math.min(seconds*1000,3600000)-60000):30000;
  const lease={accessToken:token.access_token,expiresAt:Date.now()+ttl};
  cache.set(key,lease);return lease;
 })();
 cache.set(key,{pending});
 try{return await pending}catch(error){if(cache.get(key)?.pending===pending)cache.delete(key);throw error}
}
export async function openZohoMailbox(market='saturn',fetcher=fetch,env=process.env){
 const p=zohoProfile(market,env);
 if(!p.clientId||!p.clientSecret||!p.refreshToken)throw Error(`${market} mailbox is not connected`);
 let token=await accessToken(fetcher,p);
 async function request(path,body){
  if(token.expiresAt<=Date.now())token=await accessToken(fetcher,p);
  const r=await fetcher(p.mailOrigin+'/api'+path,{method:body?'POST':'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Authorization:'Zoho-oauthtoken '+token.accessToken,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await r.json();
  if(r.status===401){const {cache,key}=tokenCache(fetcher,p);if(cache.get(key)===token)cache.delete(key)}
  // Do not replay requests, especially sends, after an authorization failure.
  if(!r.ok||data.status?.code!==200)throw Error('Zoho mailbox request failed ('+r.status+')');return data.data;
 }
 const accounts=await request('/accounts');
 const account=accounts.find(a=>a.primaryEmailAddress?.toLowerCase()===p.mailbox||a.emailAddress?.some(e=>e.isConfirmed!==false&&e.mailId?.toLowerCase()===p.mailbox));
 if(!account||account.incomingBlocked||account.outgoingBlocked)throw Error('Expected mailbox is missing or blocked');
 // Verify read scopes before allowing mail whose replies must return to the CRM.
 const messages=await request(`/accounts/${encodeURIComponent(account.accountId)}/messages/view?start=1&limit=1`);
 if(!Array.isArray(messages))throw Error('Mailbox read scope is not verified');
 return {mailbox:p.mailbox,accountId:account.accountId,request};
}
