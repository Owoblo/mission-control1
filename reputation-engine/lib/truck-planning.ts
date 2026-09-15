import type { InventoryItem } from './types'
import { assemblyText, COMPLEX_ASSEMBLY } from './assembly-planning'

export type PlannedTruckSize = '10ft' | '15ft' | '20ft' | '26ft'

export interface PlannedTruck {
  size: PlannedTruckSize
  usableCubicFeet: number
  payloadLbs: number
}
export interface TruckLoadPlan {
  trucks: PlannedTruck[]
  totalUsableCubicFeet: number
  totalPayloadLbs: number
  volumeUtilizationPct: number
  payloadUtilizationPct?: number
  summary: string
  basis: string
  fits: boolean
  reviewReasons: string[]
}

// Conservative operating capacities. They deliberately leave room for pads,
// irregular shapes and safe loading instead of treating brochure volume as usable.
export const PLANNING_TRUCKS: Record<PlannedTruckSize, PlannedTruck> = {
  '10ft': { size: '10ft', usableCubicFeet: 250, payloadLbs: 2800 },
  '15ft': { size: '15ft', usableCubicFeet: 600, payloadLbs: 5000 },
  '20ft': { size: '20ft', usableCubicFeet: 900, payloadLbs: 5700 },
  '26ft': { size: '26ft', usableCubicFeet: 1600, payloadLbs: 10000 },
}

function describeTrucks(trucks: PlannedTruck[]) {
  const counts = trucks.reduce<Record<string, number>>((acc, truck) => {
    acc[truck.size] = (acc[truck.size] || 0) + 1
    return acc
  }, {})
  return (['26ft', '20ft', '15ft', '10ft'] as PlannedTruckSize[])
    .filter(size => counts[size])
    .map(size => `${counts[size]} × ${size}`)
    .join(' + ')
}

function combinations(count: number): PlannedTruck[][] {
  const specs = Object.values(PLANNING_TRUCKS)
  function build(remaining: number, start: number): PlannedTruck[][] {
    if (!remaining) return [[]]
    return specs.flatMap((truck, index) => index < start ? [] : build(remaining - 1, index).map(rest => [truck, ...rest]))
  }
  return build(count, 0)
}

export function recommendTruckLoadPlan(input: {
  totalCubicFeet: number
  totalWeightLbs?: number
  truckCount?: number
  inventory?: InventoryItem[]
  committedSize?: string
}): TruckLoadPlan {
  const finite = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.ceil(Number(value))) : 0
  const volume = finite(input.totalCubicFeet)
  const weight = finite(input.totalWeightLbs)
  const requestedCount = Math.max(1, Math.min(3, finite(input.truckCount) || Math.max(Math.ceil(volume / 1600), Math.ceil(weight / 10000), 1)))
  const committed = PLANNING_TRUCKS[input.committedSize as PlannedTruckSize]
  const reviewReasons: string[] = []
  if (!volume) reviewReasons.push('Inventory volume is missing; verify the load before reserving a truck.')
  if (input.committedSize && !committed) reviewReasons.push('The saved truck size is unsupported; operations must reconcile it.')
  if (Number(input.truckCount) > 3) reviewReasons.push('More than three trucks requires a separate operations plan.')
  const uncertain = (input.inventory || []).filter(item => item.included !== false &&
    (COMPLEX_ASSEMBLY.test(assemblyText(item)) || /sectional|patio furniture|bbq|barbecue|grill/i.test(assemblyText(item))) &&
    !(item.size?.trim() && Number(item.confidence) >= 0.8 && Number(item.weightLbs) > 0))
  if (uncertain.length) reviewReasons.push(`Verify loaded dimensions, weight and stackability: ${uncertain.map(item => item.name || item.item).join(', ')}.`)
  const options = committed ? [Array.from({ length: requestedCount }, () => committed)] : combinations(requestedCount)
  const valid = options.filter(trucks => {
    const cubicFeet = trucks.reduce((sum, truck) => sum + truck.usableCubicFeet, 0)
    const payload = trucks.reduce((sum, truck) => sum + truck.payloadLbs, 0)
    return cubicFeet >= volume && (!weight || payload >= weight)
  })
  const candidates = valid.length ? valid : options
  const trucks = candidates.sort((a, b) => {
    const aVolume = a.reduce((sum, truck) => sum + truck.usableCubicFeet, 0)
    const bVolume = b.reduce((sum, truck) => sum + truck.usableCubicFeet, 0)
    const aPayload = a.reduce((sum, truck) => sum + truck.payloadLbs, 0)
    const bPayload = b.reduce((sum, truck) => sum + truck.payloadLbs, 0)
    const aShortfall = Math.max(0, volume - aVolume) * 100 + Math.max(0, weight - aPayload)
    const bShortfall = Math.max(0, volume - bVolume) * 100 + Math.max(0, weight - bPayload)
    return aShortfall - bShortfall || aVolume - bVolume || aPayload - bPayload
  })[0]
  const totalUsableCubicFeet = trucks.reduce((sum, truck) => sum + truck.usableCubicFeet, 0)
  const totalPayloadLbs = trucks.reduce((sum, truck) => sum + truck.payloadLbs, 0)
  const summary = describeTrucks(trucks)
  const validCount = input.truckCount === undefined || (Number.isInteger(input.truckCount) && input.truckCount >= 1 && input.truckCount <= 3)
  const validWeight = input.totalWeightLbs === undefined || (Number.isFinite(input.totalWeightLbs) && input.totalWeightLbs >= 0)
  const fits = validCount && validWeight && Number.isFinite(input.totalCubicFeet) && volume > 0 && totalUsableCubicFeet >= volume && (!weight || totalPayloadLbs >= weight) && (!input.committedSize || Boolean(committed))
  if (!fits) reviewReasons.push('The selected truck plan does not have verified sufficient capacity; increase capacity or document a trip plan.')
  if (volume / totalUsableCubicFeet > 0.85 && uncertain.length) reviewReasons.push('Load is near usable capacity with unverified furniture; operations must review a larger truck.')
  return {
    fits, reviewReasons,
    trucks,
    totalUsableCubicFeet,
    totalPayloadLbs,
    volumeUtilizationPct: totalUsableCubicFeet ? Math.round((volume / totalUsableCubicFeet) * 100) : 0,
    payloadUtilizationPct: weight && totalPayloadLbs ? Math.round((weight / totalPayloadLbs) * 100) : undefined,
    summary,
    basis: `${summary} ${committed ? 'selected' : 'recommended'} from ${volume.toLocaleString()} cu ft${weight ? ` / ${weight.toLocaleString()} lb` : ''} of included inventory`,
  }
}
