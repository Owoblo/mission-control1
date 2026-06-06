import type { InventoryItem, QuoteLeg } from './types'

export type LogisticsPlanRecommendation = 'one_truck_sequence' | 'one_truck_shuttle' | 'two_truck_parallel' | 'split_day' | 'needs_route_data'

export interface LogisticsPickupContext {
  id: string
  label: string
  cubicFeet: number
  itemCount: number
  address?: string
  accessNotes?: string
  inventoryPending?: boolean
  timingConstraint?: string
}

export interface LogisticsTimeConstraint {
  type: 'keys' | 'closing' | 'elevator' | 'parking' | 'date' | 'time_window' | 'building_access' | 'storage' | 'other'
  label: string
  time?: string
  date?: string
  appliesTo?: string
  impact?: string
}

export interface LogisticsPlanInput {
  legs: QuoteLeg[]
  inventory: InventoryItem[]
  totalCubicFeet?: number
  loadHours?: number
  unloadHours?: number
  totalHours?: number
  crewSize?: number
  startTime?: string
  singleTruckCapacity?: number
  maxSameDayHours?: number
  pickupContexts?: LogisticsPickupContext[]
  timeConstraints?: LogisticsTimeConstraint[]
  destinationKeysTime?: string
  earliestLoadTime?: string
  latestFinishTime?: string
}

export interface LogisticsPhase {
  label: string
  offsetHours: number
  time: string
  note: string
}

export interface LogisticsPlan {
  recommendation: LogisticsPlanRecommendation
  label: string
  truckCount: number
  totalCubicFeet: number
  capacityCubicFeet: number
  capacityUsedPct: number
  estimatedHours: number
  finishTime: string
  missingRouteCount: number
  riskNotes: string[]
  salesTalkingPoints: string[]
  options: LogisticsOption[]
  phases: LogisticsPhase[]
  pickupContexts: LogisticsPickupContext[]
  constraintFit: {
    destinationReadyTime?: string
    finalArrivalTime?: string
    recommendedStartTime?: string
    latestFinishTime?: string
    finishTime?: string
    status: 'clear' | 'adjust_start' | 'wait_expected' | 'runs_late' | 'needs_review'
    note: string
  }
  volumeSplit: {
    personA: { cubicFeet: number; itemCount: number }
    personB: { cubicFeet: number; itemCount: number }
  }
}

export interface LogisticsOption {
  id: 'one_truck_sequence' | 'one_truck_shuttle' | 'two_truck_parallel' | 'split_day'
  label: string
  truckCount: number
  crewCount: number
  dayCount: number
  estimatedHours: number
  finishTime: string
  capacityUsedPct: number
  costLevel: 'base' | 'higher' | 'highest'
  summary: string
  tradeoff: string
  viable: boolean
}

function roundQuarterHour(hours: number) {
  return Math.round(Number(hours || 0) * 4) / 4
}

function itemVolume(item: InventoryItem) {
  return Number(item.cubicFeet || 0) * Math.max(1, Number(item.qty || 1))
}

function parseStartHour(startTime?: string) {
  const [hour, minute] = (startTime || '09:00').split(':')
  return Number(hour || 9) + Number(minute || 0) / 60
}

function parseClockHour(value?: string) {
  if (!value) return null
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const ampm = match[3]?.toLowerCase()
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  return hour + minute / 60
}

function formatHourAsTime(hourValue: number) {
  const normalized = ((hourValue % 24) + 24) % 24
  const hour = Math.floor(normalized)
  const minute = Math.round((normalized - hour) * 60)
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

function formatClock(startHour: number, offsetHours: number) {
  const total = ((startHour + offsetHours) % 24 + 24) % 24
  const hour = Math.floor(total)
  const minute = Math.round((total - hour) * 60)
  const ampm = hour < 12 ? 'AM' : 'PM'
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return `${hour12}:${minute.toString().padStart(2, '0')} ${ampm}`
}

function routeDriveHours(leg?: QuoteLeg) {
  return roundQuarterHour(Number(leg?.driveHours || leg?.billableDriveHours || leg?.operationalDriveHours || 0))
}

function routeDistanceKm(leg?: QuoteLeg) {
  return Math.round(Number(leg?.distanceKm || leg?.billableDistanceKm || leg?.operationalDistanceKm || 0))
}

export function deriveMoveLogisticsPlan(input: LogisticsPlanInput): LogisticsPlan {
  const singleTruckCapacity = input.singleTruckCapacity || 1600
  const maxSameDayHours = input.maxSameDayHours || 10
  const includedInventory = input.inventory.filter(item => item.included !== false)
  const personAItems = includedInventory.filter(item => item.owner !== 'person_b')
  const personBItems = includedInventory.filter(item => item.owner === 'person_b')
  const personACubicFeet = Math.round(personAItems.reduce((sum, item) => sum + itemVolume(item), 0))
  const personBCubicFeet = Math.round(personBItems.reduce((sum, item) => sum + itemVolume(item), 0))
  const inventoryCubicFeet = personACubicFeet + personBCubicFeet
  const totalCubicFeet = Math.max(0, Math.round(input.totalCubicFeet || inventoryCubicFeet || 0))
  const capacityUsedPct = singleTruckCapacity > 0 ? Math.round((totalCubicFeet / singleTruckCapacity) * 100) : 0
  const nearSingleTruckCapacity = capacityUsedPct >= 95 && capacityUsedPct <= 100
  const legs = input.legs || []
  const missingRouteCount = legs.filter(leg => {
    const hasAnyAddress = Boolean(leg.originAddress || leg.originCity || leg.destAddress || leg.destCity)
    const hasRoute = Boolean(leg.distanceKm || leg.driveHours || leg.billableDriveHours || leg.operationalDriveHours)
    return hasAnyAddress && !hasRoute
  }).length

  const loadHours = roundQuarterHour(input.loadHours || 3)
  const unloadHours = roundQuarterHour(input.unloadHours || 2)
  const totalHours = roundQuarterHour(input.totalHours || loadHours + unloadHours + legs.reduce((sum, leg) => sum + routeDriveHours(leg), 0))
  const truckCount = totalCubicFeet > singleTruckCapacity ? Math.ceil(totalCubicFeet / singleTruckCapacity) : 1
  const startHour = parseStartHour(input.startTime)
  const pickupContexts = input.pickupContexts?.length
    ? input.pickupContexts
    : [
        { id: 'person_a', label: 'Person A', cubicFeet: personACubicFeet, itemCount: personAItems.length, inventoryPending: personACubicFeet === 0 },
        ...(personBItems.length > 0 || legs.length >= 2
          ? [{ id: 'person_b', label: 'Person B', cubicFeet: personBCubicFeet, itemCount: personBItems.length, inventoryPending: personBCubicFeet === 0 }]
          : []),
      ]
  const pendingContextCount = pickupContexts.filter(context => context.inventoryPending || context.cubicFeet <= 0).length

  let recommendation: LogisticsPlanRecommendation = 'one_truck_sequence'
  if (missingRouteCount > 0) recommendation = 'needs_route_data'
  else if (totalHours > maxSameDayHours) recommendation = totalHours >= 12 ? 'split_day' : 'two_truck_parallel'
  else if (truckCount > 1) recommendation = totalHours + 1.5 <= maxSameDayHours ? 'one_truck_shuttle' : 'two_truck_parallel'

  const destinationReadyHour = parseClockHour(input.destinationKeysTime)
  const latestFinishHour = parseClockHour(input.latestFinishTime)
  const finalArrivalOffset = Math.max(0, totalHours - unloadHours)
  const finalArrivalHour = startHour + finalArrivalOffset
  const finishHour = startHour + totalHours
  const recommendedStartHour = destinationReadyHour !== null
    ? Math.max(parseClockHour(input.earliestLoadTime) ?? 8, destinationReadyHour - finalArrivalOffset)
    : startHour
  const startsTooEarlyForKeys = destinationReadyHour !== null && finalArrivalHour < destinationReadyHour - 0.5
  const missesKeys = destinationReadyHour !== null && finalArrivalHour > destinationReadyHour + 0.5
  const missesLatestFinish = latestFinishHour !== null && finishHour > latestFinishHour
  const constraintFit: LogisticsPlan['constraintFit'] = {
    destinationReadyTime: input.destinationKeysTime,
    finalArrivalTime: formatClock(0, finalArrivalHour),
    recommendedStartTime: destinationReadyHour !== null ? formatHourAsTime(recommendedStartHour) : undefined,
    latestFinishTime: input.latestFinishTime,
    finishTime: formatClock(0, finishHour),
    status: missingRouteCount > 0
      ? 'needs_review'
      : missesLatestFinish
        ? 'runs_late'
        : startsTooEarlyForKeys
          ? 'adjust_start'
          : missesKeys
            ? 'runs_late'
            : destinationReadyHour !== null
              ? 'clear'
              : 'clear',
    note: '',
  }
  constraintFit.note =
    constraintFit.status === 'needs_review'
      ? 'Add route data before trusting key-time alignment.'
      : constraintFit.status === 'runs_late'
        ? 'Current operating window conflicts with the stated time constraint; compare parallel trucks or split-day options.'
        : constraintFit.status === 'adjust_start'
          ? `Start around ${constraintFit.recommendedStartTime} so the crew reaches the destination closer to key time.`
          : destinationReadyHour !== null
            ? 'Current timing lines up with the destination key window.'
            : 'No key-time constraint captured yet.'

  if (constraintFit.status === 'runs_late') recommendation = pickupContexts.length >= 2 ? 'two_truck_parallel' : 'split_day'

  const label =
    recommendation === 'needs_route_data'
      ? 'Route details needed'
      : recommendation === 'split_day'
        ? 'Split-day recommended'
        : recommendation === 'one_truck_shuttle'
          ? 'One-truck shuttle'
        : recommendation === 'two_truck_parallel'
          ? 'Two-truck / parallel plan'
          : 'One-truck sequence'

  const riskNotes: string[] = []
  if (capacityUsedPct >= 95) riskNotes.push('Single truck is near capacity; confirm hidden inventory and boxes.')
  if (truckCount > 1) riskNotes.push(`Combined volume needs ${truckCount} trucks at ${singleTruckCapacity.toLocaleString()} cu ft capacity each.`)
  if (totalHours > maxSameDayHours) riskNotes.push(`Projected ${totalHours}h day may finish late; discuss a split-day plan.`)
  if (missingRouteCount > 0) riskNotes.push(`${missingRouteCount} leg${missingRouteCount === 1 ? '' : 's'} still need route calculation.`)
  if (pendingContextCount > 0) riskNotes.push(`${pendingContextCount} pickup context${pendingContextCount === 1 ? '' : 's'} still need inventory confirmation; pricing and margin are provisional.`)
  if (constraintFit.status === 'adjust_start' || constraintFit.status === 'runs_late') riskNotes.push(constraintFit.note)

  const salesTalkingPoints = [
    recommendation === 'split_day'
      ? 'Preferred plan is to split the move so the crew is not finishing too late.'
      : recommendation === 'one_truck_shuttle'
        ? 'Preferred plan is one truck with an unload-and-return shuttle because the combined shipment may exceed one truck.'
      : recommendation === 'two_truck_parallel'
        ? 'Preferred plan is to use enough truck capacity so both households fit without forcing a late finish.'
        : recommendation === 'needs_route_data'
          ? 'Confirm all pickup and destination addresses before standing behind the final timing.'
          : nearSingleTruckCapacity
            ? 'Preferred plan is one crew and one truck in sequence, but confirm boxes and hidden inventory because the truck is near capacity.'
            : 'Preferred plan is one crew and one truck, picking up each location in sequence.',
    totalCubicFeet > 0 ? `Current inventory is about ${totalCubicFeet.toLocaleString()} cu ft, using ${capacityUsedPct}% of one 26ft truck.` : 'Inventory volume still needs confirmation.',
    `Estimated operating window is about ${totalHours}h from crew start to finish.`,
  ]

  const firstLeg = legs[0]
  const secondLeg = legs[1]
  const loadAHours = totalCubicFeet > 0
    ? roundQuarterHour(loadHours * (personACubicFeet > 0 ? personACubicFeet / totalCubicFeet : 0.5))
    : roundQuarterHour(loadHours * 0.5)
  const loadBHours = Math.max(0, roundQuarterHour(loadHours - loadAHours))
  const firstDrive = routeDriveHours(firstLeg)
  const secondDrive = routeDriveHours(secondLeg)
  const firstKm = routeDistanceKm(firstLeg)
  const secondKm = routeDistanceKm(secondLeg)
  const unloadAHours = totalCubicFeet > 0
    ? roundQuarterHour(unloadHours * (personACubicFeet > 0 ? personACubicFeet / totalCubicFeet : 0.5))
    : roundQuarterHour(unloadHours * 0.5)
  const unloadBHours = Math.max(0, roundQuarterHour(unloadHours - unloadAHours))
  const shuttleTrips = Math.max(1, Math.ceil(totalCubicFeet / singleTruckCapacity))
  const shuttleHours = roundQuarterHour(totalHours + Math.max(0, shuttleTrips - 1) * Math.max(1, secondDrive + unloadHours * 0.65))
  const parallelHours = roundQuarterHour(Math.max(
    loadAHours + firstDrive + unloadAHours,
    loadBHours + secondDrive + unloadBHours
  ) + Math.max(0.5, Math.min(firstDrive + secondDrive, 1)))
  const splitDayHours = roundQuarterHour(Math.max(loadHours + firstDrive, unloadHours + secondDrive))
  const baseCrewCount = Math.max(2, Math.round(Number(input.crewSize || 2)))
  const parallelCrewCount = Math.max(2, baseCrewCount)
  const options: LogisticsOption[] = [
    {
      id: 'one_truck_sequence',
      label: 'One truck sequence',
      truckCount: 1,
      crewCount: baseCrewCount,
      dayCount: 1,
      estimatedHours: totalHours,
      finishTime: formatClock(startHour, totalHours),
      capacityUsedPct,
      costLevel: 'base',
      summary: 'One crew loads each pickup in order, then delivers everything together.',
      tradeoff: capacityUsedPct > 100
        ? 'Not viable unless inventory is reduced or the truck makes an extra unload trip.'
        : constraintFit.status === 'adjust_start'
          ? `Best if crew starts around ${constraintFit.recommendedStartTime}.`
          : nearSingleTruckCapacity
            ? 'Lowest operating cost, but confirm boxes and hidden inventory before dispatch.'
            : 'Lowest operating cost when both loads fit.',
      viable: missingRouteCount === 0 && capacityUsedPct <= 100 && totalHours <= maxSameDayHours && constraintFit.status !== 'runs_late',
    },
    {
      id: 'one_truck_shuttle',
      label: 'One truck shuttle',
      truckCount: 1,
      crewCount: baseCrewCount,
      dayCount: 1,
      estimatedHours: shuttleHours,
      finishTime: formatClock(startHour, shuttleHours),
      capacityUsedPct: Math.min(100, capacityUsedPct),
      costLevel: 'higher',
      summary: 'Crew fills the truck, unloads at the final destination, then returns for the remaining household.',
      tradeoff: 'Protects against over-capacity, but adds extra drive/unload time and can run late.',
      viable: missingRouteCount === 0 && totalCubicFeet > singleTruckCapacity && shuttleHours <= maxSameDayHours + 2 && constraintFit.status !== 'runs_late',
    },
    {
      id: 'two_truck_parallel',
      label: 'Two trucks parallel',
      truckCount: Math.max(2, truckCount),
      crewCount: Math.max(4, parallelCrewCount),
      dayCount: 1,
      estimatedHours: parallelHours,
      finishTime: formatClock(startHour, parallelHours),
      capacityUsedPct: Math.round((Math.max(personACubicFeet, personBCubicFeet) / singleTruckCapacity) * 100),
      costLevel: 'highest',
      summary: 'Separate crews/trucks load each pickup at the same time and meet at the destination.',
      tradeoff: 'Fastest same-day option, with higher labor and truck cost.',
      viable: missingRouteCount === 0 && pickupContexts.filter(context => context.cubicFeet > 0).length >= 2,
    },
    {
      id: 'split_day',
      label: 'Split day / storage style',
      truckCount: 1,
      crewCount: baseCrewCount,
      dayCount: 2,
      estimatedHours: splitDayHours,
      finishTime: formatClock(startHour, splitDayHours),
      capacityUsedPct: Math.min(100, capacityUsedPct),
      costLevel: 'higher',
      summary: 'Break the work into separate booked days, storage, or staged pickup/delivery.',
      tradeoff: 'More protected for large or time-constrained moves, but adds another booking window.',
      viable: missingRouteCount === 0 && (totalHours > maxSameDayHours || capacityUsedPct > 100 || shuttleHours > maxSameDayHours),
    },
  ]

  const phaseSpecs = [
    { label: 'Crew departs yard', offset: 0, note: '' },
    { label: 'Arrive first pickup', offset: firstDrive, note: `${firstKm > 0 ? `${firstKm} km · ` : ''}load ~${loadAHours}h` },
    { label: 'First pickup loaded', offset: firstDrive + loadAHours, note: personACubicFeet ? `${personACubicFeet.toLocaleString()} cu ft` : 'Volume TBD' },
    { label: 'Arrive second pickup', offset: firstDrive + loadAHours + secondDrive, note: `load ~${loadBHours}h` },
    { label: 'Second pickup loaded', offset: firstDrive + loadAHours + secondDrive + loadBHours, note: personBCubicFeet ? `${personBCubicFeet.toLocaleString()} cu ft` : 'Volume TBD' },
    { label: 'Arrive final destination', offset: Math.max(0, totalHours - unloadHours), note: `unload ~${unloadHours}h${secondKm > 0 ? ` · last leg ${secondKm} km` : ''}` },
    { label: 'Move complete', offset: totalHours, note: `~${totalHours}h total` },
  ]

  return {
    recommendation,
    label,
    truckCount,
    totalCubicFeet,
    capacityCubicFeet: singleTruckCapacity,
    capacityUsedPct,
    estimatedHours: totalHours,
    finishTime: formatClock(startHour, totalHours),
    missingRouteCount,
    riskNotes,
    salesTalkingPoints,
    options,
    pickupContexts,
    constraintFit,
    phases: phaseSpecs.map(phase => ({
      label: phase.label,
      offsetHours: roundQuarterHour(phase.offset),
      time: formatClock(startHour, phase.offset),
      note: phase.note,
    })),
    volumeSplit: {
      personA: { cubicFeet: personACubicFeet, itemCount: personAItems.length },
      personB: { cubicFeet: personBCubicFeet, itemCount: personBItems.length },
    },
  }
}
