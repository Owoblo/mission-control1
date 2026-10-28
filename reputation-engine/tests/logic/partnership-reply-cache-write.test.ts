import {test} from 'node:test'
import assert from 'node:assert/strict'
import {syncPartnershipZohoReplies} from '../../lib/server/partnership-zoho-sync'
test('successful empty 201 scan-cache write does not abort mailbox processing',async()=>{
 const previousFetch=global.fetch
 const env={SUPABASE_URL:'https://db.test',SUPABASE_KEY:'test',ZOHO_PARTNERSHIP_CLIENT_ID:'test',ZOHO_PARTNERSHIP_CLIENT_SECRET:'test',ZOHO_PARTNERSHIP_REFRESH_TOKEN:'test',ZOHO_PARTNERSHIP_ACCOUNTS_URL:'https://accounts.zohocloud.ca',ZOHO_PARTNERSHIP_MAIL_URL:'https://mail.zohocloud.ca',PARTNERSHIP_EMAIL_REPLY_TO:'business@starmovers.ca'}
 const prior=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env)
 let cached=0
 global.fetch=(async(input,init)=>{
  const u=new URL(String(input));const method=init?.method||'GET'
  if(u.hostname==='accounts.zohocloud.ca')return Response.json({access_token:'test'})
  if(u.hostname==='db.test'){
   if(method==='POST'&&u.pathname.endsWith('/email_provider_events')){cached++;return new Response(null,{status:201})}
   return Response.json([])
  }
  let data:unknown=[]
  if(u.pathname==='/api/accounts')data=[{accountId:'a',primaryEmailAddress:'business@starmovers.ca'}]
  if(u.pathname.endsWith('/messages/view'))data=[{messageId:'unrelated',folderId:'f',fromAddress:'newsletter@example.test',receivedTime:String(Date.now()-1000)}]
  if(u.pathname.endsWith('/header'))data={headerContent:'Message-ID: <unrelated@example.test>'}
  return Response.json({status:{code:200},data})
 }) as typeof fetch
 try{const result=await syncPartnershipZohoReplies();assert.equal(cached,1);assert.equal(result.imported,0)}
 finally{global.fetch=previousFetch;for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v}
})
