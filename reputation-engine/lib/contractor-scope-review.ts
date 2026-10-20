import type { CRMLead, CRMQuote } from './types'

const clean = (value: unknown) => typeof value === 'string' ? value.replace(/Converted an AI group total to per-item dimensions before quantity multiplication\.?/gi, '').trim() : ''
export function buildContractorScope(lead: CRMLead, quote: CRMQuote | null, contactName: string) {
  const profiles = lead.jobFactors?.accessProfiles || []
  return {
    contactName, date: lead.moveDate || quote?.moveDate || '', time: lead.moveTime || quote?.moveTime || '',
    origin: lead.originCity || '', destination: lead.destCity || '', crew: quote?.crewSize || null,
    trucks: quote?.truckCount || null, truck: lead.truckSize || quote?.truckSize || '',
    packing: lead.jobFactors?.packingPreference || lead.jobFactors?.packingStatus || '',
    inventory: (lead.inventory || []).map(item => ({
      name: (item.qty && item.qty > 1 ? clean(item.name || item.item).replace(new RegExp(`^${item.qty}\\s+`), '') : clean(item.name || item.item)) || 'Item to confirm', quantity: item.qty ?? null,
      room: clean(item.room), size: clean(item.size), notes: clean(item.notes), included: item.included !== false,
      needsConfirmation: item.status === 'needs_confirmation' || !!item.quantityNeedsConfirmation || !!item.nameNeedsConfirmation,
      originFloor: item.originFloor ?? null, destinationFloor: item.destinationFloor ?? null,
    })),
    access: profiles.map(profile => ({
      stop: profile.stopRole === 'pickup' ? 'Pickup' : profile.stopRole === 'dropoff' ? 'Delivery' : 'Additional stop',
      property: profile.propertyType, vertical: profile.verticalMode, parking: profile.truckPosition,
      exteriorSteps: profile.exteriorSteps, confirmed: profile.evidenceStatus === 'customer_confirmed',
      narrowDoor: profile.narrowDoor, tightTurn: profile.tightTurn,
    })),
  }
}
export type ContractorScope = ReturnType<typeof buildContractorScope>
