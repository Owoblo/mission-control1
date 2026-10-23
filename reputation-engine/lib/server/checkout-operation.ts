import {createHash} from 'node:crypto'
import {requireSupabaseEnv} from './runtime'
import {stripeGet,stripePost} from './stripe-payments'
type CheckoutSession={id?:string;url?:string;status?:string;payment_status?:string;livemode?:boolean;metadata?:Record<string,string>;error?:{message?:string}}
export async function createReservedCheckout(input:{quoteId:string;leadId:string;revision:number;account:string;stripeKey:string;deposit:number;protectionChoice?:string;params:URLSearchParams}) {
 const {url,headers}=requireSupabaseEnv();const mode=/^(sk|rk)_test_/.test(input.stripeKey)?'test':'live'
 const hash=createHash('sha256').update(JSON.stringify([input.quoteId,input.leadId,input.account,mode,input.deposit,input.protectionChoice,input.params.get('line_items[1][price_data][unit_amount]')])).digest('hex')
 const response=await fetch(`${url}/rest/v1/rpc/reserve_checkout_collection`,{method:'POST',headers,body:JSON.stringify({p_quote_id:input.quoteId,p_lead_id:input.leadId,p_account:input.account,p_mode:mode,p_hash:hash,p_params:input.params.toString(),p_expected_revision:input.revision})})
 if(!response.ok)throw new Error('Checkout is unavailable or another collection is pending. Contact the team before making another payment.')
 const op=await response.json() as {id:string;state:string;created_at:string;session_id?:string;request_params:string}
 async function patch(values:Record<string,unknown>) {
  const r=await fetch(`${url}/rest/v1/crm_checkout_operations?id=eq.${op.id}&state=neq.completed`,{method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({...values,updated_at:new Date().toISOString()})})
  if(!r.ok || !(await r.json() as unknown[]).length)throw new Error('Checkout result needs reconciliation. Please contact the team.')
 }
 if(op.session_id) {
  const session=await stripeGet<CheckoutSession>(`checkout/sessions/${encodeURIComponent(op.session_id)}`,input.stripeKey)
  if(session.id!==op.session_id || session.livemode!==(mode==='live') || session.metadata?.ssmCheckoutOperationId!==op.id)throw new Error('Checkout account or identity mismatch')
  if(session.status==='expired') {await patch({state:'expired'});throw new Error('The previous checkout has expired. Refresh to create a new checkout.')}
  if(session.status==='complete' || session.payment_status==='paid')throw new Error('Payment is being reconciled. Do not pay again.')
  if(session.status!=='open' || !session.url)throw new Error('Checkout status is unresolved')
  return session
 }
 // Reuse the exact saved provider request/key only inside a bounded interval below
 // Stripe's retention window. Older unknown outcomes require human reconciliation.
 if(Date.now()-Date.parse(op.created_at)>60*60*1000)throw new Error('Checkout outcome is unresolved. Please contact the team.')
 const params=new URLSearchParams(op.request_params)
 params.set('metadata[ssmCheckoutOperationId]',op.id)
 params.set('payment_intent_data[metadata][ssmCheckoutOperationId]',op.id)
 const session=await stripePost<CheckoutSession>('checkout/sessions',input.stripeKey,params,`ssm-checkout-${op.id}`)
 if(!session.id || !session.url || session.livemode!==(mode==='live'))throw new Error('Checkout creation needs reconciliation. Please try again or contact the team.')
 await patch({state:'open',session_id:session.id,session_url:session.url})
 return session
}
export async function completeCheckoutReservation(operationId:string,sessionId:string,account:string,live:boolean) {
 const {url,headers}=requireSupabaseEnv()
 const response=await fetch(`${url}/rest/v1/crm_checkout_operations?id=eq.${encodeURIComponent(operationId)}&or=(session_id.is.null,session_id.eq.${encodeURIComponent(sessionId)})&provider_account=eq.${encodeURIComponent(account)}&provider_mode=eq.${live?'live':'test'}`,{
  method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({state:'completed',session_id:sessionId,updated_at:new Date().toISOString()}),
 })
 if(!response.ok || !(await response.json() as unknown[]).length)throw new Error('Checkout reservation was not reconciled')
}

// Stripe expiry is terminal. Refresh known sessions before a staff collection
// so an abandoned checkout cannot keep a quote locked after its actual expiry.
export async function refreshCheckoutReservations(quoteId: string, account: string, stripeKey: string) {
 const {url,headers}=requireSupabaseEnv();const mode=/^(sk|rk)_test_/.test(stripeKey)?'test':'live'
 const response=await fetch(`${url}/rest/v1/crm_checkout_operations?${new URLSearchParams({quote_id:`eq.${quoteId}`,provider_account:`eq.${account}`,provider_mode:`eq.${mode}`,state:'in.(reserved,open,unknown)',select:'id,session_id'})}`,{headers,cache:'no-store'})
 if(!response.ok)throw new Error('Could not verify pending customer checkout')
 const operations=await response.json() as Array<{id:string;session_id?:string}>
 for(const operation of operations){
  if(!operation.session_id)continue
  const session=await stripeGet<CheckoutSession>(`checkout/sessions/${encodeURIComponent(operation.session_id)}`,stripeKey)
  if(session.id!==operation.session_id||session.livemode!==(mode==='live')||session.metadata?.ssmCheckoutOperationId!==operation.id||session.metadata?.quoteId!==quoteId)throw new Error('Pending checkout needs account reconciliation')
  if(session.status==='expired'){
   const updated=await fetch(`${url}/rest/v1/crm_checkout_operations?id=eq.${operation.id}&state=in.(reserved,open,unknown)`,{method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({state:'expired',updated_at:new Date().toISOString()})})
   if(!updated.ok)throw new Error('Could not reconcile expired checkout')
  }
 }
}
