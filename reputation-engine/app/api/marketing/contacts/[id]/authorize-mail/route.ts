import {NextResponse} from 'next/server'
import {getSessionUser} from '@/lib/server/session'
import {partnershipRecordMatchesSession} from '@/lib/server/partnership-access'
import {requireSupabaseEnv} from '@/lib/server/runtime'
import {reserveAction} from '@/lib/partnership-core/reserve.mjs'
import {createHash} from 'node:crypto'
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const session=await getSessionUser();if(!session)return NextResponse.json({error:'Unauthorized'},{status:401})
 const {id}=await params;const {url,headers}=requireSupabaseEnv()
 const r=await fetch(`${url}/rest/v1/market_contacts?${new URLSearchParams({id:'eq.'+id,select:'id,city'})}`,{headers,cache:'no-store'})
 if(!r.ok)return NextResponse.json({error:'Contact lookup failed'},{status:503})
 const [contact]=await r.json();if(!contact)return NextResponse.json({error:'Not found'},{status:404})
 if(!partnershipRecordMatchesSession(session,contact))return NextResponse.json({error:'Forbidden'},{status:403})
 const body=await request.json() as {text?:string}
 if(!body.text?.trim()||body.text.length>50000)return NextResponse.json({error:'Letter text required'},{status:400})
 try{const result=await reserveAction({url,headers,contactId:id,channel:'direct_mail',kind:'reply',key:'letter:'+createHash('sha256').update(id+body.text).digest('hex'),content:body.text,sender:'manual-mail'});return NextResponse.json({ok:true,policy:result,instruction:'Approved for this letter. Record the actual mailing separately.'})}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Policy hold'},{status:409})}
}
