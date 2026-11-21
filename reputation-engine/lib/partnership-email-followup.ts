import { createHash } from 'node:crypto'
import { providerEventInternetMessageIds, normalizeInternetMessageId } from './partnership-email-thread-match'

type Row = Record<string, any>
export const DAY3_FOLLOWUP_POLICY = Object.freeze({ version: 'pilot-day3/1', delayHours: 72, maximumFollowups: 1, timing: 'elapsed_hours', countsTowardUniqueDeliveredTarget: false })
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const stamp = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN
export const followupKey = (parentJobId: string) => 'pilot-day3:' + parentJobId
export function followupContentHash(p: Row) {
  return hash(['version','parentJobId','parentContentHash','parentProviderMessageId','contactId','accountId','recipient','sender','replyTo','city','market','subject','text','dueAt','internetMessageId','actionKey'].map(k => [k,p[k]]))
}

/** Published source copy stays attached to the same business; this never guesses a category. */
export function day3Copy(parent: Row) {
  const paragraphs = String(parent.text || '').split(/\n\s*\n/).filter(Boolean)
  const intro = paragraphs.findIndex(p => p.startsWith('I wanted to personally introduce'))
  const context = intro >= 0 ? paragraphs[intro + 1] : null
  if (!context || /Would it be okay|P\.S\./i.test(context) || /\{\{|\$\{/.test(context)) throw Error('Reviewed contextual paragraph missing')
  const name = parent.market === 'ottawa' ? 'Courage' : 'John'
  const brand = parent.market === 'ottawa' ? 'Dexa Movers' : 'Saturn Star Movers'
  return `I wanted to follow up on my introduction below.\n\n${context}\n\nWould it be useful if I sent over my digital card for you to keep on hand?\n\n${name}\n${brand}\n\nP.S. If you’d prefer I didn’t follow up, just reply “no thanks” and I’ll happily honour that.`
}

export type FollowupContext = {
  parent: Row; dispatch: Row; contact: Row; events: Row[]; touches: Row[]; jobs: Row[]
  complete: boolean; checkedAt: string; mailboxSync?: { complete: boolean; checkedAt: string }
}

/** Read-only planning. Every delivery/event match is bound to the original provider receipt. */
export function planDay3Followup(c: FollowupContext, now = Date.now()): {status:'held'|'scheduled'|'due';reasons:string[];dueAt:string|null;payload:Row|null} {
  const {parent,dispatch,contact} = c, p = parent?.email_payload
  const reasons: string[] = []
  if (!Number.isFinite(now)) reasons.push('invalid_clock')
  if (!c.complete) reasons.push('incomplete_context')
  if (parent?.template_key !== 'prepared_email_v1' || p?.version !== 'ssm-prepared-email/1' || !parent.id || !p.contentHash) reasons.push('initial_email_required')
  if (parent?.status !== 'sent' || dispatch?.state !== 'accepted' || dispatch?.job_id !== parent?.id || !dispatch.message_id || !Number.isFinite(stamp(dispatch.accepted_at))) reasons.push('accepted_parent_required')
  if (!p || contact?.id !== parent?.contact_id || contact?.id !== p.contactId || contact?.email !== p.recipient || contact?.partner_company_id !== p.accountId || contact?.city !== p.city) reasons.push('recipient_context_changed')
  if (contact?.do_not_contact || contact?.sequence_paused || contact?.cross_channel_suppressed_at || contact?.email_unsubscribed_at || contact?.email_last_bounced_at || ['bounced','complained','unsubscribed'].includes(contact?.email_status) || ['dnc','do_not_contact','closed_lost'].includes(contact?.stage)) reasons.push('suppressed_or_paused')
  if (contact?.last_inbound_at || contact?.email_last_replied_at) reasons.push('reply_history_requires_review')
  const events = c.events.filter(e => e.provider_message_id === dispatch?.message_id)
  if (!events.some(e => e.event_type === 'email_delivered')) reasons.push('confirmed_parent_delivery_required')
  if (events.some(e => ['email_bounced','email_complained','email_rejected'].includes(e.event_type))) reasons.push('adverse_delivery_event')
  if (c.touches.some(t => t.contact_id === contact?.id && t.direction === 'inbound' && stamp(t.created_at) >= stamp(dispatch?.accepted_at) && !/^SES (?:delivered|opened|clicked|accepted) event\b/i.test(t.notes || ''))) reasons.push('inbound_since_introduction')
  if (c.touches.some(t => t.contact_id === contact?.id && t.direction === 'outbound' && stamp(t.created_at) > stamp(dispatch?.accepted_at) && t.metadata?.sequence_job_id !== parent?.id)) reasons.push('newer_outreach_exists')
  if (c.jobs.some(j => j.id !== parent?.id && j.contact_id === contact?.id && ['pending','running','sent'].includes(j.status))) reasons.push('other_sequence_job_exists')
  // Only actual Message-ID headers preserved in events qualify. Never derive a MIME ID from SES API IDs.
  const capturedIds=c.touches.filter(t=>t.contact_id===contact?.id && t.direction==='outbound' && t.metadata?.sequence_job_id===parent?.id && t.metadata?.provider_message_id===dispatch?.message_id)
    .map(t=>t.metadata?.internet_message_id).filter((id):id is string=>typeof id==='string').map(normalizeInternetMessageId).filter((id):id is string=>!!id)
  const mime = [...new Set([...events.flatMap(e => providerEventInternetMessageIds(e.payload)),...capturedIds])]
  if (mime.length !== 1) reasons.push(mime.length ? 'ambiguous_parent_mime_id' : 'parent_mime_id_missing')
  const accepted = stamp(dispatch?.accepted_at)
  const dueAt = Number.isFinite(accepted) ? new Date(accepted + 72*3600000).toISOString() : null
  if (reasons.length) return { status: 'held' as const, reasons: [...new Set(reasons)], dueAt, payload: null }
  let text: string
  try { text = day3Copy(p) } catch (e) { return {status:'held' as const,reasons:[(e as Error).message],dueAt,payload:null} }
  const payload: Row = {
    version: DAY3_FOLLOWUP_POLICY.version, parentJobId: parent.id, parentContentHash: p.contentHash,
    parentProviderMessageId: dispatch.message_id, contactId: contact.id, accountId: p.accountId,
    recipient: p.recipient, sender: p.sender, replyTo: p.replyTo, city: p.city, market: p.market,
    subject: /^re:/i.test(p.subject) ? p.subject : 'Re: ' + p.subject, text, dueAt,
    internetMessageId: mime[0], actionKey: followupKey(parent.id),
  }
  payload.contentHash = followupContentHash(payload)
  return {status:now < stamp(dueAt) ? 'scheduled' as const : 'due' as const,reasons:[],dueAt,payload}
}

/** Execution always reloads live evidence and a completed recent mailbox sync. */
export function day3ExecutionGate(payload: Row, context: FollowupContext, now = Date.now()) {
  const plan = planDay3Followup(context,now), reasons = [...plan.reasons]
  if (plan.status === 'scheduled') reasons.push('not_due')
  if (!plan.payload || followupContentHash(payload) !== payload.contentHash || plan.payload.contentHash !== payload.contentHash) reasons.push('prepared_followup_changed')
  for (const [name,at,complete] of [['context',context.checkedAt,context.complete],['mailbox_sync',context.mailboxSync?.checkedAt,context.mailboxSync?.complete]] as const) {
    if (!complete || !Number.isFinite(stamp(at)) || stamp(at) > now || now-stamp(at)>300000) reasons.push('fresh_'+name+'_required')
  }
  return { allowed: reasons.length===0, reasons:[...new Set(reasons)] }
}

export async function executeDay3Followup(payload: Row, deps: {
  loadContext: () => Promise<FollowupContext>
  claim: (payload: Row) => Promise<{claimed:boolean}>
  reserve: (payload: Row) => Promise<unknown>
  send: (payload: Row) => Promise<{provider:string;accepted:boolean;messageId:string|null}>
  saveOutcome: (state:'held'|'ambiguous'|'accepted', details: Row) => Promise<void>
}) {
  const context=await deps.loadContext(),gate=day3ExecutionGate(payload,context)
  if(!gate.allowed) return {state:'held',reasons:gate.reasons}
  if(!(await deps.claim(payload)).claimed) return {state:'already_claimed'}
  try { await deps.reserve(payload) } catch(e) { await deps.saveOutcome('held',{error:(e as Error).message});throw e }
  // Replies arriving while policy checks run are checked again immediately before transport.
  const finalGate=day3ExecutionGate(payload,await deps.loadContext())
  if(!finalGate.allowed){await deps.saveOutcome('held',{error:finalGate.reasons.join(',')});return{state:'held',reasons:finalGate.reasons}}
  try {
    const receipt=await deps.send({from:payload.sender,to:payload.recipient,replyTo:payload.replyTo,subject:payload.subject,text:payload.text,
      headers:{'In-Reply-To':`<${payload.internetMessageId}>`,References:`<${payload.internetMessageId}>`},trackingMode:'deliverability',
      idempotencyKey:'prepared-email:'+payload.actionKey,reviewedBody:{text:payload.text},
      context:{source:'prepared-email',contactId:payload.contactId,policyActionKey:payload.actionKey,actorName:'Day-three campaign'},
      tags:{channel:'partnership',contact_id:payload.contactId,sequence_step:'2',parent_job_id:payload.parentJobId}})
    if(receipt.provider!=='ses'||!receipt.accepted||!receipt.messageId)throw Error('Ambiguous followup acceptance')
    await deps.saveOutcome('accepted',{provider:receipt.provider,messageId:receipt.messageId,acceptedAt:new Date().toISOString()})
    return{state:'accepted',...receipt}
  }catch(e){try{await deps.saveOutcome('ambiguous',{error:(e as Error).message})}catch{};throw e}
}
