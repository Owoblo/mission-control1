import fs from 'node:fs/promises';
const root='partnership-system/markets/ca/on/ottawa';
const receipts=[];
for(const file of await fs.readdir(root))if(/^(revival|response)-[0-9a-f-]{36}\.json$/.test(file)){const r=JSON.parse(await fs.readFile(root+'/'+file));if(r.state==='accepted'||r.status==='accepted')receipts.push({...r,id:r.id||r.contactId,state:'accepted'})}
const clean=s=>String(s||'').replace(/\\r|\\n|\r|\n/g,'').trim();
const account=clean(process.env.TWILIO_ACCOUNT_SID), token=clean(process.env.TWILIO_AUTH_TOKEN);
if(!account.startsWith('AC')||!token||token.includes('SENSITIVE'))throw Error('Missing Twilio credentials');
const results=[];
for(const receipt of receipts){
 if(receipt.state!=='accepted')continue;
 const sid=receipt.result.sid;
 if(!/^(SM|MM)[0-9a-f]{32}$/i.test(sid))throw Error('Invalid message receipt');
 const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${sid}.json`,{headers:{Authorization:'Basic '+Buffer.from(account+':'+token).toString('base64')},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Provider read '+r.status);
 const m=await r.json();
 if(m.body!==receipt.body||m.from!=='+15482908695'||(receipt.mediaUrls&&Number(m.num_media)!==receipt.mediaUrls.length))throw Error('Provider message/identity mismatch');
 results.push({contactId:receipt.id,name:receipt.name,sid,status:m.status,errorCode:m.error_code,from:m.from,checkedAt:new Date().toISOString()});
}
await fs.writeFile(root+'/revival-delivery-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({checked:results.length,states:results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{})}));
