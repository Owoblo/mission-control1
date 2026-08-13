export type PlannedTruckSize = '15ft' | '20ft' | '26ft'

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
}

// Conservative operating capacities. They deliberately leave room for pads,
// irregular shapes and safe loading instead of treating brochure volume as usable.
export const PLANNING_TRUCKS: Record<PlannedTruckSize, PlannedTruck> = {
  '15ft': { size: '15ft', usableCubicFeet: 750, payloadLbs: 5000 },
  '20ft': { size: '20ft', usableCubicFeet: 1000, payloadLbs: 5700 },
  '26ft': { size: '26ft', usableCubicFeet: 1600, payloadLbs: 10000 },
}

function describeTrucks(trucks: PlannedTruck[]) {
  const counts = trucks.reduce<Record<string, number>>((acc, truck) => {
    acc[truck.size] = (acc[truck.size] || 0) + 1
    return acc
  }, {})
  return (['26ft', '20ft', '15ft'] as PlannedTruckSize[])
    .filter(size => counts[size])
    .map(size => `${counts[size]} × ${size}`)
    .join(' + ')
}

function combinations(count: number): PlannedTruck[][] {
  const specs = Object.values(PLANNING_TRUCKS)
  if (count === 1) return specs.map(truck => [truck])
  const result: PlannedTruck[][] = []
  for (let i = 0; i < specs.length; i += 1) {
    for (let j = i; j < specs.length; j += 1) result.push([specs[i], specs[j]])
  }
  return result
}

export function recommendTruckLoadPlan(input: {
  totalCubicFeet: number
  totalWeightLbs?: number
  truckCount?: number
}): TruckLoadPlan {
  const volume = Math.max(0, Math.round(input.totalCubicFeet || 0))
  const weight = Math.max(0, Math.round(input.totalWeightLbs || 0))
  const requestedCount = Math.max(1, Math.min(2, Math.round(input.truckCount || (volume > 1600 || weight > 10000 ? 2 : 1))))
  const valid = combinations(requestedCount).filter(trucks => {
    const cubicFeet = trucks.reduce((sum, truck) => sum + truck.usableCubicFeet, 0)
    const payload = trucks.reduce((sum, truck) => sum + truck.payloadLbs, 0)
    return cubicFeet >= volume && (!weight || payload >= weight)
  })
  const candidates = valid.length ? valid : combinations(requestedCount)
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
  return {
    trucks,
    totalUsableCubicFeet,
    totalPayloadLbs,
    volumeUtilizationPct: totalUsableCubicFeet ? Math.round((volume / totalUsableCubicFeet) * 100) : 0,
    payloadUtilizationPct: weight && totalPayloadLbs ? Math.round((weight / totalPayloadLbs) * 100) : undefined,
    summary,
    basis: `${summary} recommended from ${volume.toLocaleString()} cu ft${weight ? ` / ${weight.toLocaleString()} lb` : ''} of included inventory`,
  }
}

