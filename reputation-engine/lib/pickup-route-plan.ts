export type RouteLeg = { distanceKm: number; driveHours: number }
export type RouteMatrix = Record<string, RouteLeg>
export function comparePickupRoutes(matrix: RouteMatrix, loads: { original: number; additional: number; capacity: number; originalWeight: number; additionalWeight: number; payload: number; verified: boolean }) {
  const choices = [
    { label: 'Original pickup → additional pickup → delivery', stops: [0, 1, 2, 3, 0], combined: true },
    { label: 'Additional pickup → original pickup → delivery', stops: [0, 2, 1, 3, 0], combined: true },
    { label: 'Original pickup → delivery → additional pickup → delivery', stops: [0, 1, 3, 2, 3, 0], combined: false },
    { label: 'Additional pickup → delivery → original pickup → delivery', stops: [0, 2, 3, 1, 3, 0], combined: false },
  ]
  return choices.map(choice => {
    const legs = choice.stops.slice(1).map((stop, i) => matrix[`${choice.stops[i]}-${stop}`])
    const complete = legs.every(leg => leg && Number.isFinite(leg.distanceKm) && leg.distanceKm >= 0 && Number.isFinite(leg.driveHours) && leg.driveHours >= 0)
    const peakCubicFeet = choice.combined ? loads.original + loads.additional : Math.max(loads.original, loads.additional)
    const peakWeightLbs = choice.combined ? loads.originalWeight + loads.additionalWeight : Math.max(loads.originalWeight, loads.additionalWeight)
    return { ...choice, complete, distanceKm: complete ? Math.round(legs.reduce((n, l) => n + l.distanceKm, 0)) : null,
      driveHours: complete ? legs.reduce((n, l) => n + l.driveHours, 0) : null,
      peakCubicFeet, peakWeightLbs,
      capacityStatus: !loads.verified ? 'unverified' : peakCubicFeet <= loads.capacity && peakWeightLbs <= loads.payload ? 'fits' : 'exceeds' }
  }).sort((a, b) => (a.driveHours ?? Infinity) - (b.driveHours ?? Infinity) || (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
}
