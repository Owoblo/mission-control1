import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { partnershipRecordMatchesSession } from '@/lib/server/partnership-access'
import { readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import { hasUnresolvedTemplateVariable } from '@/lib/server/saturn-send-gate'
import { sendProviderEmail } from '@/lib/server/email-provider'
import { reserveAction } from '@/lib/partnership-core/reserve.mjs'
import { isOttawa } from '@/lib/partnership-core/ottawa.mjs'

const addresses: Record<string, string> = {
  john: 'john@saturnstarmovers.ca', johnny: 'johnny@saturnstarmovers.ca',
  jhon: 'jhon@saturnstarmovers.ca', business: 'business@starmovers.ca',
}
const uuid = (hash: string) => `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getRequestSessionUser(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['owner', 'manager', 'partnership_manager'].includes(session.role || '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await context.params
  const input = await request.json().catch(() => null)
  if (!input || typeof input.subject !== 'string' || typeof input.body !== 'string' ||
      !input.subject.trim() || !input.body.trim() || input.subject.length > 998 || input.body.length > 50000 || /[\r\n]/.test(input.subject) ||
      (input.sender !== undefined && (typeof input.sender !== 'string' || !Object.hasOwn(addresses, input.sender))) ||
      (input.internalTest !== undefined && typeof input.internalTest !== 'boolean')) {
    return NextResponse.json({ error: 'Valid sender, subject and message required' }, { status: 400 })
  }
  if (hasUnresolvedTemplateVariable(input.subject) || hasUnresolvedTemplateVariable(input.body)) return NextResponse.json({ error: 'Unresolved template variable' }, { status: 400 })
  const { url, headers } = requireSupabaseEnv()
  async function db(table: string, query: Record<string, string>, method = 'GET', body?: unknown) {
    const response = await fetch(`${url}/rest/v1/${table}?${new URLSearchParams(query)}`, {
      method, headers: { ...headers, Prefer: 'return=representation' }, cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`Email record ${table} unavailable (${response.status})`)
    return response.status === 204 ? [] : response.json()
  }
  try {
    const [contact] = await db('market_contacts', { id: `eq.${id}`, select: '*' })
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    if (!partnershipRecordMatchesSession(session, contact)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (isOttawa(contact.city)) return NextResponse.json({ error: 'Use the configured Ottawa email workflow for this contact' }, { status: 409 })
    if (!contact.email || contact.do_not_contact || contact.email_unsubscribed_at || contact.cross_channel_suppressed_at || ['bounced','complained','unsubscribed'].includes(contact.email_status)) {
      return NextResponse.json({ error: 'Contact has no eligible email address' }, { status: 409 })
    }
    const internalTest = input.internalTest === true
    const testContact = Array.isArray(contact.tags) && contact.tags.includes('internal-infrastructure-test')
    const allowedTests = readEnv('EMAIL_INFRASTRUCTURE_TEST_RECIPIENTS').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    if (internalTest && (session.role !== 'owner' || !testContact || !contact.sequence_paused || !allowedTests.includes(contact.email.trim().toLowerCase()))) {
      return NextResponse.json({ error: 'Internal tests require an owner, a paused test contact and a configured test recipient' }, { status: 403 })
    }
    if (testContact && !internalTest) return NextResponse.json({ error: 'Internal test contacts cannot receive campaign email' }, { status: 409 })
    const [inbound] = await db('market_touches', { contact_id: `eq.${id}`, channel: 'eq.email', direction: 'eq.inbound', order: 'created_at.desc,id.desc', limit: '1', select: 'id,metadata' })
    const outbound = await db('market_touches', { contact_id: `eq.${id}`, channel: 'eq.email', direction: 'eq.outbound', order: 'created_at.desc,id.desc', limit: '50', select: 'metadata' })
    const previousAddresses = [...new Set(outbound.map((touch: {metadata?: {from?: string}}) => {
      const from = String(touch.metadata?.from || '')
      return (from.match(/<([^<>]+)>/)?.[1] || from).toLowerCase()
    }).filter(Boolean))]
    // A contact can have several independent threads. Never guess an identity across them.
    const previousAddress = previousAddresses.length === 1 && outbound.length < 50 ? previousAddresses[0] : undefined
    const senderKey = input.sender || Object.keys(addresses).find(key => addresses[key] === previousAddress)
    if (!senderKey) return NextResponse.json({ error: 'Choose an authorized sender for this conversation' }, { status: 400 })
    const address = addresses[senderKey]
    const [profile] = await db('email_sender_accounts', { from_email: `eq.${address}`, provider: 'eq.ses', select: 'from_name,reply_to_email', limit: '1' })
    if (!profile?.reply_to_email) return NextResponse.json({ error: 'Register this sender and its reply mailbox first' }, { status: 409 })
    const sender = `${profile.from_name || 'Saturn Star Movers'} <${address}>`
    const rawReplyId = inbound?.metadata?.internet_message_id
    const replyId = typeof rawReplyId === 'string' && /^<[^<>\r\n]+>$/.test(rawReplyId) ? rawReplyId : undefined
    const hash = createHash('sha256').update(JSON.stringify([id, address, input.subject, input.body, inbound?.id || null, internalTest])).digest('hex')
    const touchId = uuid(hash), actionKey = `manual-email:${touchId}`
    const [prior] = await db('market_touches', { id: `eq.${touchId}`, select: 'metadata' })
    if (prior) return NextResponse.json(prior.metadata?.delivery_state === 'accepted'
      ? { ok: true, alreadySent: true, messageId: prior.metadata.provider_message_id }
      : { error: 'A send reservation already exists. Reconcile its receipt before retrying.' }, { status: prior.metadata?.delivery_state === 'accepted' ? 200 : 409 })
    if (!internalTest) await reserveAction({ url, headers, contactId: id, channel: 'email', kind: inbound ? 'reply' : 'cold_introduction', key: actionKey, content: input.subject + '\n' + input.body, sender, emailProvider: 'ses' })
    const metadata = { source: 'manual_partnership_email', from: sender, to: contact.email, subject: input.subject,
      reply_to: profile.reply_to_email, in_reply_to: replyId || null, delivery_state: 'reserved', internal_test: internalTest }
    // A unique touch reserves the send before transport. A racing or uncertain request cannot resend it.
    await db('market_touches', {}, 'POST', { id: touchId, contact_id: id, channel: 'email', direction: 'outbound',
      notes: `Subject: ${input.subject}\n\n${input.body}`, created_by: session.name || 'Partnership team', metadata })
    const receipt = await sendProviderEmail({ from: sender, to: contact.email, subject: input.subject, text: input.body,
      replyTo: profile.reply_to_email, headers: replyId ? { 'In-Reply-To': replyId, References: replyId } : undefined,
      purpose: internalTest ? 'internal' : 'outreach', trackingMode: 'deliverability', idempotencyKey: actionKey,
      context: { source: internalTest ? 'owner_infrastructure_test' : 'manual_partnership_email', contactId: id, policyActionKey: internalTest ? undefined : actionKey },
    })
    if (!receipt.accepted || !receipt.messageId) throw new Error('Provider acceptance is unconfirmed; reconcile before retrying')
    try {
      await db('market_touches', { id: `eq.${touchId}` }, 'PATCH', { metadata: { ...metadata, delivery_state: 'accepted', provider: receipt.provider, provider_message_id: receipt.messageId } })
      await db('market_contacts', { id: `eq.${id}` }, 'PATCH', { last_touch_at: new Date().toISOString(), email_last_sent_at: new Date().toISOString(), sequence_paused: true, sequence_paused_reason: internalTest ? 'internal_infrastructure_test' : 'manual_email_conversation' })
      await db('sequence_jobs', { contact_id: `eq.${id}`, status: 'eq.pending' }, 'PATCH', { status: 'cancelled', error: 'Paused for manual email conversation' })
    } catch {
      return NextResponse.json({ ok: true, messageId: receipt.messageId, reconciliationRequired: true, message: 'Provider accepted this email. CRM records need reconciliation; do not resend.' }, { status: 202 })
    }
    return NextResponse.json({ ok: true, messageId: receipt.messageId, from: address, replyTo: profile.reply_to_email, auditState: receipt.auditState })
  } catch (error) {
    console.error('Partnership email failed', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Email failed; check its receipt before retrying' }, { status: 409 })
  }
}
