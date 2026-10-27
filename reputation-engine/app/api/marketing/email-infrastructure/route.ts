import {getSessionUser} from '@/lib/server/session'
import {getEmailInfrastructure,refreshEmailInfrastructure,registerOutreachSender,updateOutreachSender,setOutreachPostalAddress,setOutreachDomainState} from '@/lib/server/email-infrastructure'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET(){if((await getSessionUser())?.role!=='owner')return Response.json({error:'Forbidden'},{status:403});try{return Response.json(await getEmailInfrastructure(),{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'Email readiness data is unavailable'},{status:503})}}
export async function POST(request:Request){
 if((await getSessionUser())?.role!=='owner')return Response.json({error:'Forbidden'},{status:403})
 const input=await request.json().catch(()=>({}))
 try{
  const result=input.action==='refresh'?await refreshEmailInfrastructure():input.action==='register'?await registerOutreachSender(input):input.action==='update'?await updateOutreachSender(input):input.action==='postal_address'?await setOutreachPostalAddress(input):input.action==='domain_state'?await setOutreachDomainState(input):null
  return result?Response.json(result,{headers:{'Cache-Control':'no-store'}}):Response.json({error:'Choose a valid action'},{status:400})
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Email readiness check failed'},{status:400})}
}
