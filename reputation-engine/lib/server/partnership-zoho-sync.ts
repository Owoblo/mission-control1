import { zohoProfile } from '@/lib/partnership-core/zoho.mjs'
import { isOttawa } from '@/lib/partnership-core/ottawa.mjs'
import { createHash } from 'node:crypto'
import { accountContainsMailbox } from './zoho-mail'
import { readEnv, requireSupabaseEnv } from './runtime'
import { sendPartnershipEmailAlert } from './partnership-email-alerts'
import { classifyPartnershipEmail, currentEmailReply, emailText, partnershipEmailAction, extractEmailReferralContacts, analyzePartnershipEmailReply } from '../partnership-email-replies'

import { matchPartnershipReply, mailboxAddress, recordedInternetMessageIds, providerEventInternetMessageIds, headerMessageIds, type OutboundThreadEvidence } from '../partnership-email-thread-match'

import { replyScanDisposition, REPLY_SCAN_REVIEW_VERSION, REPLY_SCAN_HEADER_BUDGET, type ReplyScanCache } from '../partnership-email-scan-policy'

type Mail = { messageId: string; folderId: string; fromAddress: string; toAddress?: string; subject?: string; receivedTime: string }
type Contact = { id: string; name: string; company: string; city: string; email: string; partner_company_id?: string; website?: string; email_last_sent_at?: string; last_inbound_at?: string; do_not_contact?: boolean }
const eventId = (key: string) => {
  const h = createHash('sha256').update(key).digest('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`
}

export async function syncPartnershipZohoReplies(market: 'saturn' | 'ottawa' = 'saturn') {
  const profile = zohoProfile(market)
  const accountsOrigin = profile.accountsOrigin
  const mailOrigin = profile.mailOrigin
  const mailbox = profile.mailbox
  const auth = await fetch(accountsOrigin + '/oauth/v2/token', {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: profile.clientId, client_secret: profile.clientSecret, refresh_token: profile.refreshToken }),
  })
  const token = await auth.json() as { access_token?: string }
  if (!auth.ok || !token.access_token) throw new Error('Zoho reply sync authorization failed')
  async function zoho<T>(path: string): Promise<T> {
    const response = await fetch(mailOrigin + '/api' + path, { headers: { Authorization: 'Zoho-oauthtoken ' + token.access_token }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
    const data = await response.json() as { status?: { code?: number }; data: T }
    if (!response.ok || data.status?.code !== 200) throw new Error('Zoho reply read failed ' + response.status)
    return data.data
  }
  const accounts = await zoho<Array<{ accountId: string; primaryEmailAddress?: string }>>('/accounts')
  const account = accounts.find(a => accountContainsMailbox(a, mailbox))
  if (!account) throw new Error('Authorized partnership reply mailbox not found')
  const { url, headers } = requireSupabaseEnv()
  async function db(table: string, q: Record<string,string> = {}, method = 'GET', body?: unknown, prefer = 'return=representation') {
    const response = await fetch(`${url}/rest/v1/${table}?${new URLSearchParams(q)}`, { method, headers: { ...headers, Prefer: prefer }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
    if (!response.ok) throw new Error(`Reply sync ${table} ${method} failed (${response.status})`)
    // PostgREST POST with return=minimal succeeds with an empty 201 body.
    // Parsing that as JSON aborts mailbox scanning after its first cache write.
    return response.status === 204 || prefer.includes('return=minimal') ? [] : response.json()
  }
  // Contacts remain scoped to the authorized market. Different-address replies require exact recorded thread evidence.
  const contacts: Contact[] = []
  for (let offset = 0; offset < 30000; offset += 1000) {
    const rows = await db('market_contacts', { select: 'id,name,company,city,email,partner_company_id,website,email_last_sent_at,last_inbound_at,do_not_contact', email: 'not.is.null', order: 'id', limit: '1000', offset: String(offset) }) as Contact[]
    contacts.push(...rows.filter(c => isOttawa(c.city) === (market === 'ottawa')))
    if (rows.length < 1000) break
    if (offset === 29000) throw new Error('Contact pagination limit reached')
  }
  // Provider receipt IDs are used only to join recorded delivery events, never guessed into MIME IDs.
  const outbound: OutboundThreadEvidence[] = []
  const receipts = new Map<string, OutboundThreadEvidence[]>()
  const contactIds = new Set(contacts.map(c => c.id))
  for (let offset = 0; offset < 50000; offset += 1000) {
    const rows = await db('market_touches', { select: 'contact_id,created_at,metadata', channel: 'eq.email', direction: 'eq.outbound', created_at: 'gte.2026-09-15T19:15:00Z', order: 'id', limit: '1000', offset: String(offset) })
    for (const row of rows) {
      if (!contactIds.has(row.contact_id)) continue
      const metadata = row.metadata || {}
      const evidence = { contactId: row.contact_id, sentAt: row.created_at, messageIds: recordedInternetMessageIds(metadata) }
      outbound.push(evidence)
      const receipt = metadata.provider_message_id || metadata.sesMessageId
      const provider = metadata.provider || (metadata.sesMessageId ? 'ses' : null)
      if (typeof receipt === 'string' && provider) {
        const key = provider + ':' + receipt
        receipts.set(key, [...(receipts.get(key) || []), evidence])
      }
    }
    if (rows.length < 1000) break
    if (offset === 49000) throw new Error('Outbound thread evidence pagination limit reached')
  }
  const receiptIds = [...new Set([...receipts.keys()].map(key => key.slice(key.indexOf(':') + 1)))]
  for (let i = 0; i < receiptIds.length; i += 60) {
    // Quote PostgREST list values; identifiers are data, not query syntax.
    const ids = receiptIds.slice(i, i + 60).map(id => JSON.stringify(id)).join(',')
    for (let offset = 0; offset < 10000; offset += 1000) {
      const events = await db('email_provider_events', { select: 'provider,provider_message_id,payload', provider_message_id: 'in.(' + ids + ')', order: 'id', limit: '1000', offset: String(offset) })
      for (const event of events) {
        for (const evidence of receipts.get(event.provider + ':' + event.provider_message_id) || []) {
          evidence.messageIds = [...new Set([...evidence.messageIds, ...providerEventInternetMessageIds(event.payload)])]
        }
      }
      if (events.length < 1000) break
      if (offset === 9000) throw new Error('Provider thread evidence pagination limit reached')
    }
  }
  // A rolling seven-day overlap catches delays and retries. Never imports historical sales mail.
  const lower = Math.max(Date.parse('2026-09-15T19:15:00Z'), Date.now() - 7 * 86400000)
  let scanned = 0, imported = 0, alerted = 0, unresolved = 0, completed = false
  let headersRead = 0, cachedSkipped = 0, budgetExhausted = false
  async function markScanned(messageId: string, result: 'ignored' | 'unresolved_queued') {
    const key = `partnership-reply-scan:${account!.accountId}:${messageId}`
    const checkedAt = new Date().toISOString()
    // Unrelated mail cache deliberately excludes sender, subject, headers and body.
    await db('email_provider_events', { on_conflict: 'id' }, 'POST', { id: eventId(key), provider: 'zoho', provider_event_id: key, provider_message_id: messageId, event_type: 'partnership_reply_scan', occurred_at: checkedAt, payload: { review_version: REPLY_SCAN_REVIEW_VERSION, checked_at: checkedAt, result } }, 'resolution=merge-duplicates,return=minimal')
  }
  mailboxPages:
  for (let start = 1; start <= 4000; start += 200) {
    const rows = await zoho<Mail[]>(`/accounts/${account.accountId}/messages/view?start=${start}&limit=200&includeto=true`)
    const priorTouches = new Map<string, { metadata?: { alert_sent_at?: string } }>()
    const scanCache = new Map<string, ReplyScanCache>()
    // Batch lookups by page, keeping URI size bounded. Every invocation walks from the newest page;
    // persisted completed scans let subsequent polls reach the older, not-yet-read messages.
    for (let i = 0; i < rows.length; i += 60) {
      const page = rows.slice(i, i + 60)
      const touchIds = page.map(mail => eventId(`zoho:${account.accountId}:${mail.messageId}`))
      const cacheIds = page.map(mail => eventId(`partnership-reply-scan:${account.accountId}:${mail.messageId}`))
      const [touches, caches] = await Promise.all([
        db('market_touches', { id: 'in.(' + touchIds.join(',') + ')', select: 'id,metadata', limit: '60' }),
        db('email_provider_events', { id: 'in.(' + cacheIds.join(',') + ')', provider: 'eq.zoho', event_type: 'eq.partnership_reply_scan', select: 'id,payload', limit: '60' }),
      ])
      for (const touch of touches) priorTouches.set(touch.id, touch)
      for (const cache of caches) scanCache.set(cache.id, cache.payload)
    }
    for (const mail of rows) {
      scanned++
      const timestamp = Number(mail.receivedTime)
      if (!Number.isFinite(timestamp) || timestamp < lower) continue
      const from = mailboxAddress(mail.fromAddress || '')
      if (!from || /@(?:starmovers|saturnstarmovers|dexamovers)\.ca$/.test(from)) continue
      const id = eventId(`zoho:${account.accountId}:${mail.messageId}`)
      const prior = priorTouches.get(id)
      const disposition = replyScanDisposition({ alerted: !!prior?.metadata?.alert_sent_at, cache: scanCache.get(eventId(`partnership-reply-scan:${account.accountId}:${mail.messageId}`)), now: Date.now(), headersRead })
      if (disposition === 'skip') { cachedSkipped++; continue }
      if (disposition === 'budget_exhausted') { budgetExhausted = true; break mailboxPages }
      headersRead++
      const header = await zoho<{ headerContent?: string }>(`/accounts/${account.accountId}/folders/${mail.folderId}/messages/${mail.messageId}/header`)
      const match = matchPartnershipReply({ from, receivedAt: timestamp, headers: header.headerContent || '', contacts, outbound })
      if (match.status === 'ignore') { await markScanned(mail.messageId, 'ignored'); continue }
      const internetMessageId = headerMessageIds(header.headerContent || '', 'message-id')[0] || null
      const content = await zoho<{ content?: string }>(`/accounts/${account.accountId}/folders/${mail.folderId}/messages/${mail.messageId}/content`)
      if (match.status === 'unresolved') {
        const occurredAt = new Date(timestamp).toISOString()
        const preview = currentEmailReply(emailText(content.content || '')).slice(0, 2000)
        const payload = { source: 'zoho', zoho_message_id: mail.messageId, zoho_account_id: account.accountId, market, from, to: mailbox, subject: mail.subject || '', internet_message_id: internetMessageId, match, reply_preview: preview, review_status: 'pending', automatic_contact_attribution: false }
        await db('email_provider_events', {}, 'POST', { id, provider: 'zoho', provider_event_id: `partnership-unresolved:${account.accountId}:${mail.messageId}`, provider_message_id: mail.messageId, event_type: 'partnership_reply_unresolved', occurred_at: occurredAt, payload }, 'resolution=ignore-duplicates,return=representation')
        // An unlinked CRM task is visible to operators without attaching the mail to the wrong company.
        await db('crm_tasks', {}, 'POST', { id: 'partnership-reply-review:' + id, source_key: 'partnership-reply-review:' + id, source: 'condition', title: 'Review unmatched partnership email reply', description: JSON.stringify(payload), category: 'partnerships', priority: 'high', status: 'open', owner_name: market === 'ottawa' ? 'Courage' : 'John', branch: market, created_by_name: 'Zoho reply sync', due_at: occurredAt }, 'resolution=ignore-duplicates,return=representation')
        await markScanned(mail.messageId, 'unresolved_queued')
        unresolved++
        continue
      }
      const contact = contacts.find(c => c.id === match.contactId)!
      const body = emailText(content.content || '')
      const reply = currentEmailReply(body), kind = classifyPartnershipEmail(mail.subject || '', body)
      const human = kind === 'reply' || kind === 'handoff' || kind === 'opt_out'
      const occurredAt = new Date(timestamp).toISOString()
      const metadata = { source: 'zoho', zoho_message_id: mail.messageId, zoho_account_id: account.accountId, subject: mail.subject || '', from, to: mailbox, email_kind: kind, human_reply: human, internet_message_id: internetMessageId, reply_match: match, reply_analysis: analyzePartnershipEmailReply(mail.subject || '', body), body, reply_preview: reply }
      if (!prior) {
        await db('market_touches', {}, 'POST', { id, contact_id: contact.id, channel: 'email', direction: 'inbound', notes: `Subject: ${mail.subject || '(no subject)'}\n\n${body}`, created_by: 'Zoho reply sync', created_at: occurredAt, outcome_code: kind === 'opt_out' ? 'opt_out' : kind === 'handoff' ? 'referred_contact' : kind === 'reply' ? 'email_replied' : 'email_' + kind, next_step: partnershipEmailAction(kind), metadata }, 'resolution=ignore-duplicates,return=representation')
        imported++
      }
      // A named referral becomes a paused company contact, never an automatic SMS send.
      for (const referral of extractEmailReferralContacts(body)) {
        const existing = await db('market_contacts', { phone: 'eq.' + referral.phone, select: 'id,partner_company_id', limit: '20' })
        if (existing.length) continue
        const referralId = eventId(`email-referral:${contact.partner_company_id || contact.id}:${referral.phone}`)
        await db('market_contacts', {}, 'POST', {
          id: referralId, name: referral.name, company: contact.company, city: contact.city, website: contact.website || null,
          phone: referral.phone, partner_company_id: contact.partner_company_id || null, stage: 'target',
          sequence_paused: true, sequence_paused_reason: referral.urgentOnly ? 'urgent_contact_context_review' : 'referred_contact_research',
          commission_rule_required: false, owner_name: market === 'ottawa' ? 'Dr. Courage' : 'John', preferred_channel: 'phone',
          tags: ['email-referred-contact'], notes: JSON.stringify({ source: 'inbound_email', message_id: mail.messageId, referred_by_contact_id: contact.id, ...referral, role_verification: 'pending', sms_capability: 'unknown' }),
        }, 'resolution=ignore-duplicates,return=representation')
        if (contact.partner_company_id) await db('market_contacts', { id: 'eq.' + referralId }, 'PATCH', { partner_company_id: contact.partner_company_id })
      }
      // Keep automatic messages visible without inflating human response metrics.
      const updates: Record<string,unknown> = { sequence_paused: true, sequence_paused_reason: 'email_' + kind }
      if (human && (!contact.last_inbound_at || Date.parse(contact.last_inbound_at) <= timestamp)) updates.last_inbound_at = occurredAt
      if (kind === 'opt_out') Object.assign(updates, { do_not_contact: true, email_status: 'unsubscribed', email_unsubscribed_at: occurredAt, cross_channel_suppressed_at: occurredAt, cross_channel_suppression_reason: 'email_opt_out' })
      await db('market_contacts', { id: 'eq.' + contact.id }, 'PATCH', updates)
      await db('sequence_jobs', { contact_id: 'eq.' + contact.id, status: 'eq.pending' }, 'PATCH', { status: 'cancelled', error: 'Paused after Zoho email ' + kind })
      const labels = { reply: 'Partner email reply', handoff: 'Partner referral / routing reply', verification: 'Partner email verification required', verification_pending_review: 'Partner verification received — awaiting review', automatic_reply: 'Partner automatic email reply', opt_out: 'Partner email opt-out', delivery_failure: 'Partner email delivery failure' }
      await sendPartnershipEmailAlert({ id, contactId: contact.id, contactName: contact.name, company: contact.company, city: contact.city, email: from, occurredAt, label: labels[kind], subject: mail.subject, notes: reply + '\n\nNext action: ' + partnershipEmailAction(kind) })
      await db('market_touches', { id: 'eq.' + id }, 'PATCH', { metadata: { ...metadata, alert_sent_at: new Date().toISOString() } })
      alerted++
    }
    if (rows.length < 200 || rows.every(m => Number(m.receivedTime) < lower)) { completed = true; break }
  }
  const paginationLimitReached = !completed && !budgetExhausted
  return { ok: true, scanned, imported, alerted, unresolved, headersRead, headerBudget: REPLY_SCAN_HEADER_BUDGET, cachedSkipped, completed, partial: !completed, budgetExhausted, paginationLimitReached }
}

export async function syncAllPartnershipZohoReplies() {
  const markets: Array<'saturn' | 'ottawa'> = ['saturn']
  if (readEnv('ZOHO_OTTAWA_REFRESH_TOKEN')) markets.push('ottawa')
  const results: Record<string, unknown> = {}
  for (const market of markets) {
    try { results[market] = await syncPartnershipZohoReplies(market) }
    catch { results[market] = { ok: false, error: 'Mailbox sync failed; retry after checking this connection' } }
  }
  return { ok: Object.values(results).every(r => (r as {ok:boolean}).ok), markets: results }
}
