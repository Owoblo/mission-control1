import {getSessionUser} from '@/lib/server/session'
import {readEnv} from '@/lib/server/runtime'
import {enqueueReviewedGoogleMail} from '@/lib/server/google-mail-queue'
export const dynamic='force-dynamic'
export async function POST(request:Request){
 if((await getSessionUser())?.role!=='owner')return Response.json({error:'Owner access required'},{status:403})
 const origin=readEnv('GOOGLE_MAIL_ORIGIN')
 if(!origin||request.headers.get('origin')!==origin)return Response.json({error:'Invalid origin'},{status:403})
 try{
  const input=await request.json()
  const queued=await enqueueReviewedGoogleMail(input.payload,input.scheduledAt)
  return Response.json({...queued,activationChanged:false,message:'Queued for worker preflight; this does not enable campaign delivery.'},{status:201})
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Google queue admission failed'},{status:409})}
}
