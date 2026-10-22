import { createHash } from 'node:crypto'
import { requireSupabaseEnv } from './runtime'
import { fetchStripeCardSummary, stripeGet, stripePost } from './stripe-payments'
import { buildPaymentRecord } from '../payment-records'
import { normalizeLead, normalizeQuote } from '../sales'
import type { CRMLead, CRMQuote } from '../types'

type Operation = { id:string; state:string; provider_intent_id?:string; amount_minor:number; currency:string; quote_id:string; lead_id:string }
type Intent = { id?:string; status?:string; amount?:number; amount_received?:number; currency?:string; livemode?:boolean; metadata?:Record<string,string>; error?:{message?:string;payment_intent?:{id?:string}} }
async function storage<T>(path:string, init?:RequestInit):Promise<T> {
  const {url,headers}=requireSupabaseEnv()
  const response=await fetch(`${url}/rest/v1/${path}`,{...init,headers:{...headers,...init?.headers},cache:'no-store'})
  if(!response.ok) throw new Error('Payment storage unavailable or command conflicted. No new charge should be attempted; inspect the payment operation.')
  return response.json()
}
export function paymentRequestHash(input:{quoteId:string;leadId:string;kind:string;amountMinor:number;paymentMethodId:string;customerId:string;account:string;mode:string}) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}
export function assertSuccessfulIntent(pi:Intent, operation:Operation, live:boolean) {
  if(!pi.id || pi.status!=='succeeded' || pi.amount!==operation.amount_minor || pi.amount_received!==operation.amount_minor || pi.currency!==operation.currency || pi.livemode!==live || pi.metadata?.ssmOperationId!==operation.id || pi.metadata?.quoteId!==operation.quote_id || pi.metadata?.leadId!==operation.lead_id) throw new Error('Payment outcome requires reconciliation; do not charge again.')
}
export async function executeDirectPayment(input:{operationKey:string;kind:'deposit'|'balance';quote:CRMQuote;lead:CRMLead;amount:number;account:'saturn'|'dexa';stripeKey:string;params:URLSearchParams;actorName?:string;actorId?:string}) {
  const {quote,lead}=input
  if(!/^[a-zA-Z0-9_-]{16,128}$/.test(input.operationKey)) throw new Error('A stable payment operation ID is required. Reload the payment screen.')
  const amountMinor=Math.round(input.amount*100)
  if(!Number.isSafeInteger(amountMinor)||amountMinor<=0)throw new Error('Invalid charge amount')
  const mode=/^(sk|rk)_test_/.test(input.stripeKey)?'test':'live'
  const hash=paymentRequestHash({quoteId:quote.id,leadId:lead.id,kind:input.kind,amountMinor,paymentMethodId:input.params.get('payment_method')||'',customerId:input.params.get('customer')||'',account:input.account,mode})
  const reservation=await storage<{created:boolean;operation:Operation}>('rpc/reserve_direct_payment',{method:'POST',body:JSON.stringify({
    p_operation_key:input.operationKey,p_account:input.account,p_mode:mode,p_hash:hash,p_quote_id:quote.id,p_lead_id:lead.id,
    p_kind:input.kind,p_amount_minor:amountMinor,p_expected_revision:quote.revision||0,p_actor_id:input.actorId||null,
  })})
  let op=reservation.operation
  async function patch(values:Record<string,unknown>) {
    const rows=await storage<Operation[]>(`crm_payment_operations?id=eq.${op.id}&state=neq.complete`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...values,updated_at:new Date().toISOString()})})
    if(rows[0]) op=rows[0]
  }
  let pi:Intent = {}
  if(reservation.created) {
    input.params.set('metadata[ssmOperationId]',op.id)
    try {
      pi=await stripePost<Intent>('payment_intents',input.stripeKey,input.params,`ssm-direct-${op.id}`)
      assertSuccessfulIntent(pi,op,mode==='live')
      await patch({state:'provider_succeeded',provider_intent_id:pi.id,provider_status:pi.status})
    } catch(error) {
      // Never classify a timeout/500/decline-shaped payload as permission for a new charge.
      await patch({state:'unknown', ...(pi.id || pi.error?.payment_intent?.id ? {provider_intent_id:pi.id || pi.error?.payment_intent?.id} : {})}).catch(()=>undefined)
      throw new Error('Payment outcome is unresolved. It must be reconciled before another charge; retrying will not submit a second payment.')
    }
  } else {
    if(op.state==='complete') {
      const saved=await storage<{quote:CRMQuote;lead:CRMLead;replayed:boolean}>('rpc/apply_direct_payment',{method:'POST',body:JSON.stringify({p_operation_id:op.id,p_record:{},p_card_brand:'',p_card_last4:''})})
      return {...saved,quote:normalizeQuote(saved.quote),lead:normalizeLead(saved.lead),pi:{id:op.provider_intent_id,status:'succeeded'},amount:op.amount_minor/100,cardBrand:quote.depositStripeCardBrand||'',cardLast4:quote.depositStripeCardLast4||'',paymentRecord:undefined,replayed:true}
    }
    if(!op.provider_intent_id) throw new Error('Payment outcome requires provider reconciliation. Do not start another payment.')
    pi=await stripeGet<Intent>(`payment_intents/${encodeURIComponent(op.provider_intent_id)}`,input.stripeKey)
    assertSuccessfulIntent(pi,op,mode==='live')
    await patch({state:'provider_succeeded',provider_status:pi.status})
  }
  const {cardBrand,cardLast4}=await fetchStripeCardSummary(input.stripeKey,input.params.get('payment_method')).catch(()=>({cardBrand:'',cardLast4:''}))
  const record=buildPaymentRecord({quote,amount:input.amount,kind:input.kind,method:'credit_card',reference:pi.id,cardLast4,recordedBy:input.actorName,recordedByUserId:input.actorId})
  const saved=await storage<{quote:CRMQuote;lead:CRMLead;replayed:boolean}>('rpc/apply_direct_payment',{method:'POST',body:JSON.stringify({p_operation_id:op.id,p_record:record,p_card_brand:cardBrand,p_card_last4:cardLast4})})
  const nextQuote=normalizeQuote(saved.quote)
  return {...saved,quote:nextQuote,lead:normalizeLead(saved.lead),pi,amount:op.amount_minor/100,cardBrand,cardLast4,paymentRecord:nextQuote.paymentRecords?.find(p=>p.reference===pi.id)}
}

// Read-only provider reconciliation. Never submits or confirms a new payment.
export async function reconcileDirectPayment(input:{operationId:string;quote:CRMQuote;lead:CRMLead;account:'saturn'|'dexa';stripeKey:string;actorId?:string;actorName?:string}) {
  const mode=/^(sk|rk)_test_/.test(input.stripeKey)?'test':'live'
  const rows=await storage<(Operation & {kind:'deposit'|'balance'})[]>(`crm_payment_operations?id=eq.${encodeURIComponent(input.operationId)}&quote_id=eq.${encodeURIComponent(input.quote.id)}&lead_id=eq.${encodeURIComponent(input.lead.id)}&provider_account=eq.${input.account}&provider_mode=eq.${mode}&select=*`)
  const op=rows[0]
  if(!op)throw new Error('Payment operation not found in this account')
  if(op.state==='complete') return {ok:true,state:'complete',quote:input.quote,lead:input.lead}
  let pi:Intent | undefined
  if(op.provider_intent_id) pi=await stripeGet<Intent>(`payment_intents/${encodeURIComponent(op.provider_intent_id)}`,input.stripeKey)
  else {
    const query=`metadata['ssmOperationId']:'${op.id}'`
    const result=await stripeGet<{data?:Intent[]}>(`payment_intents/search?query=${encodeURIComponent(query)}&limit=2`,input.stripeKey)
    if(result.data?.length===1)pi=result.data[0]
  }
  if(!pi?.id) return {ok:false,state:'unknown',message:'No conclusive provider result. The collection hold remains; do not charge again.'}
  // A canceled provider intent cannot later be captured. Other unsuccessful statuses remain held.
  if(pi.status==='canceled' && pi.metadata?.ssmOperationId===op.id && pi.metadata?.quoteId===op.quote_id && pi.metadata?.leadId===op.lead_id && pi.livemode===(mode==='live') && pi.amount===op.amount_minor && pi.currency===op.currency) {
    await storage(`crm_payment_operations?id=eq.${op.id}&state=in.(reserved,unknown)`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({state:'failed',provider_intent_id:pi.id,provider_status:'canceled',updated_at:new Date().toISOString()})})
    return {ok:false,state:'failed',message:'Provider intent is canceled. A new authorized collection requires a new operation ID.'}
  }
  assertSuccessfulIntent(pi,op,mode==='live')
  await storage(`crm_payment_operations?id=eq.${op.id}&state=neq.complete`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({state:'provider_succeeded',provider_intent_id:pi.id,provider_status:pi.status,updated_at:new Date().toISOString()})})
  const record=buildPaymentRecord({quote:input.quote,amount:op.amount_minor/100,kind:op.kind,method:'credit_card',reference:pi.id,recordedBy:input.actorName,recordedByUserId:input.actorId,note:'Provider reconciliation; no new collection submitted'})
  const saved=await storage<{quote:CRMQuote;lead:CRMLead}>('rpc/apply_direct_payment',{method:'POST',body:JSON.stringify({p_operation_id:op.id,p_record:record,p_card_brand:'',p_card_last4:''})})
  return {ok:true,state:'complete',quote:normalizeQuote(saved.quote),lead:normalizeLead(saved.lead)}
}
export async function listDirectPaymentOperations(quoteId:string,account:'saturn'|'dexa',stripeKey:string) {
  const mode=/^(sk|rk)_test_/.test(stripeKey)?'test':'live'
  return storage<Array<Operation & {created_at:string;kind:string}>>(`crm_payment_operations?quote_id=eq.${encodeURIComponent(quoteId)}&provider_account=eq.${account}&provider_mode=eq.${mode}&select=id,state,kind,amount_minor,currency,provider_intent_id,created_at&order=created_at.desc&limit=25`)
}

// A signed success callback can rescue a lost HTTP response. Record the provider
// fact only; the original request or explicit reconciliation applies CRM state.
export async function recordDirectPaymentProviderFact(pi:Intent, account:'saturn'|'dexa', live:boolean) {
  const id=pi.metadata?.ssmOperationId
  if(!id || !/^[0-9a-f-]{36}$/i.test(id))throw new Error('Invalid payment operation reference')
  const rows=await storage<Operation[]>(`crm_payment_operations?id=eq.${id}&provider_account=eq.${account}&provider_mode=eq.${live?'live':'test'}&select=*`)
  const op=rows[0]
  if(!op)throw new Error('Payment operation not found')
  assertSuccessfulIntent(pi,op,live)
  if(op.provider_intent_id && op.provider_intent_id!==pi.id)throw new Error('Conflicting provider intent')
  if(op.state==='complete')return
  await storage(`crm_payment_operations?id=eq.${id}&state=neq.complete`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({state:'provider_succeeded',provider_intent_id:pi.id,provider_status:pi.status,updated_at:new Date().toISOString()})})
}
