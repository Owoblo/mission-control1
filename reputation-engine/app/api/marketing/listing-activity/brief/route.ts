import {NextResponse} from 'next/server';
import {getSessionUser} from '@/lib/server/session';
import {handoffDb,handoffContact,handoffHistory} from '@/lib/server/partner-sales-handoff';
import {partnershipRecordMatchesSession} from '@/lib/server/partnership-access';
import {loadPartnerContext} from '@/lib/server/partner-context';
import {listingEvent,planPartnerEvents} from '@/lib/partner-event-plan';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const session=await getSessionUser();if(!session)return NextResponse.json({error:'Unauthorized'},{status:401});
 const id=new URL(request.url).searchParams.get('contact');if(!id||!/^[a-f0-9-]{36}$/i.test(id))return NextResponse.json({error:'Contact required'},{status:400});
 try{const c=await handoffContact(id);if(!c||!partnershipRecordMatchesSession(session,c))return NextResponse.json({error:'Contact unavailable'},{status:403});
 const [context,touches,events,tasks]=await Promise.all([loadPartnerContext(session,id),handoffHistory(id),handoffDb<Record<string,any>[]>('partner_listing_activity',{contact_id:'eq.'+id,order:'observed_at.desc,activity_key.asc',limit:'1000'}),handoffDb<Record<string,any>[]>('crm_tasks',{related_id:'eq.'+id,status:'in.(open,in_progress)',limit:'1000'})]);
 if(events.length===1000||tasks.length===1000)return NextResponse.json({error:'History exceeds the review limit; narrow the source before planning.'},{status:409});
 return NextResponse.json(planPartnerEvents({contact:c,context,touches,tasks,events:events.map(listingEvent)}));
 }catch{return NextResponse.json({error:'Could not load complete event context. No outreach prepared.'},{status:503})}
}
