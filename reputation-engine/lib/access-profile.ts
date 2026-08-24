import type { AccessProfile, AccessWalkBucket, CRMLead, JobFactors, QuoteLeg } from './types'

export const STANDARD_ACCESS_ASSUMPTION = 'Ground-floor access, no more than three entrance steps, normal doors and hallways, no elevator or building procedure, and legal truck parking within about a one-minute carrying route.'

export type StopAccessCalculation = {
  profileId: string
  stopId: string
  label: string
  baseHandlingHours: number
  longCarryFactor: number
  verticalFactor: number
  obstructionFactor: number
  fixedDelayHours: number
  additionalAccessHours: number
  adjustedHandlingHours: number
  assumptions: string[]
  warnings: string[]
  manualReviewReasons: string[]
  ready: boolean
  provisional: boolean
}

export type MoveAccessPlan = {
  stops: StopAccessCalculation[]
  additionalAccessHours: number
  manualReviewReasons: string[]
  warnings: string[]
  ready: boolean
}

const WALK_MINUTES: Record<AccessWalkBucket, number | null> = {
  under_1: 0.5,
  '1_2': 1.5,
  '2_4': 3,
  '4_6': 5,
  '6_8': 7,
  over_8: 9,
  unknown: null,
}

function roundQuarter(value: number) {
  return Math.round(value * 4) / 4
}

function roundHundredth(value: number) {
  return Math.round(value * 100) / 100
}

function sumWalkMinutes(profile: AccessProfile) {
  const buckets = [profile.walkToEntrance, profile.entranceToVerticalAccess, profile.verticalAccessToUnit]
  if (buckets.some(bucket => !bucket || bucket === 'unknown')) return null
  return buckets.reduce((sum, bucket) => sum + Number(WALK_MINUTES[bucket!] || 0), 0)
}

function longCarryFactor(minutes: number | null) {
  if (minutes === null) return 0.25
  if (minutes < 1) return 0
  if (minutes <= 2) return 0.1
  if (minutes <= 4) return 0.2
  if (minutes <= 6) return 0.35
  if (minutes <= 8) return 0.5
  return 0
}

function stairExposureScale(profile: AccessProfile) {
  if (profile.stairExposure === 'half_shipment') return 0.5
  if (profile.stairExposure === 'specific_items') return 0.25
  return 1
}

function stairsFactor(profile: AccessProfile) {
  const flights = Number(profile.stairFlights || 0)
  let factor = flights <= 0 ? 0 : flights === 1 ? 0.15 : flights === 2 ? 0.3 : flights === 3 ? 0.5 : flights === 4 ? 0.7 : 0
  if (profile.exteriorSteps && profile.exteriorSteps > 3 && flights === 0) factor += profile.exteriorSteps <= 12 ? 0.1 : 0.15
  if (profile.stairCondition && profile.stairCondition !== 'normal') factor += 0.1
  return factor * stairExposureScale(profile)
}

function elevatorFactor(profile: AccessProfile) {
  const reservation = profile.elevatorReservation
  if (reservation === 'unknown' || !reservation) return 0.25
  if (reservation === 'shared') return profile.elevatorWait === 'likely_delays' ? 0.4 : 0.3
  if (reservation === 'requested') return 0.25
  if (reservation === 'not_available') return 0
  if (profile.elevatorType === 'freight') return profile.elevatorWait === 'slow' ? 0.2 : 0.1
  return profile.elevatorWait === 'slow' ? 0.2 : 0.15
}

function obstructionFactor(profile: AccessProfile) {
  return Math.min(0.3, (profile.narrowDoor ? 0.1 : 0) + (profile.tightTurn ? 0.1 : 0) + (profile.normalEntranceUsable === false ? 0.1 : 0))
}

export function createStandardAccessProfile(input: Pick<AccessProfile, 'id' | 'stopId' | 'stopRole' | 'label' | 'addressSnapshot'> & { verifiedBy?: string }): AccessProfile {
  return {
    ...input,
    standardAccessConfirmed: true,
    truckPosition: 'driveway',
    walkToEntrance: 'under_1',
    entranceToVerticalAccess: 'under_1',
    verticalAccessToUnit: 'under_1',
    exteriorSteps: 0,
    narrowDoor: false,
    tightTurn: false,
    normalEntranceUsable: true,
    verticalMode: 'ground_floor',
    evidenceStatus: 'customer_confirmed',
    evidenceNote: STANDARD_ACCESS_ASSUMPTION,
    verifiedAt: new Date().toISOString(),
  }
}

export function legacyAccessProfiles(lead: Pick<CRMLead, 'originAddress' | 'originCity' | 'destAddress' | 'destCity' | 'jobFactors'>): AccessProfile[] {
  if (lead.jobFactors?.accessProfiles?.length) return lead.jobFactors.accessProfiles
  const factors = lead.jobFactors || {}
  const build = (side: 'origin' | 'destination'): AccessProfile => {
    const origin = side === 'origin'
    const floors = origin ? factors.originFloors : factors.destFloors
    const hasElevator = origin ? factors.originHasElevator : factors.destHasElevator
    const elevatorReserved = origin ? factors.originElevatorReserved : factors.destElevatorReserved
    const parkingOk = origin ? factors.originParkingOk : factors.destParkingOk
    const carryFeet = origin ? factors.originCarryDistanceFeet : factors.destCarryDistanceFeet
    const accessStatus = origin ? factors.originAccessStatus : factors.destAccessStatus
    const address = origin ? [lead.originAddress, lead.originCity].filter(Boolean).join(', ') : [lead.destAddress, lead.destCity].filter(Boolean).join(', ')
    const standard = floors === 1 && hasElevator === false && parkingOk === true
    return {
      id: `legacy-${side}`,
      stopId: `primary-${side}`,
      stopRole: origin ? 'pickup' : 'dropoff',
      label: origin ? 'Origin' : 'Destination',
      addressSnapshot: address,
      standardAccessConfirmed: standard,
      truckPosition: parkingOk === true ? 'driveway' : parkingOk === false ? 'street_unconfirmed' : 'unknown',
      walkToEntrance: carryFeet ? carryFeet <= 50 ? 'under_1' : carryFeet <= 150 ? '1_2' : carryFeet <= 300 ? '2_4' : '4_6' : standard ? 'under_1' : 'unknown',
      entranceToVerticalAccess: standard ? 'under_1' : 'unknown',
      verticalAccessToUnit: standard ? 'under_1' : 'unknown',
      exteriorSteps: origin ? factors.originExteriorSteps : factors.destExteriorSteps,
      narrowDoor: origin ? factors.originNarrowDoorwayRisk : factors.destNarrowDoorwayRisk,
      tightTurn: origin ? factors.originTightTurnRisk : factors.destTightTurnRisk,
      verticalMode: hasElevator === true ? 'elevator' : floors && floors > 1 ? 'stairs' : floors === 1 ? 'ground_floor' : 'unknown',
      stairFlights: hasElevator === false && floors ? Math.max(0, floors - 1) : undefined,
      elevatorReservation: hasElevator ? elevatorReserved ? 'confirmed' : 'unknown' : undefined,
      evidenceStatus: accessStatus === 'verified' ? 'customer_confirmed' : accessStatus === 'inferred' ? 'customer_estimated' : 'unknown',
      evidenceNote: standard ? STANDARD_ACCESS_ASSUMPTION : 'Migrated from the existing access fields; confirm the detailed carrying route.',
    }
  }
  return [build('origin'), build('destination')]
}

export function accessProfilesForStops(input: { lead: Pick<CRMLead, 'originAddress' | 'originCity' | 'destAddress' | 'destCity' | 'jobFactors'>; legs?: QuoteLeg[] }): AccessProfile[] {
  const existing = input.lead.jobFactors?.accessProfiles || []
  const primary = legacyAccessProfiles({ ...input.lead, jobFactors: { ...(input.lead.jobFactors || {}), accessProfiles: undefined } })
  const normalizeAddress = (value?: string) => {
    const ignored = new Set(['ontario', 'on', 'canada'])
    const seen = new Set<string>()
    return (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(token => token && !ignored.has(token) && !/^[a-z]\d[a-z]\d[a-z]\d$/i.test(token))
      .filter(token => {
        if (seen.has(token)) return false
        seen.add(token)
        return true
      })
      .join(' ')
  }
  const result: AccessProfile[] = []
  for (const profile of existing.length ? [...existing, ...primary] : primary) {
    const normalized = normalizeAddress(profile.addressSnapshot)
    const duplicate = normalized && result.some(current => normalizeAddress(current.addressSnapshot) === normalized && current.stopRole === profile.stopRole)
    if (!duplicate && !result.some(current => current.stopId === profile.stopId)) result.push(profile)
  }
  const normalizedAddresses = new Set(result.map(profile => `${profile.stopRole}:${normalizeAddress(profile.addressSnapshot)}`).filter(value => !value.endsWith(':')))
  for (const leg of input.legs || []) {
    const stops = [
      { suffix: 'origin', role: 'pickup' as const, address: [leg.originAddress, leg.originCity].filter(Boolean).join(', ') },
      { suffix: 'destination', role: leg.type === 'storage' ? 'storage' as const : 'dropoff' as const, address: [leg.destAddress, leg.destCity].filter(Boolean).join(', ') },
    ]
    for (const stop of stops) {
      const normalized = normalizeAddress(stop.address)
      const normalizedKey = `${stop.role}:${normalized}`
      if (!normalized || normalizedAddresses.has(normalizedKey)) continue
      normalizedAddresses.add(normalizedKey)
      result.push({ id: `access-${leg.id}-${stop.suffix}`, stopId: `leg:${leg.id}:${stop.suffix}`, stopRole: stop.role, label: `${leg.label} · ${stop.suffix === 'origin' ? 'pickup' : 'destination'}`, addressSnapshot: stop.address, evidenceStatus: 'unknown' })
    }
  }
  return result
}

export function calculateStopAccess(profile: AccessProfile, baseHandlingHours: number): StopAccessCalculation {
  const assumptions: string[] = []
  const warnings: string[] = []
  const manualReviewReasons: string[] = []
  const walkMinutes = sumWalkMinutes(profile)
  const carryFactor = profile.standardAccessConfirmed ? 0 : longCarryFactor(walkMinutes)
  if (walkMinutes === null) warnings.push(`${profile.label}: carrying route is unknown; 25% provisional allowance shown in shadow mode.`)
  else if (walkMinutes > 8) manualReviewReasons.push(`${profile.label}: carrying route exceeds eight minutes.`)
  else assumptions.push(`${profile.label}: approximately ${walkMinutes < 1 ? 'under one' : walkMinutes} minute total one-way carrying route.`)

  let verticalFactor = 0
  if (!profile.standardAccessConfirmed && (profile.verticalMode === 'stairs' || profile.verticalMode === 'elevator_and_stairs')) verticalFactor += stairsFactor(profile)
  if (!profile.standardAccessConfirmed && (profile.verticalMode === 'elevator' || profile.verticalMode === 'stairs_or_elevator' || profile.verticalMode === 'elevator_and_stairs')) verticalFactor += elevatorFactor(profile)
  if (Number(profile.stairFlights || 0) >= 5) manualReviewReasons.push(`${profile.label}: five or more stair flights.`)
  if (Number(profile.unitFloor || 0) > 4 && profile.elevatorReservation === 'not_available') manualReviewReasons.push(`${profile.label}: no usable elevator above the fourth floor.`)
  if (profile.elevatorFitsMajorFurniture === false) manualReviewReasons.push(`${profile.label}: elevator may not fit major furniture.`)
  if (profile.truckPosition === 'cannot_reach' || profile.shuttleMayBeRequired) manualReviewReasons.push(`${profile.label}: truck access may require a shuttle.`)
  if (profile.multipleTransfers) manualReviewReasons.push(`${profile.label}: more than one building transfer is required.`)
  if (profile.unsafeAccess || profile.stairCondition === 'unsafe') manualReviewReasons.push(`${profile.label}: unsafe access reported.`)

  const obstruction = profile.standardAccessConfirmed ? 0 : obstructionFactor(profile)
  const fixedDelayMinutes = Number(profile.expectedDelayMinutes || 0) + Number(profile.loadingDockProcedureMinutes || 0) + (profile.buildingCheckIn ? 15 : 0) + (profile.elevatorPadding ? 15 : 0)
  if (profile.buildingStaffRequired && profile.evidenceStatus === 'unknown') manualReviewReasons.push(`${profile.label}: required building staff are not confirmed.`)
  const fixedDelayHours = roundQuarter(fixedDelayMinutes / 60)
  const additionalAccessHours = roundHundredth(baseHandlingHours * (carryFactor + verticalFactor + obstruction) + fixedDelayHours)
  const verified = profile.standardAccessConfirmed || (profile.evidenceStatus && profile.evidenceStatus !== 'unknown')
  if (!verified) warnings.push(`${profile.label}: access evidence is not confirmed.`)

  return {
    profileId: profile.id,
    stopId: profile.stopId,
    label: profile.label,
    baseHandlingHours: roundQuarter(baseHandlingHours),
    longCarryFactor: carryFactor,
    verticalFactor,
    obstructionFactor: obstruction,
    fixedDelayHours,
    additionalAccessHours,
    adjustedHandlingHours: roundHundredth(baseHandlingHours + additionalAccessHours),
    assumptions,
    warnings,
    manualReviewReasons,
    ready: Boolean(verified) && warnings.length === 0 && manualReviewReasons.length === 0,
    provisional: warnings.length > 0,
  }
}

export function calculateMoveAccessPlan(profiles: AccessProfile[], baseHours: { origin: number; destination: number }): MoveAccessPlan {
  const stops = profiles.map((profile, index) => calculateStopAccess(profile, profile.stopRole === 'dropoff' ? baseHours.destination : index === 0 ? baseHours.origin : baseHours.origin * 0.5))
  return {
    stops,
    additionalAccessHours: roundHundredth(stops.reduce((sum, stop) => sum + stop.additionalAccessHours, 0)),
    manualReviewReasons: stops.flatMap(stop => stop.manualReviewReasons),
    warnings: stops.flatMap(stop => stop.warnings),
    ready: stops.every(stop => stop.ready),
  }
}

export function accessProfileCustomerSummary(profile: AccessProfile) {
  if (profile.standardAccessConfirmed) return `${profile.label}: customer confirmed standard ground-floor access, normal entrances, and nearby legal truck parking.`
  const parts = [profile.propertyType?.replace(/_/g, ' ')]
  const walk = sumWalkMinutes(profile)
  if (walk !== null) parts.push(walk < 1 ? 'under a one-minute carrying route' : `approximately ${walk} minutes of carrying route per trip`)
  if (profile.verticalMode === 'stairs') parts.push(`${profile.stairFlights || 0} stair flight${profile.stairFlights === 1 ? '' : 's'}`)
  if (profile.verticalMode?.includes('elevator') || profile.verticalMode === 'stairs_or_elevator') parts.push(`${profile.elevatorReservation === 'confirmed' ? 'reserved' : profile.elevatorReservation === 'shared' ? 'shared' : 'planned'} ${profile.elevatorType || ''} elevator`.replace(/\s+/g, ' ').trim())
  if (profile.buildingCheckIn) parts.push('normal building check-in')
  if (profile.loadingDockProcedureMinutes) parts.push(`${profile.loadingDockProcedureMinutes}-minute loading-dock procedure`)
  return `${profile.label}: ${parts.filter(Boolean).join(', ')}.`
}

export function profilesFromFactors(factors?: JobFactors) {
  return factors?.accessProfiles || []
}
