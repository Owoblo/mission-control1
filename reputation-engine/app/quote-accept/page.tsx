'use client'

import Image from 'next/image'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { deriveMoveLogisticsPlan } from '@/lib/move-logistics'
import { buildMoveSpecificNotes } from '@/lib/move-scope'
import { detectSalesBranchFromLocation, formatDate, formatMoney, getSalesBranchLabel, isInvoiceStylePaymentTerms, paymentTermsLabel } from '@/lib/sales'
import type { CRMLead, CustomerQuoteScope, InventoryItem, JobFactors, MoveType, QuoteLeg, QuotePaymentTerms } from '@/lib/types'
import { recommendTruckLoadPlan } from '@/lib/truck-planning'
import { assessMoveIntelligence } from '@/lib/move-intelligence'
import { hiddenInventoryCoverage } from '@/lib/quote-readiness'
import { buildCustomerCarePlan, buildCustomerQuoteScope, getCustomerQuoteOptionLabel } from '@/lib/customer-quote-content'
import {
  Archive,
  Armchair,
  BedDouble,
  Bike,
  Boxes,
  CheckCircle2,
  CircleGauge,
  Dumbbell,
  Flame,
  House,
  MapPin,
  Music2,
  PackageCheck,
  Route,
  ShieldCheck,
  Truck,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

type PublicQuote = {
  id: string
  number: string
  moveDate?: string
  moveTime?: string
  moveType?: MoveType
  branch?: CRMLead['branch']
  originCity?: string
  originAddress?: string
  destCity?: string
  destAddress?: string
  jobLabel?: string
  status: string
  validDays?: number
  crewSize?: number
  estimatedHours?: number
  truckCount?: number
  truckSize?: string
  estimatedWeightLbs?: number
  billingModel?: 'binding' | 'hourly_actuals' | 'hourly_minimum'
  paymentTerms?: QuotePaymentTerms
  minimumBillableHours?: number
  maximumEstimatedHours?: number
  hourlyRateOverride?: number
  legs?: QuoteLeg[]
  customerScope?: CustomerQuoteScope
  scopeStatus?: 'confirmed' | 'provisional'
  lineItems: Array<{ description: string; details?: string; amount: number }>
  subtotal: number
  hst: number
  total: number
  deposit: number
  depositPaid?: boolean
  depositPaidAt?: string
  depositPaidAmount?: number
  balance: number
  discountAmount?: number
  discountLabel?: string
  createdAt: string
  viewedAt?: string
  acceptedAt?: string
  respondedAt?: string
  termsAcceptedAt?: string
  termsAcceptedVersion?: string
  moveDescription?: string
  conditionalClause?: string
  quoteType?: string
  jobFactors?: JobFactors
}

const REVIEWS = [
  { name: 'Wendy Nantais', text: 'Team was prompt, professional and hard working — we were very satisfied.', stars: 5 },
  { name: 'Dan LaPain', text: 'Arrived on time and were very professional. All furniture was wrapped. Very detailed — would definitely recommend.', stars: 5 },
  { name: 'Lazlo', text: 'You guys did a great job, definitely recommended.', stars: 5 },
]

type QuoteBrand = {
  name: string
  shortName: string
  phone: string
  phoneHref: string
  email?: string
  website?: string
  logo: 'saturn' | 'dexa'
}

const SATURN_STAR_BRAND: QuoteBrand = {
  name: 'Saturn Star Moving',
  shortName: 'SATURN STAR',
  phone: '226-773-2993',
  phoneHref: 'tel:+12267732993',
  email: 'info@starmovers.ca',
  website: 'starmovers.ca',
  logo: 'saturn',
}

const DEXA_MOVERS_BRAND: QuoteBrand = {
  name: 'Dexa Movers',
  shortName: 'DEXA MOVERS',
  phone: '613-519-3236',
  phoneHref: 'tel:+16135193236',
  logo: 'dexa',
}

const QUOTE_TERMS_VERSION = '2026-08-21-scope-confirmation'

const QUOTE_TERMS_SECTIONS = [
  {
    title: 'Binding estimates and inventory accuracy',
    items: [
      'A binding estimate is locked only for the inventory, addresses, access conditions, crew plan, and services included in the estimate.',
      'Before work starts, the crew may complete a walkthrough and compare the on-site items against the estimate inventory.',
      'If extra items, undisclosed rooms, storage areas, access issues, specialty items, or major scope changes are found, the office must be contacted before the crew proceeds.',
      'If the agreed scope changes materially, Saturn Star will document the change and any flat-rate adjustment in a change order before performing the additional work.',
      'Before dispatch, Saturn Star may place a temporary authorization hold on the saved card for the estimated outstanding balance. This is not an additional charge. After service, Saturn Star may capture the final approved balance, including accepted change orders, and any unused authorized amount will be released. Bank release timing may vary.',
      'The customer may approve the change order, continue with only the original agreed scope where practical, or decline the additional work. A flat-rate move does not automatically become hourly because a change is reported.',
      'If the inventory and access match the accepted binding estimate, Saturn Star absorbs normal internal estimating variance.',
    ],
  },
  {
    title: 'Hourly or non-binding jobs',
    items: [
      'Hourly and non-binding jobs are charged based on actual time worked at the agreed rate and billing terms.',
      'Billable time may start when the crew leaves the company dispatch point, office, storage, or assigned starting location and continues until the job is completed or the crew returns as agreed.',
      'Lunches, waiting time, elevators, long carries, parking delays, customer-caused delays, extra packing, and added stops may increase the final time when applicable.',
    ],
  },
  {
    title: 'Safety, restricted items, and liability releases',
    items: [
      'Chemicals, hazardous materials, illegal items, unsafe items, and items restricted by insurance or safety rules cannot be moved.',
      'Delicate, fragile, damaged, unstable, unusually heavy, high-risk, or hard-to-handle items may require a release of liability before the crew moves them.',
      'A release of liability means the crew will handle the item carefully, but Saturn Star is not responsible for damage caused by the item condition, fragility, risk level, or handling difficulty.',
    ],
  },
  {
    title: 'Protection standard, payment, and claims',
    items: [
      'Saturn Star protects furniture and items using reasonable blankets, wrapping, equipment, and handling standards for the move.',
      'The company will not skip necessary protection just because a client wants the job completed faster or cheaper.',
      'Payment cannot be withheld because of a damage claim, complaint, or disagreement. Claims and concerns go through the normal resolution process after payment is made.',
      'The client is responsible for accurate inventory, access details, payment as agreed, and signing any required releases. Saturn Star is responsible for professional planning, protection, communication, and move execution.',
    ],
  },
]

function LogoMark({ size = 32, dark = false, brand = SATURN_STAR_BRAND }: { size?: number; dark?: boolean; brand?: QuoteBrand }) {
  if (brand.logo === 'dexa') {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-[10px] font-black tracking-tight ${dark ? 'bg-white text-[#071421] shadow-sm' : 'bg-[#071421] text-white'}`}
        style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.28)) }}
        aria-label={brand.name}
      >
        DEXA
      </span>
    )
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <Image
        src="/brand/saturn-star-icon-full-color.png"
        alt="Saturn Star Moving"
        width={size}
        height={size}
        className="h-full w-full object-contain"
        priority={size >= 40}
      />
    </span>
  )
}

function Stars({ count }: { count: number }) {
  return <span className="text-[#C99700]">{'★'.repeat(count)}</span>
}

function expiryDate(quote: PublicQuote): string {
  const days = quote.validDays || 30
  const base = new Date(quote.createdAt)
  base.setDate(base.getDate() + days)
  return base.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatMoveTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  if (isNaN(h)) return time
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m ?? 0).padStart(2, '0')} ${ampm}`
}

function daysUntilMove(moveDate?: string): number | null {
  if (!moveDate) return null
  const diff = new Date(`${moveDate}T12:00:00`).getTime() - new Date().setHours(12, 0, 0, 0)
  return Math.ceil(diff / 86400000)
}

function moveTypeLabel(type?: string) {
  if (type === 'commercial') return 'Commercial Move'
  if (type === 'long-distance') return 'Long-Distance Move'
  if (type === 'labor-only') return 'Labour-Only Service'
  if (type === 'packing') return 'Packing Service'
  if (type === 'senior') return 'Senior Move'
  return 'Residential Move'
}

function quoteServiceLabel(quote: PublicQuote) {
  const hasMovingLine = quote.lineItems.some(item => /moving service|full-service moving|moving labor/i.test(item.description || item.details || ''))
  const isConjointOrMultiStop = Boolean(quote.jobFactors?.conjointMove || (quote.legs?.length ?? 0) > 1)
  if (quote.moveType === 'labor-only' && (hasMovingLine || isConjointOrMultiStop)) {
    return isConjointOrMultiStop ? 'Multi-Stop Residential Move' : 'Residential Move'
  }
  if (quote.jobFactors?.conjointMove) return 'Conjoint Residential Move'
  if ((quote.legs?.length ?? 0) > 1) return 'Multi-Stop Residential Move'
  return moveTypeLabel(quote.moveType)
}

const PUBLIC_BRANCH_MARKETS: Record<NonNullable<CRMLead['branch']>, string> = {
  windsor: 'Windsor, Ontario',
  waterloo: 'Waterloo Region, Ontario',
  london: 'London, Ontario',
  ottawa: 'Ottawa, Ontario',
}

function quoteBranch(quote: PublicQuote) {
  const routeParts = [
    quote.originCity,
    quote.originAddress,
    quote.destCity,
    quote.destAddress,
    ...(quote.legs || []).flatMap(leg => [
      leg.originCity,
      leg.originAddress,
      leg.destCity,
      leg.destAddress,
    ]),
  ]
  return quote.branch || detectSalesBranchFromLocation(...routeParts)
}

function quoteBrand(quote: PublicQuote): QuoteBrand {
  return quoteBranch(quote) === 'ottawa' ? DEXA_MOVERS_BRAND : SATURN_STAR_BRAND
}

function quoteMarketLabel(quote: PublicQuote) {
  const detectedBranch = quoteBranch(quote)
  if (detectedBranch && PUBLIC_BRANCH_MARKETS[detectedBranch]) return PUBLIC_BRANCH_MARKETS[detectedBranch]
  const city = quote.originCity || quote.destCity || getSalesBranchLabel(detectedBranch)
  return city && city !== 'Unassigned' ? `${city}, Ontario` : 'Ontario'
}

interface TimelinePhase {
  emoji: string
  time: string
  title: string
  detail: string
}

function timelinePhaseIcon(phase: TimelinePhase): LucideIcon {
  const text = `${phase.title} ${phase.detail}`.toLowerCase()
  if (text.includes('complete') || phase.emoji === '✅') return CheckCircle2
  if (text.includes('destination') || text.includes('new home') || text.includes('final room')) return House
  if (text.includes('loaded') || text.includes('loading complete') || phase.emoji === '📦') return PackageCheck
  if (text.includes('pickup') || text.includes('arrive')) return MapPin
  if (text.includes('route') || text.includes('transit') || text.includes('driv') || phase.emoji === '🛣️') return Route
  return Truck
}

function carePlanIcon(item: string, category: 'protection' | 'assembly' | 'specialty'): LucideIcon {
  const normalized = item.toLowerCase()
  if (/fireplace|barbecue|bbq|grill/.test(normalized)) return Flame
  if (/treadmill|exercise|gym|weight/.test(normalized)) return Dumbbell
  if (/couch|sofa|chair|recliner/.test(normalized)) return Armchair
  if (/mattress|bed|headboard/.test(normalized)) return BedDouble
  if (/dresser|cabinet|wardrobe|armoire/.test(normalized)) return Archive
  if (/piano|organ/.test(normalized)) return Music2
  if (/bike|bicycle/.test(normalized)) return Bike
  if (/safe|vault/.test(normalized)) return CircleGauge
  if (/box|carton|tote/.test(normalized)) return Boxes
  if (category === 'assembly') return Wrench
  if (category === 'specialty') return PackageCheck
  return ShieldCheck
}

function buildMoveTimeline(params: {
  startTime?: string   // "09:00"
  crewSize: number
  trucks: number
  estimatedHours: number
  quoteType?: string
  moveType?: string
  disassemblyItems: string[]
  originCity?: string
  destCity?: string
  isTwoDay?: boolean
}): TimelinePhase[] {
  const { startTime = '09:00', crewSize, trucks, estimatedHours, quoteType, disassemblyItems, originCity, destCity, isTwoDay } = params
  const [startH, startM = 0] = startTime.split(':').map(Number)
  const startDecimal = startH + startM / 60

  function fmtH(decimal: number) {
    const total = ((decimal % 24) + 24) % 24
    const h = Math.floor(total)
    const m = Math.round((total - h) * 60)
    const ampm = h >= 12 ? 'PM' : 'AM'
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  const isLongDistance = quoteType === 'long_distance' || params.moveType === 'long-distance'

  if (isLongDistance) {
    // Long distance: load → long drive → unload (may be 2 days)
    const loadH   = Math.min(estimatedHours * 0.4, 6)
    const driveH  = Math.max(estimatedHours - loadH * 2, 4) // remaining minus unload
    const unloadH = loadH * 0.9
    const depart = startDecimal + loadH
    const arrive = depart + driveH
    const done   = arrive + unloadH
    const phases: TimelinePhase[] = [
      { emoji: '🚚', time: fmtH(startDecimal), title: `Crew arrives${originCity ? ` in ${originCity}` : ''}`, detail: `${crewSize} movers · ${trucks} truck${trucks > 1 ? 's' : ''}${disassemblyItems.length > 0 ? ` · Disassemble: ${disassemblyItems.slice(0, 2).join(', ')}${disassemblyItems.length > 2 ? ' +more' : ''}` : ''}` },
      { emoji: '📦', time: fmtH(depart), title: 'Loading complete — depart', detail: `All items wrapped, protected, loaded · ${trucks === 2 ? 'Both trucks' : 'Truck'} heading to ${destCity || 'destination'}` },
      { emoji: '🛣️', time: `~${Math.round(driveH)}h drive`, title: `In transit${destCity ? ` → ${destCity}` : ''}`, detail: 'Items secured for long-distance transport' },
      { emoji: '🏠', time: fmtH(arrive), title: `Arrive at ${destCity || 'destination'}`, detail: 'Begin unloading · place furniture · reassemble' },
      { emoji: '✅', time: fmtH(done), title: 'Move complete', detail: done > 22 ? 'May continue next morning depending on arrival time' : 'Final walkthrough with customer' },
    ]
    return phases
  }

  if (isTwoDay) {
    return [
      { emoji: '🚚', time: fmtH(startDecimal), title: 'Day 1 — Crew arrives', detail: `${crewSize} movers · ${trucks} truck${trucks > 1 ? 's' : ''} · Start loading` },
      { emoji: '📦', time: fmtH(startDecimal + estimatedHours * 0.55), title: 'Loading complete', detail: `All furniture wrapped, trucks packed · Drive to ${destCity || 'destination'}` },
      { emoji: '🛑', time: fmtH(startDecimal + estimatedHours * 0.65), title: 'End of Day 1', detail: 'Items secure in truck — crew returns, fresh start tomorrow' },
      { emoji: '🚚', time: '9:00 AM', title: 'Day 2 — Fresh crew arrives', detail: `Unload · unwrap · place furniture${disassemblyItems.length > 0 ? ` · Reassemble: ${disassemblyItems.slice(0, 2).join(', ')}` : ''}` },
      { emoji: '✅', time: fmtH(9 + estimatedHours * 0.4), title: 'Move complete', detail: 'Final walkthrough · all items in place' },
    ]
  }

  // Standard local/medium move
  const loadH   = estimatedHours * 0.52
  const driveH  = Math.max(estimatedHours * 0.08, 0.25)
  const unloadH = estimatedHours * 0.4
  const loadDone = startDecimal + loadH
  const arrive   = loadDone + driveH
  const done     = arrive + unloadH

  return [
    { emoji: '🚚', time: fmtH(startDecimal), title: 'Crew arrives at origin', detail: `${crewSize} movers · ${trucks} truck${trucks > 1 ? 's' : ''}${disassemblyItems.length > 0 ? ` · Disassemble: ${disassemblyItems.slice(0, 2).join(', ')}${disassemblyItems.length > 2 ? ' +more' : ''}` : ''} · wrap all furniture` },
    { emoji: '📦', time: fmtH(loadDone), title: 'Loading complete', detail: `All items wrapped and secured · truck${trucks > 1 ? 's' : ''} ready to go` },
    { emoji: '🚛', time: fmtH(loadDone), title: `Driving to ${destCity || 'destination'}`, detail: 'Travel time included in your estimate' },
    { emoji: '🏠', time: fmtH(arrive), title: 'Arrive at new home', detail: `Unload · place furniture${disassemblyItems.length > 0 ? ` · Reassemble: ${disassemblyItems.slice(0, 2).join(', ')}` : ''}` },
    { emoji: '✅', time: fmtH(done), title: 'Move complete', detail: 'Final walkthrough · keys handed over' },
  ]
}

function buildConjointMoveTimeline(params: {
  quote: PublicQuote
  inventory: InventoryItem[]
  crewSize: number
  trucks: number
  estimatedHours: number
}): TimelinePhase[] | null {
  const { quote, inventory, crewSize, trucks, estimatedHours } = params
  if (!quote.jobFactors?.conjointMove || (quote.legs?.length ?? 0) < 2) return null
  const personALabel = quote.jobFactors.personALabel || 'First pickup'
  const personBLabel = quote.jobFactors.personBLabel || 'Second pickup'
  const included = inventory.filter(item => item.included !== false)
  const personAItems = included.filter(item => item.owner !== 'person_b')
  const personBItems = included.filter(item => item.owner === 'person_b')
  const totalCubicFeet = Math.round(included.reduce((sum, item) => sum + Number(item.cubicFeet || 0) * Math.max(1, Number(item.qty || 1)), 0))
  const plan = deriveMoveLogisticsPlan({
    legs: quote.legs || [],
    inventory: included,
    totalCubicFeet,
    totalHours: estimatedHours || quote.estimatedHours || undefined,
    crewSize,
    startTime: quote.moveTime || '09:00',
    pickupContexts: [
      {
        id: 'person_a',
        label: personALabel,
        address: quote.legs?.[0]?.originAddress || quote.originAddress,
        cubicFeet: Math.round(personAItems.reduce((sum, item) => sum + Number(item.cubicFeet || 0) * Math.max(1, Number(item.qty || 1)), 0)),
        itemCount: personAItems.length,
      },
      {
        id: 'person_b',
        label: personBLabel,
        address: quote.legs?.[1]?.originAddress,
        cubicFeet: Math.round(personBItems.reduce((sum, item) => sum + Number(item.cubicFeet || 0) * Math.max(1, Number(item.qty || 1)), 0)),
        itemCount: personBItems.length,
      },
    ],
    destinationKeysTime: quote.jobFactors.destinationKeysTime,
    earliestLoadTime: quote.jobFactors.earliestLoadTime,
    latestFinishTime: quote.jobFactors.latestFinishTime,
  })
  return plan.phases.map((phase, index) => {
    const title = phase.label
      .replace('Crew departs yard', 'Crew starts the route')
      .replace('Arrive first pickup', `Arrive at ${personALabel}`)
      .replace('First pickup loaded', `${personALabel} loaded`)
      .replace('Arrive second pickup', `Arrive at ${personBLabel}`)
      .replace('Second pickup loaded', `${personBLabel} loaded`)
      .replace('Arrive final destination', 'Arrive at final destination')
    const detail = index === 0
      ? `${crewSize} movers · ${trucks} truck${trucks > 1 ? 's' : ''} · sequential pickup plan`
      : phase.note || 'Timing included in your estimate'
    return {
      emoji: index === 0 ? '🚚' : index === plan.phases.length - 1 ? '✅' : title.includes('loaded') ? '📦' : title.includes('destination') ? '🏠' : '🚛',
      time: phase.time,
      title,
      detail,
    }
  })
}

function groupInventoryByRoom(items: InventoryItem[]): Map<string, InventoryItem[]> {
  const map = new Map<string, InventoryItem[]>()
  for (const item of items) {
    const room = item.room || 'Other'
    if (!map.has(room)) map.set(room, [])
    map.get(room)!.push(item)
  }
  return map
}

function depositPct(quote: PublicQuote): number {
  if (!quote.total) return 30
  return Math.round((quote.deposit / quote.total) * 100)
}

// Divider with label
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#667085]">{children}</div>
    </div>
  )
}

type PublicListingSummary = {
  address?: string
  bedrooms?: number | string | null
  bathrooms?: number | string | null
  livingArea?: number | string | null
  yearBuilt?: number | string | null
  scanConfidence?: 'low' | 'medium' | 'high'
}

function inventoryConfidence(items: InventoryItem[], scanConfidence?: PublicListingSummary['scanConfidence']) {
  const scored = items.map(item => Number(item.confidence)).filter(value => Number.isFinite(value) && value > 0)
  if (scored.length > 0) return Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length * 100)
  if (scanConfidence === 'high') return 90
  if (scanConfidence === 'medium') return 78
  if (scanConfidence === 'low') return 62
  return null
}

function InventoryIntelligence({
  inventory,
  roomGroups,
  listingSummary,
  updateHref,
}: {
  inventory: InventoryItem[]
  roomGroups: Map<string, InventoryItem[]>
  listingSummary: PublicListingSummary | null
  updateHref: string
}) {
  const totalUnits = inventory.reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0)
  return (
    <div className="mb-16">
      <SectionLabel>Here&apos;s what we found</SectionLabel>
      <div className="mb-8 grid gap-5 lg:grid-cols-[1fr_280px] lg:items-end">
        <div>
          <div className="max-w-2xl text-3xl font-bold tracking-tight text-[#071421] sm:text-4xl">Your home, room by room.</div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#667085]">Review the items below. Your flat rate is built from this known scope.</p>
        </div>
        <div className="rounded-2xl border border-[#071421]/10 bg-white p-5">
          <div className="flex items-end justify-between gap-4">
            <div><div className="text-3xl font-bold text-[#071421]">{totalUnits}</div><div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#667085]">Included items</div></div>
            <div className="text-right"><div className="text-sm font-bold text-emerald-700">Scope captured</div><div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#667085]">Review below</div></div>
          </div>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {Array.from(roomGroups.entries()).map(([room, items]) => (
          <div key={room} className="rounded-2xl bg-white p-7 shadow-[0_10px_35px_rgba(7,20,33,0.045)]">
            <div className="mb-5 text-lg font-bold text-[#071421]">{room}</div>
            <div className="space-y-3">
              {items.map((item, index) => {
                const name = item.name || item.item || 'Item'
                const qty = Number(item.qty || 1)
                return <div key={`${name}-${index}`} className="flex items-center justify-between gap-4 text-sm"><span className="text-[#071421]/75"><span className="mr-2 text-[#C99700]">✓</span>{name}</span>{qty > 1 && <span className="text-xs font-semibold text-[#667085]">×{qty}</span>}</div>
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 rounded-2xl border border-[#C99700]/25 bg-[#fffaf0] p-6">
        <div className="text-sm font-bold text-[#071421]">Anything missing?</div>
        <p className="mt-1 text-xs leading-5 text-[#667085]">Your moving plan and price are based on the items above. Tell us before accepting if anything is missing—especially boxes, garage or basement contents, outdoor items, or specialty pieces.</p>
        <a href={updateHref} className="mt-4 inline-flex rounded-lg bg-[#071421] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#15273a]">Update my inventory</a>
      </div>
    </div>
  )
}

function ScopeOfWork({ scope }: { scope: CustomerQuoteScope }) {
  const carePlan = buildCustomerCarePlan(scope)
  if (carePlan.length === 0 && scope.serviceNotes.length === 0) return null
  const categoryLabel = {
    protection: 'Protection plan',
    assembly: 'Assembly service',
    specialty: 'Specialty handling',
  } as const
  return (
    <div className="mb-16">
      <SectionLabel>Your care and handling plan</SectionLabel>
      <div className="mb-7 max-w-3xl">
        <div className="text-3xl font-bold tracking-tight text-[#071421]">Prepared for the pieces that need extra care.</div>
        <p className="mt-3 text-sm leading-6 text-[#667085]">These services are connected to the inventory included in your flat-rate scope.</p>
      </div>
      {carePlan.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {carePlan.map((plan, index) => {
            const CareIcon = carePlanIcon(plan.item, plan.category)
            return (
              <div key={`${plan.category}-${plan.item}-${index}`} className="group flex gap-4 rounded-2xl border border-[#071421]/10 bg-white p-5 transition-colors hover:border-[#C99700]/35">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#C99700]/10 text-[#9b7200]">
                  <CareIcon className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
                </div>
                <div className="min-w-0 pt-0.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C99700]">{categoryLabel[plan.category]}</div>
                  <div className="mt-1.5 text-base font-bold text-[#071421]">{plan.item}</div>
                  <div className="mt-1 text-xs leading-5 text-[#667085]">{plan.service}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {(scope.serviceNotes.length > 0 || scope.customerHandledAssemblyItems.length > 0) && (
        <div className="mt-5 rounded-2xl bg-[#071421] p-6 text-white">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-white/50">Scope details</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {scope.serviceNotes.map(note => <div key={note} className="flex gap-2 text-xs leading-5 text-white/75"><span className="text-[#C99700]">✓</span><span>{note}</span></div>)}
            {scope.customerHandledAssemblyItems.map(item => <div key={item} className="flex gap-2 text-xs leading-5 text-white/75"><span className="text-white/35">○</span><span>{item}: assembly handled by customer</span></div>)}
          </div>
        </div>
      )}
    </div>
  )
}

function flatRateTimelineDetail(title: string, crewSize: number, trucks: number, assemblyItems: string[]) {
  const normalized = title.toLowerCase()
  if (normalized.includes('crew starts') || normalized.includes('crew arrives')) {
    return `${crewSize} professional movers · ${trucks} truck${trucks === 1 ? '' : 's'} · confirmed route and pickup plan`
  }
  if (normalized.includes('pickup loaded') || normalized.includes('loading complete')) {
    return 'Included inventory protected, secured, and organized for transport'
  }
  if (normalized.includes('second pickup') || normalized.includes('next pickup')) {
    return 'Continue the confirmed multi-stop pickup plan'
  }
  if (normalized.includes('destination') || normalized.includes('new home')) {
    return `Unload and place furniture room by room${assemblyItems.length ? ` · Reassemble: ${assemblyItems.slice(0, 3).join(', ')}` : ''}`
  }
  if (normalized.includes('complete')) {
    return 'Final placement, walkthrough, and scope confirmation'
  }
  return 'Completed as part of the confirmed moving plan'
}

function RecommendationReasoning({ quote, inventory, listingSummary, crewSize, trucks }: {
  quote: PublicQuote
  inventory: InventoryItem[]
  listingSummary: PublicListingSummary | null
  crewSize: number
  trucks: number
}) {
  const cubicFeet = inventory.reduce((sum, item) => sum + Number(item.cubicFeet || 0) * Math.max(1, Number(item.qty || 1)), 0)
  const truckPlan = recommendTruckLoadPlan({ totalCubicFeet: cubicFeet, totalWeightLbs: quote.estimatedWeightLbs, truckCount: trucks })
  const itemUnits = inventory.reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0)
  const accessReasons = [
    quote.jobFactors?.originHasElevator ? 'origin elevator' : null,
    quote.jobFactors?.destHasElevator ? 'destination elevator' : null,
    (quote.jobFactors?.originFloors || 0) > 1 ? `${quote.jobFactors?.originFloors} origin floors` : null,
    (quote.jobFactors?.destFloors || 0) > 1 ? `${quote.jobFactors?.destFloors} destination floors` : null,
  ].filter(Boolean)
  return (
    <div className="mb-16">
      <SectionLabel>Recommended move plan</SectionLabel>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl bg-[#071421] p-8 text-white">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Crew recommendation</div>
          <div className="mt-3 text-4xl font-bold">{crewSize} movers</div>
          <p className="mt-4 text-sm leading-6 text-white/65">Selected for approximately {itemUnits} inventory items{listingSummary?.livingArea ? ` across ${listingSummary.livingArea} sq ft` : ''}{accessReasons.length ? `, including ${accessReasons.join(' and ')}` : ''}.</p>
        </div>
        <div className="rounded-2xl border border-[#071421]/10 bg-white p-8">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#667085]">Truck recommendation</div>
          <div className="mt-3 text-4xl font-bold text-[#071421]">{truckPlan.summary}</div>
          <p className="mt-4 text-sm leading-6 text-[#667085]">Selected to carry the included room-by-room inventory with the protection equipment and loading plan required for this scope. Final loading order and truck availability are confirmed before moving day.</p>
          {trucks === 2 && quote.moveType !== 'long-distance' && <p className="mt-3 text-xs leading-5 text-[#667085]">Local alternative: 1 × 26ft truck over 2 trips. Your moving coordinator compares the added travel time against the two-truck plan before confirming the best option.</p>}
        </div>
      </div>
    </div>
  )
}

function PhotoGallery({ photos }: { photos: string[] }) {
  const [active, setActive] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  if (photos.length === 0) return null

  return (
    <div className="mx-auto mb-16 max-w-3xl">
      <div className="relative">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="group relative block w-full overflow-hidden rounded-2xl bg-[#071421] text-left shadow-[0_24px_70px_rgba(7,20,33,0.13)]"
          aria-label="Open move photo at full size"
        >
          <img
            src={photos[active]}
            alt={`Move photo ${active + 1} of ${photos.length}`}
            className="mx-auto block max-h-[520px] min-h-[280px] max-w-full object-contain [image-rendering:auto]"
            decoding="async"
            fetchPriority={active === 0 ? 'high' : 'auto'}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#071421]/65 via-transparent to-transparent" />
          <div className="absolute bottom-6 left-7">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Move photo {active + 1} of {photos.length}</div>
            <div className="mt-1 text-sm font-semibold text-white">Select to view full resolution</div>
          </div>
        </button>
        {photos.length > 1 && (
          <>
            <button
              onClick={() => setActive(a => Math.max(0, a - 1))}
              disabled={active === 0}
              className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-xl bg-[#071421]/80 px-3 py-2 text-sm font-bold text-white disabled:opacity-20 hover:bg-[#071421]"
            >‹</button>
            <button
              onClick={() => setActive(a => Math.min(photos.length - 1, a + 1))}
              disabled={active === photos.length - 1}
              className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-xl bg-[#071421]/80 px-3 py-2 text-sm font-bold text-white disabled:opacity-20 hover:bg-[#071421]"
            >›</button>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div ref={scrollRef} className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {photos.map((photo, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`shrink-0 overflow-hidden rounded-lg border transition ${active === i ? 'border-[#071421]' : 'border-transparent opacity-50 hover:opacity-80'}`}
              style={{ width: 96, height: 64 }}
            >
              <img src={photo} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }} />
            </button>
          ))}
        </div>
      )}
      {expanded && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#071421]/95 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Full-resolution move photo"
          onClick={() => setExpanded(false)}
        >
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="absolute right-5 top-5 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
          >
            Close
          </button>
          <img
            src={photos[active]}
            alt={`Move photo ${active + 1} of ${photos.length}`}
            className="max-h-full max-w-full object-contain [image-rendering:auto]"
            decoding="async"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

function AcceptBlock({
  quote,
  brand,
  accepting,
  declining,
  accepted,
  declined,
  justPaid,
  stripeLoading,
  termsAccepted,
  onAccept,
  onDecline,
  onPayStripe,
  onRequireTerms,
  variant = 'main',
}: {
  quote: PublicQuote
  brand: QuoteBrand
  accepting: boolean
  declining: boolean
  accepted: boolean
  declined: boolean
  justPaid: boolean
  stripeLoading: boolean
  termsAccepted: boolean
  onAccept: () => void
  onDecline: () => void
  onPayStripe: () => void
  onRequireTerms: () => void
  variant?: 'main' | 'sticky'
}) {
  const needsTerms = !quote.termsAcceptedAt && !termsAccepted
  const invoiceStyleTerms = isInvoiceStylePaymentTerms(quote.paymentTerms)
  const acceptOrRequestTerms = () => {
    if (needsTerms) {
      onRequireTerms()
      return
    }
    onAccept()
  }
  const payOrRequestTerms = () => {
    if (needsTerms) {
      onRequireTerms()
      return
    }
    onPayStripe()
  }

  if (declined) {
    return variant === 'sticky' ? (
      <div className="rounded-lg border border-[#071421]/20 bg-[#071421]/5 px-4 py-2 text-xs font-semibold text-[#071421]/50">Quote Declined</div>
    ) : (
      <div className="rounded-xl border border-[#071421]/15 bg-[#071421]/5 p-6 text-center">
        <div className="text-sm font-semibold text-[#071421]/60 mb-1">Quote Declined</div>
        <div className="text-xs text-[#071421]/40">If you change your mind, call or text us at {brand.phone}.</div>
      </div>
    )
  }

  if (accepted && justPaid) {
    return variant === 'sticky' ? (
      <div className="rounded-lg bg-[#071421] px-4 py-2 text-xs font-bold text-[#C99700]">Deposit Paid — You&apos;re Booked</div>
    ) : (
      <div className="rounded-xl border-2 border-[#071421] bg-[#071421] p-8 text-center">
        <LogoMark size={56} dark brand={brand} />
        <div className="mt-4 text-xl font-black text-white mb-2">You&apos;re on the calendar.</div>
        <div className="text-sm text-white/70 max-w-sm mx-auto leading-6">
          Your deposit has been received. The {brand.name} team will be in touch shortly to confirm move-day details.
        </div>
        <div className="mt-5 rounded-lg bg-white/10 p-4 text-sm text-white/80">
          Questions? Call or text <strong className="text-[#C99700]">{brand.phone}</strong>{brand.email ? <> or email <strong className="text-[#C99700]">{brand.email}</strong></> : null}
        </div>
      </div>
    )
  }

  if (accepted) {
    if (invoiceStyleTerms) {
      return variant === 'sticky' ? (
        <div className="rounded-lg bg-[#071421] px-4 py-2 text-xs font-bold text-[#C99700]">Estimate Approved</div>
      ) : (
        <div className="rounded-xl border-2 border-[#071421] bg-white p-6 text-center">
          <div className="text-sm font-bold text-[#071421] mb-1">Estimate Approved</div>
          <div className="text-xs text-[#071421]/50">We&apos;ll coordinate billing using {paymentTermsLabel(quote.paymentTerms).toLowerCase()}.</div>
        </div>
      )
    }
    return variant === 'sticky' ? (
      <button
        onClick={payOrRequestTerms}
        disabled={stripeLoading}
        className="rounded-lg bg-[#C99700] px-5 py-2 text-xs font-bold text-[#071421] hover:opacity-90 disabled:opacity-50"
      >
        {stripeLoading ? 'Redirecting...' : `Pay Deposit — ${formatMoney(quote.deposit)}`}
      </button>
    ) : (
      <div className="rounded-xl border-2 border-[#071421] bg-white p-6">
        <div className="text-center mb-5">
          <div className="text-sm font-bold text-[#071421] mb-1">Quote Accepted — Secure Your Date</div>
          <div className="text-xs text-[#071421]/50">Pay your deposit to lock in your move.</div>
        </div>
        <button
          onClick={payOrRequestTerms}
          disabled={stripeLoading}
          className="w-full rounded-xl bg-[#071421] py-4 text-base font-bold text-white hover:bg-[#243460] disabled:opacity-50 shadow-md"
        >
          {stripeLoading ? 'Redirecting to payment...' : `Pay Deposit Online — ${formatMoney(quote.deposit)}`}
        </button>
        <div className="mt-3 rounded-lg border border-[#071421]/10 bg-[#071421]/5 p-3 text-xs text-[#071421]/50 text-center">
          {brand.email ? <>Prefer e-Transfer or cash? Send to <strong>{brand.email}</strong> and reply to confirm.</> : <>Prefer e-Transfer or cash? Call or text <strong>{brand.phone}</strong> to arrange payment.</>}
        </div>
      </div>
    )
  }

  // Not yet accepted
  if (variant === 'sticky') {
    return (
      <div className="flex items-center gap-2">
        <button onClick={onDecline} disabled={declining} className="rounded-lg border border-[#071421]/20 px-3 py-2 text-xs font-medium text-[#071421]/40 hover:border-[#071421]/40 disabled:opacity-40">
          {declining ? '...' : 'Decline'}
        </button>
        <button onClick={invoiceStyleTerms ? acceptOrRequestTerms : payOrRequestTerms} disabled={invoiceStyleTerms ? accepting : stripeLoading} className="rounded-lg bg-[#071421] px-5 py-2 text-xs font-bold text-white hover:bg-[#243460] disabled:opacity-50">
          {invoiceStyleTerms ? (accepting ? 'Approving...' : 'Approve Estimate') : (stripeLoading ? 'Redirecting...' : 'Accept & Pay Deposit')}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-[#071421] px-8 py-14 text-center sm:px-12">
      <div className="text-3xl font-bold tracking-tight text-white">{invoiceStyleTerms ? 'Ready to approve your move?' : 'Ready to secure your move?'}</div>
      <p className="mx-auto mb-8 mt-3 max-w-md text-base leading-7 text-white/55">
        {invoiceStyleTerms
          ? `Approve the estimate and terms now. Billing will be handled by ${paymentTermsLabel(quote.paymentTerms).toLowerCase()} after office confirmation.`
          : 'Pay your deposit now to confirm your booking. Your card is saved on file — balance is due after the move.'}
      </p>
      <button
        onClick={invoiceStyleTerms ? acceptOrRequestTerms : payOrRequestTerms}
        disabled={invoiceStyleTerms ? accepting : stripeLoading}
        className="w-full rounded-xl bg-[#C99700] py-4 text-base font-bold text-[#071421] shadow-lg transition hover:-translate-y-0.5 hover:opacity-95 disabled:opacity-50"
      >
        {invoiceStyleTerms ? (accepting ? 'Approving...' : 'Approve Proposal') : (stripeLoading ? 'Redirecting to payment...' : 'Reserve Your Crew')}
      </button>
      {!invoiceStyleTerms ? (
        <button
          onClick={acceptOrRequestTerms}
          disabled={accepting}
          className="mt-4 text-xs text-white/30 hover:text-white/60 disabled:opacity-40"
        >
          {accepting ? 'Confirming...' : 'Accept without card (E-Transfer/Cash)'}
        </button>
      ) : null}
      <button
        onClick={onDecline}
        disabled={declining}
        className="mt-2 text-xs text-white/20 hover:text-white/40 disabled:opacity-40"
      >
        {declining ? 'Updating...' : 'Decline this quote'}
      </button>
    </div>
  )
}

function CustomerTermsAgreement({
  brand,
  isBindingEstimate,
  termsAccepted,
  termsPrompt,
  onChange,
}: {
  brand: QuoteBrand
  isBindingEstimate: boolean
  termsAccepted: boolean
  termsPrompt: boolean
  onChange: (accepted: boolean) => void
}) {
  return (
    <div className={`rounded-2xl bg-white p-8 transition ${termsPrompt && !termsAccepted ? 'ring-2 ring-[#C99700] shadow-lg shadow-[#C99700]/10' : 'shadow-[0_12px_40px_rgba(7,20,33,0.06)]'}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SectionLabel>Important information</SectionLabel>
          <h2 className="text-3xl font-bold tracking-tight text-[#071421]">A calm, clear agreement.</h2>
          <p className="mt-2 max-w-xl text-xs leading-5 text-[#071421]/55">
            This protects both sides: {brand.name} is agreeing to the price and plan shown here, and you are confirming that the inventory, access, addresses, and services are accurate.
          </p>
        </div>
        <div className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${isBindingEstimate ? 'bg-emerald-50 text-emerald-700' : 'bg-[#C99700]/12 text-[#9b5b00]'}`}>
          {isBindingEstimate ? 'Inventory-based estimate' : 'Hourly / non-binding estimate'}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[#071421]/10 bg-[#F7F4ED] p-4">
        <div className="text-xs font-bold text-[#071421]">
          {isBindingEstimate ? 'If the inventory matches, your agreed estimate is protected.' : 'Final price follows the actual time and work required.'}
        </div>
        <div className="mt-1 text-xs leading-5 text-[#071421]/55">
          {isBindingEstimate
            ? 'If the crew finds extra items, undisclosed areas, special handling, or access conditions that were not included, the office will confirm the change before work starts and the quote may become non-binding.'
            : 'Hourly or non-binding moves are based on the real work performed, including time, labour, materials, truck usage, waiting, access, and approved added scope.'}
        </div>
      </div>

      <div className="mt-6 space-y-2">
        {QUOTE_TERMS_SECTIONS.map((section, sectionIndex) => (
          <details key={section.title} className="group rounded-xl bg-[#F7F4ED] px-5 py-4" open={sectionIndex === 0}>
            <summary className="cursor-pointer list-none text-sm font-bold text-[#071421] marker:hidden">{section.title}<span className="float-right text-[#667085] group-open:rotate-45">+</span></summary>
            <ul className="mt-4 space-y-3">
              {section.items.map(item => item.replaceAll('Saturn Star', brand.name)).map(item => (
                <li key={item} className="flex gap-2 text-xs leading-5 text-[#071421]/58">
                  <span className="mt-1.5 text-[#667085]">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>

      <label className={`mt-4 flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${termsAccepted ? 'border-emerald-200 bg-emerald-50' : termsPrompt ? 'border-[#C99700] bg-[#fff8e8]' : 'border-[#071421]/10 bg-[#F7F4ED]'}`}>
        <input
          type="checkbox"
          checked={termsAccepted}
          onChange={event => onChange(event.target.checked)}
          className="mt-1 h-5 w-5 accent-[#071421]"
        />
        <span>
          <span className="block text-sm font-bold text-[#071421]">I confirm my move details are accurate and agree to the booking terms.</span>
          <span className="mt-1 block text-xs leading-5 text-[#071421]/55">
            I have reviewed the inventory, basement/garage/outdoor contents, access conditions, and specialty items shown in this plan. I understand the crew will verify the scope before loading and that material changes may require my approval of an updated moving plan and price before additional work begins.
          </span>
        </span>
      </label>
      {termsPrompt && !termsAccepted ? (
        <div className="mt-2 text-xs font-semibold text-[#9b5b00]">Please check this box before accepting or paying the deposit.</div>
      ) : null}
    </div>
  )
}

function QuoteAcceptPageInner() {
  const searchParams = useSearchParams()
  const [quote, setQuote] = useState<PublicQuote | null>(null)
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [listingPhotos, setListingPhotos] = useState<string[]>([])
  const [listingSummary, setListingSummary] = useState<PublicListingSummary | null>(null)
  const [jobFactors, setJobFactors] = useState<JobFactors | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stripeLoading, setStripeLoading] = useState(false)
  const [lineItemsOpen, setLineItemsOpen] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [termsPrompt, setTermsPrompt] = useState(false)
  const termsRef = useRef<HTMLDivElement | null>(null)

  const id = searchParams.get('id')
  const token = searchParams.get('token')
  const printMode = searchParams.get('print') === '1'
  const justPaid = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('paid') === '1'
  const depositConfirmed = justPaid || quote?.depositPaid === true

  useEffect(() => {
    async function load() {
      if (!id || !token) { setError('Missing quote link details.'); setLoading(false); return }
      try {
        const r = await fetch(`/api/public/quotes/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
        const payload = await r.json()
        if (!r.ok) throw new Error(payload?.error || 'Failed to load quote')
        setQuote(payload.quote)
        setClientName(payload.client?.name || payload.lead?.name || '')
        setClientEmail(payload.client?.email || '')
        setClientPhone(payload.client?.phone || '')
        setInventory(payload.lead?.inventory || [])
        setListingPhotos(payload.lead?.listingPhotos || [])
        setListingSummary(payload.lead?.listingSummary || null)
        setJobFactors(payload.lead?.jobFactors || null)
        setAccepted(payload.quote.status === 'accepted' || payload.quote.status === 'invoiced')
        setTermsAccepted(Boolean(payload.quote.termsAcceptedAt))
        setDeclined(payload.quote.status === 'declined')
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [id, token])

  useEffect(() => {
    if (!printMode || loading || !quote) return
    const timer = window.setTimeout(() => window.print(), 450)
    return () => window.clearTimeout(timer)
  }, [loading, printMode, quote])

  async function confirmAccept() {
    if (!id || !token) return
    if (!ensureTermsAccepted()) return
    try {
      setAccepting(true)
      const r = await fetch(`/api/public/quotes/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, termsAccepted: true, scopeConfirmed: true, termsVersion: QUOTE_TERMS_VERSION }),
      })
      const payload = await r.json()
      if (!r.ok) throw new Error(payload?.error || 'Failed to accept quote')
      setQuote(payload.quote)
      setAccepted(true)
      setDeclined(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAccepting(false)
    }
  }

  async function confirmDecline() {
    if (!id || !token) return
    try {
      setDeclining(true)
      const r = await fetch(`/api/public/quotes/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'decline' }),
      })
      const payload = await r.json()
      if (!r.ok) throw new Error(payload?.error || 'Failed to decline quote')
      setQuote(payload.quote)
      setAccepted(false)
      setDeclined(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeclining(false)
    }
  }

  async function payDepositStripe() {
    if (!id) return
    if (!ensureTermsAccepted()) return
    try {
      setStripeLoading(true)
      const r = await fetch('/api/sales/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: id, token, termsAccepted: true, scopeConfirmed: true, termsVersion: QUOTE_TERMS_VERSION }),
      })
      const payload = await r.json() as { url?: string; error?: string }
      if (!r.ok || !payload.url) throw new Error(payload.error || 'Could not create payment session')
      window.location.href = payload.url
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setStripeLoading(false)
    }
  }

  function ensureTermsAccepted() {
    if (termsAccepted || quote?.termsAcceptedAt) return true
    setTermsPrompt(true)
    setError(null)
    window.setTimeout(() => termsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40)
    return false
  }

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F4ED]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-9 w-9 animate-pulse rounded-xl bg-[#071421]/10" />
        <div className="text-xs text-[#071421]/40 tracking-wider uppercase">Loading your quote...</div>
      </div>
    </div>
  )

  if (error || !quote) return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F4ED] p-6">
      <div className="rounded-xl border border-[#071421]/15 bg-white p-8 text-center text-sm text-[#071421]/60 max-w-md">
        {error || 'Quote not found or link is invalid.'}
      </div>
    </div>
  )

  const firstName = clientName.split(' ')[0] || 'there'
  const daysOut = daysUntilMove(quote.moveDate)
  const depPct = depositPct(quote)
  const isBindingEstimate = quote.billingModel !== 'hourly_actuals' && quote.billingModel !== 'hourly_minimum'
  const isSingleLocationLaborOnly = quoteServiceLabel(quote) === 'Labour-Only Service'
  const bundledMove = isBindingEstimate
  const invoiceStyleTerms = isInvoiceStylePaymentTerms(quote.paymentTerms)
  const hasInventory = inventory.length > 0
  const totalInventoryPieces = inventory.reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0)
  const roomGroups = groupInventoryByRoom(inventory)
  const crewSize = quote.crewSize || 3
  const trucks = quote.truckCount || 1
  const rawHours = Number(quote.estimatedHours || 0)
  const hours = rawHours > 0 ? `${rawHours}–${Math.ceil(rawHours * 1.25)}` : null
  const moveIntelligence = assessMoveIntelligence({
    inventory,
    jobFactors: quote.jobFactors,
    originAddress: quote.originAddress,
    destinationAddress: quote.destAddress,
    legs: quote.legs,
    singleLocation: isSingleLocationLaborOnly,
  })
  const reviewedHiddenAreas = hiddenInventoryCoverage(jobFactors || undefined)
  const legacyAssemblyItems = (quote.jobFactors?.disassemblyItemCount ?? 0) > 0
    ? inventory
        .filter(item => /\bbed\b|\btable\b|\bdesk\b|\bdresser\b|\bwardrobe\b|\btreadmill\b/i.test(item.name || item.item || ''))
        .slice(0, quote.jobFactors?.disassemblyItemCount || 4)
        .map(item => item.name || item.item || 'Item')
    : []
  const customerScope = quote.customerScope || buildCustomerQuoteScope({
    inventory,
    jobFactors: quote.jobFactors,
    assemblyItems: legacyAssemblyItems,
    specialtyItems: [
      quote.jobFactors?.hasPiano ? 'Piano' : null,
      quote.jobFactors?.hasSafe ? 'Safe' : null,
      ...inventory
        .filter(item => /\b(?:treadmill|electric fireplace|piano|safe|pool table)\b/i.test(item.name || item.item || '') || item.handlingProfile?.level === 'specialty')
        .map(item => item.name || item.item || 'Specialty item'),
    ].filter(Boolean) as string[],
  })
  const serviceLabel = quoteServiceLabel(quote)
  const marketLabel = quoteMarketLabel(quote)
  const brand = quoteBrand(quote)
  const quoteOptionLabel = getCustomerQuoteOptionLabel({
    jobLabel: quote.jobLabel,
    moveDescription: quote.moveDescription,
  })

  // ── Fast Lane view — hourly rate quote, no inventory/photos, direct to Stripe ──
  const DEPOSIT = 100
  const isFastLane = searchParams.get('fastlane') === '1'
  if (isFastLane) {
    const lineItem = quote.lineItems?.[0]
    const rateDesc = lineItem?.description || ''
    const rangeDesc = lineItem?.details || ''
    const specialtyNote = (quote as unknown as Record<string, unknown>).moveDescription as string | undefined
    const alreadyPaid = depositConfirmed

    // Extract min/max from range for display
    const rangeMatch = rangeDesc.match(/(\d+(?:\.\d+)?)[-–](\d+(?:\.\d+)?)\s*hrs?/i)
    const rate = String(quote.hourlyRateOverride || rateDesc.match(/\$(\d+)\/hr/)?.[1] || '')
    const minimumHours = Number(quote.minimumBillableHours || 0) || (rangeMatch ? parseFloat(rangeMatch[1]) : 0)
    const maximumHours = Number(quote.maximumEstimatedHours || 0) || (rangeMatch ? parseFloat(rangeMatch[2]) : minimumHours)
    const minimumTotal = quote.total || (rate ? Math.round(parseInt(rate, 10) * minimumHours * 1.13) : 0)
    const maximumTotal = rate && maximumHours > minimumHours
      ? Math.round(parseInt(rate, 10) * maximumHours * 1.13)
      : minimumTotal

    return (
      <div className="min-h-screen bg-[#F7F4ED]">
        <div className="mx-auto max-w-md px-4 py-8 pb-16">
          {/* Header */}
          <div className="mb-6 flex items-center gap-3">
            <LogoMark size={36} brand={brand} />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#071421]/40">{brand.name}</div>
              <div className="text-sm font-semibold text-[#071421]">Your Moving Quote</div>
            </div>
          </div>

          {alreadyPaid ? (
            <div className="rounded-2xl border-2 border-[#071421] bg-[#071421] p-8 text-center">
              <LogoMark size={56} dark brand={brand} />
              <div className="mt-4 text-xl font-black text-white mb-2">You&apos;re on the calendar.</div>
              <div className="text-sm text-white/70 max-w-sm mx-auto leading-6">
                Deposit received. The {brand.name} team will be in touch to confirm your move details.
              </div>
              <div className="mt-5 rounded-lg bg-white/10 p-4 text-sm text-white/80">
                Questions? Call or text <strong className="text-[#C99700]">{brand.phone}</strong>
              </div>
            </div>
          ) : (
            <>
              {/* Hi + name */}
              <div className="mb-4 text-lg font-semibold text-[#071421]">Hi {firstName},</div>

              {/* Rate card */}
              <div className="rounded-2xl bg-white border border-[#071421]/10 shadow-sm p-5 mb-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#071421]/40 mb-3">Your quote</div>
                <div className="text-xl font-black text-[#071421] mb-1">{rateDesc}</div>
                {maximumHours > minimumHours ? (
                  <div className="text-sm text-[#071421]/60 mb-4">Most jobs in this lane take about {minimumHours}-{maximumHours} hours</div>
                ) : (
                  <div className="text-sm text-[#071421]/60 mb-4">{minimumHours}-hour minimum</div>
                )}

                {rate && minimumHours > 0 && (
                  <div className="rounded-xl bg-[#F7F4ED] p-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[#071421]/40 mb-2">Minimum charge (incl. HST)</div>
                    <div className="text-2xl font-black text-[#071421]">
                      ${minimumTotal.toLocaleString()}
                    </div>
                    <div className="mt-1 text-[11px] text-[#071421]/50">
                      Based on a {minimumHours}-hour minimum at ${rate}/hr + 13% HST
                    </div>
                    {maximumHours > minimumHours ? (
                      <div className="mt-2 text-[11px] font-medium text-[#071421]/70">
                        If the move runs longer, the same hourly rate continues. A typical top end for this lane is about ${maximumTotal.toLocaleString()} incl. HST.
                      </div>
                    ) : null}
                  </div>
                )}

                <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <span className="text-sm">⚠️</span>
                  <div className="text-[11px] leading-snug text-amber-800">
                    <strong>{minimumHours}-hour minimum.</strong> If the crew finishes sooner, the minimum still applies. After that, time bills in 15-minute increments at the same hourly rate. Gas and travel are included.
                  </div>
                </div>

                {specialtyNote && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#071421]/10 bg-[#F7F4ED] px-3 py-2.5">
                    <span className="text-sm">📋</span>
                    <div className="text-[11px] leading-snug text-[#071421]/70">{specialtyNote}</div>
                  </div>
                )}
              </div>

              {!alreadyPaid && (
                <div ref={termsRef} className="mb-4">
                  <CustomerTermsAgreement
                    brand={brand}
                    isBindingEstimate={false}
                    termsAccepted={termsAccepted}
                    termsPrompt={termsPrompt}
                    onChange={(accepted) => {
                      setTermsAccepted(accepted)
                      if (accepted) setTermsPrompt(false)
                    }}
                  />
                </div>
              )}

              {/* Deposit + book */}
              <div className="rounded-2xl border-2 border-[#071421] bg-[#071421] p-6 text-center mb-4">
                <div className="text-lg font-black text-white mb-1">{invoiceStyleTerms ? 'Approve this estimate' : 'Reserve your move date'}</div>
                <div className="text-sm text-white/60 mb-5 leading-5">
                  {invoiceStyleTerms
                    ? `Confirm the scope and terms. Billing will be handled by ${paymentTermsLabel(quote.paymentTerms).toLowerCase()}.`
                    : `$${DEPOSIT} deposit holds your spot. Card saved on file — balance due on move day.`}
                </div>
                <button
                  onClick={() => invoiceStyleTerms ? void confirmAccept() : void payDepositStripe()}
                  disabled={invoiceStyleTerms ? accepting : stripeLoading}
                  className="w-full rounded-xl bg-[#C99700] py-4 text-base font-black text-[#071421] hover:opacity-90 disabled:opacity-50 shadow-lg transition"
                >
                  {invoiceStyleTerms ? (accepting ? 'Approving...' : 'Approve Estimate') : (stripeLoading ? 'Redirecting...' : `Book Now — Pay $${DEPOSIT} Deposit`)}
                </button>
                {!invoiceStyleTerms ? (
                  <div className="mt-3 text-[10px] text-white/30">
                    {brand.email ? `Prefer e-Transfer? Send to ${brand.email} and reply to confirm.` : `Prefer e-Transfer? Call or text ${brand.phone} to arrange payment.`}
                  </div>
                ) : null}
              </div>

              {/* Social proof */}
              <div className="space-y-2">
                {brand.logo === 'saturn' && REVIEWS.slice(0, 2).map((r, i) => (
                  <div key={i} className="rounded-xl bg-white border border-[#071421]/8 p-4">
                    <Stars count={r.stars} />
                    <div className="mt-1 text-xs text-[#071421]/70 leading-5">&ldquo;{r.text}&rdquo;</div>
                    <div className="mt-1 text-[10px] font-semibold text-[#071421]/40">{r.name}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 text-center text-xs text-[#071421]/40">
                Questions? Call or text <strong>{brand.phone}</strong>{brand.website ? ` · ${brand.website}` : ''}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F7F4ED] print:bg-white">

      {/* ── Sticky top bar ── */}
      <div className="print:hidden sticky top-0 z-20 border-b border-[#071421]/10 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <LogoMark size={28} brand={brand} />
            <div>
              <div className="text-xs font-black tracking-tight text-[#071421]">{brand.shortName}</div>
              <div className="text-[9px] font-medium text-[#071421]/40 tracking-wide">MOVING</div>
            </div>
          </div>
          <AcceptBlock
            quote={quote}
            brand={brand}
            accepting={accepting}
            declining={declining}
            accepted={accepted}
            declined={declined}
            justPaid={depositConfirmed}
            stripeLoading={stripeLoading}
            termsAccepted={termsAccepted}
            onAccept={() => void confirmAccept()}
            onDecline={() => void confirmDecline()}
            onPayStripe={() => void payDepositStripe()}
            onRequireTerms={ensureTermsAccepted}
            variant="sticky"
          />
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16 print:px-0 print:py-4 print:max-w-none">

        {/* ── Hero ── */}
        <div className="relative mb-16 overflow-hidden rounded-2xl bg-[#071421] shadow-[0_30px_90px_rgba(7,20,33,0.18)]">
          {listingPhotos[0] && (
            <>
              <img src={listingPhotos[0]} alt="" className="absolute inset-0 h-full w-full object-cover" aria-hidden="true" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#071421]/95 via-[#071421]/78 to-[#071421]/35" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#071421]/80 via-transparent to-[#071421]/20" />
            </>
          )}
          {/* Gold top accent bar */}
          <div className="relative z-10 h-1 bg-[#C99700]" />
          <div className="relative z-10 flex min-h-[620px] flex-col justify-between px-7 py-12 sm:px-12 sm:py-16">
            <div>
            {/* Logo + brand */}
            <div className="mb-12 flex items-center gap-4">
              <LogoMark size={64} dark brand={brand} />
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white">{brand.name}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/40">Your moving estimate · {marketLabel}</div>
              </div>
            </div>

            <h1 className="mb-4 max-w-2xl text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-white sm:text-6xl">
              Your move.<br />Prepared for {firstName}.
            </h1>
            <p className={`max-w-xl text-base leading-7 text-white/70 ${quoteOptionLabel ? 'mb-3' : 'mb-10'}`}>
              {listingPhotos.length > 0
                ? listingSummary
                  ? 'Built from your home’s listing, detected inventory, and the move details shared with our team.'
                  : 'Built from the photos and move details you shared with our team.'
                : 'A complete moving plan based on the inventory and move details you provided.'}
            </p>
            {quoteOptionLabel && (
              <div className="mb-8 inline-flex rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white/80">
                {quoteOptionLabel}
              </div>
            )}

            {/* Move countdown */}
            {daysOut !== null && daysOut > 0 && (
              <div className="mb-8 inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2">
                <div className="h-1.5 w-1.5 rounded-full bg-[#C99700]" />
                <span className="text-xs font-bold text-white/80">
                  {daysOut === 1 ? 'Move is TOMORROW' : `${daysOut} days until your move`}
                </span>
              </div>
            )}
            {daysOut === 0 && (
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 mb-5">
                <div className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                <span className="text-xs font-bold text-white">Move Day is TODAY</span>
              </div>
            )}
            </div>

            {/* Route / single service location */}
            <div className={`${isSingleLocationLaborOnly ? 'grid-cols-1' : 'grid-cols-[1fr_44px_1fr]'} grid items-center gap-3 rounded-2xl px-5 py-6`} style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/35">{isSingleLocationLaborOnly ? 'Work location' : 'Origin'}</div>
                <div className="text-lg font-bold leading-tight text-white">{quote.originCity || (isSingleLocationLaborOnly ? 'Service address' : 'Origin')}</div>
                {quote.originAddress && <div className="mt-1 text-xs leading-5 text-white/40">{quote.originAddress}</div>}
              </div>
              {!isSingleLocationLaborOnly && <div className="flex justify-center">
                <svg width="20" height="16" viewBox="0 0 20 16" fill="none">
                  <path d="M0 8H18M18 8L11 1M18 8L11 15" stroke="#C99700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>}
              {!isSingleLocationLaborOnly && <div className="text-right">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/35">Destination</div>
                {(quote.legs?.length ?? 0) > 1 ? (
                  <div className="text-sm font-bold text-white leading-tight">{quote.legs!.length} Stops</div>
                ) : (
                  <>
                    <div className="text-lg font-bold leading-tight text-white">{quote.destCity || 'Destination'}</div>
                    {quote.destAddress && <div className="mt-1 text-xs leading-5 text-white/40">{quote.destAddress}</div>}
                  </>
                )}
              </div>}
            </div>
          </div>
        </div>

        {/* ── Customer and property photos ── */}
        {listingPhotos.length > 0 && <PhotoGallery photos={listingPhotos} />}

        {/* ── Move stats ── */}
        <div className="mb-16">
          <SectionLabel>Your move at a glance</SectionLabel>
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(7,20,33,0.06)] sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: 'Move Date', value: quote.moveDate ? formatDate(quote.moveDate) : 'TBD' },
            { label: isSingleLocationLaborOnly ? 'Work Location' : 'Route', value: isSingleLocationLaborOnly ? (quote.originCity || quote.originAddress || 'Service address') : `${quote.originCity || 'Origin'} → ${quote.destCity || 'Destination'}` },
            { label: 'Crew', value: `${crewSize} Movers` },
            { label: trucks === 1 ? 'Truck' : 'Trucks', value: `${trucks} Truck${trucks > 1 ? 's' : ''}` },
            { label: 'Home inventory', value: hasInventory ? `${totalInventoryPieces} Pieces` : 'In review' },
          ].map(stat => (
            <div key={stat.label} className="px-5 py-6 text-center">
              <div className="text-base font-bold text-[#071421]">{stat.value}</div>
              <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#667085]">{stat.label}</div>
            </div>
          ))}
          </div>
        </div>

        {/* ── Estimate type ── */}
        <div className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3.5 ${
          isBindingEstimate
            ? 'border-[#071421]/20 bg-[#071421]/5'
            : 'border-[#C99700]/30 bg-[#C99700]/8'
        }`} style={isBindingEstimate ? {} : { background: 'rgba(245,166,35,0.06)' }}>
          <div className={`mt-0.5 h-2 w-2 rounded-full flex-shrink-0 ${isBindingEstimate ? 'bg-[#071421]' : 'bg-[#C99700]'}`} />
          <div>
            <div className={`text-xs font-bold mb-0.5 ${isBindingEstimate ? 'text-[#071421]' : 'text-[#071421]'}`}>
              {isBindingEstimate ? (quote.scopeStatus === 'provisional' ? 'Scope-Based Estimate · Confirmation Pending' : 'Scope-Based Flat Rate') : 'Hourly Estimate'}
            </div>
            <div className="text-xs leading-5 text-[#071421]/50">
              {isBindingEstimate
                ? quote.scopeStatus === 'provisional'
                  ? 'This estimate is ready to review. Confirm the highlighted inventory and access details with our team before the scope is finalized.'
                  : 'Your price is built from the inventory, access details, and services included in this scope.'
                : 'Based on a typical move of this type. You pay for actual hours at the agreed rate.'
              }
            </div>
          </div>
        </div>

        {isBindingEstimate && moveIntelligence.fixedPriceReadiness !== 'ready' && (
          <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-[#071421]">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-800">Scope confirmation required</div>
            <p className="mt-2 text-sm leading-6 text-[#071421]/70">
              This fixed price applies to the inventory and access shown in this estimate. A moving coordinator must confirm the remaining high-impact access or handling details before dispatch.
            </p>
            {moveIntelligence.questions.slice(0, 3).map(question => (
              <div key={question.id} className="mt-2 text-xs font-semibold text-[#071421]/70">• {question.question}</div>
            ))}
          </div>
        )}

        {hasInventory && (
          <InventoryIntelligence
            inventory={inventory}
            roomGroups={roomGroups}
            listingSummary={listingSummary}
            updateHref={`sms:${brand.phoneHref.replace(/^tel:/, '')}?&body=${encodeURIComponent(`Hi ${brand.shortName}, I need to update the inventory for quote ${quote.number}.`)}`}
          />
        )}

        {hasInventory && (
          <section className="mb-12 rounded-2xl border border-[#071421]/15 bg-white p-6 sm:p-8">
            <div className="text-xs font-bold uppercase tracking-wider text-[#C99700]">Before you continue</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-[#071421]">The three inventory blind spots.</h2>
            <p className="mt-2 text-sm leading-6 text-[#071421]/60">Please make sure these areas are accurately represented above. They can materially change the moving plan and vehicle capacity.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {reviewedHiddenAreas.filter(area => ['basement', 'garage', 'outdoor'].includes(area.key)).map(area => (
                <div key={area.key} className={`rounded-xl border px-4 py-4 ${area.resolved ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                  <div className="flex items-center justify-between gap-2"><span className="font-bold text-[#071421]">{area.label}</span><span className={area.resolved ? 'text-emerald-700' : 'text-amber-700'}>{area.resolved ? '✓' : '!'}</span></div>
                  <div className="mt-2 text-xs leading-5 text-[#071421]/60">{area.value?.state === 'not_applicable' ? 'None / not applicable' : area.value?.state === 'customer_confirmed' ? 'Customer confirmed' : area.value?.state === 'observed' ? 'Verified from property evidence' : area.value?.state === 'estimated' ? 'Included as an estimate' : 'Tell us if this area contains anything moving'}{area.value?.note ? ` — ${area.value.note}` : ''}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {hasInventory && (
          <RecommendationReasoning
            quote={quote}
            inventory={inventory}
            listingSummary={listingSummary}
            crewSize={crewSize}
            trucks={trucks}
          />
        )}

        {hasInventory && <ScopeOfWork scope={customerScope} />}

        {/* ── Multi-leg Move Plan ── */}
        {(quote.legs?.length ?? 0) > 1 && (
          <div className="mb-6 overflow-hidden rounded-xl border border-[#071421]/10 bg-white">
            <div className="border-b border-[#071421]/8 px-5 py-4">
              <div className="text-xs font-bold uppercase tracking-wider text-[#071421]">Move Plan — {quote.legs!.length} Stops</div>
            </div>
            <div className="divide-y divide-[#071421]/6">
              {quote.legs!.map((leg, idx) => {
                const typeLabel = leg.type === 'junk' ? 'Junk Removal' : leg.type === 'delivery' ? 'Delivery' : leg.type === 'storage' ? 'House → Storage' : leg.type === 'storage_delivery' ? 'Storage → New Home' : 'Moving'
                const origin = [leg.originAddress, leg.originCity].filter(Boolean).join(', ') || '—'
                const dest = [leg.destAddress, leg.destCity].filter(Boolean).join(', ') || '—'
                const customerLegNote = isBindingEstimate ? '' : leg.notes || ''
                return (
                  <div key={leg.id} className="flex items-start gap-4 px-5 py-4">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#071421] text-[10px] font-bold text-white mt-0.5">{idx + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-[#071421]">{leg.label}</span>
                        <span className="rounded-full bg-[#C99700]/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#071421]">{typeLabel}</span>
                        {leg.scheduledDate && (
                          <span className="text-[10px] text-[#071421]/40">{new Date(leg.scheduledDate + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 text-xs text-[#071421]/50">
                        <span className="truncate">{origin}</span>
                        <svg className="h-3 w-3 shrink-0 text-[#C99700]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                        <span className="truncate">{dest}</span>
                      </div>
                      {(leg.distanceKm || customerLegNote) && (
                        <div className="mt-1 text-[10px] text-[#071421]/35">
                          {leg.distanceKm ? `${leg.distanceKm} km${!isBindingEstimate && leg.driveHours ? ` · ${leg.driveHours}h drive` : ''}` : ''}
                          {leg.distanceKm && customerLegNote ? ' · ' : ''}
                          {customerLegNote}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Move Day Timeline ── */}
        {(isBindingEstimate ? hasInventory : rawHours > 0) && (() => {
          const disItems = customerScope.assemblyItems
          const isTwoDay = rawHours > 13
          const timeline = buildConjointMoveTimeline({
            quote,
            inventory,
            crewSize,
            trucks,
            estimatedHours: Math.max(rawHours, 1),
          }) || buildMoveTimeline({
            startTime: quote.moveTime || '09:00',
            crewSize, trucks, estimatedHours: Math.max(rawHours, 1),
            quoteType: quote.quoteType,
            moveType: quote.moveType,
            disassemblyItems: disItems,
            originCity: quote.originCity,
            destCity: quote.destCity,
            isTwoDay,
          })
          return (
            <div className="mb-16 overflow-hidden rounded-2xl bg-white p-8 shadow-[0_12px_40px_rgba(7,20,33,0.06)] sm:p-10">
              <div className="mb-8">
                <SectionLabel>Your moving day</SectionLabel>
                <div className="text-3xl font-bold tracking-tight text-[#071421]">From arrival to the final room.</div>
                <div className="mt-2 text-sm text-[#667085]">A considered plan for how your move unfolds.</div>
              </div>
              {isBindingEstimate && (
                <div className="mb-8 rounded-xl border border-[#C99700]/25 bg-[#fffaf0] p-5">
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#9b7200]">Before anything is loaded</div>
                  <p className="mt-2 text-sm leading-6 text-[#071421]/70">Your crew will complete a quick walkthrough with you to verify the inventory and move conditions against this plan. If the scope has materially changed, we will explain any required adjustment before additional work begins.</p>
                </div>
              )}
              <div>
                <div className="relative">
                  {/* Vertical line */}
                  <div className="absolute left-[18px] top-4 bottom-4 w-px bg-[#071421]/10" />
                  <div className="space-y-7">
                    {timeline.map((phase, i) => {
                      const PhaseIcon = timelinePhaseIcon(phase)
                      return <div key={i} className="flex gap-4">
                        <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#C99700]/15 bg-[#fffaf0] text-[#9b7200] shadow-[0_3px_10px_rgba(7,20,33,0.05)]">
                          <PhaseIcon className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#C99700]">{isBindingEstimate ? `Stage ${i + 1}` : phase.time}</span>
                            <span className="text-xs font-semibold text-[#071421]/70">{phase.title}</span>
                          </div>
                          <div className="mt-1 text-sm leading-5 text-[#667085]">{isBindingEstimate ? flatRateTimelineDetail(phase.title, crewSize, trucks, customerScope.assemblyItems) : phase.detail}</div>
                        </div>
                      </div>
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {/* ── Pricing ── */}
        <div className="mb-12 overflow-hidden rounded-2xl bg-[#071421] text-white shadow-[0_24px_70px_rgba(7,20,33,0.16)]">
          <div className="flex items-center justify-between px-8 pt-8 sm:px-12 sm:pt-12">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Your move investment</div>
            {!bundledMove && <button
              onClick={() => setLineItemsOpen(v => !v)}
              className="text-[10px] font-semibold uppercase tracking-wide text-white/40 hover:text-white"
            >
              {lineItemsOpen ? 'Hide breakdown' : 'See breakdown'}
            </button>}
          </div>

          {/* Summary row */}
          <div className="grid grid-cols-[1fr_auto] gap-4 px-8 py-6 text-sm sm:px-12">
            <div>
              <div className="font-semibold text-white">{serviceLabel}</div>
              <div className="mt-1 text-xs text-white/40">
                {crewSize}-person professional team · {trucks} truck{trucks > 1 ? 's' : ''}{!bundledMove && hours ? ` · ~${hours} hrs` : bundledMove ? ' · planned execution' : ''}
              </div>
            </div>
            <div className="font-semibold text-white">{formatMoney(quote.subtotal)}</div>
          </div>

          {/* Line items */}
          {!bundledMove && lineItemsOpen && (
            <div className="mx-8 rounded-xl bg-white/5 sm:mx-12">
              {quote.lineItems.map((item, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-4 px-5 py-3">
                  <div>
                    <div className="text-xs font-medium text-white/80">{item.description}</div>
                    {item.details && <div className="mt-0.5 text-[10px] leading-4 text-white/35">{item.details}</div>}
                  </div>
                  <div className="text-right text-xs font-medium text-white/60">{formatMoney(item.amount)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Totals */}
          <div className="px-8 pb-10 pt-4 text-center sm:px-12 sm:pb-14">
            {(quote.discountAmount || 0) > 0 && (
              <div className="mb-3 flex justify-center gap-3 text-white/55">
                <span className="text-xs">{quote.discountLabel || 'Discount'}</span>
                <span className="text-xs font-semibold">−{formatMoney(quote.discountAmount!)}</span>
              </div>
            )}
            {/* Subtotal is the hero — anchors customer on pre-tax price */}
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">{bundledMove ? 'Flat-rate move investment' : 'Estimated relocation total'}</div>
            <div className="mt-3 text-5xl font-bold tracking-[-0.04em] text-white sm:text-6xl">{formatMoney(quote.subtotal)}</div>
            <div className="mt-4 flex justify-center gap-2 text-xs text-white/35">
              <span>HST {formatMoney(quote.hst)}</span><span>·</span><span>{formatMoney(quote.total)} inclusive</span>
            </div>
          </div>
        </div>

        {/* ── Payment schedule ── */}
        <div className="mb-16 overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(7,20,33,0.06)]">
          <div className="px-8 pt-8 sm:px-10">
            <SectionLabel>{invoiceStyleTerms ? 'Approval and billing' : 'Reservation and payment'}</SectionLabel>
          </div>
          {invoiceStyleTerms ? (
            <div className="px-5 py-4">
              <div className="text-[9px] font-bold uppercase tracking-widest text-[#C99700] mb-1">Terms</div>
              <div className="text-2xl font-black text-[#071421]">{paymentTermsLabel(quote.paymentTerms)}</div>
              <div className="mt-2 text-xs leading-5 text-[#071421]/45">
                Approving this estimate confirms the scope and terms. {brand.name} will coordinate billing, invoice details, or purchase-order requirements with your office contact.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2">
              <div className="px-8 pb-8 sm:px-10">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#667085]">Deposit today · {depPct}%</div>
                <div className="text-4xl font-bold tracking-tight text-[#071421]">{formatMoney(quote.deposit)}</div>
                <div className="mt-2 text-xs text-[#667085]">Reserves your date and crew</div>
              </div>
              <div className="px-8 pb-8 sm:px-10">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#667085]">Balance · {100 - depPct}%</div>
                <div className="text-4xl font-bold tracking-tight text-[#071421]">{formatMoney(quote.balance)}</div>
                <div className="mt-2 text-xs text-[#667085]">Due when your move is complete</div>
              </div>
            </div>
          )}
          <div className="border-t border-[#071421]/8 bg-[#071421]/3 px-5 py-3" style={{ background: 'rgba(26,39,68,0.025)' }}>
            {!invoiceStyleTerms && <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[#071421]/55"><span>Total including HST: <strong className="text-[#071421]">{formatMoney(quote.total)}</strong></span><span>−</span><span>deposit: <strong className="text-[#071421]">{formatMoney(quote.deposit)}</strong></span><span>=</span><span>remaining balance: <strong className="text-[#071421]">{formatMoney(quote.balance)}</strong></span></div>}
            <div className="flex flex-wrap gap-1.5">
              {['Cash', 'e-Transfer', 'Credit Card', 'Debit'].map(m => (
                <span key={m} className="rounded-full border border-[#071421]/15 px-2.5 py-0.5 text-[10px] font-medium text-[#071421]/50">{m}</span>
              ))}
            </div>
            <div className="mt-1.5 text-[9px] text-[#071421]/30">No card or administration surcharge{brand.email ? ` · e-Transfer also available at ${brand.email}` : ` · Contact ${brand.phone} for e-Transfer details`}</div>
          </div>
        </div>

        {/* ── Accept CTA ── */}
        <div className="mb-8 print:hidden">
          <AcceptBlock
            quote={quote}
            brand={brand}
            accepting={accepting}
            declining={declining}
            accepted={accepted}
            declined={declined}
            justPaid={depositConfirmed}
            stripeLoading={stripeLoading}
            termsAccepted={termsAccepted}
            onAccept={() => void confirmAccept()}
            onDecline={() => void confirmDecline()}
            onPayStripe={() => void payDepositStripe()}
            onRequireTerms={ensureTermsAccepted}
          />
          {error && <div className="mt-3 rounded-lg border border-[#071421]/15 bg-[#071421]/5 px-4 py-2 text-xs text-[#071421]/60">{error}</div>}
        </div>

        {/* ── Trust before paperwork ── */}
        {brand.logo === 'saturn' && (
          <div className="mb-16">
            <SectionLabel>Trusted for moves that matter</SectionLabel>
            <div className="mb-8 max-w-2xl text-3xl font-bold tracking-tight text-[#071421] sm:text-4xl">Careful planning. Calm communication. Five-star execution.</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {REVIEWS.map((review, index) => (
                <div key={index} className="rounded-2xl bg-white p-7 shadow-[0_12px_40px_rgba(7,20,33,0.05)]">
                  <Stars count={review.stars} />
                  <p className="mt-5 text-base leading-7 text-[#071421]/70">{review.text}</p>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-[#667085]">{review.name}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 text-center text-xs text-[#667085]">Five-star rated on Google · starmovers.ca</div>
          </div>
        )}

        {/* ── Conditional Clause ── */}
        {quote.conditionalClause && (
          <div className="mb-6 overflow-hidden rounded-xl border border-[#C99700]/30 bg-white">
            <div className="border-b border-[#C99700]/20 px-5 py-3.5" style={{ background: 'rgba(245,166,35,0.05)' }}>
              <div className="flex items-center gap-2">
                <span className="text-sm">⚠️</span>
                <div className="text-xs font-bold uppercase tracking-wider text-[#071421]">Important Condition</div>
              </div>
            </div>
            <div className="px-5 py-4 text-sm text-[#071421]/70 leading-6">
              {quote.conditionalClause}
            </div>
          </div>
        )}

        {/* ── Move-specific notes ── */}
        {jobFactors && (() => {
          const notes = buildMoveSpecificNotes(jobFactors, inventory, quote.moveType)
          if (notes.length === 0) return null
          return (
            <div className="mb-8">
              <SectionLabel>Move-Specific Notes</SectionLabel>
              <div className="rounded-xl border border-[#071421]/10 bg-white divide-y divide-[#071421]/5">
                {notes.map((note, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3">
                    <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#C99700] flex-shrink-0" />
                    <span className="text-xs text-[#071421]/70 leading-5">{note}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* ── What's included ── */}
        <div className="mb-8">
          <SectionLabel>What&apos;s Included</SectionLabel>
          <div className="rounded-xl border border-[#071421]/10 bg-white">
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 divide-[#071421]/5">
              {[
                'Professional licensed moving crew',
                'Moving trucks with pads & equipment',
                'Furniture disassembly tools on board',
                'Moving blankets and wrap for all items',
                'Dollies, hand trucks & straps',
                'On-site crew supervisor',
                isBindingEstimate ? 'Room-by-room unloading and placement' : 'Portal-to-portal billing — no hidden drive fees',
                isBindingEstimate ? 'Final walkthrough at destination' : 'Fuel included — no surcharge',
              ].map((item, i) => (
                <div key={item} className={`flex items-center gap-2.5 px-4 py-3 ${i % 2 === 0 && i < 7 ? 'sm:border-r border-[#071421]/5' : ''}`}>
                  <div className="h-1.5 w-1.5 rounded-full bg-[#C99700] flex-shrink-0" />
                  <span className="text-xs text-[#071421]/70">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Terms ── */}
        {!declined && !depositConfirmed && (
          <div ref={termsRef} className="mb-8">
            <CustomerTermsAgreement
              brand={brand}
              isBindingEstimate={isBindingEstimate}
              termsAccepted={termsAccepted}
              termsPrompt={termsPrompt}
              onChange={(accepted) => {
                setTermsAccepted(accepted)
                if (accepted) setTermsPrompt(false)
              }}
            />
          </div>
        )}

        {/* ── Bottom accept CTA ── */}
        <div className="mb-10 print:hidden">
          <AcceptBlock
            quote={quote}
            brand={brand}
            accepting={accepting}
            declining={declining}
            accepted={accepted}
            declined={declined}
            justPaid={depositConfirmed}
            stripeLoading={stripeLoading}
            termsAccepted={termsAccepted}
            onAccept={() => void confirmAccept()}
            onDecline={() => void confirmDecline()}
            onPayStripe={() => void payDepositStripe()}
            onRequireTerms={ensureTermsAccepted}
          />
        </div>

        {/* ── Print totals ── */}
        <div className="hidden print:block mb-8">
          <div className="rounded-xl border border-[#071421]/15 p-5">
            <div className="text-sm font-bold text-[#071421] mb-3">Payment Summary</div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-[#071421]/60"><span>Total</span><span className="font-bold">{formatMoney(quote.total)}</span></div>
              {invoiceStyleTerms ? (
                <div className="flex justify-between text-[#071421]/60"><span>Payment Terms</span><span className="font-bold">{paymentTermsLabel(quote.paymentTerms)}</span></div>
              ) : (
                <>
                  <div className="flex justify-between text-[#071421]/60"><span>Deposit Required</span><span className="font-bold">{formatMoney(quote.deposit)}</span></div>
                  <div className="flex justify-between text-[#071421]/60"><span>Balance Due</span><span className="font-bold">{formatMoney(quote.balance)}</span></div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="overflow-hidden rounded-2xl bg-[#071421]">
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <LogoMark size={48} dark brand={brand} />
            <div className="mt-3 text-sm font-bold tracking-tight text-white">{brand.shortName}</div>
            <div className="mt-3 text-xs leading-6 text-white/40">
              {marketLabel}<br />
              <a href={brand.phoneHref} className="text-white/50 hover:text-white">{brand.phone}</a>
              {brand.email ? <>{' · '}<a href={`mailto:${brand.email}`} className="text-white/50 hover:text-white">{brand.email}</a></> : null}
              {brand.website ? <>{' · '}<a href={`https://${brand.website}`} className="text-white/50 hover:text-white">{brand.website}</a></> : null}
            </div>
            <div className="mt-2 text-[9px] text-white/20">Valid until {expiryDate(quote)}</div>
          </div>
        </div>

      </div>
    </div>
  )
}

export default function QuoteAcceptPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-[#F7F4ED]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-9 w-9 animate-pulse rounded-xl bg-[#071421]/10" />
          <div className="text-xs text-[#071421]/40 tracking-wider uppercase">Loading...</div>
        </div>
      </div>
    }>
      <QuoteAcceptPageInner />
    </Suspense>
  )
}
