import fs from 'node:fs';
const allowed=new Set(['Domain sending interval has not elapsed','Outreach sender is not enabled','Outreach owner or reply route is missing','Outreach postal address has not been recorded','Recipient is suppressed','Rolling sender or shared domain limit reached','SES account health must be refreshed','SES operational reserve reached','Sender paused before dispatch','Recipient opted out before dispatch','SES account health expired before dispatch','Outreach reservation expired; review before preparing another send','Email key already belongs to different content','Transport fingerprint is required','Invalid email reservation']);
export function safeStorageDiagnostic(url,status,body){
 const pathname=new URL(url).pathname;
 return {at:new Date().toISOString(),status,operation:pathname.startsWith('/rest/v1/rpc/')?pathname.split('/').at(-1):'storage_read',code:/^[A-Z0-9]{3,12}$/.test(body?.code||'')?body.code:null,reason:allowed.has(body?.message)?body.message:'unclassified_storage_error'};
}
export function installPilotStorageDiagnostics(){
 if(globalThis.__pilotStorageDiagnostics)return;
 globalThis.__pilotStorageDiagnostics=true;
 const original=globalThis.fetch;
 globalThis.fetch=async function(input,options){
  const response=await original(input,options);
  try{
   const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
   const parsed=new URL(url);
   const expected=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
   if(!response.ok&&expected&&parsed.origin===new URL(expected).origin&&parsed.pathname.startsWith('/rest/v1/')){
    const body=await response.clone().json().catch(()=>null);
    const diagnostic=safeStorageDiagnostic(url,response.status,body);
    // Keep the database's error text locally for root-cause review. Never record
    // request bodies, URL query strings, auth headers, or recipient addresses.
    diagnostic.detail=String(body?.message||'').slice(0,500);
    diagnostic.hint=String(body?.hint||'').slice(0,500);
    fs.appendFileSync('/Users/owoblo/Downloads/mission-control1/reputation-engine/artifacts/partnership-pilot-3000-20261027/storage-http-errors.jsonl',JSON.stringify(diagnostic)+'\n');
   }
  }catch{/* Diagnostics must not alter request outcomes. */}
  return response;
 };
}
