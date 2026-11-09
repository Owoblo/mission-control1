import {getSessionUser} from '@/lib/server/session'
import {emailStorage} from '@/lib/server/email-delivery'
import {readEnv} from '@/lib/server/runtime'
export const dynamic='force-dynamic'
export async function GET(){
 if((await getSessionUser())?.role!=='owner')return Response.json({error:'Owner access required'},{status:403})
 try{
  const [connections,health,jobs]=await Promise.all([
   emailStorage('google_mail_connections?select=email,status,campaign_enabled&order=email'),
   emailStorage('google_mail_health?select=email,ready,checked_at,sync_checked_at,reasons'),
   emailStorage('google_mail_jobs?select=id,state,scheduled_at,claimed_at,accepted_at,error&order=scheduled_at.desc&limit=100')])
  return Response.json({workerEnabled:readEnv('GOOGLE_MAIL_WORKER_ENABLED')==='true',dispatchEnabled:readEnv('GOOGLE_MAIL_DISPATCH_ENABLED')==='true',connections,health,jobs},{headers:{'Cache-Control':'no-store'}})
 }catch{return Response.json({error:'Google fleet storage unavailable or migration pending'},{status:503})}
}
