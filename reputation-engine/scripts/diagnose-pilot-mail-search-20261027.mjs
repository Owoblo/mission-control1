import './gta-email-recovery-runtime.mjs';
const original=globalThis.fetch;
globalThis.fetch=async(...args)=>{const r=await original(...args);if(!r.ok){let b;try{b=await r.clone().json()}catch{b={bodyType:r.headers.get('content-type')}};console.log(JSON.stringify({status:r.status,host:new URL(String(args[0])).hostname,path:new URL(String(args[0])).pathname.replace(/\/accounts\/[^/]+/,'/accounts/[id]'),error:b?.status,errorCode:b?.data?.errorCode,details:b?.data?.moreInfo,message:b?.data?.message,error:b?.error}));}return r;};
const {openZohoMailbox}=await import('../lib/partnership-core/zoho.mjs');
for(const market of ['saturn','ottawa']){
 try{const b=await openZohoMailbox(market);const r=await b.request(`/accounts/${b.accountId}/messages/search?${new URLSearchParams({searchKey:'sender:info@mtnairporttaxi.com',start:'1',limit:'200',includeto:'true'})}`);console.log(JSON.stringify({market,resultCount:r.length}));}catch(e){console.log(JSON.stringify({market,error:e.message}));}
}
