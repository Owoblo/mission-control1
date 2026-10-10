import type { RealtorResearch } from './types'
export type RealtorCandidate = RealtorResearch['candidates'][number]
export type RealtorPartner = { id: string; name: string; phone?: string; email?: string; company?: string; city?: string;
  do_not_contact?: boolean; cross_channel_suppressed_at?: string; stage?: string; decision?: string }
const normalized = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const phone = (s?: string) => (s || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
export function matchRealtorPartners(candidate: RealtorCandidate, partners: RealtorPartner[]) {
  // An office number shared by several people cannot identify an individual.
  const byChannel = partners.filter(p => (candidate.phone && phone(candidate.phone).length === 10 && phone(p.phone) === phone(candidate.phone))
    || (candidate.email && p.email?.toLowerCase() === candidate.email.toLowerCase()))
  if (byChannel.length) return byChannel.length === 1 && normalized(byChannel[0].name) === normalized(candidate.name) ? byChannel[0] : null
  const byName = partners.filter(p => normalized(p.name) === normalized(candidate.name) && !!candidate.brokerage
    && normalized(p.company) === normalized(candidate.brokerage))
  return byName.length === 1 ? byName[0] : null
}
export function realtorPartnerBlocked(p: RealtorPartner) {
  return !!(p.do_not_contact || p.cross_channel_suppressed_at || ['dnc','closed_lost'].includes(p.stage || '')
    || ['opted_out','rejected'].includes(p.decision || ''))
}
export function parseRealtorCandidates(raw: unknown, sources: Array<{url: string; title: string}>): RealtorCandidate[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0,5).flatMap(row => {
    if (!row || typeof row !== 'object' || typeof row.name !== 'string' || !row.name.trim()) return []
    const clean = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim().slice(0,500) : undefined
    const urls = Array.isArray(row.sourceUrls) ? row.sourceUrls : []
    return [{ name: row.name.trim().slice(0,150), phone: clean(row.phone), email: clean(row.email), brokerage: clean(row.brokerage),
      role: ['listing_agent','sales_representative','brokerage_office'].includes(row.role) ? row.role : 'unknown',
      evidence: clean(row.evidence) || 'Listing representation needs confirmation.',
      sources: sources.filter(s => urls.includes(s.url)),
    }]
  })
}
