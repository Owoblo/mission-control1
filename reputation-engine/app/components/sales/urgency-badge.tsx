import { AlertTriangle, CheckCircle2, Clock3, Info, Minus, type LucideIcon } from 'lucide-react'

/**
 * ONE urgency language for the CRM (Saturn design vision, Sept 2026).
 *
 * Five fixed visual tones. Every urgency/priority/heat/SLA/readiness
 * indicator in the CRM maps to one of these — never a one-off badge color.
 *
 * Semantic kinds (name them explicitly at the call site):
 *   'priority' — human-assigned importance (task priority)
 *   'sla'      — time-derived urgency (overdue / due today / upcoming,
 *              speed-to-lead tiers, booked-job countdowns)
 *   'heat'     — lead temperature (risk / hot / warm / cold / dormant,
 *              golden moments)
 *   'readiness'— booked-job readiness (fully ready / at risk / in progress)
 *
 * Map your kind to a tone with the helpers below, then render UrgencyBadge.
 * The label always carries the specific meaning ("Overdue", "Golden moment");
 * the tone carries the severity. Same severity => same look, everywhere.
 */
export type UrgencyTone = 'critical' | 'warning' | 'info' | 'positive' | 'neutral'

type ToneClasses = {
  /** pill badge: border + tinted bg + text */
  badge: string
  /** soft tinted background for rows/cards */
  softBg: string
  /** solid bar/stripe */
  stripe: string
  /** small dot */
  dot: string
  /** inline text on light surfaces */
  text: string
}

export const URGENCY_TONE_CLASSES: Record<UrgencyTone, ToneClasses> = {
  critical: {
    badge: 'border-[#B42318]/25 bg-[#FEF2F2] text-[#B42318]',
    softBg: 'bg-[#FEF2F2]',
    stripe: 'bg-[#B42318]',
    dot: 'bg-[#B42318]',
    text: 'text-[#B42318]',
  },
  warning: {
    badge: 'border-[#92400E]/25 bg-[#FFFAEB] text-[#92400E]',
    softBg: 'bg-[#FFFAEB]',
    stripe: 'bg-[#92400E]',
    dot: 'bg-[#C99700]',
    text: 'text-[#92400E]',
  },
  info: {
    badge: 'border-[#1D4ED8]/25 bg-[#EFF6FF] text-[#1D4ED8]',
    softBg: 'bg-[#EFF6FF]',
    stripe: 'bg-[#1D4ED8]',
    dot: 'bg-[#1D4ED8]',
    text: 'text-[#1D4ED8]',
  },
  positive: {
    badge: 'border-[#0F6A53]/25 bg-[#ECFDF3] text-[#0F6A53]',
    softBg: 'bg-[#ECFDF3]',
    stripe: 'bg-[#0F6A53]',
    dot: 'bg-[#0F6A53]',
    text: 'text-[#0F6A53]',
  },
  neutral: {
    badge: 'border-[#E5E7EB] bg-[#F9FAFB] text-[#667085]',
    softBg: 'bg-[#F9FAFB]',
    stripe: 'bg-[#E5E7EB]',
    dot: 'bg-[#667085]',
    text: 'text-[#667085]',
  },
}

const TONE_ICONS: Record<UrgencyTone, LucideIcon> = {
  critical: AlertTriangle,
  warning: Clock3,
  info: Info,
  positive: CheckCircle2,
  neutral: Minus,
}

export function UrgencyBadge({
  tone,
  label,
  icon,
  className = '',
}: {
  tone: UrgencyTone
  label: string
  icon?: LucideIcon
  className?: string
}) {
  const Icon = icon || TONE_ICONS[tone]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${URGENCY_TONE_CLASSES[tone].badge} ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  )
}

// ─── Kind → tone mappings ──────────────────────────────────────────────

export function priorityToTone(priority: 'low' | 'normal' | 'high' | 'urgent'): UrgencyTone {
  if (priority === 'urgent') return 'critical'
  if (priority === 'high') return 'warning'
  return 'neutral'
}

export function slaToTone(state: 'overdue' | 'today' | 'upcoming' | 'none'): UrgencyTone {
  if (state === 'overdue') return 'critical'
  if (state === 'today') return 'warning'
  return 'neutral'
}

/** Speed-to-lead tiers (inbox): live → info, warning → warning, urgent/overdue → critical */
export function speedToLeadToTone(tier: 'live' | 'warning' | 'urgent' | 'overdue' | null): UrgencyTone | null {
  if (tier === null) return null
  if (tier === 'live') return 'info'
  if (tier === 'warning') return 'warning'
  return 'critical'
}

export function heatToTone(heat: 'risk' | 'hot' | 'warm' | 'cold' | 'dormant' | string): UrgencyTone {
  if (heat === 'risk') return 'critical'
  if (heat === 'hot' || heat === 'warm' || heat === 'cold') return 'warning'
  return 'neutral'
}

export function readinessToTone(status: 'fully_ready' | 'at_risk' | string): UrgencyTone {
  if (status === 'fully_ready') return 'positive'
  if (status === 'at_risk') return 'critical'
  return 'warning'
}

/** Lead-detail sales nudge urgency: high → critical, medium → warning, else neutral */
export function nudgeToTone(urgency: string): UrgencyTone {
  if (urgency === 'high') return 'critical'
  if (urgency === 'medium') return 'warning'
  return 'neutral'
}
