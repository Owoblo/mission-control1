import { operationsDb, operationsSession } from '@/lib/server/operations-phone'
import { operationsPhone, OPERATIONS_ROLES } from '@/lib/operations-phone'
import { canReviewPayment, cleanProfile, ONBOARDING_STAGES, CHECKLIST_FIELDS, readinessGaps } from '@/lib/contractor-workflow'
import { getContractorCase, caseInvite, paymentStatus, reviewedInvite } from '@/lib/server/contractor-workflow'
import { createOnboardingInvite, updateOnboardingInvite } from '@/lib/server/partner-pilot'
import { saveSubcontractor } from '@/lib/server/subcontractors'
import { getAppBaseUrl, requireSupabaseEnv } from '@/lib/server/runtime'
import { parseApplication } from '@/lib/contractor-onboarding'
export async function GET(request:Request) {
 const session=await operationsSession(request)
 if(!session)return Response.json({error:'Forbidden'},{status:403})
 try{
  const id=new URL(request.url).searchParams.get('id')
  if(id){const row=await getContractorCase(id);if(!row)return Response.json({error:'Not found'},{status:404});const invite=await caseInvite(row),payment=await paymentStatus(invite?.id)
   return Response.json({row,invite:invite?{id:invite.id,stage:invite.stage,application:invite.application,documentsReviewed:reviewedInvite(invite)}:null,paymentStatus:payment.status,canReviewPayment:canReviewPayment(session),gaps:readinessGaps(row,reviewedInvite(invite),payment.status==='verified')},{headers:{'Cache-Control':'no-store'}})
  }
  const [cases,staff,invites,payments]=await Promise.all([operationsDb('contractor_onboarding_cases?order=city.asc,display_name.asc&limit=1000'),operationsDb(`app_users?select=id,name,role&role=in.(${OPERATIONS_ROLES.join(',')})&order=name.asc`),operationsDb('partner_onboarding_invites?select=id,subcontractor_id,checklist,created_at&order=created_at.desc&limit=1000'),operationsDb('contractor_payment_documents?select=invite_id,verified_at,created_at&order=created_at.desc&limit=1000')])
  const enriched=cases.map((row:any)=>{const invite=invites.find((i:any)=>i.subcontractor_id===row.subcontractor_id),payment=invite?payments.find((p:any)=>p.invite_id===invite.id):null;return {...row,readyNow:['ready','approved'].includes(row.stage)&&readinessGaps(row,reviewedInvite(invite),!!payment?.verified_at).length===0}})
  return Response.json({cases:enriched,staff,userId:session.userId,canReviewPayment:canReviewPayment(session)},{headers:{'Cache-Control':'no-store'}})
 }catch{return Response.json({error:'Unable to load onboarding. Please retry.'},{status:503})}
}
export async function POST(request:Request) {
 const session=await operationsSession(request)
 if(!session)return Response.json({error:'Forbidden'},{status:403})
 try{
  const body=await request.json(),row=await getContractorCase(body.id)
  if(!row)return Response.json({error:'Not found'},{status:404})
  const currentInvite=await caseInvite(row)
  const responseError=(error:string,status=400)=>Response.json({error},{status})
  async function patch(values:Record<string,unknown>){
   const saved=await operationsDb(`contractor_onboarding_cases?id=eq.${row!.id}&updated_at=eq.${encodeURIComponent(body.updatedAt || '')}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...values,updated_by:session!.name || session!.userId,updated_at:new Date().toISOString()})})
   if(!saved.length)throw new Error('This record changed. Reload before saving.')
   return saved[0]
  }
  if(body.updatedAt!==row.updated_at)return responseError('This record changed. Reload before saving.',409)
  if(body.action==='release_hold'){
   if(!canReviewPayment(session))return responseError('A manager must review and release this hold.',403)
   const reason=String(body.reason||'').trim();if(reason.length<10)return responseError('Record why this hold can be released.')
   return Response.json({row:await patch({hold_reason:'',source_note:row.source_note+`\nHold released by ${session.name || session.userId}: ${reason}`})})
  }
  if(body.action==='claim'){
   if(!session.userId)return responseError('Sign in again to claim a contractor.',409)
   if(row.assignee_id&&row.assignee_id!==session.userId)return responseError('Already assigned. Use the owner field to reassign deliberately.',409)
   return Response.json({row:await patch({assignee_id:session.userId})})
  }
  if(body.action==='save'){
   if(!Object.hasOwn(ONBOARDING_STAGES,body.stage))return responseError('Choose a valid stage.')
   const phone=body.phone?operationsPhone(body.phone):'';if(body.phone&&!phone)return responseError('Enter a complete Canadian or US phone number.')
   const profile=cleanProfile(body.profile),checklist:Record<string,boolean>={}
   for(const key of Object.keys(CHECKLIST_FIELDS))checklist[key]=body.checklist?.[key]===true
   const assignee=body.assigneeId||null
   if(assignee){const staff=await operationsDb(`app_users?id=eq.${encodeURIComponent(assignee)}&role=in.(${OPERATIONS_ROLES.join(',')})&select=id&limit=1`);if(!staff.length)return responseError('Choose an authorized staff member.')}
   const due=body.followUpAt||null;if(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due))return responseError('Enter a follow-up date.')
   const next={...row,phone,profile,checklist,stage:body.stage}
   if(['ready','approved'].includes(body.stage)){
    const payment=await paymentStatus(currentInvite?.id),gaps=readinessGaps(next,reviewedInvite(currentInvite),payment.status==='verified')
    if(gaps.length)return responseError('Complete before marking ready: '+gaps.join('; '),409)
   }
   if(body.stage==='approved' && (!canReviewPayment(session)||!String(body.trialNotes||'').trim()))return responseError('A manager must record the first-job review before regular approval.',403)
   const interest=['interested','confirm','tentative','not_interested'].includes(body.interest)?body.interest:row.interest
   return Response.json({row:await patch({phone,email:String(body.email||'').trim().slice(0,200),profile,checklist,stage:body.stage,interest,assignee_id:assignee,next_action:String(body.nextAction||'').slice(0,2000),follow_up_at:due,trial_notes:String(body.trialNotes||'').slice(0,4000)})})
  }
  if(body.action==='invite'){
   if(row.hold_reason)return responseError('Resolve the recorded hold before creating or renewing an invitation.',409)
   if(row.interest==='not_interested'||row.stage==='paused')return responseError('This contractor is paused or not interested.',409)
   if(!row.phone||!row.profile.legalBusinessName||!row.profile.contactName)return responseError('Confirm and save the company name, contact name and phone first.')
   let contractorId=row.subcontractor_id
   if(!contractorId){
    const matches=await operationsDb(`subcontractors?phone=eq.${encodeURIComponent(row.phone)}&select=id&limit=2`)
    if(matches.length>1)return responseError('More than one contractor matches this phone. Ask a manager to resolve the identity.',409)
    if(matches[0])contractorId=matches[0].id
    else contractorId=(await saveSubcontractor({companyName:String(row.profile.legalBusinessName),contactName:String(row.profile.contactName),phone:row.phone,email:row.email,status:'paused',insured:false,notes:`Onboarding source: ${row.source_key || row.id}. ${row.source_note}`})).id
    await patch({subcontractor_id:contractorId})
   }
   const contractor=await operationsDb(`subcontractors?id=eq.${contractorId}&select=status&limit=1`)
   if(contractor[0]?.status==='blocked')return responseError('This contractor is blocked.',409)
   const existing=await caseInvite({...row,subcontractor_id:contractorId})
   if(existing?.stage==='declined')return responseError('This application is closed. A manager must review it before further onboarding.',409)
   let invite=existing
   if(invite)invite=await updateOnboardingInvite(invite.token,{expires_at:new Date(Date.now()+14*86400000).toISOString()})
   else {invite=await createOnboardingInvite({subcontractorId:contractorId!,phone:row.phone,email:row.email,createdBy:session.name});invite=await updateOnboardingInvite(invite.token,{application:parseApplication({...row.profile,phone:row.phone,email:row.email,homeMarket:row.profile.homeMarket||row.city})})}
   return Response.json({url:`${getAppBaseUrl(new URL(request.url).origin)}/onboard/${invite.token}`,message:'Link prepared. No message has been sent.'})
  }
  if(body.action==='payment_document'||body.action==='verify_payment'){
   if(!canReviewPayment(session))return responseError('Payment documents are restricted to owners and managers.',403)
   const payment=await paymentStatus(currentInvite?.id),document=payment.document
   if(!document)return responseError('No payment document has been received.',404)
   if(body.action==='verify_payment'){
    if(body.confirmed!==true || body.documentId!==document.id)return responseError('Open and explicitly verify the latest document first.',409)
    await operationsDb(`contractor_payment_documents?id=eq.${document.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({verified_at:new Date().toISOString(),verified_by:session.name||session.userId})})
    return Response.json({ok:true})
   }
   const {url,headers}=requireSupabaseEnv(),response=await fetch(`${url}/storage/v1/object/sign/contractor-payment/${document.object_path}`,{method:'POST',headers,body:JSON.stringify({expiresIn:60})})
   if(!response.ok)throw new Error('Payment document unavailable')
   const signed=await response.json();return Response.json({url:`${url}/storage/v1${signed.signedURL}`,documentId:document.id},{headers:{'Cache-Control':'no-store'}})
  }
  return responseError('Unknown action.')
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Unable to save onboarding.'},{status:409})}
}
