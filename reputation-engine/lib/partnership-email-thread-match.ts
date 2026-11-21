/** Match only recorded Internet Message-IDs. Provider receipt IDs are not MIME IDs. */
export type OutboundThreadEvidence = {
  contactId: string; sentAt: string; messageIds: string[]
}
export type ThreadContact = { id: string; email: string; email_last_sent_at?: string }
export type PartnershipThreadMatch =
  | { status: 'matched'; contactId: string; method: 'thread_headers' | 'exact_sender'; evidenceIds: string[] }
  | { status: 'unresolved'; candidateContactIds: string[]; reason: 'ambiguous_thread' | 'ambiguous_sender'; evidenceIds: string[] }
  | { status: 'ignore'; evidenceIds: string[] }

// Domain is case-insensitive; retain the case-sensitive identifier/local part.
export function normalizeInternetMessageId(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.startsWith('<') !== trimmed.endsWith('>')) return null
  const m = trimmed.match(/^<?([^<>\s@]+)@([^<>\s@]+)>?$/)
  return m ? `${m[1]}@${m[2].toLowerCase()}` : null
}
export function headerMessageIds(headers: string, field: string): string[] {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, ' ')
  const values = unfolded.split(/\r?\n/).filter(line => line.slice(0, line.indexOf(':')).toLowerCase() === field.toLowerCase())
  return [...new Set(values.flatMap(line => (line.match(/<[^<>\r\n]+>/g) || []).map(normalizeInternetMessageId).filter((id): id is string => !!id)))]
}
export function mailboxAddress(value: string): string | null {
  const address = value.match(/<([^<>]+)>/)?.[1] || value.trim()
  return /^[^\s<>@]+@[^\s<>@]+$/.test(address) ? address.toLowerCase() : null
}
export function recordedInternetMessageIds(metadata: Record<string, unknown> = {}): string[] {
  return [...new Set(['internet_message_id', 'internetMessageId', 'message_id', 'provider_message_id', 'sesMessageId'].flatMap(key => {
    const value = metadata[key]
    const id = typeof value === 'string' ? normalizeInternetMessageId(value) : null
    return id ? [id] : []
  }))]
}
/** Extract actual MIME identifiers captured in a provider event, without deriving one from its receipt ID. */
export function providerEventInternetMessageIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  let event = payload as Record<string, any>
  if (typeof event.Message === 'string') {
    try { event = JSON.parse(event.Message) } catch { return [] }
  }
  const ids: string[] = []
  const common = event?.mail?.commonHeaders?.messageId
  if (typeof common === 'string') ids.push(common)
  for (const header of Array.isArray(event?.mail?.headers) ? event.mail.headers : []) {
    if (typeof header?.name === 'string' && header.name.toLowerCase() === 'message-id' && typeof header.value === 'string') ids.push(header.value)
  }
  return [...new Set(ids.map(normalizeInternetMessageId).filter((id): id is string => !!id))]
}
export function matchPartnershipReply(input: { from: string; receivedAt: number; headers: string; contacts: ThreadContact[]; outbound: OutboundThreadEvidence[] }): PartnershipThreadMatch {
  if (!Number.isFinite(input.receivedAt)) return { status: 'ignore', evidenceIds: [] }
  const contactIds = new Set(input.contacts.map(c => c.id))
  const prior = input.outbound.filter(e => contactIds.has(e.contactId) && Number.isFinite(Date.parse(e.sentAt)) && Date.parse(e.sentAt) <= input.receivedAt)
  const refs = [...new Set([...headerMessageIds(input.headers, 'in-reply-to'), ...headerMessageIds(input.headers, 'references')])]
  const linked = prior.filter(e => e.messageIds.some(id => refs.includes(normalizeInternetMessageId(id) || '')))
  const linkedIds = [...new Set(linked.map(e => e.contactId))]
  const evidenceIds = refs.filter(id => linked.some(e => e.messageIds.some(v => normalizeInternetMessageId(v) === id)))
  if (linkedIds.length > 1) return { status: 'unresolved', candidateContactIds: linkedIds, reason: 'ambiguous_thread', evidenceIds }
  if (linkedIds.length === 1) return { status: 'matched', contactId: linkedIds[0], method: 'thread_headers', evidenceIds }
  const from = mailboxAddress(input.from)
  const exact = input.contacts.filter(c => from && mailboxAddress(c.email) === from && (
    (Number.isFinite(Date.parse(c.email_last_sent_at || '')) && Date.parse(c.email_last_sent_at!) <= input.receivedAt) || prior.some(e => e.contactId === c.id)
  ))
  if (exact.length === 1) return { status: 'matched', contactId: exact[0].id, method: 'exact_sender', evidenceIds: [] }
  if (exact.length > 1) return { status: 'unresolved', candidateContactIds: exact.map(c => c.id), reason: 'ambiguous_sender', evidenceIds: [] }
  return { status: 'ignore', evidenceIds: [] }
}
