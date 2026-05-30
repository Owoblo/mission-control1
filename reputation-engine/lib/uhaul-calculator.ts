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
  gasPrice: number
  blanketBags: number
  includeStraightDrop: boolean
  crewSize: number
  estimatedHours: number
  miscBuffer: number
  revenue: number            // what the customer pays (incl HST)
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
}

function r(n: number) { return Math.round(n * 100) / 100 }

// Operational km per truck based on trip strategy:
// single_truck       → go + return to depot   = 2× one-way
// single_truck_two_trips → go + back + go + return = 4× one-way
// two_trucks / three_trucks → each truck: go + return  = 2× one-way
function kmPerTruck(strategy: TripStrategy, oneWayKm: number): number {
  return strategy === 'single_truck_two_trips' ? oneWayKm * 4 : oneWayKm * 2
}

export function calcUHaulCost(params: UHaulCostParams): UHaulCostResult {
  const {
    truckSize, truckCount, tripStrategy, oneWayDistanceKm,
    gasPrice, blanketBags, includeStraightDrop,
    crewSize, estimatedHours, miscBuffer, revenue,
  } = params

  const kmEach = kmPerTruck(tripStrategy, oneWayDistanceKm)
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
  }
}

// Side-by-side comparison: 1 truck 2 trips vs 2 trucks 1 trip
export function compareStrategies(base: Omit<UHaulCostParams, 'tripStrategy' | 'truckCount'>) {
  const oneTruckTwoTrips = calcUHaulCost({ ...base, truckCount: 1, tripStrategy: 'single_truck_two_trips' })
  const twoTrucksOneTrip = calcUHaulCost({ ...base, truckCount: 2, tripStrategy: 'two_trucks' })
  return { oneTruckTwoTrips, twoTrucksOneTrip }
}

// Derive truck size from total cubic feet
export function truckSizeFromCubicFeet(cubicFeet: number): string {
  if (cubicFeet <= 250) return '10ft'
  if (cubicFeet <= 600) return '15ft'
  if (cubicFeet <= 900) return '20ft'
  return '26ft'
}
