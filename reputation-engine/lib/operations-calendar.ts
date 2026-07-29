import type { CRMLead, CRMQuote, QuoteLeg, QuoteLegType } from './types'

export interface OperationsCalendarOccurrence {
  key: string
  date: string
  legId?: string
  legIndex?: number
  legLabel?: string
  legType?: QuoteLegType
  originAddress?: string
  destinationAddress?: string
}

function validCalendarDate(value?: string): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function occurrenceFromLeg(
  quote: CRMQuote,
  leg: QuoteLeg,
  legIndex: number,
  date: string,
): OperationsCalendarOccurrence {
  return {
    key: `${quote.id}:leg:${leg.id || legIndex}:${date}`,
    date,
    legId: leg.id,
    legIndex,
    legLabel: leg.label || `Leg ${legIndex + 1}`,
    legType: leg.type,
    originAddress: leg.originAddress || leg.originCity,
    destinationAddress: leg.destAddress || leg.destCity,
  }
}

/**
 * Projects one booked job into its real operational commitments.
 * Multi-leg moves use their leg dates; ordinary moves retain the lead/quote date.
 */
export function getOperationsCalendarOccurrences(
  lead: Pick<CRMLead, 'id' | 'moveDate'>,
  quote: CRMQuote | null,
): OperationsCalendarOccurrence[] {
  const baseDate = validCalendarDate(lead.moveDate)
    ? lead.moveDate
    : validCalendarDate(quote?.moveDate)
      ? quote.moveDate
      : undefined
  const legs = quote?.legs || []

  if (legs.length > 1 && quote) {
    const occurrences: OperationsCalendarOccurrence[] = []
    legs.forEach((leg, legIndex) => {
      const date = validCalendarDate(leg.scheduledDate)
        ? leg.scheduledDate
        : legIndex === 0
          ? baseDate
          : undefined
      if (date) occurrences.push(occurrenceFromLeg(quote, leg, legIndex, date))
    })
    if (occurrences.length > 0) return occurrences
  }

  return baseDate
    ? [{ key: `${quote?.id || lead.id}:move:${baseDate}`, date: baseDate }]
    : []
}

export function hasOperationsOccurrenceOnDate(
  lead: Pick<CRMLead, 'id' | 'moveDate'>,
  quote: CRMQuote | null,
  date: string,
) {
  return getOperationsCalendarOccurrences(lead, quote).some(occurrence => occurrence.date === date)
}
