'use client'

import { useState } from 'react'
import type { CRMLead } from '@/lib/types'

const RATES: Record<string, Record<number, number>> = {
  truck:  { 2: 160, 3: 200, 4: 315 },
  labor:  { 2: 120, 3: 150, 4: 200 },
}

const HOUR_RANGES = [
  { label: '3 hr minimum', min: 3, max: 3 },
  { label: '3–5 hrs', min: 3, max: 5 },
  { label: '4–6 hrs', min: 4, max: 6 },
  { label: '5–8 hrs', min: 5, max: 8 },
]

const SPECIALTY_ITEMS = [
  { id: 'piano', label: '🎹 Piano & Safe', note: 'Extra care required — confirmed at booking' },
  { id: 'pool_table', label: '🎱 Pool Table', note: 'Disassembly required — quoted separately' },
  { id: 'hot_tub', label: '🛁 Hot Tub / Swim Spa', note: 'Specialty equipment — quoted separately' },
]

interface Props {
  open: boolean
  lead: CRMLead
  onClose: () => void
  onBooked: (updatedLead: CRMLead) => void
}

export function FastLaneModal({ open, lead, onClose, onBooked }: Props) {
  const [moveType, setMoveType] = useState<'truck' | 'labor'>('truck')
  const [crew, setCrew] = useState<2 | 3 | 4>(2)
  const [rangeIdx, setRangeIdx] = useState(1) // default 3–5 hrs
  const [specialtyItems, setSpecialtyItems] = useState<string[]>([])
  const [surcharge, setSurcharge] = useState(0)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{
    bookingLink: string
    crewLabel: string
    rangeLabel: string
    minimumHours: number
    maximumHours: number
    minTotal: number
    maxTotal: number
    rate: number
    channel: 'sms' | 'email'
    recipient: string
  } | null>(null)

  const rate = RATES[moveType]?.[crew] ?? RATES.truck[3]
  const range = HOUR_RANGES[rangeIdx]
  const minTotal = Math.round(rate * range.min * 1.13) + surcharge
  const maxTotal = Math.round(rate * range.max * 1.13) + surcharge

  function toggleSpecialty(id: string) {
    setSpecialtyItems(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  async function sendQuote() {
    setSending(true)
    try {
      const res = await fetch('/api/sales/fast-lane', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leadId: lead.id,
          moveType,
          crew,
          minHours: range.min,
          maxHours: range.max,
          specialtyItems,
          surchargeAmount: surcharge > 0 ? surcharge : undefined,
        }),
      })
      const data = await res.json() as {
        ok?: boolean
        bookingLink?: string
        crewLabel?: string
        rangeLabel?: string
        minimumHours?: number
        maximumHours?: number
        minTotal?: number
        maxTotal?: number
        rate?: number
        channel?: 'sms' | 'email'
        recipient?: string
        error?: string
      }
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to send')
      setResult({
        bookingLink: data.bookingLink!,
        crewLabel: data.crewLabel!,
        rangeLabel: data.rangeLabel!,
        minimumHours: data.minimumHours!,
        maximumHours: data.maximumHours!,
        minTotal: data.minTotal!,
        maxTotal: data.maxTotal!,
        rate: data.rate!,
        channel: data.channel || (lead.phone ? 'sms' : 'email'),
        recipient: data.recipient || lead.phone || lead.email || '',
      })
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  function handleDone() {
    setResult(null)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col rounded-[20px] border border-[var(--app-line)] bg-white shadow-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--app-line)] px-5 py-4 sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-display text-base font-semibold text-[var(--app-ink)]">⚡ Fast Lane Quote</h2>
            <p className="mt-0.5 text-xs text-[var(--app-muted)]">{lead.name} · {lead.phone || 'No phone'}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-[var(--app-muted)] hover:bg-[var(--app-bg)]">✕</button>
        </div>

        {result ? (
          /* ── Sent confirmation ── */
          <div className="flex flex-col gap-4 px-5 py-6">
            <div className="rounded-[12px] bg-emerald-50 border border-emerald-200 p-4 text-center">
              <div className="text-3xl mb-2">✅</div>
              <div className="text-sm font-semibold text-emerald-800">Quote + booking link sent!</div>
              <div className="mt-1 text-xs text-emerald-700">
                {result.channel === 'email' ? 'Email sent to' : 'SMS delivered to'} {result.recipient}
              </div>
            </div>

            <div className="rounded-[10px] bg-[var(--app-bg)] px-4 py-3 space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Quote summary</div>
              <div className="text-sm font-semibold text-[var(--app-ink)]">{result.crewLabel} · ${result.rate}/hr</div>
              <div className="text-xs text-[var(--app-muted)]">
                {result.minimumHours}-hour minimum
                {result.maximumHours > result.minimumHours ? ` · most jobs in this lane take about ${result.rangeLabel}` : ''}
                {` · minimum ${result.minTotal.toLocaleString()} incl. HST`}
              </div>
              <div className="text-xs text-[var(--app-muted)]">$100 deposit to book</div>
            </div>

            <div className="rounded-[10px] border border-[var(--app-line)] px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)] mb-1">Booking link</div>
              <div className="text-xs text-[#1a2744] break-all">{result.bookingLink}</div>
              <button
                onClick={() => void navigator.clipboard.writeText(result.bookingLink)}
                className="mt-2 text-[10px] text-[var(--app-accent)] underline"
              >
                Copy link
              </button>
            </div>

            <button onClick={handleDone} className="crm-button-dark w-full justify-center">Done</button>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4">

            {/* Move Type */}
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Move Type</div>
              <div className="grid grid-cols-2 gap-2">
                {([['truck', '🚛 With Truck'], ['labor', '💪 Labour Only']] as const).map(([val, lbl]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setMoveType(val)}
                    className={`rounded-[10px] border py-3 text-sm font-semibold transition ${
                      moveType === val
                        ? 'border-[#1a2744] bg-[#1a2744] text-white'
                        : 'border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-ink)] hover:border-[#1a2744]'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* Crew Size */}
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Crew Size</div>
              <div className="grid grid-cols-3 gap-2">
                {([2, 3, 4] as const).map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCrew(n)}
                    className={`rounded-[10px] border py-3 text-sm font-semibold transition ${
                      crew === n
                        ? 'border-[#f5a623] bg-[#f5a623] text-[#1a2744]'
                        : 'border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-ink)] hover:border-[#f5a623]'
                    }`}
                  >
                    {n} Movers
                  </button>
                ))}
              </div>
            </div>

            {/* Hour Range */}
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Estimated Time</div>
              <div className="grid grid-cols-2 gap-2">
                {HOUR_RANGES.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setRangeIdx(i)}
                    className={`rounded-[10px] border py-2.5 text-sm font-semibold transition ${
                      rangeIdx === i
                        ? 'border-[#1a2744] bg-[#1a2744]/5 text-[#1a2744]'
                        : 'border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-muted)] hover:border-[#1a2744]'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Emergency surcharge */}
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Emergency Surcharge</div>
              <div className="grid grid-cols-4 gap-2">
                {([0, 100, 150, 200] as const).map(amt => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setSurcharge(amt)}
                    className={`rounded-[10px] border py-2.5 text-sm font-semibold transition ${
                      surcharge === amt
                        ? 'border-rose-500 bg-rose-500 text-white'
                        : 'border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-muted)] hover:border-rose-400'
                    }`}
                  >
                    {amt === 0 ? 'None' : `+$${amt}`}
                  </button>
                ))}
              </div>
              {surcharge > 0 && (
                <p className="mt-1.5 text-[10px] text-rose-600">
                  Emergency fee of ${surcharge} added — customer sees it as a fixed surcharge on the quote.
                </p>
              )}
            </div>

            {/* Rate preview */}
            <div className="rounded-[10px] bg-[#1a2744]/5 px-4 py-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-bold text-[#1a2744]">${rate}/hr</span>
                <span className="text-xs text-[var(--app-muted)]">{range.min}-hour minimum</span>
              </div>
              <div className="mt-1 text-xs text-[var(--app-muted)]">
                Minimum charge <span className="font-semibold text-[var(--app-ink)]">${minTotal.toLocaleString()}</span> (incl. HST{surcharge > 0 ? ` + $${surcharge} surcharge` : ''})
                {range.max > range.min ? ` · most jobs in this lane take about ${range.label}` : ''}
              </div>
              <div className="mt-1 text-[10px] text-[var(--app-muted)]">$100 deposit to book · time after the minimum bills in 15-minute increments</div>
            </div>

            {/* Specialty Items */}
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Specialty Items</div>
              <div className="space-y-2">
                {SPECIALTY_ITEMS.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleSpecialty(item.id)}
                    className={`w-full rounded-[10px] border px-3 py-2.5 text-left transition ${
                      specialtyItems.includes(item.id)
                        ? 'border-amber-400 bg-amber-50'
                        : 'border-[var(--app-line)] bg-[var(--app-bg)] hover:border-amber-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[var(--app-ink)]">{item.label}</span>
                      <span className={`text-[10px] font-bold ${specialtyItems.includes(item.id) ? 'text-amber-600' : 'text-[var(--app-muted)]'}`}>
                        {specialtyItems.includes(item.id) ? '✓ noted' : '+ add'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-[var(--app-muted)]">{item.note}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Send button */}
            <button
              onClick={() => void sendQuote()}
              disabled={sending || !lead.phone}
              className="w-full rounded-[10px] bg-[#f5a623] py-3.5 text-sm font-bold text-[#1a2744] transition hover:opacity-90 disabled:opacity-60"
            >
              {sending ? 'Sending...' : `⚡ Send Booking Link to ${lead.name?.split(' ')[0] || 'Customer'}`}
            </button>
            {!lead.phone && (
              <p className="text-center text-xs text-rose-500">No phone number on this lead — add it first</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
