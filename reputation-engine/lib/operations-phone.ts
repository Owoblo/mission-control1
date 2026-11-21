import type { SessionPayload } from './auth'

export const OPERATIONS_NUMBER = '+12267746581'
export const OPERATIONS_IDENTITY_PREFIX = 'saturn-ops-rep-'
export const OPERATIONS_ROLES = ['owner', 'manager', 'sales_rep', 'operations_lead']
export function canUseOperationsPhone(session?: SessionPayload | null) {
  return !!session && OPERATIONS_ROLES.includes(session.role || '')
}
export function operationsPhone(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return ''
}
export function isOperationsVoice(form: URLSearchParams) {
  const from = form.get('From') || ''
  return from.startsWith(`client:${OPERATIONS_IDENTITY_PREFIX}`) ||
    from.startsWith('sip:opsmanager@saturn-ops.sip.twilio.com') ||
    (!from.startsWith('client:') && !from.startsWith('sip:') && operationsPhone(form.get('To')) === OPERATIONS_NUMBER)
}
export type OperationsContact = { phone: string; name: string; company: string; type: 'subcontractor' | 'vendor'; notes?: string }
export type OperationsEvent = { id: string; phone: string; kind: 'call' | 'sms' | 'note'; direction: 'inbound' | 'outbound' | 'internal'; created_at: string; payload: { body?: string; status?: string; duration?: number; recordingSid?: string; objectKey?: string; transcript?: string; transcriptionStatus?: string; repName?: string; mediaUrls?: string[]; voicemail?: boolean; [key: string]: unknown } }

export function isOperationsCallAddress(value?: string | null) {
  return operationsPhone(value) === OPERATIONS_NUMBER || String(value || '').startsWith(`client:${OPERATIONS_IDENTITY_PREFIX}`) || String(value || '').includes('@saturn-ops.sip.twilio.com')
}
export function excludeOperationsCalls<T extends {sid:string;from:string;to:string;parent_call_sid?:string|null}>(calls:T[]) {
  const excluded = new Set(calls.filter(c=>isOperationsCallAddress(c.from)||isOperationsCallAddress(c.to)).map(c=>c.sid))
  let changed = true
  while(changed) { changed=false; for(const call of calls) if(call.parent_call_sid && excluded.has(call.parent_call_sid) && !excluded.has(call.sid)){excluded.add(call.sid);changed=true} }
  return calls.filter(c=>!excluded.has(c.sid))
}
