import { calculateMoveAccessPlan } from './access-profile'
import type { AccessProfile, OperationalStopPlan, OperationalTimeBudget, OperationalTimeComponent, PricingBreakdown } from './types'

function roundQuarter(value: number) {
  return Math.round(Math.max(0, value) * 4) / 4
}

/** Scheduling stays in useful blocks: 15 minutes up to one hour, then 30 minutes. */
export function roundPlanningHours(value: number) {
  const safe = Math.max(0, Number(value || 0))
  return safe <= 1 ? roundQuarter(safe) : Math.round(safe * 2) / 2
}

function serviceRange(hours: number, provisional = false) {
  const spread = provisional ? Math.max(0.75, hours * 0.15) : Math.max(0.5, hours * 0.1)
  return {
    minHours: roundPlanningHours(Math.max(0.25, hours - spread)),
    maxHours: roundPlanningHours(hours + spread),
  }
}

function component(input: Omit<OperationalTimeComponent, 'rawHours' | 'plannedHours'> & { hours: number }): OperationalTimeComponent {
  return { ...input, rawHours: Math.round(input.hours * 100) / 100, plannedHours: roundPlanningHours(input.hours) }
}

export function buildOperationalTimeBudget(input: {
  pricing: Pick<PricingBreakdown, 'loadHours' | 'unloadHours' | 'driveHours' | 'operationalDriveHours' | 'bufferHours' | 'adjustmentBreakdown' | 'routeCategory'>
  accessProfiles?: AccessProfile[]
  singleLocation?: boolean
  generatedAt?: string
}): OperationalTimeBudget {
  const { pricing } = input
  const profiles = (input.accessProfiles || []).filter(profile => !input.singleLocation || profile.stopRole !== 'dropoff')
  const accessPlan = calculateMoveAccessPlan(profiles, { origin: pricing.loadHours, destination: pricing.unloadHours })
  const serviceHours = pricing.adjustmentBreakdown
    .filter(item => item.category === 'disassembly' || item.category === 'specialty' || item.category === 'packing')
    .reduce((sum, item) => sum + item.hours, 0)
  const legacyAccessHours = pricing.adjustmentBreakdown
    .filter(item => item.category === 'access')
    .reduce((sum, item) => sum + item.hours, 0)
  const accessHours = profiles.length ? accessPlan.additionalAccessHours : legacyAccessHours
  const transportHours = pricing.operationalDriveHours || pricing.driveHours
  const allowanceHours = pricing.bufferHours

  const components: OperationalTimeComponent[] = [
    component({ key: 'origin-handling', label: 'Origin loading and inventory handling', category: 'working', hours: pricing.loadHours, source: 'inventory', confidence: 'estimated', customerVisible: true }),
    component({ key: 'destination-handling', label: 'Destination unloading and placement', category: 'working', hours: input.singleLocation ? 0 : pricing.unloadHours, source: 'inventory', confidence: 'estimated', customerVisible: true }),
    component({ key: 'access', label: 'Access and carrying routes', category: 'access', hours: accessHours, source: 'access_profile', confidence: accessPlan.ready ? 'confirmed' : 'provisional', customerVisible: true }),
    component({ key: 'services', label: 'Assembly, packing, and specialty services', category: 'services', hours: serviceHours, source: 'service_scope', confidence: 'estimated', customerVisible: true }),
    component({ key: 'transportation', label: 'Route and driving plan', category: 'transportation', hours: transportHours, source: 'route', confidence: transportHours > 0 ? 'estimated' : 'provisional', customerVisible: true }),
    component({ key: 'allowance', label: 'Normal operational allowance', category: 'allowance', hours: allowanceHours, source: 'operational_allowance', confidence: 'estimated', customerVisible: false }),
  ]

  const originServiceHours = serviceHours * 0.6
  const destinationServiceHours = input.singleLocation ? 0 : serviceHours * 0.4
  const stopPlans: OperationalStopPlan[] = accessPlan.stops.map((stop, index) => {
    const destination = stop.stopId === 'primary-destination' || profiles[index]?.stopRole === 'dropoff'
    const handling = destination ? pricing.unloadHours : index === 0 ? pricing.loadHours : 0
    const services = destination ? destinationServiceHours : index === 0 ? originServiceHours : 0
    const allowance = accessPlan.stops.length ? allowanceHours / accessPlan.stops.length : 0
    const total = roundPlanningHours(handling + stop.additionalAccessHours + services + allowance)
    return {
      stopId: stop.stopId,
      label: stop.label,
      role: profiles[index]?.stopRole || (destination ? 'dropoff' : 'pickup'),
      handlingHours: roundPlanningHours(handling),
      accessHours: roundPlanningHours(stop.additionalAccessHours),
      serviceHours: roundPlanningHours(services),
      allowanceHours: roundPlanningHours(allowance),
      totalHours: total,
      customerRange: serviceRange(total, stop.provisional),
      assumptions: stop.assumptions,
      warnings: stop.warnings,
      manualReviewReasons: stop.manualReviewReasons,
    }
  })

  const workingTime = roundPlanningHours(pricing.loadHours + (input.singleLocation ? 0 : pricing.unloadHours))
  const plannedAccess = roundPlanningHours(accessHours)
  const plannedServices = roundPlanningHours(serviceHours)
  const plannedTransport = roundPlanningHours(transportHours)
  const plannedAllowance = roundPlanningHours(allowanceHours)
  const totalCrewClockTime = roundPlanningHours(workingTime + plannedAccess + plannedServices + plannedTransport + plannedAllowance)
  const provisional = accessPlan.warnings.length > 0 || accessPlan.manualReviewReasons.length > 0

  return {
    version: '2026-08-24',
    mode: 'shadow',
    generatedAt: input.generatedAt || new Date().toISOString(),
    components,
    stops: stopPlans,
    workingTime,
    accessTime: plannedAccess,
    serviceTime: plannedServices,
    transportationTime: plannedTransport,
    allowanceTime: plannedAllowance,
    totalCrewClockTime,
    customerServiceRange: serviceRange(totalCrewClockTime, provisional),
    manualReviewReasons: accessPlan.manualReviewReasons,
    warnings: accessPlan.warnings,
  }
}

export function operationalBudgetSummary(budget?: OperationalTimeBudget) {
  if (!budget) return ''
  return `Working ${budget.workingTime}h | Access ${budget.accessTime}h | Services ${budget.serviceTime}h | Travel ${budget.transportationTime}h | Allowance ${budget.allowanceTime}h | Plan ${budget.totalCrewClockTime}h`
}
