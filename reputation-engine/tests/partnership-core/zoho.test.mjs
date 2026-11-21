import test from 'node:test';import assert from 'node:assert/strict';
import {zohoProfile,zohoServiceOrigin,openZohoMailbox} from '../../lib/partnership-core/zoho.mjs';
test('Ottawa never falls back to Saturn credentials',async()=>{
 const env={ZOHO_PARTNERSHIP_CLIENT_ID:'saturn',ZOHO_PARTNERSHIP_CLIENT_SECRET:'secret',ZOHO_PARTNERSHIP_REFRESH_TOKEN:'refresh'};
 assert.equal(zohoProfile('ottawa',env).clientId,'');
 await assert.rejects(openZohoMailbox('ottawa',()=>{throw Error('must not call')},env),/not connected/);
});
test('Zoho origins reject credential capture destinations',()=>{
 for(const url of ['http://mail.zohocloud.ca','https://mail.zohocloud.ca.evil.test','https://user:pw@mail.zohocloud.ca','https://mail.zohocloud.ca/path'])assert.throws(()=>zohoServiceOrigin(url,'mail'));
});
test('wrong authenticated mailbox cannot send as Dexa',async()=>{
 const env={ZOHO_OTTAWA_CLIENT_ID:'dexa',ZOHO_OTTAWA_CLIENT_SECRET:'secret',ZOHO_OTTAWA_REFRESH_TOKEN:'refresh'};let n=0;
 const fetcher=async()=>new Response(JSON.stringify(n++===0?{access_token:'test'}:{status:{code:200},data:[{accountId:'other',primaryEmailAddress:'business@starmovers.ca'}]}));
 await assert.rejects(openZohoMailbox('ottawa',fetcher,env),/missing or blocked/);
});
const env={ZOHO_PARTNERSHIP_CLIENT_ID:'saturn',ZOHO_PARTNERSHIP_CLIENT_SECRET:'secret',ZOHO_PARTNERSHIP_REFRESH_TOKEN:'refresh'};
function fixture(){
 const state={tokens:0,mail:0,failAuth:false,unauthorized:false};
 const fetcher=async(url)=>{
  if(url.includes('/oauth/')){state.tokens++;return new Response(JSON.stringify(state.failAuth?{error:'Access Denied',error_description:'You have made too many requests continuously.'}:{access_token:'test-'+state.tokens,expires_in:3600}),{status:state.failAuth?400:200});}
  state.mail++;if(state.unauthorized)return new Response(JSON.stringify({status:{code:401}}),{status:401});
  return new Response(JSON.stringify({status:{code:200},data:url.endsWith('/accounts')?[{accountId:'saturn',primaryEmailAddress:'business@starmovers.ca'}]:[]}));
 };return {state,fetcher};
}
test('concurrent and sequential readiness checks share one access token but verify mailbox each time',async()=>{
 const {state,fetcher}=fixture();
 await Promise.all(Array.from({length:6},()=>openZohoMailbox('saturn',fetcher,env)));
 await openZohoMailbox('saturn',fetcher,env);
 assert.equal(state.tokens,1);assert.equal(state.mail,14);
});
test('credential changes and service origins never share cached tokens',async()=>{
 const {state,fetcher}=fixture();
 await openZohoMailbox('saturn',fetcher,env);
 await openZohoMailbox('saturn',fetcher,{...env,ZOHO_PARTNERSHIP_REFRESH_TOKEN:'new-refresh'});
 await openZohoMailbox('saturn',fetcher,{...env,ZOHO_PARTNERSHIP_MAIL_URL:'https://mail.zoho.com'});
 assert.equal(state.tokens,3);
});
test('expired tokens refresh before another mailbox check',async()=>{
 const {state,fetcher}=fixture(),realNow=Date.now;let now=realNow();Date.now=()=>now;
 try{await openZohoMailbox('saturn',fetcher,env);now+=3540001;await openZohoMailbox('saturn',fetcher,env);assert.equal(state.tokens,2)}finally{Date.now=realNow}
});
test('throttled authentication has local cooldown and does not cache failed credentials as success',async()=>{
 const {state,fetcher}=fixture(),realNow=Date.now;let now=realNow();Date.now=()=>now;state.failAuth=true;
 try{
  await assert.rejects(openZohoMailbox('saturn',fetcher,env),/throttled/);
  await assert.rejects(openZohoMailbox('saturn',fetcher,env),/throttled/);assert.equal(state.tokens,1);
  now+=60001;state.failAuth=false;await openZohoMailbox('saturn',fetcher,env);assert.equal(state.tokens,2);
 }finally{Date.now=realNow}
});
test('401 invalidates token without replaying a send',async()=>{
 const {state,fetcher}=fixture();const box=await openZohoMailbox('saturn',fetcher,env);
 state.unauthorized=true;const before=state.mail;
 await assert.rejects(box.request('/accounts/saturn/messages',{content:'test'}),/401/);
 assert.equal(state.mail,before+1);assert.equal(state.tokens,1);
 state.unauthorized=false;await openZohoMailbox('saturn',fetcher,env);assert.equal(state.tokens,2);
});
