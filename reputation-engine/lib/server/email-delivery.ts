import { createHash, createHmac, randomUUID } from 'node:crypto'
import { requireSupabaseEnv, readEnv, getAppBaseUrl } from './runtime'

export type EmailPurpose = 'outreach' | 'transactional' | 'internal'
export class EmailOutcomeUnknownError extends Error { readonly outcomeUnknown = true }
export class EmailPreflightError extends Error { readonly beforeSend = true }
export type EmailContext = { source?: string; contactId?: string; leadId?: string; quoteId?: string; campaignId?: string; variantId?: string; cohortId?: string; actorName?: string; policyActionKey?: string }
export async function emailStorage<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new EmailPreflightError(`Email storage unavailable (${response.status})`)
  return response.status === 204 ? undefined as T : response.json()
}
export function emailAddress(value: string) {
  value=String(value || '')
  if (/[\r\n]/.test(value)) throw new EmailPreflightError('Invalid email address')
  const address = (value.match(/<([^<>]+)>\s*$/)?.[1] || value).trim().toLowerCase()
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(address)) throw new EmailPreflightError('Invalid email address')
  return address
}
export const emailHash = (value: string) => createHash('sha256').update(value).digest('hex')
export function emailContext(context: EmailContext = {}) {
  return Object.fromEntries(['source','contactId','leadId','quoteId','campaignId','variantId','cohortId','actorName','policyActionKey']
    .filter(key => typeof context[key as keyof EmailContext] === 'string').map(key => [key, String(context[key as keyof EmailContext]).slice(0,240)]))
}
export async function reserveEmail(payload: { from: string; to: string | string[]; subject: string; html?: string; text?: string; replyTo?: string; attachments?: Array<{filename:string;content:string}>; headers?: Record<string,string>; tags?: Record<string,string>; purpose?: EmailPurpose; idempotencyKey?: string; context?: EmailContext }) {
  const from = emailAddress(payload.from), recipients = [...new Set((Array.isArray(payload.to) ? payload.to : [payload.to]).map(emailAddress))].sort()
  if (!recipients.length || recipients.length > 50 || /[\r\n]/.test(payload.subject)) throw new EmailPreflightError('Invalid email recipients or subject')
  const purpose = payload.purpose || 'transactional', key = payload.idempotencyKey || `email:${randomUUID()}`
  if (!key || key.length > 240) throw new EmailPreflightError('Invalid email request key')
  if (purpose === 'outreach' && (!payload.idempotencyKey || recipients.length !== 1 || !payload.context?.contactId || !payload.context?.policyActionKey)) throw new EmailPreflightError('Outreach requires a reviewed contact and a stable request key')
  const fingerprint = emailHash(JSON.stringify({ from: payload.from, recipients, subject: payload.subject, html: payload.html || '', text: payload.text || '', replyTo: payload.replyTo || '',
    headers: payload.headers || {}, tags: payload.tags || {}, purpose, context: emailContext(payload.context), attachments: (payload.attachments || []).map(a => [a.filename,emailHash(a.content)]) }))
  let unsubscribeUrl: string | undefined
  if (purpose === 'outreach') {
    const secret = readEnv('AUTH_SECRET'); if (!secret) throw new EmailPreflightError('Outreach unsubscribe signing is unavailable')
    const token = createHmac('sha256',secret).update(`${key}:${recipients[0]}`).digest('hex')
    if(new URL(getAppBaseUrl('https://go.quote2move.com')).protocol!=='https:')throw new EmailPreflightError('Outreach unsubscribe requires HTTPS')
    unsubscribeUrl = `${getAppBaseUrl('https://go.quote2move.com')}/api/marketing/email-unsubscribe?token=${token}`
    const profile = await emailStorage<Array<{from_name:string;reply_to_email:string}>>(`email_sender_accounts?provider=eq.ses&from_email=eq.${encodeURIComponent(from)}&select=from_name,reply_to_email&limit=2`)
    if (profile.length !== 1 || emailAddress(profile[0].reply_to_email || '') !== emailAddress(payload.replyTo || '')) throw new EmailPreflightError('Outreach reply address must match the registered sender')
  }
  const result = await emailStorage<{allowed:boolean;accepted?:boolean;messageId?:string;attemptId:string;reason?:string}>('rpc/reserve_crm_email', {
    p_key:key,p_fingerprint:fingerprint,p_payload:{from,domain:from.split('@')[1],recipients,subject:payload.subject,purpose,replyTo:payload.replyTo ? emailAddress(payload.replyTo) : null,
      context:emailContext(payload.context),unsubscribeHash:unsubscribeUrl ? emailHash(new URL(unsubscribeUrl).searchParams.get('token')!) : null} })
  if (!result.allowed && !result.accepted) throw new EmailOutcomeUnknownError('Email has an unresolved send attempt. Reconcile the provider result before retrying.')
  return {...result,recipients,from,purpose,unsubscribeUrl}
}
export async function beginEmailAttempt(id: string,transportFingerprint:string) {
  if (!await emailStorage<boolean>('rpc/start_crm_email',{p_attempt:id,p_content_hash:transportFingerprint})) throw new EmailOutcomeUnknownError('This email attempt has already been claimed. Check its receipt before retrying.')
}
export async function finishEmailAttempt(id:string,state:'accepted'|'rejected'|'unknown',messageId?:string,errorCode?:string) {
  return emailStorage<void>('rpc/finish_crm_email',{p_attempt:id,p_state:state,p_message:messageId||null,p_error:errorCode||null})
}
export async function addOutreachFooter<T extends { html?:string; text?:string; headers?:Record<string,string>; replyTo?:string }>(payload:T,domain:string,unsubscribeUrl:string) {
  const [row] = await emailStorage<Array<{postal_address:string}>>(`crm_email_domains?domain=eq.${encodeURIComponent(domain)}&select=postal_address&limit=1`)
  if (!row?.postal_address) throw new EmailPreflightError('Record the business postal address before outreach')
  const footer=`Saturn Star Movers · ${row.postal_address}\nContact: ${payload.replyTo || 'business@starmovers.ca'}\nStop outreach emails: ${unsubscribeUrl}`
  const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
  return {...payload,text:payload.text ? `${payload.text}\n\n${footer}` : undefined,
    html:payload.html ? `${payload.html}<p style="font:12px Arial;color:#64748b">Saturn Star Movers · ${escape(row.postal_address)}<br>${escape(payload.replyTo || 'business@starmovers.ca')}<br><a href="${escape(unsubscribeUrl)}">Unsubscribe from outreach</a></p>` : undefined,
    headers:{...payload.headers,'List-Unsubscribe':`<${unsubscribeUrl}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'} }
}
