import {isAuthorizedCronRequest} from '@/lib/server/cron-auth'
import {processGoogleMail} from '@/lib/server/google-mail-worker'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET(request:Request){
 if(!isAuthorizedCronRequest(request))return Response.json({error:'Unauthorized'},{status:401})
 try{return Response.json(await processGoogleMail())}catch{return Response.json({error:'Google mail processing requires attention'},{status:503})}
}
