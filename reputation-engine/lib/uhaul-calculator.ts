// Canadian U-Haul rates — Ontario in-town (local) moves
// Daily rates confirmed for Ontario market
export const UHAUL_DAILY_RATES: Record<string, number> = {
  '10ft': 19.95,
  '15ft': 29.95,
  '20ft': 39.95,
  '26ft': 49.99,
}

// Fuel economy: L/100km (10 MPG ≈ 23.5 L/100km; 12 MPG ≈ 19.6 L/100km)
export const UHAUL_FUEL_L_PER_100KM: Record<string, number> = {
  '10ft': 19.6,
  '15ft': 23.5,
  '20ft': 23.5,
  '26ft': 23.5,
}

export const UHAUL_PER_KM_RATE = 0.99          // $/km in-town Ontario
export const UHAUL_SAFEMOVE_PER_DAY = 20.00    // SafeMove insurance per truck per day
export const UHAUL_BLANKET_BAG_COST = 6.00     // per bag of blankets
export const UHAUL_STRAIGHT_DROP_COST = 35.00  // straight drop (drop box return fee)
export const ONTARIO_HST_RATE = 0.13
export const DEFAULT_GAS_PRICE_PER_L = 1.55    // Ontario avg
export const CREW_BUDGET_RATE_PER_HOUR = 25    // $ per mover per hour (budget rate)
export const DEFAULT_MISC_BUFFER = 15          // food + crew car gas

// Default blanket bags by truck size
export const DEFAULT_BLANKET_BAGS: Record<string, number> = {
  '10ft': 0,
  '15ft': 3,
  '20ft': 3,
  '26ft': 6,
}

export type TripStrategy = 'single_truck' | 'single_truck_two_trips' | 'two_trucks' | 'three_trucks'

export interface UHaulCostParams {
  truckSize: string
  truckCount: number
  tripStrategy: TripStrategy
  oneWayDistanceKm: number   // origin → destination
  uhaulPickupKm?: number     // nearest U-Haul depot → origin (added each way)
  gasPrice: number
  blanketBags: number
  includeStraightDrop: boolean
  crewSize: number
  estimatedHours: number
  miscBuffer: number
  revenue: number
}

export interface UHaulCostResult {
  // Truck bucket (before HST)
  dailyRental: number
  mileageCharge: number
  fuelCost: number
  safeMoveInsurance: number
  blankets: number
  straightDrop: number
  truckSubtotal: number
  truckHST: number
  truckTotal: number         // truck bucket after HST
  // Labor bucket
  laborCost: number
  // Misc bucket
  miscCost: number
  // Totals
  totalCost: number
  grossProfit: number
  grossMarginPct: number
  // Reference
  totalOperationalKm: number
  jobKmPerTruck: number      // origin→dest legs only (excl. depot)
  depotKmPerTruck: number    // UHaul→origin + dest→UHaul per truck
}

function r(n: number) { return Math.round(n * 100) / 100 }

// Route breakdown per truck:
//
// 1 truck · 1 trip / 2 trucks · 1 trip (per truck):
//   UHaul → Origin → Dest → UHaul
//   = pickup + oneWay + (oneWay + pickup) = 2×pickup + 2×oneWay
//
// 1 truck · 2 trips:
//   UHaul → Origin → Dest → Origin → Dest → UHaul
//   = pickup + oneWay + oneWay + oneWay + (oneWay + pickup) = 2×pickup + 4×oneWay
//
// Dest → UHaul approximated as oneWay + pickup (UHaul is near origin)
function jobKmForStrategy(strategy: TripStrategy, oneWayKm: number): number {
  return strategy === 'single_truck_two_trips' ? oneWayKm * 4 : oneWayKm * 2
}
function kmPerTruck(strategy: TripStrategy, oneWayKm: number, uhaulPickupKm = 0): number {
  return jobKmForStrategy(strategy, oneWayKm) + uhaulPickupKm * 2
}

export function calcUHaulCost(params: UHaulCostParams): UHaulCostResult {
  const {
    truckSize, truckCount, tripStrategy, oneWayDistanceKm,
    uhaulPickupKm = 0, gasPrice, blanketBags, includeStraightDrop,
    crewSize, estimatedHours, miscBuffer, revenue,
  } = params

  const jobKm = jobKmForStrategy(tripStrategy, oneWayDistanceKm)
  const depotKm = uhaulPickupKm * 2
  const kmEach = jobKm + depotKm
  const totalKm = kmEach * truckCount

  const dailyRate = UHAUL_DAILY_RATES[truckSize] ?? UHAUL_DAILY_RATES['26ft']
  const fuelPer100km = UHAUL_FUEL_L_PER_100KM[truckSize] ?? UHAUL_FUEL_L_PER_100KM['26ft']

  const dailyRental       = r(dailyRate * truckCount)
  const mileageCharge     = r(totalKm * UHAUL_PER_KM_RATE)
  const fuelCost          = r((kmEach / 100) * fuelPer100km * gasPrice * truckCount)
  const safeMoveInsurance = r(UHAUL_SAFEMOVE_PER_DAY * truckCount)
  const blankets          = r(blanketBags * UHAUL_BLANKET_BAG_COST)
  const straightDrop      = includeStraightDrop ? UHAUL_STRAIGHT_DROP_COST : 0

  const truckSubtotal = r(dailyRental + mileageCharge + fuelCost + safeMoveInsurance + blankets + straightDrop)
  const truckHST      = r(truckSubtotal * ONTARIO_HST_RATE)
  const truckTotal    = r(truckSubtotal + truckHST)

  const laborCost = r(crewSize * CREW_BUDGET_RATE_PER_HOUR * estimatedHours)
  const miscCost  = miscBuffer

  const totalCost     = r(truckTotal + laborCost + miscCost)
  const grossProfit   = r(revenue - totalCost)
  const grossMarginPct = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0

  return {
    dailyRental, mileageCharge, fuelCost, safeMoveInsurance,
    blankets, straightDrop, truckSubtotal, truckHST, truckTotal,
    laborCost, miscCost,
    totalCost, grossProfit, grossMarginPct,
    totalOperationalKm: totalKm,
    jobKmPerTruck: jobKm,
    depotKmPerTruck: depotKm,
  }
}

// Side-by-side comparison: 1 truck 2 trips vs 2 trucks 1 trip
// blanketBagsPerTruck scales correctly per strategy's truck count
export function compareStrategies(
  base: Omit<UHaulCostParams, 'tripStrategy' | 'truckCount' | 'blanketBags'>,
  blanketBagsPerTruck: number,
) {
  const oneTruckTwoTrips = calcUHaulCost({
    ...base, truckCount: 1, tripStrategy: 'single_truck_two_trips',
    blanketBags: blanketBagsPerTruck * 1,
  })
  const twoTrucksOneTrip = calcUHaulCost({
    ...base, truckCount: 2, tripStrategy: 'two_trucks',
    blanketBags: blanketBagsPerTruck * 2,
  })
  return { oneTruckTwoTrips, twoTrucksOneTrip }
}

// Derive truck size from total cubic feet
export function truckSizeFromCubicFeet(cubicFeet: number): string {
  if (cubicFeet <= 250) return '10ft'
  if (cubicFeet <= 600) return '15ft'
  if (cubicFeet <= 900) return '20ft'
  return '26ft'
}

// Format decimal hours as "h:mm AM/PM"
function fmtHour(decimalHour: number): string {
  const total = ((decimalHour % 24) + 24) % 24
  const h = Math.floor(total)
  const m = Math.round((total - h) * 60)
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
}

export interface StrategyTiming {
  phases: Array<{ label: string; end: string; note?: string }>
  multiDay: boolean
  finishLabel: string   // e.g. "Done ~3:00 PM (Day 2)"
  warning?: string
}

export function calcStrategyTiming(
  strategy: TripStrategy,
  breakdown: {
    loadHours: number
    driveHours: number
    unloadHours: number
    totalHours: number
  },
  flags: {
    twoTripComparison?: { totalHours: number; extraHours: number } | null
    twoDayMoveEstimate?: { day1Hours: number; day2Hours: number } | null
  } | null,
  crewStartHour = 9,
): StrategyTiming {
  const { loadHours, driveHours, unloadHours, totalHours } = breakdown

  if (strategy === 'two_trucks' || strategy === 'three_trucks') {
    const d1h = flags?.twoDayMoveEstimate?.day1Hours ?? (loadHours + driveHours)
    const d2h = flags?.twoDayMoveEstimate?.day2Hours ?? unloadHours
    const d1End = crewStartHour + d1h
    const d2End = crewStartHour + d2h
    const multiDay = (d1h + d2h) > 13

    if (multiDay) {
      return {
        multiDay: true,
        phases: [
          { label: 'D1 — loading done', end: fmtHour(d1End), note: 'trucks loaded, keys dropped' },
          { label: 'D2 — all done', end: fmtHour(d2End), note: 'unload + reassemble' },
        ],
        finishLabel: `~${fmtHour(d2End)} (Day 2)`,
      }
    }

    const singleEnd = crewStartHour + totalHours
    return {
      multiDay: false,
      phases: [{ label: 'All done', end: fmtHour(singleEnd) }],
      finishLabel: `~${fmtHour(singleEnd)} (same day)`,
    }
  }

  if (strategy === 'single_truck_two_trips') {
    const tripH = flags?.twoTripComparison?.totalHours ?? totalHours
    const endH = crewStartHour + tripH
    const multiDay = endH > 22

    if (multiDay) {
      // Split: trip 1 on day 1, trip 2 on day 2
      const trip1H = (loadHours / 2) + driveHours + (unloadHours / 2) + driveHours
      const trip2H = (loadHours / 2) + driveHours + (unloadHours / 2)
      return {
        multiDay: true,
        phases: [
          { label: 'D1 — trip 1 done', end: fmtHour(crewStartHour + trip1H), note: 'first load delivered' },
          { label: 'D2 — trip 2 done', end: fmtHour(crewStartHour + trip2H), note: 'second load + reassemble' },
        ],
        finishLabel: `~${fmtHour(crewStartHour + trip2H)} (Day 2)`,
        warning: 'Too long for 1 day — will need Day 2',
      }
    }

    return {
      multiDay: false,
      phases: [{ label: 'All done', end: fmtHour(endH), note: `both trips + unload` }],
      finishLabel: `~${fmtHour(endH)} (same day)`,
      warning: endH > 19 ? 'Very late finish — consider 2 days' : undefined,
    }
  }

  // single_truck single trip
  const end = crewStartHour + totalHours
  return {
    multiDay: false,
    phases: [{ label: 'All done', end: fmtHour(end) }],
    finishLabel: `~${fmtHour(end)} (same day)`,
    warning: end > 19 ? 'Late finish' : undefined,
  }
}
