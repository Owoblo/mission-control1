import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, getSalesQuote } from '@/lib/server/sales-repository'
import { canHandleLeadPayments } from '@/lib/server/sales-permissions'
import { assertQuoteStripeAccount, requireStripeAccountForLead } from '@/lib/server/stripe-accounts'
import { listDirectPaymentOperations, reconcileDirectPayment } from '@/lib/server/direct-payment-operation'
async function context(request:Request) {
  const user=await getSessionUser()
  if(!user)throw new Error('Forbidden')
  const id=new URL(request.url).searchParams.get('quoteId')
  const quote=id?await getSalesQuote(id):null
  const lead=quote?.leadId?await getSalesLead(quote.leadId):null
  if(!quote||!lead||!canHandleLeadPayments(user,lead))throw new Error('Forbidden')
  const account=requireStripeAccountForLead(lead);assertQuoteStripeAccount(quote,account.key)
  return {user,quote,lead,account}
}
export async function GET(request:Request) {
  try {
    const {quote,account}=await context(request)
    return Response.json({operations:await listDirectPaymentOperations(quote.id,account.key,account.secretKey)},{headers:{'cache-control':'no-store'}})
  }catch{return Response.json({error:'Payment operations unavailable or access denied'},{status:403})}
}
export async function POST(request:Request) {
  try {
    const {user,quote,lead,account}=await context(request)
    const {operationId}=await request.json()
    if(typeof operationId!=='string'||!/^[0-9a-f-]{36}$/i.test(operationId))return Response.json({error:'Valid operation ID required'},{status:400})
    const result=await reconcileDirectPayment({operationId,quote,lead,account:account.key,stripeKey:account.secretKey,actorId:user.userId,actorName:user.name})
    return Response.json(result,{status:result.ok?200:409})
  }catch{return Response.json({error:'Reconciliation remains unresolved. Do not start another payment.'},{status:409})}
}
