import { randomUUID } from 'node:crypto'
import { getOnboardingInvite } from '@/lib/server/partner-pilot'
import { detectDocumentType } from '@/lib/contractor-onboarding'
import { operationsDb } from '@/lib/server/operations-phone'
import { paymentStatus } from '@/lib/server/contractor-workflow'
import { requireSupabaseEnv } from '@/lib/server/runtime'
async function valid(token:string){const invite=await getOnboardingInvite(token);return invite&&invite.stage!=='declined'&&invite.expires_at&&Date.parse(invite.expires_at)>Date.now()?invite:null}
export async function GET(_:Request,{params}:{params:Promise<{token:string}>}) {
 const invite=await valid((await params).token)
 if(!invite)return Response.json({error:'This link has expired or closed.'},{status:404})
 const result=await paymentStatus(invite.id)
 return Response.json({status:result.status},{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})
}
export async function POST(request:Request,{params}:{params:Promise<{token:string}>}) {
 try{
  const invite=await valid((await params).token)
  if(!invite)return Response.json({error:'This link has expired or closed.'},{status:404})
  if(Number(request.headers.get('content-length'))>4.3*1024*1024)return Response.json({error:'Choose a file under 4 MB.'},{status:413})
  const current=await operationsDb(`contractor_payment_documents?invite_id=eq.${invite.id}&select=id&limit=5`)
  if(current.length>=5)return Response.json({error:'Please contact Saturn to replace your payment document.'},{status:409})
  const form=await request.formData(),file=form.get('file')
  if(!(file instanceof File)||!file.size||file.size>4*1024*1024||form.get('consent')!=='true')return Response.json({error:'Confirm authorization and choose a PDF, JPG or PNG under 4 MB.'},{status:400})
  const bytes=new Uint8Array(await file.arrayBuffer()),format=detectDocumentType(bytes)
  if(!format)return Response.json({error:'Choose a PDF, JPG or PNG.'},{status:400})
  const {url,headers}=requireSupabaseEnv(),path=`${invite.id}/${randomUUID()}.${format.extension}`
  const uploaded=await fetch(`${url}/storage/v1/object/contractor-payment/${path}`,{method:'POST',headers:{...headers,'Content-Type':format.type,'x-upsert':'false'},body:bytes})
  if(!uploaded.ok)throw new Error('Upload unavailable')
  try{await operationsDb('contractor_payment_documents',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({invite_id:invite.id,object_path:path,filename:file.name.slice(0,180)})})}
  catch(error){await fetch(`${url}/storage/v1/object/contractor-payment`,{method:'DELETE',headers,body:JSON.stringify({prefixes:[path]})}).catch(()=>null);throw error}
  return Response.json({status:'received'},{status:201,headers:{'Cache-Control':'no-store'}})
 }catch{return Response.json({error:'Payment upload could not be completed. Please retry.'},{status:503})}
}
