import {isAuthorizedCronRequest} from '@/lib/server/cron-auth'
import {refreshEmailInfrastructure} from '@/lib/server/email-infrastructure'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET(request:Request){
 if(!isAuthorizedCronRequest(request))return Response.json({error:'Unauthorized'},{status:401})
 try{await refreshEmailInfrastructure();return Response.json({ok:true})}catch{return Response.json({error:'Email readiness check failed'},{status:503})}
}
