import{test}from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';import path from'node:path';
const require=createRequire(import.meta.url),createLoader=require('../helpers/load-typescript.cjs'),root=path.resolve('.');
const submission='Service: Moving enquiry | From: Tilbury | To: Redford | Date: 2026-11-30 | Customer notes: Normal living, kitchen and bedroom furniture along with boxes. Washer and freezer\nNo price, crew or booking was confirmed by this form.';
for(const [source,at,model]of [['website_form','2026-10-26T10:21:37Z',false],['twilio_sms','2026-10-26T03:30:00Z',false],['website_form','2026-10-25T03:30:00Z',true]])test(`actual inbound sales worker continues ${source} discovery at ${at} without coordinator handoff`,async()=>{
 const RealDate=globalThis.Date,originalFetch=globalThis.fetch,posts=[],threads=[],patches=[];let lead={id:'lead-fixture',name:'Starr',stage:'contacted',createdAt:'2026-10-26',phone:'+15195550199',moveDate:'2026-11-30',originCity:'Tilbury',destCity:'Redford',automationStatus:'active',inventory:[{id:'item',name:'Washer',qty:1,customerDescription:'Washer',included:true,cubicFeet:28,weightLbs:180}],qualificationState:{missingFields:['origin_address','destination_address'],moveDateKnown:true}};
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[at]))}static now(){return RealDate.parse(at)}};
 globalThis.fetch=async(input,init)=>{assert.equal(String(input),'https://api.openai.com/v1/chat/completions');const prompt=JSON.parse(init.body).messages[0].content;assert.match(prompt,/at any hour/);return Response.json({choices:[{message:{content:JSON.stringify({reply:'Our coordinator will respond tomorrow during office hours.',shouldHandoff:true,intent:'handoff',missingFields:['origin_address']})}}]})};
 try{
  const runtime={readEnv:key=>model&&key==='OPENAI_API_KEY'?'fixture':key.startsWith('TWILIO_')?'fixture':undefined,getAppBaseUrl:()=>'',getWorkerSharedSecret:()=>'fixture'};
  const load=createLoader(root,{
   '@/lib/server/runtime':runtime,'./runtime':runtime,
   '@/lib/server/sales-automation-repository':{claimAutomationJob:async j=>({...j,status:'running'}),getConversationThreadByIdentity:async()=>null,normalizeConversationContactValue:(_,v)=>v,saveConversationThread:async t=>{threads.push(t);return t},listSmsMessagesForContact:async()=>[],patchAutomationJob:async(id,p)=>{patches.push(p);return{id,...p}}},
   '@/lib/server/sales-repository':{getSalesLead:async()=>lead,getSalesLeadByContact:async()=>lead,getSalesLeadForUpdate:async()=>({lead,updatedAt:at}),getSalesQuote:async()=>null,getLatestSalesQuoteByLeadId:async()=>null,saveSalesLead:async l=>{lead=l;return l},saveFollowUpLog:async l=>l,listFollowUpLogs:async()=>[],listFollowUpLogsForLead:async()=>[],listSalesEmails:async()=>[]},
   '@/lib/server/sales-messaging':{sendSalesMessage:async input=>{posts.push(input);return{lead,result:{sid:'SMfixture'}}}},
   '@/lib/server/analytics':{logEvent:async()=>{}},'@/lib/server/sales-alerts':{createSalesSystemAlert:async()=>{throw Error('Normal discovery must not create a handoff alert')}},
  });
  const result=await load(path.join(root,'lib/server/sales-automation.ts')).processAutomationJob({id:'job',leadId:lead.id,kind:'lead_response',channel:'sms',status:'pending',dueAt:at,payload:{source,message:submission,receivedAt:at,contactValue:lead.phone}});
  assert.equal(result.status,'completed',JSON.stringify(result));assert.equal(posts.length,1,JSON.stringify(result));assert.match(posts[0].body,/exact pickup address/i);assert.doesNotMatch(posts[0].body,/coordinator|office hours|tomorrow|handing|passing/i);assert.equal(lead.automationStatus,'active');assert.equal(threads.at(-1).status,'open');assert.equal(patches.some(p=>p.status==='pending'),false);
 }finally{globalThis.Date=RealDate;globalThis.fetch=originalFetch}
});
