import { requireSupabaseEnv } from './runtime'
export async function withProviderWebhookReceipt(
 identity:{account:string;live:boolean;id:string;type:string;objectId:string},
 process:()=>Promise<Response>,
) {
 const {url,headers}=requireSupabaseEnv();const mode=identity.live?'live':'test'
 const claim=await fetch(`${url}/rest/v1/rpc/claim_provider_webhook`,{method:'POST',headers,
  body:JSON.stringify({p_account:identity.account,p_mode:mode,p_event_id:identity.id,p_event_type:identity.type,p_object_id:identity.objectId})})
 if(!claim.ok)return new Response('Webhook receipt storage unavailable',{status:503})
 const result=await claim.json() as {claimed:boolean;complete?:boolean;lease?:string}
 if(!result.claimed)return result.complete?Response.json({received:true,duplicate:true}):new Response('Webhook processing in progress; retry later',{status:503})
 let response:Response
 try {response=await process()} catch {response=new Response('Webhook processing failed',{status:500})}
 const saved=await fetch(`${url}/rest/v1/crm_provider_webhook_receipts?provider_account=eq.${encodeURIComponent(identity.account)}&provider_mode=eq.${mode}&event_id=eq.${encodeURIComponent(identity.id)}&lease_token=eq.${encodeURIComponent(result.lease||'')}`,{
  method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify({state:response.ok?'complete':'retry',completed_at:response.ok?new Date().toISOString():null}),
 })
 if(!saved.ok || !(await saved.json() as unknown[]).length)return new Response('Webhook processing receipt not committed',{status:503})
 return response
}
