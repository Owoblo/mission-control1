import { detectPartnershipLeadSignal } from './partnership-lead-detection'

type Touch = { id: string; contact_id: string; notes: string | null; created_at: string }

export function selectCurrentHandoffTouches<T extends Touch>(touches: T[], now: Date): Map<string, T> {
  const latest = new Map<string, T>()
  // Historical imports require review, not a fresh sales assignment months later.
  const earliest = now.getTime() - 7 * 24 * 60 * 60 * 1000
  const ordered = [...touches].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const byContact = new Map<string, T[]>()
  for (const touch of ordered) {
    const list = byContact.get(touch.contact_id) || []
    list.push(touch)
    byContact.set(touch.contact_id, list)
  }
  for (const [contactId, history] of byContact) {
    const candidates = history.filter(touch => {
      const time = Date.parse(touch.created_at)
      return time >= earliest && time <= now.getTime() && detectPartnershipLeadSignal(touch.notes).is_lead
    })
    const candidate = candidates[candidates.length - 1]
    if (!candidate) continue
    const later = history.filter(touch => touch.created_at > candidate.created_at)
    // A later concrete correction or cancellation closes the request. A routine
    // update (for example, "he'll confirm tomorrow") keeps the handoff alive.
    const superseded = later.some(touch => /\b(?:wrong service|not moving|not a move|no longer need|don't need|do not need|already booked|booked someone else|cancel(?:led|ed)?|forget that|that was a mistake|never mind)\b/i.test(touch.notes || ''))
    if (!superseded) latest.set(contactId, candidate)
  }
  return new Map([...latest].filter(([, touch]) => {
    const time = Date.parse(touch.created_at)
    return time >= earliest && time <= now.getTime()
  }))
}

export function canCreatePartnerHandoff(contact: { do_not_contact?: boolean; decision?: string | null; stage?: string | null }, exists: boolean): boolean {
  return !exists && contact.do_not_contact !== true &&
    !['opted_out', 'do_not_contact', 'unsubscribed', 'not_interested'].includes(String(contact.decision || '').toLowerCase()) &&
    !['suppressed', 'closed', 'lost'].includes(String(contact.stage || '').toLowerCase())
}
