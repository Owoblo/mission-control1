'use client'

import Image from 'next/image'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { deriveMoveLogisticsPlan } from '@/lib/move-logistics'
import { buildMoveSpecificNotes } from '@/lib/move-scope'
import { detectSalesBranchFromLocation, formatDate, formatMoney, getSalesBranchLabel, isInvoiceStylePaymentTerms, paymentTermsLabel } from '@/lib/sales'
import type { CRMLead, InventoryItem, JobFactors, MoveType, QuoteLeg, QuotePaymentTerms } from '@/lib/types'

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
  status: string
  validDays?: number
  crewSize?: number
  estimatedHours?: number
  truckCount?: number
  billingModel?: 'binding' | 'hourly_actuals' | 'hourly_minimum'
  paymentTerms?: QuotePaymentTerms
  minimumBillableHours?: number
  maximumEstimatedHours?: number
  hourlyRateOverride?: number
  legs?: QuoteLeg[]
  lineItems: Array<{ description: string; details?: string; amount: number }>
  subtotal: number
  hst: number
  total: number
  deposit: number
  balance: number
  discountAmount?: number
  discountLabel?: string
  createdAt: string
  viewedAt?: string
  acceptedAt?: string
  respondedAt?: string
  termsAcceptedAt?: string
  termsAcceptedVersion?: string
  conditionalClause?: string
  quoteType?: string
  jobFactors?: JobFactors
}

const REVIEWS = [
  { name: 'Wendy Nantais', text: 'Team was prompt, professional and hard working — we were very satisfied.', stars: 5 },
  { name: 'Dan LaPain', text: 'Arrived on time and were very professional. All furniture was wrapped. Very detailed — would definitely recommend.', stars: 5 },
  { name: 'Lazlo', text: 'You guys did a great job, definitely recommended.', stars: 5 },
]

const QUOTE_TERMS_VERSION = '2026-06-07-basic-moving-terms'

const QUOTE_TERMS_SECTIONS = [
  {
    title: 'Binding estimates and inventory accuracy',
    items: [
      'A binding estimate is locked only for the inventory, addresses, access conditions, crew plan, and services included in the estimate.',
      'Before work starts, the crew may complete a walkthrough and compare the on-site items against the estimate inventory.',
      'If extra items, undisclosed rooms, storage areas, access issues, specialty items, or major scope changes are found, the office must be contacted before the crew proceeds.',
      'When the scope changes, the estimate may become non-binding and final charges may be based on actual time, labour, materials, truck usage, and work required.',
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

function LogoMark({ size = 32, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[10px] ${dark ? 'bg-white/95 p-1 shadow-sm' : ''}`}
      style={{ width: size, height: size }}
    >
      <Image
        src="/saturn-star-logo.png"
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
  return <span className="text-[#f5a623]">{'★'.repeat(count)}</span>
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

function quoteMarketLabel(quote: PublicQuote) {
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
  const detectedBranch = quote.branch || detectSalesBranchFromLocation(...routeParts)
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
  if (!quote.total) return 20
  return Math.round((quote.deposit / quote.total) * 100)
}

// Divider with label
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-[#1a2744]/10" />
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#1a2744]/40">{children}</div>
      <div className="h-px flex-1 bg-[#1a2744]/10" />
    </div>
  )
}

function PhotoGallery({ photos }: { photos: string[] }) {
  const [active, setActive] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  if (photos.length === 0) return null

  return (
    <div className="mb-8">
      <div className="relative overflow-hidden rounded-xl bg-[#1a2744]/5" style={{ aspectRatio: '16/7' }}>
        <img
          src={photos[active]}
          alt="Your home"
          className="h-full w-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <div className="absolute inset-0 bg-[#1a2744]/30" />
        <div className="absolute bottom-3 left-4">
          <div className="text-[9px] font-bold uppercase tracking-widest text-[#f5a623]">Your Property</div>
          <div className="text-xs font-semibold text-white mt-0.5">{photos.length} photos reviewed by our team</div>
        </div>
        {photos.length > 1 && (
          <>
            <button
              onClick={() => setActive(a => Math.max(0, a - 1))}
              disabled={active === 0}
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-[#1a2744]/70 px-2.5 py-1.5 text-sm font-bold text-white disabled:opacity-20 hover:bg-[#1a2744]"
            >‹</button>
            <button
              onClick={() => setActive(a => Math.min(photos.length - 1, a + 1))}
              disabled={active === photos.length - 1}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-[#1a2744]/70 px-2.5 py-1.5 text-sm font-bold text-white disabled:opacity-20 hover:bg-[#1a2744]"
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
              className={`shrink-0 overflow-hidden rounded-md border-2 transition ${active === i ? 'border-[#f5a623]' : 'border-transparent opacity-50 hover:opacity-80'}`}
              style={{ width: 60, height: 44 }}
            >
              <img src={photo} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AcceptBlock({
  quote,
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
      <div className="rounded-lg border border-[#1a2744]/20 bg-[#1a2744]/5 px-4 py-2 text-xs font-semibold text-[#1a2744]/50">Quote Declined</div>
    ) : (
      <div className="rounded-xl border border-[#1a2744]/15 bg-[#1a2744]/5 p-6 text-center">
        <div className="text-sm font-semibold text-[#1a2744]/60 mb-1">Quote Declined</div>
        <div className="text-xs text-[#1a2744]/40">If you change your mind, call or text us at 226-773-2993.</div>
      </div>
    )
  }

  if (accepted && justPaid) {
    return variant === 'sticky' ? (
      <div className="rounded-lg bg-[#1a2744] px-4 py-2 text-xs font-bold text-[#f5a623]">Deposit Paid — You&apos;re Booked</div>
    ) : (
      <div className="rounded-xl border-2 border-[#1a2744] bg-[#1a2744] p-8 text-center">
        <LogoMark size={56} dark />
        <div className="mt-4 text-xl font-black text-white mb-2">You&apos;re on the calendar.</div>
        <div className="text-sm text-white/70 max-w-sm mx-auto leading-6">
          Your deposit has been received. The Saturn Star team will be in touch shortly to confirm move-day details.
        </div>
        <div className="mt-5 rounded-lg bg-white/10 p-4 text-sm text-white/80">
          Questions? Call or text <strong className="text-[#f5a623]">226-773-2993</strong> or email <strong className="text-[#f5a623]">business@starmovers.ca</strong>
        </div>
      </div>
    )
  }

  if (accepted) {
    if (invoiceStyleTerms) {
      return variant === 'sticky' ? (
        <div className="rounded-lg bg-[#1a2744] px-4 py-2 text-xs font-bold text-[#f5a623]">Estimate Approved</div>
      ) : (
        <div className="rounded-xl border-2 border-[#1a2744] bg-white p-6 text-center">
          <div className="text-sm font-bold text-[#1a2744] mb-1">Estimate Approved</div>
          <div className="text-xs text-[#1a2744]/50">We&apos;ll coordinate billing using {paymentTermsLabel(quote.paymentTerms).toLowerCase()}.</div>
        </div>
      )
    }
    return variant === 'sticky' ? (
      <button
        onClick={payOrRequestTerms}
        disabled={stripeLoading}
        className="rounded-lg bg-[#f5a623] px-5 py-2 text-xs font-bold text-[#1a2744] hover:opacity-90 disabled:opacity-50"
      >
        {stripeLoading ? 'Redirecting...' : `Pay Deposit — ${formatMoney(quote.deposit)}`}
      </button>
    ) : (
      <div className="rounded-xl border-2 border-[#1a2744] bg-white p-6">
        <div className="text-center mb-5">
          <div className="text-sm font-bold text-[#1a2744] mb-1">Quote Accepted — Secure Your Date</div>
          <div className="text-xs text-[#1a2744]/50">Pay your deposit to lock in your move.</div>
        </div>
        <button
          onClick={payOrRequestTerms}
          disabled={stripeLoading}
          className="w-full rounded-xl bg-[#1a2744] py-4 text-base font-bold text-white hover:bg-[#243460] disabled:opacity-50 shadow-md"
        >
          {stripeLoading ? 'Redirecting to payment...' : `Pay Deposit Online — ${formatMoney(quote.deposit)}`}
        </button>
        <div className="mt-3 rounded-lg border border-[#1a2744]/10 bg-[#1a2744]/5 p-3 text-xs text-[#1a2744]/50 text-center">
          Prefer e-Transfer or cash? Send to <strong>business@starmovers.ca</strong> and reply to confirm.
        </div>
      </div>
    )
  }

  // Not yet accepted
  if (variant === 'sticky') {
    return (
      <div className="flex items-center gap-2">
        <button onClick={onDecline} disabled={declining} className="rounded-lg border border-[#1a2744]/20 px-3 py-2 text-xs font-medium text-[#1a2744]/40 hover:border-[#1a2744]/40 disabled:opacity-40">
          {declining ? '...' : 'Decline'}
        </button>
        <button onClick={invoiceStyleTerms ? acceptOrRequestTerms : payOrRequestTerms} disabled={invoiceStyleTerms ? accepting : stripeLoading} className="rounded-lg bg-[#1a2744] px-5 py-2 text-xs font-bold text-white hover:bg-[#243460] disabled:opacity-50">
          {invoiceStyleTerms ? (accepting ? 'Approving...' : 'Approve Estimate') : (stripeLoading ? 'Redirecting...' : 'Accept & Pay Deposit')}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border-2 border-[#1a2744] bg-[#1a2744] p-8 text-center">
      <div className="text-lg font-black text-white mb-2">{invoiceStyleTerms ? 'Ready to approve this scope?' : 'Ready to lock in your move?'}</div>
      <p className="text-sm text-white/60 mb-6 max-w-sm mx-auto leading-6">
        {invoiceStyleTerms
          ? `Approve the estimate and terms now. Billing will be handled by ${paymentTermsLabel(quote.paymentTerms).toLowerCase()} after office confirmation.`
          : 'Pay your deposit now to confirm your booking. Your card is saved on file — balance is due after the move.'}
      </p>
      <button
        onClick={invoiceStyleTerms ? acceptOrRequestTerms : payOrRequestTerms}
        disabled={invoiceStyleTerms ? accepting : stripeLoading}
        className="w-full rounded-xl bg-[#f5a623] py-4 text-base font-bold text-[#1a2744] hover:opacity-90 disabled:opacity-50 shadow-lg transition"
      >
        {invoiceStyleTerms ? (accepting ? 'Approving...' : 'Approve Estimate') : (stripeLoading ? 'Redirecting to payment...' : 'Accept Quote & Pay Deposit')}
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
  isBindingEstimate,
  termsAccepted,
  termsPrompt,
  onChange,
}: {
  isBindingEstimate: boolean
  termsAccepted: boolean
  termsPrompt: boolean
  onChange: (accepted: boolean) => void
}) {
  return (
    <div className={`rounded-2xl border-2 bg-white p-5 transition ${termsPrompt && !termsAccepted ? 'border-[#f5a623] shadow-lg shadow-[#f5a623]/10' : 'border-[#1a2744]/12'}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SectionLabel>Booking Terms & Conditions</SectionLabel>
          <h2 className="text-lg font-black text-[#1a2744]">Please review before paying your deposit.</h2>
          <p className="mt-2 max-w-xl text-xs leading-5 text-[#1a2744]/55">
            This protects both sides: Saturn Star is agreeing to the price and plan shown here, and you are confirming that the inventory, access, addresses, and services are accurate.
          </p>
        </div>
        <div className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${isBindingEstimate ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f5a623]/12 text-[#9b5b00]'}`}>
          {isBindingEstimate ? 'Inventory-based estimate' : 'Hourly / non-binding estimate'}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[#1a2744]/10 bg-[#f8f9fb] p-4">
        <div className="text-xs font-bold text-[#1a2744]">
          {isBindingEstimate ? 'If the inventory matches, your agreed estimate is protected.' : 'Final price follows the actual time and work required.'}
        </div>
        <div className="mt-1 text-xs leading-5 text-[#1a2744]/55">
          {isBindingEstimate
            ? 'If the crew finds extra items, undisclosed areas, special handling, or access conditions that were not included, the office will confirm the change before work starts and the quote may become non-binding.'
            : 'Hourly or non-binding moves are based on the real work performed, including time, labour, materials, truck usage, waiting, access, and approved added scope.'}
        </div>
      </div>

      <div className="mt-4 max-h-80 overflow-y-auto rounded-xl border border-[#1a2744]/10 bg-white">
        {QUOTE_TERMS_SECTIONS.map((section, sectionIndex) => (
          <div key={section.title} className={`p-4 ${sectionIndex > 0 ? 'border-t border-[#1a2744]/8' : ''}`}>
            <div className="text-xs font-black uppercase tracking-wider text-[#1a2744]/70">{section.title}</div>
            <ul className="mt-3 space-y-2">
              {section.items.map(item => (
                <li key={item} className="flex gap-2 text-xs leading-5 text-[#1a2744]/58">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#f5a623]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <label className={`mt-4 flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${termsAccepted ? 'border-emerald-200 bg-emerald-50' : termsPrompt ? 'border-[#f5a623] bg-[#fff8e8]' : 'border-[#1a2744]/10 bg-[#f8f9fb]'}`}>
        <input
          type="checkbox"
          checked={termsAccepted}
          onChange={event => onChange(event.target.checked)}
          className="mt-1 h-5 w-5 accent-[#1a2744]"
        />
        <span>
          <span className="block text-sm font-bold text-[#1a2744]">I have read and agree to the booking terms and conditions.</span>
          <span className="mt-1 block text-xs leading-5 text-[#1a2744]/55">
            I understand the binding/non-binding estimate rules, inventory accuracy requirements, payment terms, claim process, restricted items, and liability release requirements.
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
        body: JSON.stringify({ token, termsAccepted: true, termsVersion: QUOTE_TERMS_VERSION }),
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
        body: JSON.stringify({ quoteId: id, token, termsAccepted: true, termsVersion: QUOTE_TERMS_VERSION }),
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
    <div className="flex min-h-screen items-center justify-center bg-[#f0f2f5]">
      <div className="flex flex-col items-center gap-3">
        <LogoMark size={40} />
        <div className="text-xs text-[#1a2744]/40 tracking-wider uppercase">Loading your quote...</div>
      </div>
    </div>
  )

  if (error || !quote) return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0f2f5] p-6">
      <div className="rounded-xl border border-[#1a2744]/15 bg-white p-8 text-center text-sm text-[#1a2744]/60 max-w-md">
        {error || 'Quote not found or link is invalid.'}
      </div>
    </div>
  )

  const firstName = clientName.split(' ')[0] || 'there'
  const daysOut = daysUntilMove(quote.moveDate)
  const depPct = depositPct(quote)
  const invoiceStyleTerms = isInvoiceStylePaymentTerms(quote.paymentTerms)
  const hasInventory = inventory.length > 0
  const roomGroups = groupInventoryByRoom(inventory)
  const crewSize = quote.crewSize || 3
  const trucks = quote.truckCount || 1
  const rawHours = Number(quote.estimatedHours || 0)
  const hours = rawHours > 0 ? `${rawHours}–${Math.ceil(rawHours * 1.25)}` : null
  const isBindingEstimate = hasInventory && inventory.length >= 5
  const serviceLabel = quoteServiceLabel(quote)
  const marketLabel = quoteMarketLabel(quote)

  // ── Fast Lane view — hourly rate quote, no inventory/photos, direct to Stripe ──
  const DEPOSIT = 100
  const isFastLane = searchParams.get('fastlane') === '1'
  if (isFastLane) {
    const lineItem = quote.lineItems?.[0]
    const rateDesc = lineItem?.description || ''
    const rangeDesc = lineItem?.details || ''
    const specialtyNote = (quote as unknown as Record<string, unknown>).moveDescription as string | undefined
    const alreadyPaid = justPaid || !!quote.acceptedAt

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
      <div className="min-h-screen bg-[#f0f2f5]">
        <div className="mx-auto max-w-md px-4 py-8 pb-16">
          {/* Header */}
          <div className="mb-6 flex items-center gap-3">
            <LogoMark size={36} />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#1a2744]/40">Saturn Star Moving</div>
              <div className="text-sm font-semibold text-[#1a2744]">Your Moving Quote</div>
            </div>
          </div>

          {alreadyPaid ? (
            <div className="rounded-2xl border-2 border-[#1a2744] bg-[#1a2744] p-8 text-center">
              <LogoMark size={56} dark />
              <div className="mt-4 text-xl font-black text-white mb-2">You&apos;re on the calendar.</div>
              <div className="text-sm text-white/70 max-w-sm mx-auto leading-6">
                Deposit received. The Saturn Star team will be in touch to confirm your move details.
              </div>
              <div className="mt-5 rounded-lg bg-white/10 p-4 text-sm text-white/80">
                Questions? Call or text <strong className="text-[#f5a623]">226-773-2993</strong>
              </div>
            </div>
          ) : (
            <>
              {/* Hi + name */}
              <div className="mb-4 text-lg font-semibold text-[#1a2744]">Hi {firstName},</div>

              {/* Rate card */}
              <div className="rounded-2xl bg-white border border-[#1a2744]/10 shadow-sm p-5 mb-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#1a2744]/40 mb-3">Your quote</div>
                <div className="text-xl font-black text-[#1a2744] mb-1">{rateDesc}</div>
                {maximumHours > minimumHours ? (
                  <div className="text-sm text-[#1a2744]/60 mb-4">Most jobs in this lane take about {minimumHours}-{maximumHours} hours</div>
                ) : (
                  <div className="text-sm text-[#1a2744]/60 mb-4">{minimumHours}-hour minimum</div>
                )}

                {rate && minimumHours > 0 && (
                  <div className="rounded-xl bg-[#f0f2f5] p-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[#1a2744]/40 mb-2">Minimum charge (incl. HST)</div>
                    <div className="text-2xl font-black text-[#1a2744]">
                      ${minimumTotal.toLocaleString()}
                    </div>
                    <div className="mt-1 text-[11px] text-[#1a2744]/50">
                      Based on a {minimumHours}-hour minimum at ${rate}/hr + 13% HST
                    </div>
                    {maximumHours > minimumHours ? (
                      <div className="mt-2 text-[11px] font-medium text-[#1a2744]/70">
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
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#1a2744]/10 bg-[#f0f2f5] px-3 py-2.5">
                    <span className="text-sm">📋</span>
                    <div className="text-[11px] leading-snug text-[#1a2744]/70">{specialtyNote}</div>
                  </div>
                )}
              </div>

              {!alreadyPaid && (
                <div ref={termsRef} className="mb-4">
                  <CustomerTermsAgreement
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
              <div className="rounded-2xl border-2 border-[#1a2744] bg-[#1a2744] p-6 text-center mb-4">
                <div className="text-lg font-black text-white mb-1">{invoiceStyleTerms ? 'Approve this estimate' : 'Reserve your move date'}</div>
                <div className="text-sm text-white/60 mb-5 leading-5">
                  {invoiceStyleTerms
                    ? `Confirm the scope and terms. Billing will be handled by ${paymentTermsLabel(quote.paymentTerms).toLowerCase()}.`
                    : `$${DEPOSIT} deposit holds your spot. Card saved on file — balance due on move day.`}
                </div>
                <button
                  onClick={() => invoiceStyleTerms ? void confirmAccept() : void payDepositStripe()}
                  disabled={invoiceStyleTerms ? accepting : stripeLoading}
                  className="w-full rounded-xl bg-[#f5a623] py-4 text-base font-black text-[#1a2744] hover:opacity-90 disabled:opacity-50 shadow-lg transition"
                >
                  {invoiceStyleTerms ? (accepting ? 'Approving...' : 'Approve Estimate') : (stripeLoading ? 'Redirecting...' : `Book Now — Pay $${DEPOSIT} Deposit`)}
                </button>
                {!invoiceStyleTerms ? (
                  <div className="mt-3 text-[10px] text-white/30">
                    Prefer e-Transfer? Send to business@starmovers.ca and reply to confirm.
                  </div>
                ) : null}
              </div>

              {/* Social proof */}
              <div className="space-y-2">
                {REVIEWS.slice(0, 2).map((r, i) => (
                  <div key={i} className="rounded-xl bg-white border border-[#1a2744]/8 p-4">
                    <Stars count={r.stars} />
                    <div className="mt-1 text-xs text-[#1a2744]/70 leading-5">&ldquo;{r.text}&rdquo;</div>
                    <div className="mt-1 text-[10px] font-semibold text-[#1a2744]/40">{r.name}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 text-center text-xs text-[#1a2744]/40">
                Questions? Call or text <strong>226-773-2993</strong> · starmovers.ca
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f0f2f5] print:bg-white">

      {/* ── Sticky top bar ── */}
      <div className="print:hidden sticky top-0 z-20 border-b border-[#1a2744]/10 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <LogoMark size={28} />
            <div>
              <div className="text-xs font-black tracking-tight text-[#1a2744]">SATURN STAR</div>
              <div className="text-[9px] font-medium text-[#1a2744]/40 tracking-wide">MOVING</div>
            </div>
          </div>
          <AcceptBlock
            quote={quote}
            accepting={accepting}
            declining={declining}
            accepted={accepted}
            declined={declined}
            justPaid={justPaid}
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

      <div className="mx-auto max-w-2xl px-4 py-8 print:px-0 print:py-4 print:max-w-none">

        {/* ── Hero ── */}
        <div className="mb-6 overflow-hidden rounded-2xl bg-[#1a2744]">
          {/* Gold top accent bar */}
          <div className="h-1.5 bg-[#f5a623]" />
          <div className="px-6 py-7">
            {/* Logo + brand */}
            <div className="flex items-center gap-3 mb-5">
              <LogoMark size={52} dark />
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#f5a623]">Saturn Star Moving</div>
                <div className="text-[9px] text-white/30 tracking-wider uppercase mt-0.5">{marketLabel}</div>
              </div>
            </div>

            <h1 className="text-2xl font-black text-white leading-tight mb-2">
              Hi {firstName} — your moving estimate is ready.
            </h1>
            <p className="text-sm text-white/50 mb-5">Quote {quote.number} · {serviceLabel}</p>

            {/* Move countdown */}
            {daysOut !== null && daysOut > 0 && (
              <div className="inline-flex items-center gap-2 rounded-full border border-[#f5a623]/30 bg-[#f5a623]/10 px-3 py-1.5 mb-5">
                <div className="h-1.5 w-1.5 rounded-full bg-[#f5a623]" />
                <span className="text-xs font-bold text-[#f5a623]">
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

            {/* Route */}
            <div className="grid grid-cols-[1fr_28px_1fr] items-center gap-2 rounded-xl bg-white/8 border border-white/10 px-4 py-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-[#f5a623]/60 mb-0.5">From</div>
                <div className="text-sm font-bold text-white leading-tight">{quote.originCity || 'Origin'}</div>
                {quote.originAddress && <div className="text-[10px] text-white/40 mt-0.5 leading-4">{quote.originAddress}</div>}
              </div>
              <div className="flex justify-center">
                <svg width="20" height="16" viewBox="0 0 20 16" fill="none">
                  <path d="M0 8H18M18 8L11 1M18 8L11 15" stroke="#f5a623" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="text-right">
                <div className="text-[9px] font-bold uppercase tracking-widest text-[#f5a623]/60 mb-0.5">To</div>
                {(quote.legs?.length ?? 0) > 1 ? (
                  <div className="text-sm font-bold text-white leading-tight">{quote.legs!.length} Stops</div>
                ) : (
                  <>
                    <div className="text-sm font-bold text-white leading-tight">{quote.destCity || 'Destination'}</div>
                    {quote.destAddress && <div className="text-[10px] text-white/40 mt-0.5 leading-4">{quote.destAddress}</div>}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Property photos ── */}
        {listingPhotos.length > 0 && <PhotoGallery photos={listingPhotos} />}

        {/* ── Move stats ── */}
        <div className="mb-6 grid grid-cols-5 gap-2">
          {[
            { label: 'Move Date', value: quote.moveDate ? formatDate(quote.moveDate) : 'TBD' },
            { label: 'Start Time', value: quote.moveTime ? formatMoveTime(quote.moveTime) : '9:00 AM' },
            { label: 'Crew', value: `${crewSize} Movers` },
            { label: trucks === 1 ? 'Truck' : 'Trucks', value: `${trucks} Truck${trucks > 1 ? 's' : ''}` },
            { label: 'Est. Hours', value: hours ? `${hours}h` : 'TBD' },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl border border-[#1a2744]/10 bg-white px-3 py-3 text-center">
              <div className="text-sm font-black text-[#1a2744]">{stat.value}</div>
              <div className="text-[9px] font-medium text-[#1a2744]/35 mt-0.5 uppercase tracking-wide">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* ── Estimate type ── */}
        <div className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3.5 ${
          isBindingEstimate
            ? 'border-[#1a2744]/20 bg-[#1a2744]/5'
            : 'border-[#f5a623]/30 bg-[#f5a623]/8'
        }`} style={isBindingEstimate ? {} : { background: 'rgba(245,166,35,0.06)' }}>
          <div className={`mt-0.5 h-2 w-2 rounded-full flex-shrink-0 ${isBindingEstimate ? 'bg-[#1a2744]' : 'bg-[#f5a623]'}`} />
          <div>
            <div className={`text-xs font-bold mb-0.5 ${isBindingEstimate ? 'text-[#1a2744]' : 'text-[#1a2744]'}`}>
              {isBindingEstimate ? 'Inventory-Based Estimate' : 'Hourly Estimate'}
            </div>
            <div className="text-xs leading-5 text-[#1a2744]/50">
              {isBindingEstimate
                ? 'Priced from your specific inventory. Final time may vary if items are added on move day.'
                : 'Based on a typical move of this type. You pay for actual hours at the agreed rate.'
              }
            </div>
          </div>
        </div>

        {/* ── Multi-leg Move Plan ── */}
        {(quote.legs?.length ?? 0) > 1 && (
          <div className="mb-6 overflow-hidden rounded-xl border border-[#1a2744]/10 bg-white">
            <div className="border-b border-[#1a2744]/8 px-5 py-4">
              <div className="text-xs font-bold uppercase tracking-wider text-[#1a2744]">Move Plan — {quote.legs!.length} Stops</div>
            </div>
            <div className="divide-y divide-[#1a2744]/6">
              {quote.legs!.map((leg, idx) => {
                const typeLabel = leg.type === 'junk' ? 'Junk Removal' : leg.type === 'delivery' ? 'Delivery' : leg.type === 'storage' ? 'House → Storage' : leg.type === 'storage_delivery' ? 'Storage → New Home' : 'Moving'
                const origin = [leg.originAddress, leg.originCity].filter(Boolean).join(', ') || '—'
                const dest = [leg.destAddress, leg.destCity].filter(Boolean).join(', ') || '—'
                return (
                  <div key={leg.id} className="flex items-start gap-4 px-5 py-4">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1a2744] text-[10px] font-bold text-white mt-0.5">{idx + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-[#1a2744]">{leg.label}</span>
                        <span className="rounded-full bg-[#f5a623]/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#1a2744]">{typeLabel}</span>
                        {leg.scheduledDate && (
                          <span className="text-[10px] text-[#1a2744]/40">{new Date(leg.scheduledDate + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 text-xs text-[#1a2744]/50">
                        <span className="truncate">{origin}</span>
                        <svg className="h-3 w-3 shrink-0 text-[#f5a623]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                        <span className="truncate">{dest}</span>
                      </div>
                      {(leg.distanceKm || leg.notes) && (
                        <div className="mt-1 text-[10px] text-[#1a2744]/35">
                          {leg.distanceKm ? `${leg.distanceKm} km · ${leg.driveHours}h drive` : ''}
                          {leg.distanceKm && leg.notes ? ' · ' : ''}
                          {leg.notes || ''}
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
        {rawHours > 0 && (() => {
          const disItems = (quote.jobFactors?.disassemblyItemCount ?? 0) > 0
            ? inventory.filter(i => /\bbed\b|\btable\b|\bdesk\b|\bdresser\b|\bwardrobe\b/i.test(i.name || i.item || '')).slice(0, 4).map(i => i.name || i.item || '')
            : []
          const isTwoDay = rawHours > 13
          const timeline = buildConjointMoveTimeline({
            quote,
            inventory,
            crewSize,
            trucks,
            estimatedHours: rawHours,
          }) || buildMoveTimeline({
            startTime: quote.moveTime || '09:00',
            crewSize, trucks, estimatedHours: rawHours,
            quoteType: quote.quoteType,
            moveType: quote.moveType,
            disassemblyItems: disItems,
            originCity: quote.originCity,
            destCity: quote.destCity,
            isTwoDay,
          })
          return (
            <div className="mb-6 overflow-hidden rounded-xl border border-[#1a2744]/10 bg-white">
              <div className="border-b border-[#1a2744]/8 px-5 py-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[#1a2744]">Your Move Day</div>
                <div className="text-[10px] text-[#1a2744]/40 mt-0.5">How your move unfolds from start to finish</div>
              </div>
              <div className="px-5 py-4">
                <div className="relative">
                  {/* Vertical line */}
                  <div className="absolute left-3.5 top-4 bottom-4 w-px bg-[#1a2744]/10" />
                  <div className="space-y-5">
                    {timeline.map((phase, i) => (
                      <div key={i} className="flex gap-4">
                        <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white border border-[#1a2744]/15 text-sm">
                          {phase.emoji}
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-xs font-bold text-[#1a2744]">{phase.time}</span>
                            <span className="text-xs font-semibold text-[#1a2744]/70">{phase.title}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-[#1a2744]/40 leading-4">{phase.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {/* ── Pricing ── */}
        <div className="mb-6 overflow-hidden rounded-xl border border-[#1a2744]/10 bg-white">
          <div className="flex items-center justify-between border-b border-[#1a2744]/8 px-5 py-4">
            <div className="text-xs font-bold uppercase tracking-wider text-[#1a2744]">Your Quote</div>
            <button
              onClick={() => setLineItemsOpen(v => !v)}
              className="text-[10px] font-semibold uppercase tracking-wide text-[#1a2744]/40 hover:text-[#1a2744]"
            >
              {lineItemsOpen ? 'Hide breakdown' : 'See breakdown'}
            </button>
          </div>

          {/* Summary row */}
          <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-[#1a2744]/8 px-5 py-4 text-sm">
            <div>
              <div className="font-semibold text-[#1a2744]">{serviceLabel}</div>
              <div className="text-xs text-[#1a2744]/40 mt-0.5">
                {crewSize}-person crew · {trucks} truck{trucks > 1 ? 's' : ''}{hours ? ` · ~${hours} hrs` : ''}
              </div>
            </div>
            <div className="font-semibold text-[#1a2744]">{formatMoney(quote.subtotal)}</div>
          </div>

          {/* Line items */}
          {lineItemsOpen && (
            <div className="border-b border-[#1a2744]/8">
              {quote.lineItems.map((item, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-4 border-b border-[#1a2744]/5 last:border-0 px-5 py-3">
                  <div>
                    <div className="text-xs font-medium text-[#1a2744]">{item.description}</div>
                    {item.details && <div className="mt-0.5 text-[10px] leading-4 text-[#1a2744]/35">{item.details}</div>}
                  </div>
                  <div className="text-xs font-medium text-[#1a2744]/70 text-right">{formatMoney(item.amount)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Totals */}
          <div className="space-y-1.5 px-5 py-4 text-sm">
            {(quote.discountAmount || 0) > 0 && (
              <div className="flex justify-between text-[#f5a623]">
                <span className="text-xs">{quote.discountLabel || 'Discount'}</span>
                <span className="text-xs font-semibold">−{formatMoney(quote.discountAmount!)}</span>
              </div>
            )}
            {/* Subtotal is the hero — anchors customer on pre-tax price */}
            <div className="flex justify-between border-t border-[#1a2744]/10 pt-2.5 text-base font-black text-[#1a2744]">
              <span>Estimated Total</span><span>{formatMoney(quote.subtotal)}</span>
            </div>
            <div className="flex justify-between text-[#1a2744]/35 text-xs mt-1">
              <span>HST (13%)</span><span>+{formatMoney(quote.hst)}</span>
            </div>
            <div className="flex justify-between text-[#1a2744]/35 text-xs border-t border-[#1a2744]/8 pt-1.5 mt-1.5">
              <span>Total incl. HST</span><span>{formatMoney(quote.total)}</span>
            </div>
          </div>
        </div>

        {/* ── Payment schedule ── */}
        <div className="mb-6 overflow-hidden rounded-xl border border-[#1a2744]/10 bg-white">
          <div className="border-b border-[#1a2744]/8 px-5 py-4">
            <div className="text-xs font-bold uppercase tracking-wider text-[#1a2744]">{invoiceStyleTerms ? 'Approval & Billing' : 'Payment Schedule'}</div>
          </div>
          {invoiceStyleTerms ? (
            <div className="px-5 py-4">
              <div className="text-[9px] font-bold uppercase tracking-widest text-[#f5a623] mb-1">Terms</div>
              <div className="text-2xl font-black text-[#1a2744]">{paymentTermsLabel(quote.paymentTerms)}</div>
              <div className="mt-2 text-xs leading-5 text-[#1a2744]/45">
                Approving this estimate confirms the scope and terms. Saturn Star will coordinate billing, invoice details, or purchase-order requirements with your office contact.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 divide-x divide-[#1a2744]/8">
              <div className="px-5 py-4">
                <div className="text-[9px] font-bold uppercase tracking-widest text-[#f5a623] mb-1">Deposit ({depPct}%)</div>
                <div className="text-2xl font-black text-[#1a2744]">{formatMoney(quote.deposit)}</div>
                <div className="text-[10px] text-[#1a2744]/35 mt-1">Required to confirm booking</div>
              </div>
              <div className="px-5 py-4">
                <div className="text-[9px] font-bold uppercase tracking-widest text-[#1a2744]/30 mb-1">Balance ({100 - depPct}%)</div>
                <div className="text-2xl font-black text-[#1a2744]">{formatMoney(quote.balance)}</div>
                <div className="text-[10px] text-[#1a2744]/35 mt-1">Due upon move completion</div>
              </div>
            </div>
          )}
          <div className="border-t border-[#1a2744]/8 bg-[#1a2744]/3 px-5 py-3" style={{ background: 'rgba(26,39,68,0.025)' }}>
            <div className="flex flex-wrap gap-1.5">
              {['Cash', 'e-Transfer', 'Credit Card', 'Debit'].map(m => (
                <span key={m} className="rounded-full border border-[#1a2744]/15 px-2.5 py-0.5 text-[10px] font-medium text-[#1a2744]/50">{m}</span>
              ))}
            </div>
            <div className="mt-1.5 text-[9px] text-[#1a2744]/30">4% processing fee on card payments · e-Transfer to business@starmovers.ca</div>
          </div>
        </div>

        {/* ── Accept CTA ── */}
        <div className="mb-8 print:hidden">
          <AcceptBlock
            quote={quote}
            accepting={accepting}
            declining={declining}
            accepted={accepted}
            declined={declined}
            justPaid={justPaid}
            stripeLoading={stripeLoading}
            termsAccepted={termsAccepted}
            onAccept={() => void confirmAccept()}
            onDecline={() => void confirmDecline()}
            onPayStripe={() => void payDepositStripe()}
            onRequireTerms={ensureTermsAccepted}
          />
          {error && <div className="mt-3 rounded-lg border border-[#1a2744]/15 bg-[#1a2744]/5 px-4 py-2 text-xs text-[#1a2744]/60">{error}</div>}
        </div>

        {/* ── Conditional Clause ── */}
        {quote.conditionalClause && (
          <div className="mb-6 overflow-hidden rounded-xl border border-[#f5a623]/30 bg-white">
            <div className="border-b border-[#f5a623]/20 px-5 py-3.5" style={{ background: 'rgba(245,166,35,0.05)' }}>
              <div className="flex items-center gap-2">
                <span className="text-sm">⚠️</span>
                <div className="text-xs font-bold uppercase tracking-wider text-[#1a2744]">Important Condition</div>
              </div>
            </div>
            <div className="px-5 py-4 text-sm text-[#1a2744]/70 leading-6">
              {quote.conditionalClause}
            </div>
          </div>
        )}

        {/* ── What's moving ── */}
        {hasInventory && (
          <div className="mb-8">
            <SectionLabel>Inventory — Reviewed by Our Team</SectionLabel>
            <div className="space-y-2">
              {Array.from(roomGroups.entries()).map(([room, items]) => (
                <div key={room} className="overflow-hidden rounded-xl border border-[#1a2744]/10 bg-white">
                  <div className="border-b border-[#1a2744]/8 bg-[#1a2744]/3 px-4 py-2.5" style={{ background: 'rgba(26,39,68,0.03)' }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#1a2744]/60">{room}</div>
                  </div>
                  <div className="divide-y divide-[#1a2744]/5">
                    {items.map((item, i) => {
                      const name = item.name || item.item || 'Item'
                      const qty = Number(item.qty || 1)
                      return (
                        <div key={i} className="flex items-center justify-between px-4 py-2.5">
                          <span className="text-sm text-[#1a2744]">{name}</span>
                          <div className="flex items-center gap-3">
                            {item.size && <span className="text-[10px] text-[#1a2744]/30">{item.size}</span>}
                            {qty > 1 && <span className="rounded-full bg-[#1a2744]/8 px-2 py-0.5 text-[10px] font-semibold text-[#1a2744]/50">×{qty}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-[#f5a623]/25 bg-[#f5a623]/6 p-3 text-[10px] text-[#1a2744]/60 leading-5" style={{ background: 'rgba(245,166,35,0.05)' }}>
              <span className="font-bold text-[#1a2744]/70">Note:</span> This estimate covers the items listed. If items are added on move day, the crew will do a brief walk-through and adjust the time before starting.
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
              <div className="rounded-xl border border-[#1a2744]/10 bg-white divide-y divide-[#1a2744]/5">
                {notes.map((note, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3">
                    <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#f5a623] flex-shrink-0" />
                    <span className="text-xs text-[#1a2744]/70 leading-5">{note}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* ── What's included ── */}
        <div className="mb-8">
          <SectionLabel>What&apos;s Included</SectionLabel>
          <div className="rounded-xl border border-[#1a2744]/10 bg-white">
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 divide-[#1a2744]/5">
              {[
                'Professional licensed moving crew',
                'Moving trucks with pads & equipment',
                'Furniture disassembly tools on board',
                'Moving blankets and wrap for all items',
                'Dollies, hand trucks & straps',
                'On-site crew supervisor',
                'Portal-to-portal billing — no hidden drive fees',
                'Fuel included — no surcharge',
              ].map((item, i) => (
                <div key={item} className={`flex items-center gap-2.5 px-4 py-3 ${i % 2 === 0 && i < 7 ? 'sm:border-r border-[#1a2744]/5' : ''}`}>
                  <div className="h-1.5 w-1.5 rounded-full bg-[#f5a623] flex-shrink-0" />
                  <span className="text-xs text-[#1a2744]/70">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Terms ── */}
        {!declined && !justPaid && (
          <div ref={termsRef} className="mb-8">
            <CustomerTermsAgreement
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
            accepting={accepting}
            declining={declining}
            accepted={accepted}
            declined={declined}
            justPaid={justPaid}
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
          <div className="rounded-xl border border-[#1a2744]/15 p-5">
            <div className="text-sm font-bold text-[#1a2744] mb-3">Payment Summary</div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-[#1a2744]/60"><span>Total</span><span className="font-bold">{formatMoney(quote.total)}</span></div>
              {invoiceStyleTerms ? (
                <div className="flex justify-between text-[#1a2744]/60"><span>Payment Terms</span><span className="font-bold">{paymentTermsLabel(quote.paymentTerms)}</span></div>
              ) : (
                <>
                  <div className="flex justify-between text-[#1a2744]/60"><span>Deposit Required</span><span className="font-bold">{formatMoney(quote.deposit)}</span></div>
                  <div className="flex justify-between text-[#1a2744]/60"><span>Balance Due</span><span className="font-bold">{formatMoney(quote.balance)}</span></div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Reviews ── */}
        <div className="mb-8">
          <SectionLabel>What Our Customers Say</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {REVIEWS.map((r, i) => (
              <div key={i} className="rounded-xl border border-[#1a2744]/10 bg-white p-4">
                <Stars count={r.stars} />
                <p className="mt-2 text-xs leading-5 text-[#1a2744]/60">{r.text}</p>
                <p className="mt-2 text-[10px] font-semibold text-[#1a2744]/30">— {r.name}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-center gap-3 text-[10px] text-[#1a2744]/30">
            <Stars count={5} />
            <span>5-star rated on Google</span>
            <span>·</span>
            <a href="https://starmovers.ca" className="text-[#1a2744]/40 hover:text-[#1a2744]">starmovers.ca</a>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="overflow-hidden rounded-2xl bg-[#1a2744]">
          <div className="h-1 bg-[#f5a623]" />
          <div className="flex flex-col items-center gap-2 px-6 py-7 text-center">
            <LogoMark size={56} dark />
            <div className="mt-2 text-base font-black tracking-tight text-white">SATURN STAR MOVING</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#f5a623]/70">Professional Moving Services</div>
            <div className="mt-3 text-[10px] text-white/30 leading-6">
              {marketLabel}<br />
              <a href="tel:+12267732993" className="text-white/50 hover:text-white">226-773-2993</a>
              {' · '}
              <a href="mailto:business@starmovers.ca" className="text-white/50 hover:text-white">business@starmovers.ca</a>
              {' · '}
              <a href="https://starmovers.ca" className="text-white/50 hover:text-white">starmovers.ca</a>
            </div>
            <div className="mt-2 text-[9px] text-white/20">Quote {quote.number} · Valid until {expiryDate(quote)}</div>
          </div>
        </div>

      </div>
    </div>
  )
}

export default function QuoteAcceptPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-[#f0f2f5]">
        <div className="flex flex-col items-center gap-3">
          <LogoMark size={40} />
          <div className="text-xs text-[#1a2744]/40 tracking-wider uppercase">Loading...</div>
        </div>
      </div>
    }>
      <QuoteAcceptPageInner />
    </Suspense>
  )
}
