import { requireSupabaseEnv, getTwilioCredentials } from './runtime'
import { getRequestSessionUser } from './request-session'
import { canUseOperationsPhone, OPERATIONS_IDENTITY_PREFIX, OPERATIONS_ROLES, type OperationsEvent } from '../operations-phone'

export async function operationsSession(request: Request) {
  const session = await getRequestSessionUser(request)
  return canUseOperationsPhone(session) ? session : null
}
export async function operationsDb(path: string, init?: RequestInit) {
  const {url,headers} = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: {...headers,...init?.headers}, cache:'no-store', signal:AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`Operations storage unavailable (${response.status})`)
  const body = await response.text()
  return body ? JSON.parse(body) : null
}
export async function saveOperationsEvent(id: string, phone: string, kind: OperationsEvent['kind'], direction: OperationsEvent['direction'], payload: OperationsEvent['payload']) {
  await operationsDb('rpc/save_operations_phone_event',{method:'POST',body:JSON.stringify({p_id:id,p_phone:phone,p_kind:kind,p_direction:direction,p_payload:payload})})
}
export async function operationsUser(identity: string) {
  if (!identity.startsWith(OPERATIONS_IDENTITY_PREFIX)) return null
  const id = identity.slice(OPERATIONS_IDENTITY_PREFIX.length)
  const rows = await operationsDb(`app_users?select=id,name,role&id=eq.${encodeURIComponent(id)}&limit=1`)
  return rows?.[0] && OPERATIONS_ROLES.includes(rows[0].role) ? rows[0] as {id:string;name:string;role:string} : null
}
export async function operationsTwilio(path: string) {
  const {accountSid,authToken} = getTwilioCredentials()
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/${path}`,{headers:{Authorization:`Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`},cache:'no-store',signal:AbortSignal.timeout(12000)})
  if (!response.ok) throw new Error(`Operations provider unavailable (${response.status})`)
  return response.json()
}
