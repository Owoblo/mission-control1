import test from 'node:test'
import assert from 'node:assert/strict'
import {canReviewPayment,cleanProfile,readinessGaps,type ContractorCase} from '../../lib/contractor-workflow'
import {reviewedInvite} from '../../lib/server/contractor-workflow'
import {POST,GET} from '../../app/api/sales/operations/onboarding/route'
import {POST as uploadPayment} from '../../app/api/onboarding/[token]/payment/route'
import {createSessionToken} from '../../lib/auth'
const caseId='11111111-1111-4111-8111-111111111111'
const row:ContractorCase={id:caseId,subcontractor_id:null,display_name:'Fixture contractor',city:'Windsor / Essex',phone:'+14165550199',email:'',interest:'interested',source_group:'main',source_note:'Fixture source',hold_reason:'',stage:'interested',assignee_id:null,next_action:'Intro call',follow_up_at:null,profile:{legalBusinessName:'Fixture Company',contactName:'Fixture',dispatchName:'Dispatch',dispatchPhone:'+14165550199',serviceAreas:'Windsor',crewSize:'2',pricingModel:'Hourly',rateNotes:'Fixture rate',paymentTerms:'Agreed terms',truckAccess:['Own'],truckSizes:'26 ft',insuranceExpiry:'2099-01-01'},checklist:{fitConfirmed:true,briefingComplete:true,termsAgreed:true,shippingConfirmed:true},trial_notes:'',updated_at:'2026-11-09T00:00:00Z'}
test('readiness requires evidence, current insurance, payment verification and no hold',()=>{
 assert.deepEqual(readinessGaps(row,true,true),[])
 assert.ok(readinessGaps(row,false,false).includes('Complete document review'))
 assert.ok(readinessGaps(row,false,false).includes('Complete restricted payment verification'))
 assert.ok(readinessGaps({...row,hold_reason:'Do not contact'},true,true).includes('Resolve the outreach / identity hold'))
 assert.ok(readinessGaps({...row,profile:{...row.profile,insuranceExpiry:'2000-01-01'}},true,true).includes('Confirm current insurance expiry'))
})
test('labour-only contractors do not need a truck size',()=>{
 assert.deepEqual(readinessGaps({...row,profile:{...row.profile,truckAccess:['Labour only'],truckSizes:''}},true,true),[])
})
test('sensitive payment fields cannot enter the ordinary profile through structured inputs',()=>{
 const clean=cleanProfile({legalBusinessName:' Company ',accountNumber:'123',routingNumber:'456',bankDocument:'secret',shirtSizes:'2 large'})
 assert.equal(clean.legalBusinessName,'Company');assert.equal(clean.shirtSizes,'2 large');assert.equal(clean.accountNumber,undefined);assert.equal(clean.bankDocument,undefined)
 assert.equal(canReviewPayment({role:'sales_rep',exp:1}),false);assert.equal(canReviewPayment({role:'operations_lead',exp:1}),false);assert.equal(canReviewPayment({role:'manager',exp:1}),true)
})
test('received documents alone do not count as reviewed; every required kind needs reviewed evidence',()=>{
 const docs=['registration','insurance','identity','additional_insured'].map((kind,i)=>({kind,id:String(i)}))
 assert.equal(reviewedInvite({checklist:{onboardingDocuments:docs}}),false)
 assert.equal(reviewedInvite({checklist:{onboardingDocuments:docs,documentsReviewedAt:'today',reviewedDocumentIds:['0','1','2']}}),false)
 assert.equal(reviewedInvite({checklist:{onboardingDocuments:docs,documentsReviewedAt:'today',reviewedDocumentIds:['0','1','2','3']}}),true)
})
async function request(role:'sales_rep'|'manager'|'crew',body?:unknown){const token=await createSessionToken({role,userId:'rep1',name:'Fixture rep'});return new Request('https://crm.test/api/sales/operations/onboarding'+(!body?'?id='+caseId:''),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify({id:caseId,updatedAt:row.updated_at,...body as object})}:{})})}
async function fixture(run:(calls:{url:string;method:string;body:any}[])=>Promise<void>,override:Partial<ContractorCase>={}){
 const original=global.fetch,calls:{url:string;method:string;body:any}[]=[];Object.assign(process.env,{AUTH_SECRET:'workflow-fixture',SUPABASE_URL:'https://db.test',SUPABASE_KEY:'fixture'})
 global.fetch=async(input,init)=>{const url=String(input),method=init?.method||'GET';calls.push({url,method,body:init?.body?JSON.parse(String(init.body)):null});if(url.includes('/contractor_onboarding_cases'))return Response.json([{...row,...override}]);if(url.includes('/app_users'))return Response.json([{id:'rep1'}]);if(url.includes('/partner_onboarding_invites'))return Response.json([{id:'invite-fixture',stage:'verification',application:{legalBusinessName:'Fixture'},checklist:{}}]);if(url.includes('/contractor_payment_documents'))return Response.json([{id:'private-document',object_path:'banking/private-file.pdf',filename:'sensitive-payment.pdf',verified_at:null}]);throw Error('Unexpected request '+url)}
 try{await run(calls)}finally{global.fetch=original}
}
test('sales reps can claim and save onboarding without changing contractor activation or sending messages',async()=>fixture(async calls=>{
 assert.equal((await POST(await request('sales_rep',{action:'claim'}))).status,200)
 assert.equal((await POST(await request('sales_rep',{action:'save',stage:'screening',phone:row.phone,profile:row.profile,checklist:row.checklist,interest:'interested',assigneeId:'rep1',nextAction:'Call',followUpAt:'2026-11-10'}))).status,200)
 assert.ok(calls.every(c=>!c.url.includes('/subcontractors?')&&!c.url.includes('Messages.json')))
}))
test('crew cannot access cases and reps cannot read payment files or clear holds',async()=>fixture(async calls=>{
 assert.equal((await GET(await request('crew'))).status,403)
 assert.equal((await POST(await request('sales_rep',{action:'payment_document'}))).status,403)
 assert.equal((await POST(await request('sales_rep',{action:'release_hold',reason:'Should not be allowed'}))).status,403)
 assert.ok(calls.every(c=>c.method==='GET'))
}))
test('holds block invitation creation and incomplete evidence blocks ready status',async()=>fixture(async calls=>{
 assert.equal((await POST(await request('sales_rep',{action:'invite'}))).status,409)
 assert.equal((await POST(await request('sales_rep',{action:'save',stage:'ready',phone:row.phone,profile:row.profile,checklist:row.checklist}))).status,409)
 assert.ok(calls.every(c=>c.method==='GET'))
},{hold_reason:'Explicit outreach hold'}))
test('stale saves are rejected before any mutation',async()=>fixture(async calls=>{
 assert.equal((await POST(await request('sales_rep',{action:'claim',updatedAt:'stale'}))).status,409)
 assert.ok(calls.every(c=>c.method==='GET'))
}))

test('ordinary case responses disclose payment status but never payment document metadata',async()=>fixture(async()=>{
 const result=await GET(await request('sales_rep'));assert.equal(result.status,200)
 const body=await result.json();assert.equal(body.paymentStatus,'received');assert.equal(body.canReviewPayment,false)
 const text=JSON.stringify(body);assert.equal(text.includes('banking/private-file'),false);assert.equal(text.includes('sensitive-payment'),false);assert.equal(text.includes('private-document'),false)
},{subcontractor_id:'22222222-2222-4222-8222-222222222222'}))

test('private payment upload accepts an empty 201 storage-write response without deleting the uploaded file',async()=>{
 const original=global.fetch,requests:{url:string;method:string}[]=[]
 Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_KEY:'fixture'})
 global.fetch=async(input,init)=>{const url=String(input),method=init?.method||'GET';requests.push({url,method});
  if(url.includes('/partner_onboarding_invites'))return Response.json([{id:caseId,stage:'application',expires_at:'2099-01-01T00:00:00Z'}])
  if(url.includes('/contractor_payment_documents')&&method==='GET')return Response.json([])
  if(url.includes('/storage/v1/object/contractor-payment/')&&method==='POST')return new Response(null,{status:200})
  if(url.includes('/contractor_payment_documents')&&method==='POST')return new Response(null,{status:201})
  throw new Error('Unexpected request '+url)
 }
 try{const form=new FormData();form.set('consent','true');form.set('file',new File(['%PDF-1.4 fixture'],'fixture.pdf',{type:'application/pdf'}))
  const response=await uploadPayment(new Request('https://crm.test/api/onboarding/'+caseId+'/payment',{method:'POST',body:form}),{params:Promise.resolve({token:caseId})})
  assert.equal(response.status,201);assert.equal((await response.json()).status,'received');assert.equal(requests.some(r=>r.method==='DELETE'),false)
 }finally{global.fetch=original}
})
