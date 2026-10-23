import { zohoProfile } from '@/lib/partnership-core/zoho.mjs'
import { isOttawa } from '@/lib/partnership-core/ottawa.mjs'
import { createHash } from 'node:crypto'
import { accountContainsMailbox, zohoOrigin } from './zoho-mail'
import { readEnv, requireSupabaseEnv } from './runtime'
import { sendPartnershipEmailAlert } from './partnership-email-alerts'
import { classifyPartnershipEmail, currentEmailReply, emailText, partnershipEmailAction, extractEmailReferralContacts } from '../partnership-email-replies'

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
    return response.status === 204 ? [] : response.json()
  }
  // Exact email matches only. New senders are reviewed before assigning an existing company.
  const contacts: Contact[] = []
  for (let offset = 0; offset < 30000; offset += 1000) {
    const rows = await db('market_contacts', { select: 'id,name,company,city,email,partner_company_id,website,email_last_sent_at,last_inbound_at,do_not_contact', email: 'not.is.null', order: 'id', limit: '1000', offset: String(offset) }) as Contact[]
    contacts.push(...rows.filter(c => isOttawa(c.city) === (market === 'ottawa')))
    if (rows.length < 1000) break
    if (offset === 29000) throw new Error('Contact pagination limit reached')
  }
  // A rolling seven-day overlap catches delays and retries. Never imports historical sales mail.
  const lower = Math.max(Date.parse('2026-09-15T19:15:00Z'), Date.now() - 7 * 86400000)
  let scanned = 0, imported = 0, alerted = 0, completed = false
  for (let start = 1; start <= 4000; start += 200) {
    const rows = await zoho<Mail[]>(`/accounts/${account.accountId}/messages/view?start=${start}&limit=200&includeto=true`)
    for (const mail of rows) {
      scanned++
      const timestamp = Number(mail.receivedTime)
      if (!Number.isFinite(timestamp) || timestamp < lower) continue
      const from = mail.fromAddress?.trim().toLowerCase()
      if (!from || /@(?:starmovers|saturnstarmovers|dexamovers)\.ca$/.test(from)) continue
      const matches = contacts.filter(c => c.email.toLowerCase() === from && c.email_last_sent_at)
      if (matches.length !== 1) continue
      const contact = matches[0]
      if (Date.parse(contact.email_last_sent_at || '') > timestamp) {
        const earlier = await db('market_touches', { contact_id: 'eq.' + contact.id, channel: 'eq.email', direction: 'eq.outbound', created_at: 'lte.' + new Date(timestamp).toISOString(), select: 'id', limit: '1' })
        if (!earlier.length) continue
      }
      const id = eventId(`zoho:${account.accountId}:${mail.messageId}`)
      const [prior] = await db('market_touches', { id: 'eq.' + id, select: 'id,metadata' })
      if (prior?.metadata?.alert_sent_at) continue
      const content = await zoho<{ content?: string }>(`/accounts/${account.accountId}/folders/${mail.folderId}/messages/${mail.messageId}/content`)
      const header = await zoho<{ headerContent?: string }>(`/accounts/${account.accountId}/folders/${mail.folderId}/messages/${mail.messageId}/header`)
      const internetMessageId = header.headerContent?.match(/^Message-I[Dd]:\s*(<[^>\r\n]+>)/mi)?.[1] || null
      const body = emailText(content.content || '')
      const reply = currentEmailReply(body), kind = classifyPartnershipEmail(mail.subject || '', body)
      const human = kind === 'reply' || kind === 'handoff' || kind === 'opt_out'
      const occurredAt = new Date(timestamp).toISOString()
      const metadata = { source: 'zoho', zoho_message_id: mail.messageId, zoho_account_id: account.accountId, subject: mail.subject || '', from, to: mailbox, email_kind: kind, human_reply: human, internet_message_id: internetMessageId, body, reply_preview: reply }
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
  if (!completed) throw new Error('Mailbox pagination limit reached; increase coverage before advancing')
  return { ok: true, scanned, imported, alerted }
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
