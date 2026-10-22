import {getTwilioCredentials,requireSupabaseEnv} from './runtime'
function identity(callSid:string) {
 if(!/^CA[0-9a-f]{32}$/i.test(callSid))throw new Error('Valid callback CallSid required')
 const {accountSid}=getTwilioCredentials()
 return {accountSid,key:`twilio:${accountSid}:${callSid}:missed_call_reply`}
}
export async function reserveMissedCallReply(callSid:string) {
 const {accountSid,key}=identity(callSid);const {url,headers}=requireSupabaseEnv()
 const response=await fetch(`${url}/rest/v1/crm_callback_action_reservations?on_conflict=action_key`,{
  method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates,return=representation'},
  body:JSON.stringify({action_key:key,provider_account:accountSid,provider_call_id:callSid,action_type:'missed_call_reply'}),
 })
 if(!response.ok)throw new Error('Callback reservation unavailable; reply was not authorized')
 return (await response.json() as unknown[]).length>0
}
export async function recordMissedCallReply(callSid:string,state:'handed_off'|'unknown') {
 const {key}=identity(callSid);const {url,headers}=requireSupabaseEnv()
 const response=await fetch(`${url}/rest/v1/crm_callback_action_reservations?action_key=eq.${encodeURIComponent(key)}`,{
  method:'PATCH',headers,body:JSON.stringify({state,updated_at:new Date().toISOString()}),
 })
 if(!response.ok)console.error('Missed-call reply reservation outcome could not be recorded')
}
