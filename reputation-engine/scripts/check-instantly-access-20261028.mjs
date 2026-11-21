// Read-only workspace check. Never prints or persists the API token.
import fs from 'node:fs';
process.loadEnvFile('.env.local');
const key=process.env.INSTANTLY_API_KEY;
if(!key)throw Error('Instantly API key not configured');
const response=await fetch('https://api.instantly.ai/api/v2/accounts?limit=100',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});
const data=await response.json().catch(()=>({}));
const accounts=Array.isArray(data.items)?data.items:[];
const report={at:new Date().toISOString(),status:response.status,connectedAccounts:accounts.length,accounts:accounts.map(a=>({email:a.email,providerCode:a.provider_code,status:a.status,warmupStatus:a.warmup_status,warmupStart:a.timestamp_warmup_start,dailyLimit:a.daily_limit})),nextPage:!!data.next_starting_after,error:response.ok?null:String(data.message||data.error||'Unknown API response')};
fs.writeFileSync('artifacts/partnership-pilot-3000-20261027/instantly-access-check-20261028.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
