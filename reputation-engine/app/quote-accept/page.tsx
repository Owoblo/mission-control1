'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { buildMoveSpecificNotes } from '@/lib/move-scope'
import { formatDate, formatMoney } from '@/lib/sales'
import type { MoveType } from '@/lib/types'

type InventoryItem = {
  name?: string
  item?: string
  qty?: number
  room?: string
  notes?: string
  size?: string
}

type JobFactors = {
  originFloors?: number
  destFloors?: number
  originHasElevator?: boolean
  destHasElevator?: boolean
  hasPiano?: boolean
  hasSafe?: boolean
  packingStatus?: 'packed' | 'partial' | 'not-started'
  disassemblyItemCount?: number
  disassemblyMode?: 'both' | 'disassemble_only' | 'reassemble_only'
  garageCubicFeet?: number
  basementCubicFeet?: number
  shedCubicFeet?: number
  estimatedBoxes?: number
  specialtyNotes?: string
}

type PublicQuote = {
  id: string
  number: string
  moveDate?: string
  moveType?: MoveType
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
  minimumBillableHours?: number
  maximumEstimatedHours?: number
  hourlyRateOverride?: number
  lineItems: Array<{ description: string; details?: string; amount: number }>
  customerNotes?: string
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
}

const REVIEWS = [
  { name: 'Wendy Nantais', text: 'Team was prompt, professional and hard working — we were very satisfied.', stars: 5 },
  { name: 'Dan LaPain', text: 'Arrived on time and were very professional. All furniture was wrapped. Very detailed — would definitely recommend.', stars: 5 },
  { name: 'Lazlo', text: 'You guys did a great job, definitely recommended.', stars: 5 },
]

// Saturn Star logo mark — gold circle with navy pillar (SVG, matches icon-192.png)
function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="192" height="192" rx="96" fill="#f5a623" />
      <rect x="77" y="44" width="38" height="104" rx="4" fill="#1a2744" />
    </svg>
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
        <div className="absolute inset-0 bg-gradient-to-t from-[#1a2744]/50 via-transparent to-transparent" />
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
  onAccept,
  onDecline,
  onPayStripe,
  variant = 'main',
}: {
  quote: PublicQuote
  accepting: boolean
  declining: boolean
  accepted: boolean
  declined: boolean
  justPaid: boolean
  stripeLoading: boolean
  onAccept: () => void
  onDecline: () => void
  onPayStripe: () => void
  variant?: 'main' | 'sticky'
}) {
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
        <LogoMark size={48} />
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
    return variant === 'sticky' ? (
      <button
        onClick={onPayStripe}
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
          onClick={onPayStripe}
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
        <button onClick={onAccept} disabled={accepting} className="rounded-lg bg-[#1a2744] px-5 py-2 text-xs font-bold text-white hover:bg-[#243460] disabled:opacity-50">
          {accepting ? 'Confirming...' : 'Accept & Book'}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border-2 border-[#1a2744] bg-[#1a2744] p-8 text-center">
      <div className="text-lg font-black text-white mb-2">Ready to lock in your move?</div>
      <p className="text-sm text-white/60 mb-6 max-w-sm mx-auto leading-6">
        Clicking Accept confirms your booking. We&apos;ll coordinate your move date and send final details.
      </p>
      <button
        onClick={onAccept}
        disabled={accepting}
        className="w-full rounded-xl bg-[#f5a623] py-4 text-base font-bold text-[#1a2744] hover:opacity-90 disabled:opacity-50 shadow-lg transition"
      >
        {accepting ? 'Confirming...' : 'Accept Quote — Book My Move'}
      </button>
      <button
        onClick={onDecline}
        disabled={declining}
        className="mt-4 text-xs text-white/30 hover:text-white/60 disabled:opacity-40"
      >
        {declining ? 'Updating...' : 'Decline this quote'}
      </button>
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
    try {
      setAccepting(true)
      const r = await fetch(`/api/public/quotes/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
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
    try {
      setStripeLoading(true)
      const r = await fetch('/api/sales/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: id }),
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
  const hasInventory = inventory.length > 0
  const roomGroups = groupInventoryByRoom(inventory)
  const crewSize = quote.crewSize || 3
  const trucks = quote.truckCount || 1
  const hours = quote.estimatedHours ? `${quote.estimatedHours}–${Math.ceil(quote.estimatedHours * 1.25)}` : null
  const isBindingEstimate = hasInventory && inventory.length >= 5

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
              <LogoMark size={48} />
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

              {/* Deposit + book */}
              <div className="rounded-2xl border-2 border-[#1a2744] bg-[#1a2744] p-6 text-center mb-4">
                <div className="text-lg font-black text-white mb-1">Reserve your move date</div>
                <div className="text-sm text-white/60 mb-5 leading-5">
                  ${DEPOSIT} deposit holds your spot. Card saved on file — balance due on move day.
                </div>
                <button
                  onClick={() => void payDepositStripe()}
                  disabled={stripeLoading}
                  className="w-full rounded-xl bg-[#f5a623] py-4 text-base font-black text-[#1a2744] hover:opacity-90 disabled:opacity-50 shadow-lg transition"
                >
                  {stripeLoading ? 'Redirecting...' : `Book Now — Pay $${DEPOSIT} Deposit`}
                </button>
                <div className="mt-3 text-[10px] text-white/30">
                  Prefer e-Transfer? Send to business@starmovers.ca and reply to confirm.
                </div>
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
            onAccept={() => void confirmAccept()}
            onDecline={() => void confirmDecline()}
            onPayStripe={() => void payDepositStripe()}
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
              <LogoMark size={40} />
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#f5a623]">Saturn Star Moving</div>
                <div className="text-[9px] text-white/30 tracking-wider uppercase mt-0.5">Windsor, Ontario</div>
              </div>
            </div>

            <h1 className="text-2xl font-black text-white leading-tight mb-2">
              Hi {firstName} — your moving estimate is ready.
            </h1>
            <p className="text-sm text-white/50 mb-5">Quote {quote.number} · {moveTypeLabel(quote.moveType)}</p>

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
                <div className="text-sm font-bold text-white leading-tight">{quote.destCity || 'Destination'}</div>
                {quote.destAddress && <div className="text-[10px] text-white/40 mt-0.5 leading-4">{quote.destAddress}</div>}
              </div>
            </div>
          </div>
        </div>

        {/* ── Property photos ── */}
        {listingPhotos.length > 0 && <PhotoGallery photos={listingPhotos} />}

        {/* ── Move stats ── */}
        <div className="mb-6 grid grid-cols-4 gap-2">
          {[
            { label: 'Move Date', value: quote.moveDate ? formatDate(quote.moveDate) : 'TBD' },
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
              <div className="font-semibold text-[#1a2744]">{moveTypeLabel(quote.moveType)}</div>
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
            <div className="flex justify-between text-[#1a2744]/40 text-xs">
              <span>Subtotal</span><span>{formatMoney(quote.subtotal)}</span>
            </div>
            <div className="flex justify-between text-[#1a2744]/40 text-xs">
              <span>HST (13%)</span><span>{formatMoney(quote.hst)}</span>
            </div>
            <div className="flex justify-between border-t border-[#1a2744]/10 pt-2.5 text-base font-black text-[#1a2744]">
              <span>Total</span><span>{formatMoney(quote.total)}</span>
            </div>
          </div>
        </div>

        {/* ── Payment schedule ── */}
        <div className="mb-6 overflow-hidden rounded-xl border border-[#1a2744]/10 bg-white">
          <div className="border-b border-[#1a2744]/8 px-5 py-4">
            <div className="text-xs font-bold uppercase tracking-wider text-[#1a2744]">Payment Schedule</div>
          </div>
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
            onAccept={() => void confirmAccept()}
            onDecline={() => void confirmDecline()}
            onPayStripe={() => void payDepositStripe()}
          />
          {error && <div className="mt-3 rounded-lg border border-[#1a2744]/15 bg-[#1a2744]/5 px-4 py-2 text-xs text-[#1a2744]/60">{error}</div>}
        </div>

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
        <div className="mb-8">
          <SectionLabel>Terms — Plain Language</SectionLabel>
          <div className="rounded-xl border border-[#1a2744]/10 bg-white divide-y divide-[#1a2744]/5">
            {[
              {
                title: 'Hourly Billing',
                body: isFastLane
                  ? `This lane bills hourly with a ${quote.minimumBillableHours || 3}-hour minimum. If the crew finishes sooner, the minimum still applies. After the minimum, the same hourly rate continues in 15-minute increments.`
                  : 'Your estimate is based on an hourly rate. If the move takes less time — you pay less. If it runs longer due to extra items or access issues, the same hourly rate applies. No surprises.'
              },
              {
                title: 'Cancellation',
                body: 'Cancellations within 48 hours of the move are subject to a $150 fee. Deposits are non-refundable within 72 hours of the move date unless rescheduled.'
              },
              {
                title: 'Damage Coverage',
                body: 'Standard coverage: $0.60/lb per item. Notify the foreman before the job ends if there\'s an issue. Claims must be filed before payment is complete. Exclusions: particle board, customer-packed boxes, jewelry, collectibles.'
              },
              {
                title: isBindingEstimate ? 'Inventory-Based Estimate' : 'Hourly Estimate',
                body: isBindingEstimate
                  ? 'By accepting, you confirm the inventory above is reasonably complete. Adding items on move day may affect final time.'
                  : isFastLane
                    ? `This is an hourly quote with a ${quote.minimumBillableHours || 3}-hour minimum. Final cost is the minimum or the actual time worked above that minimum, at the agreed rate.`
                    : 'This is an hourly estimate — final cost is based on actual hours worked at the agreed rate.'
              },
            ].map((term) => (
              <div key={term.title} className="px-5 py-4">
                <div className="text-xs font-bold text-[#1a2744] mb-1">{term.title}</div>
                <div className="text-xs leading-5 text-[#1a2744]/50">{term.body}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Agreement summary (pre-accept) ── */}
        {!accepted && !declined && (
          <div className="mb-6 rounded-xl border border-[#1a2744]/10 bg-white p-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#1a2744]/40 mb-3">By accepting this quote, you confirm:</div>
            <ul className="space-y-2">
              {[
                isFastLane
                  ? `This quote has a ${quote.minimumBillableHours || 3}-hour minimum and the same hourly rate applies after that.`
                  : 'This is an hourly estimate — final cost may vary based on actual time.',
                'The inventory list above is reasonably complete.',
                'You have read and understand the damage policy and exclusions.',
                'You agree to pay the deposit to confirm your move date.',
              ].map((line, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs text-[#1a2744]/60 leading-5">
                  <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#1a2744]/20 flex-shrink-0" />
                  {line}
                </li>
              ))}
            </ul>
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
            onAccept={() => void confirmAccept()}
            onDecline={() => void confirmDecline()}
            onPayStripe={() => void payDepositStripe()}
          />
        </div>

        {/* ── Print totals ── */}
        <div className="hidden print:block mb-8">
          <div className="rounded-xl border border-[#1a2744]/15 p-5">
            <div className="text-sm font-bold text-[#1a2744] mb-3">Payment Summary</div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-[#1a2744]/60"><span>Total</span><span className="font-bold">{formatMoney(quote.total)}</span></div>
              <div className="flex justify-between text-[#1a2744]/60"><span>Deposit Required</span><span className="font-bold">{formatMoney(quote.deposit)}</span></div>
              <div className="flex justify-between text-[#1a2744]/60"><span>Balance Due</span><span className="font-bold">{formatMoney(quote.balance)}</span></div>
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
            <LogoMark size={44} />
            <div className="mt-2 text-base font-black tracking-tight text-white">SATURN STAR MOVING</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#f5a623]/70">Professional Moving Services</div>
            <div className="mt-3 text-[10px] text-white/30 leading-6">
              Windsor, Ontario<br />
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
