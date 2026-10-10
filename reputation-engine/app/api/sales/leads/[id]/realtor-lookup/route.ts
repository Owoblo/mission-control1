import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace, leadMatchesSessionBranch, canEditLead } from '@/lib/server/sales-permissions'
import { getSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { researchDestinationRealtor, confirmDestinationRealtor } from '@/lib/server/destination-realtor-research'
export const maxDuration = 120
export async function POST(request: Request, props: { params: Promise<{id:string}> }) {
  try {
    const session=await getSessionUser()
    if (!canAccessSalesWorkspace(session)) return NextResponse.json({error:'Unauthorized'},{status:401})
    const {id}=await props.params
    const lead=await getSalesLead(id)
    if (!lead) return NextResponse.json({error:'Lead not found'},{status:404})
    if (!leadMatchesSessionBranch(lead,session) || !canEditLead(session,lead)) return NextResponse.json({error:'Forbidden'},{status:403})
    const body=await request.json().catch(()=>({}))
    const result=body.action==='confirm'
      ? await confirmDestinationRealtor(id,body.index,body.checkedAt)
      : await researchDestinationRealtor(id)
    return NextResponse.json({ok:true,lead:result})
  } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:'Research failed'},{status:400}) }
}
