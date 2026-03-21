export type PartnershipStage =
  | 'target'
  | 'mail_sent'
  | 'follow_up_due'
  | 'attempting_contact'
  | 'connected'
  | 'qualified'
  | 'partnership_active'
  | 'dormant'
  | 'closed_lost'

export interface PartnershipStageMeta {
  label: string
  shortLabel: string
  color: string
  ring: string
}

export const PARTNERSHIP_STAGE_ORDER: PartnershipStage[] = [
  'target',
  'mail_sent',
  'follow_up_due',
  'attempting_contact',
  'connected',
  'qualified',
  'partnership_active',
  'dormant',
  'closed_lost',
]

export const PARTNERSHIP_STAGE_META: Record<PartnershipStage, PartnershipStageMeta> = {
  target:             { label: 'Target',              shortLabel: 'Target',     color: 'bg-slate-100 text-slate-700',        ring: 'ring-slate-200' },
  mail_sent:          { label: 'Mail Sent',           shortLabel: 'Mailed',     color: 'bg-amber-100 text-amber-800',        ring: 'ring-amber-200' },
  follow_up_due:      { label: 'Follow-Up Due',       shortLabel: 'Due',        color: 'bg-rose-100 text-rose-700',          ring: 'ring-rose-200' },
  attempting_contact: { label: 'Attempting Contact',  shortLabel: 'Attempting', color: 'bg-sky-100 text-sky-700',           ring: 'ring-sky-200' },
  connected:          { label: 'Connected',           shortLabel: 'Connected',  color: 'bg-violet-100 text-violet-700',      ring: 'ring-violet-200' },
  qualified:          { label: 'Qualified',           shortLabel: 'Qualified',  color: 'bg-orange-100 text-orange-700',      ring: 'ring-orange-200' },
  partnership_active: { label: 'Partnership Active',  shortLabel: 'Active',     color: 'bg-emerald-100 text-emerald-700',    ring: 'ring-emerald-200' },
  dormant:            { label: 'Dormant',             shortLabel: 'Dormant',    color: 'bg-fuchsia-100 text-fuchsia-700',    ring: 'ring-fuchsia-200' },
  closed_lost:        { label: 'Closed Lost',         shortLabel: 'Closed',     color: 'bg-zinc-200 text-zinc-700',          ring: 'ring-zinc-300' },
}

const LEGACY_STAGE_MAP: Record<string, PartnershipStage> = {
  cold: 'target',
  contacted: 'attempting_contact',
  engaged: 'connected',
  qualified: 'qualified',
  partnered: 'partnership_active',
  referring: 'partnership_active',
  revisit: 'dormant',
  dnc: 'closed_lost',
}

export function normalizePartnershipStage(stage: string | null | undefined): PartnershipStage {
  const value = String(stage || '').trim()
  if (!value) return 'target'
  if (value in LEGACY_STAGE_MAP) return LEGACY_STAGE_MAP[value]
  if (PARTNERSHIP_STAGE_ORDER.includes(value as PartnershipStage)) return value as PartnershipStage
  return 'target'
}

export function getPartnershipStageMeta(stage: string | null | undefined) {
  const normalized = normalizePartnershipStage(stage)
  return PARTNERSHIP_STAGE_META[normalized]
}

export function addDays(date: Date | string, days: number) {
  const base = typeof date === 'string' ? new Date(date) : new Date(date)
  const copy = new Date(base)
  copy.setDate(copy.getDate() + days)
  return copy
}

export function toDateInput(date: Date | string) {
  const value = typeof date === 'string' ? new Date(date) : date
  return value.toISOString().slice(0, 10)
}

export function defaultFollowUpDate(from: Date | string = new Date(), days = 21) {
  return toDateInput(addDays(from, days))
}

export function getPipelineBucket(tier?: string | null, industry?: string | null) {
  const t = String(tier || '').toUpperCase()
  const i = String(industry || '').toLowerCase()
  if (t === 'C' || /(school|factory|industrial|employer|manufacturer|college|university|hospital|government|corporate)/.test(i)) {
    return 'corporate'
  }
  return 'partners'
}

export function isDateDue(date?: string | null, today = new Date()) {
  if (!date) return false
  return new Date(date).getTime() <= new Date(toDateInput(today)).getTime()
}
