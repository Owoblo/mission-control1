'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { formatDate, formatMoney } from '@/lib/sales'

type PublicQuote = {
  id: string
  number: string
  moveDate?: string
  originCity?: string
  destCity?: string
  status: string
  lineItems: Array<{ description: string; details?: string; amount: number }>
  subtotal: number
  hst: number
  total: number
  deposit: number
  balance: number
  createdAt: string
  viewedAt?: string
  acceptedAt?: string
  respondedAt?: string
}

function QuoteAcceptPageInner() {
  const searchParams = useSearchParams()
  const [quote, setQuote] = useState<PublicQuote | null>(null)
  const [clientName, setClientName] = useState<string>('')
  const [leadName, setLeadName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const id = searchParams.get('id')
  const token = searchParams.get('token')
  const printMode = searchParams.get('print') === '1'

  useEffect(() => {
    async function load() {
      if (!id || !token) {
        setError('Missing quote link details.')
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/public/quotes/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, {
          cache: 'no-store',
        })
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load quote')
        }

        setQuote(payload.quote)
        setClientName(payload.client?.name || '')
        setLeadName(payload.lead?.name || '')
        setAccepted(payload.quote.status === 'accepted')
        setDeclined(payload.quote.status === 'declined')
        setError(null)
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
      const response = await fetch(`/api/public/quotes/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to accept quote')
      }

      setQuote(payload.quote)
      setAccepted(true)
      setDeclined(false)
      setError(null)
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
      const response = await fetch(`/api/public/quotes/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'decline' }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to decline quote')
      }

      setQuote(payload.quote)
      setAccepted(false)
      setDeclined(true)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeclining(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
      <div className="crm-shell w-full max-w-3xl">
        <div className="mb-6 text-center">
          <div className="crm-label">Saturn Star Movers</div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-stone-900">Review and accept your quote.</h1>
          <p className="mt-3 text-sm text-stone-600">
            {clientName || leadName ? `Prepared for ${clientName || leadName}` : 'Secure quote confirmation'}
          </p>
        </div>

        {loading ? (
          <div className="crm-panel p-10 text-center text-sm text-stone-500">Loading quote...</div>
        ) : error || !quote ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700">
            {error || 'Quote not found'}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="crm-panel">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="crm-label">Quote</div>
                  <div className="mt-2 text-xl font-semibold text-stone-900">{quote.number}</div>
                  <div className="mt-2 text-sm text-stone-600">
                    {quote.originCity || 'Origin TBD'} to {quote.destCity || 'Destination TBD'}
                  </div>
                  <div className="text-sm text-stone-500">Move date: {formatDate(quote.moveDate)}</div>
                </div>
                <div className="text-left md:text-right">
                  <div className="crm-label">Total</div>
                  <div className="mt-2 text-3xl font-semibold text-stone-900">{formatMoney(quote.total)}</div>
                  <div className="text-sm text-stone-500">Deposit to book: {formatMoney(quote.deposit)}</div>
                  <button onClick={() => window.print()} className="mt-4 crm-button">
                    Print / Save PDF
                  </button>
                </div>
              </div>
            </div>

            <div className="crm-panel">
              <div className="crm-label">Included Services</div>
              <div className="mt-4 space-y-4">
                {quote.lineItems.map((item, index) => (
                  <div key={`${item.description}-${index}`} className="flex items-start justify-between gap-4 border-b border-stone-200 pb-4 last:border-b-0 last:pb-0">
                    <div>
                      <div className="text-sm font-medium text-stone-900">{item.description}</div>
                      {item.details && <div className="text-xs leading-5 text-stone-500">{item.details}</div>}
                    </div>
                    <div className="text-sm text-stone-900">{formatMoney(item.amount)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 space-y-2 border-t border-stone-200 pt-4 text-sm">
                <div className="flex items-center justify-between text-stone-500">
                  <span>Subtotal</span>
                  <span>{formatMoney(quote.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-stone-500">
                  <span>HST</span>
                  <span>{formatMoney(quote.hst)}</span>
                </div>
                <div className="flex items-center justify-between text-stone-900">
                  <span>Balance After Deposit</span>
                  <span>{formatMoney(quote.balance)}</span>
                </div>
              </div>
            </div>

            {accepted ? (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-center">
                <div className="text-xl font-semibold text-emerald-700">Quote accepted</div>
                <div className="mt-2 text-sm text-emerald-700/80">
                  Your move is marked as confirmed. Saturn Star will follow up with the next booking steps.
                </div>
              </div>
            ) : declined ? (
              <div className="rounded-3xl border border-stone-200 bg-stone-50 p-6 text-center">
                <div className="text-xl font-semibold text-stone-900">Quote declined</div>
                <div className="mt-2 text-sm text-stone-600">
                  Saturn Star has been notified that you are not moving forward on this quote right now.
                </div>
              </div>
            ) : (
              <div className="rounded-3xl border border-stone-200 bg-white p-6">
                <div className="text-lg font-semibold text-stone-900">Ready to move forward?</div>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  Confirming here marks the quote as accepted and tells the team to lock your move into the booked workflow.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button onClick={() => void confirmAccept()} disabled={accepting} className="crm-button-dark disabled:opacity-60">
                    {accepting ? 'Confirming...' : 'Accept Quote'}
                  </button>
                  <button onClick={() => void confirmDecline()} disabled={declining} className="crm-button disabled:opacity-60">
                    {declining ? 'Updating...' : 'Decline Quote'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 text-center text-xs text-stone-500">
          Need changes before accepting? Contact Saturn Star directly instead of confirming this quote.
        </div>
      </div>
    </div>
  )
}

export default function QuoteAcceptPage() {
  return (
    <Suspense fallback={<div className="crm-shell"><div className="crm-panel p-10 text-center text-sm text-stone-500">Loading quote...</div></div>}>
      <QuoteAcceptPageInner />
    </Suspense>
  )
}
