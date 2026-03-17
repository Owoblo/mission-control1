'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { formatDate, formatMoney } from '@/lib/sales'

type InventoryItem = {
  name?: string
  item?: string
  qty?: number
  room?: string
}

type PublicQuote = {
  id: string
  number: string
  moveDate?: string
  moveType?: string
  originCity?: string
  originAddress?: string
  destCity?: string
  destAddress?: string
  status: string
  validDays?: number
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
}

const REVIEWS = [
  { name: 'Wendy Nantais', text: 'Team was prompt, professional and hard working — we were very satisfied.', stars: 5 },
  { name: 'Dan LaPain', text: 'The movers arrived on time and were very professional. All of my furniture was wrapped in either bubble wrap or heavy blankets. They were very detailed — I would definitely recommend.', stars: 5 },
  { name: 'Lazlo', text: 'You guys did a great job, definitely recommended.', stars: 5 },
]

function Stars({ count }: { count: number }) {
  return <span className="text-amber-400">{'★'.repeat(count)}</span>
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-stone-200 pt-6 mt-6">
      <h3 className="text-base font-semibold text-stone-900 mb-3">{icon} {title}</h3>
      <div className="text-sm leading-7 text-stone-600 space-y-2">{children}</div>
    </div>
  )
}

function expiryDate(quote: PublicQuote): string {
  const days = quote.validDays || 30
  const base = new Date(quote.createdAt)
  base.setDate(base.getDate() + days)
  return base.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
}

function quoteTitle(quote: PublicQuote): string {
  const from = quote.originCity || 'Origin'
  const to = quote.destCity || 'Destination'
  if (quote.moveType === 'labor-only') return `Labor-Only Service — ${from}`
  if (quote.moveType === 'commercial') return `Commercial Move — ${from} to ${to}`
  if (quote.moveType === 'long-distance') return `Long-Distance Move — ${from} to ${to}`
  if (quote.moveType === 'packing') return `Packing Service — ${from}`
  return `Full House Move from ${from} to ${to}`
}

function depositPct(quote: PublicQuote): number {
  if (!quote.total) return 20
  return Math.round((quote.deposit / quote.total) * 100)
}

function QuoteAcceptPageInner() {
  const searchParams = useSearchParams()
  const [quote, setQuote] = useState<PublicQuote | null>(null)
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stripeLoading, setStripeLoading] = useState(false)
  const justPaid = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('paid') === '1' : false

  const id = searchParams.get('id')
  const token = searchParams.get('token')
  const printMode = searchParams.get('print') === '1'

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
        setAccepted(payload.quote.status === 'accepted')
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
      const r = await fetch(`/api/public/quotes/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      const payload = await r.json()
      if (!r.ok) throw new Error(payload?.error || 'Failed to accept quote')
      setQuote(payload.quote); setAccepted(true); setDeclined(false)
    } catch (err) { setError((err as Error).message) } finally { setAccepting(false) }
  }

  async function confirmDecline() {
    if (!id || !token) return
    try {
      setDeclining(true)
      const r = await fetch(`/api/public/quotes/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action: 'decline' }) })
      const payload = await r.json()
      if (!r.ok) throw new Error(payload?.error || 'Failed to decline quote')
      setQuote(payload.quote); setAccepted(false); setDeclined(true)
    } catch (err) { setError((err as Error).message) } finally { setDeclining(false) }
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
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <div className="text-sm text-stone-500">Loading your quote...</div>
    </div>
  )

  if (error || !quote) return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 p-6">
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700 max-w-md">
        {error || 'Quote not found or link is invalid.'}
      </div>
    </div>
  )

  const depPct = depositPct(quote)
  const hasInventory = inventory.length > 0

  return (
    <div className="min-h-screen bg-stone-50 print:bg-white">

      {/* Sticky action bar — hidden on print */}
      <div className="print:hidden sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-stone-200 bg-white px-4 py-3 md:px-8 shadow-sm">
        <div className="text-sm font-semibold text-stone-900">Quote {quote.number}</div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">
            Download PDF
          </button>
          {!accepted && !declined && (
            <>
              <button onClick={() => void confirmDecline()} disabled={declining} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-500 hover:bg-stone-50 disabled:opacity-60">
                {declining ? 'Updating...' : 'Decline'}
              </button>
              <button onClick={() => void confirmAccept()} disabled={accepting} className="rounded-lg bg-[#1a2744] px-5 py-2 text-sm font-semibold text-white hover:bg-[#243460] disabled:opacity-60">
                {accepting ? 'Confirming...' : '✓ Accept & Book'}
              </button>
            </>
          )}
          {accepted && <div className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white">✓ Accepted</div>}
          {declined && <div className="rounded-lg border border-stone-300 px-5 py-2 text-sm font-medium text-stone-500">Declined</div>}
        </div>
      </div>

      {/* Document */}
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12 print:px-0 print:py-0 print:max-w-none">
        <div className="rounded-2xl border border-stone-200 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
          <div className="p-6 md:p-10 print:p-8">

            {/* Header */}
            <div className="flex items-start justify-between mb-8 pb-8 border-b border-stone-200">
              <div>
                <div className="text-2xl font-black tracking-tight text-[#1a2744]">SATURN STAR</div>
                <div className="text-sm font-bold text-[#f5a623] tracking-wide">MOVING COMPANY</div>
                <div className="mt-2 text-xs text-stone-500 leading-5">
                  Professional Commercial &amp; Residential Moving<br />
                  Windsor, Ontario<br />
                  business@starmovers.ca<br />
                  +1 (226) 724 1730
                </div>
              </div>
              <div className="text-right">
                <div className="text-4xl font-black tracking-tight text-[#1a2744]">QUOTE</div>
                <div className="mt-2 text-xs text-stone-500 leading-6">
                  <div>Date: {formatDate(quote.createdAt)}</div>
                  <div>Valid Until: {expiryDate(quote)}</div>
                </div>
                <div className="mt-2 inline-block rounded-md bg-[#f5a623] px-3 py-1 text-xs font-bold text-[#1a2744] tracking-wide">
                  {quote.number}
                </div>
              </div>
            </div>

            {/* FROM / FOR / Quote Details */}
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">FROM</div>
                <div className="text-sm font-semibold text-stone-900">John Owolabi</div>
                <div className="text-sm text-stone-700">Saturn Star Movers</div>
                <div className="text-xs text-stone-500 mt-1 leading-5">
                  2968 Donnelly Street<br />Windsor, ON N9C 1L8<br />
                  <span className="text-[#1a2744]">www.starmovers.ca</span>
                </div>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">FOR</div>
                <div className="text-sm font-semibold text-stone-900">{clientName || 'Customer'}</div>
                {clientEmail && <div className="text-xs text-[#1a2744] mt-1">{clientEmail}</div>}
                {clientPhone && <div className="text-xs text-stone-500">{clientPhone}</div>}
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-stone-500">
                  <div><div className="font-semibold uppercase tracking-wide text-[9px]">Estimate #</div><div className="text-stone-800 font-medium">{quote.number}</div></div>
                  <div><div className="font-semibold uppercase tracking-wide text-[9px]">Move Date</div><div className="text-stone-800 font-medium">{formatDate(quote.moveDate)}</div></div>
                  <div><div className="font-semibold uppercase tracking-wide text-[9px]">Issued</div><div>{formatDate(quote.createdAt)}</div></div>
                  <div><div className="font-semibold uppercase tracking-wide text-[9px]">Expires</div><div>{expiryDate(quote)}</div></div>
                </div>
              </div>
            </div>

            {/* Route block */}
            <div className="mb-8 rounded-xl bg-[#1a2744] p-4 text-white grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#f5a623] mb-1">Origin</div>
                <div className="font-semibold">{quote.originCity || 'Origin TBD'}</div>
                {quote.originAddress && <div className="text-xs text-white/70 mt-0.5">{quote.originAddress}</div>}
              </div>
              <div className="text-2xl text-[#f5a623]">→</div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#f5a623] mb-1">Destination</div>
                <div className="font-semibold">{quote.destCity || 'Destination TBD'}</div>
                {quote.destAddress && <div className="text-xs text-white/70 mt-0.5">{quote.destAddress}</div>}
              </div>
            </div>

            {/* Quote Title */}
            <h1 className="text-2xl font-bold text-stone-900 mb-6">{quoteTitle(quote)}</h1>

            {/* Line Items */}
            <div className="rounded-xl border border-stone-200 overflow-hidden mb-6">
              {quote.lineItems.map((item, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-4 border-b border-stone-100 last:border-0 p-4">
                  <div>
                    <div className="text-sm font-semibold text-stone-900">{item.description}</div>
                    {item.details && <div className="mt-0.5 text-xs leading-5 text-stone-500">{item.details}</div>}
                  </div>
                  <div className="text-sm font-semibold text-stone-900 text-right">{formatMoney(item.amount)}</div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="ml-auto max-w-xs space-y-1.5 text-sm mb-8">
              {(quote.discountAmount || 0) > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>{quote.discountLabel || 'Discount'}</span>
                  <span>−{formatMoney(quote.discountAmount!)}</span>
                </div>
              )}
              <div className="flex justify-between text-stone-600">
                <span>Subtotal</span>
                <span>{formatMoney(quote.subtotal)}</span>
              </div>
              <div className="flex justify-between text-stone-600">
                <span>HST 13%</span>
                <span>{formatMoney(quote.hst)}</span>
              </div>
              <div className="flex justify-between border-t border-stone-300 pt-2 text-base font-bold text-stone-900">
                <span>Total CAD</span>
                <span>{formatMoney(quote.total)}</span>
              </div>
            </div>

            {/* Payment Schedule */}
            <div className="rounded-xl bg-[#1a2744] p-6 mb-6">
              <div className="text-[11px] font-bold uppercase tracking-widest text-[#f5a623] mb-4">Payment Schedule</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-3xl font-black text-[#f5a623]">{formatMoney(quote.deposit)}</div>
                  <div className="text-xs font-bold uppercase tracking-wide text-white/80 mt-1">Deposit ({depPct}%)</div>
                  <div className="text-xs text-white/60 mt-0.5">Required to confirm booking</div>
                </div>
                <div>
                  <div className="text-3xl font-black text-white">{formatMoney(quote.balance)}</div>
                  <div className="text-xs font-bold uppercase tracking-wide text-white/80 mt-1">Balance ({100 - depPct}%)</div>
                  <div className="text-xs text-white/60 mt-0.5">Due upon completion</div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#f5a623] mb-2">Accepted Payment Methods</div>
                <div className="flex flex-wrap gap-2">
                  {['Cash', 'Interac e-Transfer', 'Credit Card', 'Debit Card', 'Bank Transfer / EFT'].map(m => (
                    <span key={m} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white">{m}</span>
                  ))}
                </div>
                <div className="mt-1.5 text-[10px] text-white/50">Credit/Debit card payments subject to a 4% processing fee. E-Transfer to: business@starmovers.ca</div>
              </div>
            </div>

            {/* Accept / Decline CTA */}
            {!accepted && !declined ? (
              <div className="rounded-xl border-2 border-[#1a2744] p-6 mb-8 text-center">
                <div className="text-lg font-bold text-stone-900 mb-1">Ready to lock in your move?</div>
                <p className="text-sm text-stone-500 mb-5">Clicking Accept confirms your booking and notifies the Saturn Star team to begin coordinating your move date.</p>
                <div className="flex flex-col sm:flex-row justify-center gap-3">
                  <button onClick={() => void confirmAccept()} disabled={accepting} className="rounded-xl bg-[#1a2744] px-8 py-3 text-base font-bold text-white hover:bg-[#243460] disabled:opacity-60">
                    {accepting ? 'Confirming...' : '✓ Accept Quote & Book My Move'}
                  </button>
                  <button onClick={() => void confirmDecline()} disabled={declining} className="rounded-xl border border-stone-300 px-6 py-3 text-sm font-medium text-stone-500 hover:bg-stone-50 disabled:opacity-60">
                    {declining ? 'Updating...' : 'Decline'}
                  </button>
                </div>
              </div>
            ) : accepted ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 mb-8">
                <div className="text-center mb-4">
                  <div className="text-xl font-bold text-emerald-700 mb-1">✓ Move Confirmed</div>
                  <div className="text-sm text-emerald-700/80">Your booking is confirmed. Saturn Star will be in touch shortly to finalize move day details.</div>
                </div>
                {justPaid ? (
                  <div className="mt-4 rounded-xl bg-emerald-600 p-4 text-center text-white">
                    <div className="text-base font-bold">✓ Deposit Received — You&apos;re All Set!</div>
                    <div className="text-sm text-white/80 mt-1">Your deposit has been processed. We&apos;ll confirm your move date shortly.</div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-emerald-300 bg-white p-5">
                    <div className="text-sm font-semibold text-stone-900 mb-1">Secure your date with a deposit</div>
                    <p className="text-xs text-stone-500 mb-4">A deposit of <strong>{formatMoney(quote.deposit)}</strong> is required to lock in your move date.</p>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        onClick={() => void payDepositStripe()}
                        disabled={stripeLoading}
                        className="flex-1 rounded-xl bg-[#1a2744] px-5 py-3 text-sm font-bold text-white hover:bg-[#243460] disabled:opacity-60"
                      >
                        {stripeLoading ? 'Redirecting...' : `💳 Pay Deposit Online — ${formatMoney(quote.deposit)}`}
                      </button>
                    </div>
                    <p className="mt-3 text-center text-xs text-stone-400">Prefer e-Transfer or cash? Send to <strong>business@starmovers.ca</strong> and reply to confirm.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-6 mb-8 text-center">
                <div className="text-base font-semibold text-stone-700 mb-1">Quote Declined</div>
                <div className="text-sm text-stone-500">Saturn Star has been notified. If you change your mind, contact us directly.</div>
              </div>
            )}

            {/* Inventory Assumptions */}
            {hasInventory && (
              <Section icon="📋" title="Inventory Assumptions">
                <p>This estimate is based on the following inventory provided by the customer:</p>
                <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
                  {inventory.map((item, i) => {
                    const name = item.name || item.item || 'Item'
                    const qty = Number(item.qty || 1)
                    return <li key={i} className="text-stone-700">— {qty > 1 ? `${qty}× ` : ''}{name}</li>
                  })}
                </ul>
                <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                  <span className="font-semibold">Important:</span> If the actual inventory on moving day exceeds what&apos;s listed above, or additional rooms/items are included, we reserve the right to reassess the estimated hours or switch to hourly billing. Our crew will perform a brief inventory walk-through before starting the move.
                </div>
              </Section>
            )}

            {/* What's Included */}
            <Section icon="✅" title="What's Included">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {[
                  'Professional moving crew',
                  'Moving trucks and equipment',
                  'Furniture disassembly tools',
                  'Protective wrapping materials',
                  'Moving blankets and padding',
                  'Dollies and hand trucks',
                  'On-site crew supervision',
                  'Portal-to-portal billing',
                ].map(item => (
                  <div key={item} className="flex items-center gap-2 text-stone-700">
                    <span className="text-emerald-600 font-bold">✓</span> {item}
                  </div>
                ))}
              </div>
            </Section>

            {/* Hourly Billing */}
            <Section icon="⏱" title="Hourly Billing &amp; Overtime">
              <p>This estimate is based on an hourly rate for your crew and truck, billed portal-to-portal (from our shop to your origin, and back).</p>
              <p>If the move takes <strong>less time</strong>, you will only be billed for the hours worked, rounded to the nearest 15 minutes.</p>
              <p>If the move takes <strong>more time</strong> due to delays, extra items, or property access issues, you will be billed for the additional time at the same hourly rate.</p>
            </Section>

            {/* Cancellation Policy */}
            <Section icon="📄" title="Cancellation Policy">
              <p>Cancellations made within <strong>48 hours</strong> of the move date are subject to a <strong>$150 cancellation fee</strong>.</p>
              <p>Deposits are <strong>non-refundable</strong> if cancellation occurs within 72 hours of the move, unless the move is rescheduled.</p>
            </Section>

            {/* Protection */}
            <Section icon="🛡" title="Protection &amp; Damage Liability">
              <p><strong>Standard Coverage:</strong> $0.60/lb per item</p>
              <p><strong>Optional TV Coverage:</strong> Damage to TVs is covered up to $1,000 if TV protection is purchased</p>
              <p><strong>Excluded Items:</strong> Particle board furniture, customer-packed boxes, jewelry, collectibles, or any item not reasonably transportable without disassembly</p>
              <p className="text-xs text-stone-500">To file a damage claim: notify the foreman before the job is completed, take photos, email to business@starmovers.ca. Claims are processed only after full payment has been made.</p>
            </Section>

            {/* Customer Agreement */}
            <Section icon="✅" title="Customer Agreement">
              <p>By accepting this estimate, you acknowledge and agree to the following:</p>
              <ul className="space-y-1 mt-2">
                {[
                  'This estimate is based on an hourly rate and the inventory listed.',
                  'Final price may vary based on actual time worked or unlisted items.',
                  'You have read and understand our damage policy and exclusions.',
                  'Claims must be submitted before the end of the job and payment is required prior to claim review.',
                ].map((line, i) => <li key={i} className="flex gap-2"><span className="text-[#1a2744] font-bold mt-0.5">—</span>{line}</li>)}
              </ul>
            </Section>

            {/* Reviews */}
            <div className="border-t border-stone-200 pt-6 mt-6">
              <h3 className="text-base font-semibold text-stone-900 mb-4">Reviews</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {REVIEWS.map((r, i) => (
                  <div key={i} className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                    <Stars count={r.stars} />
                    <p className="mt-2 text-xs leading-5 text-stone-600">{r.text}</p>
                    <p className="mt-2 text-[11px] font-medium text-stone-400">by {r.name}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="mt-8 pt-6 border-t border-stone-200 text-center">
              <div className="text-sm font-bold text-[#1a2744]">Saturn Star Moving Company</div>
              <div className="text-xs text-stone-500 mt-1">Windsor, Ontario · business@starmovers.ca · +1 (226) 724 1730</div>
              <div className="mt-1 text-xs font-semibold text-[#f5a623]">Professional Moving Services You Can Trust</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function QuoteAcceptPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <div className="text-sm text-stone-500">Loading your quote...</div>
      </div>
    }>
      <QuoteAcceptPageInner />
    </Suspense>
  )
}
