import fs from 'node:fs/promises';
const auth=await fetch(process.env.ZOHO_PARTNERSHIP_ACCOUNTS_URL+'/oauth/v2/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:process.env.ZOHO_PARTNERSHIP_CLIENT_ID,client_secret:process.env.ZOHO_PARTNERSHIP_CLIENT_SECRET,refresh_token:process.env.ZOHO_PARTNERSHIP_REFRESH_TOKEN}),signal:AbortSignal.timeout(20000)});
const token=await auth.json();if(!token.access_token)throw Error('Mailbox authorization unavailable');
const r=await fetch(process.env.ZOHO_PARTNERSHIP_MAIL_URL+'/api/accounts',{headers:{Authorization:'Zoho-oauthtoken '+token.access_token},signal:AbortSignal.timeout(20000)});
const result=await r.json();if(!r.ok||result.status?.code!==200)throw Error('Mailbox account access '+r.status);
const accounts=(result.data||[]).map(a=>({accountId:a.accountId,primaryEmailAddress:a.primaryEmailAddress,emailAddress:a.emailAddress}));
await fs.writeFile('partnership-system/markets/ca/on/ottawa/mail-access-review.json',JSON.stringify({at:new Date().toISOString(),accounts},null,2));
console.log(JSON.stringify(accounts));
