import type { JobFactors, QuoteLineItem } from './types'

export interface PackingPlan {
  pack: boolean
  unpack: 'none' | 'essentials' | 'all'
  materials: boolean
  bedrooms: number
  rooms: string
  fullness: 'light' | 'typical' | 'full'
  remaining: 'all' | 'half' | 'mostly_packed'
  boxes: number
  fragileBoxes: number
  confirmed: boolean
  loadedHourlyCost: number
  packMinutesPerBox: number
  unpackMinutesPerBox: number
  materialCostPerBox: number
  setupCost: number
  contingencyPct: number
  marginPct: number
  feePct: number
  cleaning: 'none' | 'move_out' | 'move_in' | 'both'
  cleaningScope: string
  cleaningCost: number
}
export interface MoveDatePlan {
  mode: 'confirmed' | 'alternatives' | 'range' | 'unknown'
  firstDate?: string
  secondDate?: string
  followUpDate?: string
  note?: string
}
export interface TruckHoldPlan {
  status: 'none' | 'possible' | 'confirmed'
  nights: number
  trucks: number
  truckCostPerNight: number
  secureParkingCostPerNight: number
  extraDeliveryCost: number
  deliveryDate?: string
  location?: string
}
export const SERVICE_NAMES = {
  packing: 'Professional Packing Service (Day Before Move)',
  unpacking: 'Professional Unpacking Service',
  materials: 'Packing Materials Allowance',
  cleaning: 'Move-In / Move-Out Cleaning',
  hold: 'Loaded Truck Overnight Hold',
} as const
export const DEFAULT_PACKING_PLAN: PackingPlan = {
  pack: false, unpack: 'none', materials: false, bedrooms: 2, rooms: '', fullness: 'typical',
  remaining: 'all', boxes: 0, fragileBoxes: 0, confirmed: false,
  loadedHourlyCost: 25, packMinutesPerBox: 12, unpackMinutesPerBox: 7.5,
  materialCostPerBox: 4, setupCost: 0, contingencyPct: 10, marginPct: 38, feePct: 3,
  cleaning: 'none', cleaningScope: '', cleaningCost: 0,
}
export const DEFAULT_TRUCK_HOLD: TruckHoldPlan = { status: 'none', nights: 1, trucks: 1, truckCostPerNight: 0, secureParkingCostPerNight: 0, extraDeliveryCost: 0 }
const money = (n: number) => Math.round(n * 100) / 100
const valid = (n: number, min = 0, max = 100000) => Number.isFinite(n) && n >= min && n <= max
export function suggestedPackingBoxes(plan: Pick<PackingPlan, 'bedrooms' | 'fullness' | 'remaining'>) {
  const base = 15 + Math.max(0, Math.min(10, plan.bedrooms)) * 15
  return Math.max(5, Math.round(base * ({ light: 0.7, typical: 1, full: 1.4 }[plan.fullness]) * ({ all: 1, half: 0.5, mostly_packed: 0.25 }[plan.remaining]) / 5) * 5)
}
export function estimateServicePackage(factors: JobFactors) {
  const p = { ...DEFAULT_PACKING_PLAN, ...factors.packingPlan }
  const h = { ...DEFAULT_TRUCK_HOLD, ...factors.truckHold }
  const active = p.pack || p.unpack !== 'none' || p.materials
  const issues: string[] = []
  if (active && (!valid(p.boxes, 1, 2000) || !p.rooms.trim() || !p.confirmed)) issues.push('Confirm the rooms and remaining box allowance with the customer.')
  if (active && (!valid(p.fragileBoxes, 0, p.boxes) || !valid(p.loadedHourlyCost, 1, 500) || !valid(p.packMinutesPerBox, 1, 120) || !valid(p.unpackMinutesPerBox, 1, 120) || !valid(p.materialCostPerBox, 0, 500))) issues.push('Check packing quantities, productivity, and internal costs.')
  if (!valid(p.marginPct, 0, 80) || !valid(p.feePct, 0, 20) || p.marginPct + p.feePct >= 95 || !valid(p.contingencyPct, 0, 50) || !valid(p.setupCost)) issues.push('Check the service margin, fees, contingency, and setup cost.')
  if (p.cleaning !== 'none' && (!p.cleaningScope.trim() || !valid(p.cleaningCost, 1))) issues.push('Confirm cleaning scope and its internal labour or supplier cost.')
  if (h.status === 'confirmed' && (!valid(h.nights, 1, 30) || !valid(h.trucks, 1, 10) || !valid(h.truckCostPerNight, 1) || !valid(h.secureParkingCostPerNight) || !valid(h.extraDeliveryCost) || !h.location?.trim() || !h.deliveryDate)) issues.push('Confirm overnight truck cost, secure location, nights, and delivery date.')
  const packHours = active ? money((p.boxes * p.packMinutesPerBox + p.fragileBoxes * p.packMinutesPerBox) / 60) : 0
  const unpackBoxes = p.unpack === 'essentials' ? Math.min(p.boxes, Math.max(5, Math.ceil(p.boxes * 0.25))) : p.boxes
  const unpackHours = p.unpack === 'none' ? 0 : money(unpackBoxes * p.unpackMinutesPerBox / 60)
  const costs = {
    packing: p.pack ? money(packHours * p.loadedHourlyCost + p.setupCost) : 0,
    unpacking: p.unpack !== 'none' ? money(unpackHours * p.loadedHourlyCost + (!p.pack ? p.setupCost : 0)) : 0,
    materials: p.materials ? money(p.boxes * p.materialCostPerBox) : 0,
    cleaning: p.cleaning !== 'none' ? money(p.cleaningCost) : 0,
    hold: h.status === 'confirmed' ? money(h.nights * h.trucks * (h.truckCostPerNight + h.secureParkingCostPerNight) + h.extraDeliveryCost) : 0,
  }
  const sell = (cost: number) => cost > 0 ? Math.ceil(cost * (1 + p.contingencyPct / 100) / (1 - (p.marginPct + p.feePct) / 100) / 25) * 25 : 0
  const details = {
    packing: `${p.rooms} · up to ${p.boxes} remaining boxes, including ${p.fragileBoxes} fragile boxes`,
    unpacking: `${p.unpack === 'essentials' ? 'Essentials' : 'Room-by-room'} unpacking · up to ${unpackBoxes} boxes · basic placement and empty-box consolidation; organizing and disposal excluded`,
    materials: `Agreed materials kit for up to ${p.boxes} boxes · standard cartons, paper and tape; custom crates excluded`,
    cleaning: `${p.cleaning.replace(/_/g, ' ')} · ${p.cleaningScope}`,
    hold: `${h.nights} night(s) · ${h.trucks} loaded truck(s) · delivery ${h.deliveryDate || 'to confirm'} · no warehouse unloading/reloading`,
  }
  let hash = 2166136261
  for (const char of JSON.stringify({ p, h })) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  const fingerprint = `services-v1-${(hash >>> 0).toString(16)}`
  const lineItems: QuoteLineItem[] = issues.length ? [] : (Object.keys(costs) as Array<keyof typeof costs>).filter(key => costs[key] > 0).map(key => ({ description: SERVICE_NAMES[key], details: details[key], amount: sell(costs[key]), serviceScopeFingerprint: fingerprint }))
  return { issues, costs, packHours, unpackHours, lineItems, fingerprint, total: money(lineItems.reduce((sum, line) => sum + line.amount, 0)) }
}
export function servicePackageIsStale(factors: JobFactors, lines: QuoteLineItem[]) {
  if (factors.packingPlan && lines.some(line => (Object.values(SERVICE_NAMES) as string[]).includes(line.description) && !line.serviceScopeFingerprint)) return true
  const managed = lines.filter(line => line.serviceScopeFingerprint)
  return managed.some(line => line.serviceScopeFingerprint !== estimateServicePackage(factors).fingerprint)
}
export function replaceServicePackage(lines: QuoteLineItem[], factors: JobFactors) {
  const plan = estimateServicePackage(factors)
  if (plan.issues.length) throw new Error(plan.issues.join(' '))
  return [...lines.filter(line => !(Object.values(SERVICE_NAMES) as string[]).includes(line.description)), ...plan.lineItems]
}
export function datePlanLabel(plan?: MoveDatePlan) {
  if (!plan || plan.mode === 'confirmed') return ''
  if (plan.mode === 'unknown') return 'Move date to be confirmed'
  return plan.firstDate && plan.secondDate ? `${plan.firstDate}${plan.mode === 'alternatives' ? ' or ' : ' to '}${plan.secondDate} — to be confirmed` : 'Move dates to be confirmed'
}
export function planningFollowUp(factors: JobFactors) {
  const date = factors.moveDatePlan
  const pending = date && date.mode !== 'confirmed'
  const hold = factors.truckHold?.status === 'possible'
  if (!pending && !hold) return null
  return { date: date?.followUpDate, note: `[Move planning] ${[pending ? `Confirm ${datePlanLabel(date)}${date?.note ? ` (${date.note})` : ''}` : '', hold ? 'Confirm whether a loaded truck overnight hold is needed and agree delivery date/cost.' : ''].filter(Boolean).join(' ')}` }
}
