import { getFastLaneTruckSize } from './sales-automation-qualification'

export const FAST_QUOTE_TRUCK_SIZES = ['15ft', '20ft', '26ft'] as const
export type FastQuoteTruckSize = typeof FAST_QUOTE_TRUCK_SIZES[number]

/** Equipment selections describe the job; they never participate in pricing. */
export function fastQuoteTruckConfiguration(moveType: 'truck' | 'labor', crew: 2 | 3 | 4, input: { truckSize?: unknown; truckCount?: unknown }) {
  if (moveType === 'labor') return { truckSize: undefined, truckCount: 0 }
  const truckSize = input.truckSize ?? getFastLaneTruckSize(crew)
  const truckCount = input.truckCount ?? 1
  if (!FAST_QUOTE_TRUCK_SIZES.includes(truckSize as FastQuoteTruckSize)) throw new Error('Choose a 15ft, 20ft or 26ft truck.')
  if (typeof truckCount !== 'number' || !Number.isInteger(truckCount) || truckCount < 1 || truckCount > 20) throw new Error('Choose a whole number of trucks from 1 to 20.')
  return { truckSize: truckSize as FastQuoteTruckSize, truckCount }
}

export function fastQuoteCrewLabel(crew: number, truckSize: string | undefined, truckCount: number) {
  const movers = `${crew} mover${crew === 1 ? '' : 's'}`
  if (!truckCount) return `${movers} (labour only)`
  // Preserve the existing single-truck quote wording exactly.
  return truckCount === 1 ? `${movers} + ${truckSize} truck` : `${movers} + ${truckCount} × ${truckSize} trucks`
}
