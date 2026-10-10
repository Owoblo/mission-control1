import { destinationDb } from '@/lib/server/destination-db'
import { maybeCreateDestinationOpportunityLead } from '@/lib/server/sales-opportunities'
import type { CRMLead } from '@/lib/types'
import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { processDestinationRealtorJobs } from '@/lib/server/destination-realtor-research'
export const maxDuration = 120
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({error:'Unauthorized'},{status:401})
  try {
    const [source] = await destinationDb<CRMLead[]>('rpc/next_destination_source',{method:'POST',body:'{}'})
    if (source) await maybeCreateDestinationOpportunityLead(source,source,true)
    return NextResponse.json({ok:true,...await processDestinationRealtorJobs()})
  }
  catch(error) { return NextResponse.json({error:error instanceof Error?error.message:'Research failed'},{status:500}) }
}
