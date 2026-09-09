import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { canSeeAllPartnershipMarkets } from '@/lib/server/partnership-access'
export async function GET() {
 const session=await getSessionUser()
 if(!session||!canSeeAllPartnershipMarkets(session)) return NextResponse.json({error:'Owner or central manager access required'},{status:403})
 const {url,headers}=requireSupabaseEnv()
 const response=await fetch(`${url}/rest/v1/pipeline_assessments?select=run_id,lane,region,observed_at,report&order=observed_at.desc&limit=100`,{headers,cache:'no-store'})
 if(!response.ok) return NextResponse.json({error:'Assessments unavailable'},{status:502})
 return NextResponse.json(await response.json())
}
