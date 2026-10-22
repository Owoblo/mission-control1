import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canSeeAllPartnershipMarkets } from '@/lib/server/partnership-access'
import { getPartnershipDeliveryHealth } from '@/lib/server/partnership-delivery-health'
export const dynamic='force-dynamic'
export const maxDuration=120
export async function GET(){
 if(!canSeeAllPartnershipMarkets(await getSessionUser()))return NextResponse.json({error:'Forbidden'},{status:403})
 try{return NextResponse.json(await getPartnershipDeliveryHealth())}catch(error){console.error('Delivery health unavailable',error);return NextResponse.json({error:'Delivery health unavailable'},{status:500})}
}
