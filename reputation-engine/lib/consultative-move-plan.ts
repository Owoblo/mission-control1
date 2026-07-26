import type { CRMLead, JobFactors, QuoteLineItem } from './types'

export type MovePlanPhase = 'prepare' | 'move_out' | 'hold' | 'move_in' | 'settle'

export interface ConsultativeMovePlan {
  phases: Array<{
    id: MovePlanPhase
    label: string
    status: 'included' | 'optional' | 'pending'
    summary: string
  }>
  questions: string[]
  assumptions: string[]
  recommendedServices: Array<'packing' | 'storage' | 'cleaning' | 'protection'>
  canBeBinding: boolean
  estimateMode: 'firm' | 'locked_scope' | 'provisional'
  estimateMessage: string
  knownNow: string[]
  finalizeLater: string[]
  nudges: Array<{
    key: 'confirm_exact_date' | 'confirm_destination_property' | 'confirm_storage_end' | 'review_home_sale'
    label: string
    trigger: string
  }>
}

function hasLine(lines: QuoteLineItem[], pattern: RegExp) {
  return lines.some(line => pattern.test(`${line.description} ${line.details || ''}`))
}

export function buildConsultativeMovePlan(input: {
  factors?: JobFactors
  lineItems?: QuoteLineItem[]
  destinationKnown?: boolean
  lead?: Pick<CRMLead,
    | 'moveDate'
    | 'moveDateFlexible'
    | 'moveDateFlexibleReason'
    | 'originAddress'
    | 'originCity'
    | 'destAddress'
    | 'destCity'
    | 'propertyType'
    | 'tentativeReason'
    | 'followUpDate'
  >
}): ConsultativeMovePlan {
  const factors = input.factors || {}
  const lines = input.lineItems || []
  const lead = input.lead
  const questions: string[] = []
  const assumptions: string[] = []
  const knownNow: string[] = []
  const finalizeLater: string[] = []
  const nudges: ConsultativeMovePlan['nudges'] = []
  const recommended = new Set<ConsultativeMovePlan['recommendedServices'][number]>()
  const storageNeeded = Boolean(factors.temporaryStorageNeeded || factors.destinationTiming === 'known_gap' || factors.destinationTiming === 'unknown')
  const destinationAddressKnown = Boolean(lead?.destAddress) || input.destinationKnown === true
  const destinationCityKnown = Boolean(lead?.destCity)
  const destinationKnown = input.destinationKnown !== false && factors.destinationTiming !== 'unknown'
  const dateFlexible = Boolean(lead?.moveDateFlexible)
  const waitingForSale = lead?.tentativeReason === 'waiting_for_sale' ||
    /\b(?:sell|sale|buyer|house.*sold)\b/i.test(lead?.moveDateFlexibleReason || '')

  if (lead?.originAddress || lead?.originCity) knownNow.push(`Pickup: ${lead.originAddress || lead.originCity}`)
  if (destinationAddressKnown) knownNow.push(`Destination: ${lead?.destAddress || 'address captured'}`)
  else if (destinationCityKnown) knownNow.push(`Destination market: ${lead?.destCity}`)
  if (lead?.moveDate && !dateFlexible) knownNow.push(`Move date: ${lead.moveDate}`)
  else if (dateFlexible) knownNow.push(`Timing target: ${lead?.moveDateFlexibleReason || 'date still flexible'}`)
  if (lead?.propertyType) knownNow.push(`Property type: ${lead.propertyType.replaceAll('_', ' ')}`)

  if (dateFlexible) {
    finalizeLater.push('Exact move date and crew availability')
    nudges.push({
      key: waitingForSale ? 'review_home_sale' : 'confirm_exact_date',
      label: waitingForSale ? 'Check sale/closing progress and tighten the move window' : 'Confirm the exact move date',
      trigger: lead?.followUpDate || 'At the agreed check-in milestone',
    })
    assumptions.push(`Price is based on the current scope and timing target (${lead?.moveDateFlexibleReason || 'date TBD'}); availability and date-sensitive costs are reconfirmed when the date is selected.`)
  }

  if (!destinationAddressKnown && destinationCityKnown) {
    const destinationCity = lead?.destCity || 'the destination city'
    finalizeLater.push('Exact destination address and access')
    if (!lead?.propertyType) {
      questions.push(`Are you expecting a house, apartment, condo, or storage destination in ${destinationCity}?`)
    }
    nudges.push({
      key: 'confirm_destination_property',
      label: 'Confirm destination property and access',
      trigger: lead?.followUpDate || 'When the customer chooses the property',
    })
    assumptions.push(`Travel is modeled to ${destinationCity}; final mileage and destination access adjust when the address is known.`)
  }

  if (!factors.destinationTiming) questions.push('Do the sale and possession dates line up, or is there a gap between homes?')
  if (storageNeeded && !factors.storageDurationKnown) {
    questions.push('Is the storage end date known, or should we show a monthly allowance that can be adjusted later?')
    assumptions.push(`Storage allowance based on ${Math.max(1, factors.storageEstimatedMonths || 2)} month(s); actual duration adjusts when the move-in date is known.`)
    recommended.add('storage')
    finalizeLater.push('Storage release or move-in date')
    nudges.push({
      key: 'confirm_storage_end',
      label: 'Confirm storage end date and second move-in leg',
      trigger: lead?.followUpDate || 'Before the storage allowance expires',
    })
  }
  if (!factors.packingPreference || factors.packingPreference === 'undecided') {
    questions.push('Would you like to pack yourselves, have help with selected rooms, or have us handle the full pack?')
  }
  if (factors.packingPreference === 'partial_help' || factors.packingPreference === 'full_service') recommended.add('packing')
  if (!factors.cleaningPreference || factors.cleaningPreference === 'undecided') {
    questions.push('Would move-out or move-in cleaning remove stress from the handover?')
  } else if (factors.cleaningPreference !== 'none') {
    recommended.add('cleaning')
  }
  if (!factors.protectionPreference || factors.protectionPreference === 'undecided') {
    questions.push('Is standard protection enough, or should we review enhanced protection for high-value pieces?')
  } else if (factors.protectionPreference === 'enhanced') {
    recommended.add('protection')
  }

  const storagePriced = hasLine(lines, /\bstorage\b/i)
  const packingPriced = hasLine(lines, /\bpack(?:ing|ed)?\b/i)
  const cleaningPriced = hasLine(lines, /\bclean(?:ing)?\b/i)
  const protectionPriced = hasLine(lines, /\b(?:valuation|protection|insurance)\b/i)

  if (storageNeeded && !storagePriced) assumptions.push('Storage handling and monthly storage still need pricing.')
  if (recommended.has('packing') && !packingPriced) assumptions.push('Requested packing help is not yet included in the price.')
  if (recommended.has('cleaning') && !cleaningPriced) assumptions.push('Requested cleaning is not yet included in the price.')
  if (recommended.has('protection') && !protectionPriced) assumptions.push('Enhanced protection still needs selection and pricing.')

  const phases: ConsultativeMovePlan['phases'] = [
    {
      id: 'prepare',
      label: 'Prepare',
      status: packingPriced ? 'included' : recommended.has('packing') ? 'pending' : 'optional',
      summary: packingPriced ? 'Packing support is included.' : 'Self-pack or add partial/full packing.',
    },
    {
      id: 'move_out',
      label: 'Move out',
      status: 'included',
      summary: 'Load, protect, transport, disassemble and reassemble as scoped.',
    },
  ]
  if (storageNeeded) {
    phases.push({
      id: 'hold',
      label: 'Hold',
      status: storagePriced ? 'included' : 'pending',
      summary: factors.storageDurationKnown
        ? `${Math.max(1, factors.storageEstimatedMonths || 1)} month storage period.`
        : `Flexible storage allowance; currently modeled at ${Math.max(1, factors.storageEstimatedMonths || 2)} months.`,
    })
  }
  phases.push({
    id: 'move_in',
    label: 'Move in',
    status: destinationKnown ? 'included' : 'pending',
    summary: destinationKnown ? 'Delivery and placement at the destination.' : 'Date and destination can be added without rebuilding the whole plan.',
  })
  phases.push({
    id: 'settle',
    label: 'Settle',
    status: cleaningPriced ? 'included' : recommended.has('cleaning') ? 'pending' : 'optional',
    summary: cleaningPriced ? 'Cleaning support is included.' : 'Cleaning and unpacking remain optional.',
  })

  const unresolvedCommercialInputs = assumptions.length > 0 || questions.length > 0
  const estimateMode: ConsultativeMovePlan['estimateMode'] =
    !dateFlexible && destinationAddressKnown && !unresolvedCommercialInputs
      ? 'firm'
      : knownNow.length > 0 && (lead?.originAddress || lead?.originCity)
        ? 'locked_scope'
        : 'provisional'
  const estimateMessage = estimateMode === 'firm'
    ? 'The route, date, and selected services are defined enough for a firm estimate.'
    : estimateMode === 'locked_scope'
      ? 'Price the known white-glove scope now. Lock those assumptions in writing, then adjust only the date-, destination-, or duration-sensitive pieces when they become known.'
      : 'Give a transparent planning estimate now and identify the few facts that materially affect the final price.'

  return {
    phases,
    questions: questions.slice(0, 3),
    assumptions,
    recommendedServices: [...recommended],
    canBeBinding: destinationKnown && questions.length === 0 && assumptions.length === 0,
    estimateMode,
    estimateMessage,
    knownNow,
    finalizeLater: [...new Set(finalizeLater)],
    nudges: nudges.filter((nudge, index, all) => all.findIndex(item => item.key === nudge.key) === index),
  }
}
