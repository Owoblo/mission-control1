import {getSessionUser} from '@/lib/server/session'
export const dynamic = 'force-dynamic'

/** Historical SES campaign entrypoint. New cold outreach belongs to the Google fleet. */
export async function POST(_request: Request) {
  const session = await getSessionUser()
  if (session?.role !== 'owner') return Response.json({error: 'Only the owner can release outreach'}, {status: 403})
  return Response.json({error: 'Cold outreach is held pending the Google fleet workflow. No email was sent.'}, {status: 409})
}
