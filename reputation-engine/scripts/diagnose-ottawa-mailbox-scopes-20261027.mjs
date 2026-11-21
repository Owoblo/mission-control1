import {fs} from './gta-email-recovery-runtime.mjs';
import {zohoProfile} from '../lib/partnership-core/zoho.mjs';
const p=zohoProfile('ottawa');
const a=await fetch(p.accountsOrigin+'/oauth/v2/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),body:new URLSearchParams({grant_type:'refresh_token',client_id:p.clientId,client_secret:p.clientSecret,refresh_token:p.refreshToken})});
const t=await a.json();const results={at:new Date().toISOString(),mailbox:p.mailbox,refresh:{http_status:a.status,success:!!t.access_token,error:t.error||null,scope:t.scope||null},checks:[]};
if(t.access_token){
 async function read(label,path){
  const r=await fetch(p.mailOrigin+'/api'+path,{headers:{Authorization:'Zoho-oauthtoken '+t.access_token},redirect:'error',signal:AbortSignal.timeout(20000)});const d=await r.json();
  results.checks.push({label,http_status:r.status,api_status:d.status,error:d.error||null,error_details:r.ok?undefined:d.data});return r.ok?d.data:null;
 }
 const accounts=await read('accounts','/accounts');
 const acc=Array.isArray(accounts)?accounts.find(x=>x.primaryEmailAddress?.toLowerCase()===p.mailbox||x.emailAddress?.some(e=>e.mailId?.toLowerCase()===p.mailbox)):null;
 if(acc){const base='/accounts/'+encodeURIComponent(acc.accountId);
 await read('message_list',base+'/messages/view?start=1&limit=1');
 await read('folder_list',base+'/folders');
 await read('message_search',base+'/messages/search?'+new URLSearchParams({searchKey:'sender:john@saturnstarmovers.ca',start:'1',limit:'1'}));
 }
}
fs.writeFileSync('artifacts/partnership-pilot-3000-20261027/ottawa-connection-diagnosis.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
