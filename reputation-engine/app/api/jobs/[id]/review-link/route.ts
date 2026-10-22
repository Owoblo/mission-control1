import { getSessionUser } from '@/lib/server/session'
import { getJob } from '@/lib/server/repository'
import { issueReviewCapability } from '@/lib/server/review-capability'
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user || !['owner','manager','sales_rep','operations_lead'].includes(user.role || '')) return Response.json({ error:'Forbidden' }, {status:403})
  const {id} = await props.params
  const job = await getJob(id)
  if (!job) return Response.json({error:'Not found'},{status:404})
  const url = new URL(`/review/${encodeURIComponent(id)}`, request.url)
  url.searchParams.set('token', issueReviewCapability(job))
  return Response.json({ url: url.toString() }, {headers:{'cache-control':'no-store'}})
}
