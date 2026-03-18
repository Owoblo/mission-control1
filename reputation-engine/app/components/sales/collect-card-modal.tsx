'use client'

import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { formatMoney } from '@/lib/sales'
import type { CRMLead, CRMQuote } from '@/lib/types'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '')

type Props = {
  open: boolean
  lead: CRMLead
  quote: CRMQuote | null
  onClose: () => void
  onSuccess: (result: { depositCharged: boolean; cardLast4: string; cardBrand: string; lead: CRMLead }) => void
}

const CARD_STYLE = {
  style: {
    base: {
      fontSize: '15px',
      color: '#1a2744',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      fontWeight: '500',
      letterSpacing: '0.02em',
      '::placeholder': { color: '#94a3b8' },
    },
    invalid: { color: '#dc2626' },
  },
}

function CardForm({ lead, quote, onClose, onSuccess }: Omit<Props, 'open'>) {
  const stripe = useStripe()
  const elements = useElements()
  const [clientSecret, setClientSecret] = useState('')
  const [setupIntentId, setSetupIntentId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [chargeNow, setChargeNow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [initError, setInitError] = useState('')
  const [cardError, setCardError] = useState('')

  useEffect(() => {
    async function init() {
      try {
        const r = await fetch('/api/sales/stripe/setup-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ leadId: lead.id }),
        })
        const data = await r.json() as { clientSecret?: string; setupIntentId?: string; customerId?: string; error?: string }
        if (!r.ok || !data.clientSecret) throw new Error(data.error || 'Could not init card collection')
        setClientSecret(data.clientSecret)
        setSetupIntentId(data.setupIntentId || '')
        setCustomerId(data.customerId || '')
      } catch (err) {
        setInitError(err instanceof Error ? err.message : 'Setup failed')
      }
    }
    void init()
  }, [lead.id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements || !clientSecret) return
    setBusy(true)
    setCardError('')
    try {
      const cardElement = elements.getElement(CardElement)
      if (!cardElement) throw new Error('Card field not found')

      const { error, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      })

      if (error) { setCardError(error.message || 'Card declined'); return }
      if (setupIntent?.status !== 'succeeded') { setCardError('Card setup did not complete. Please try again.'); return }

      const r = await fetch('/api/sales/stripe/save-payment-method', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leadId: lead.id,
          quoteId: quote?.id,
          setupIntentId,
          customerId,
          chargeDepositNow: chargeNow && !!quote,
        }),
      })
      const result = await r.json() as {
        ok?: boolean; depositCharged?: boolean; cardBrand?: string
        cardLast4?: string; lead?: CRMLead; error?: string
      }
      if (!r.ok || !result.ok) throw new Error(result.error || 'Save failed')

      onSuccess({
        depositCharged: result.depositCharged ?? false,
        cardLast4: result.cardLast4 || '????',
        cardBrand: result.cardBrand || 'card',
        lead: result.lead!,
      })
    } catch (err) {
      setCardError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  if (initError) return (
    <div className="px-6 py-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
        <span className="text-lg">⚠</span>
      </div>
      <p className="text-sm font-medium text-red-600">{initError}</p>
    </div>
  )

  if (!clientSecret) return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#1a2744] border-t-transparent" />
      <p className="text-xs text-slate-400">Connecting to Stripe…</p>
    </div>
  )

  const depositPct = quote ? Math.round((quote.deposit / quote.total) * 100) : 20

  return (
    <form onSubmit={e => void handleSubmit(e)} className="px-6 pb-6 pt-5 space-y-4">

      {/* Customer pill */}
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1a2744] text-xs font-bold text-white">
          {lead.name?.slice(0, 2).toUpperCase() || 'CX'}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#1a2744]">{lead.name}</div>
          <div className="truncate text-xs text-slate-400">{[lead.email, lead.phone].filter(Boolean).join(' · ')}</div>
        </div>
      </div>

      {/* Card input */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Card Details</label>
          <div className="flex items-center gap-1 text-[10px] text-slate-300">
            <svg width="11" height="13" viewBox="0 0 11 13" fill="none"><path d="M5.5 0L0 2.6V6c0 3.3 2.3 6.3 5.5 7C8.7 12.3 11 9.3 11 6V2.6L5.5 0z" fill="#94a3b8"/></svg>
            Encrypted by Stripe
          </div>
        </div>
        <div
          className={`rounded-xl border bg-white px-4 py-3.5 transition-all ${
            cardError
              ? 'border-red-300 ring-1 ring-red-200'
              : 'border-slate-200 focus-within:border-[#f5a623] focus-within:ring-1 focus-within:ring-[#f5a623]/40'
          }`}
        >
          <CardElement
            options={CARD_STYLE}
            onChange={e => { if (e.error) setCardError(e.error.message || ''); else setCardError('') }}
          />
        </div>
        {cardError && (
          <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500">
            <span>✕</span> {cardError}
          </p>
        )}
      </div>

      {/* Charge now toggle */}
      {quote && (
        <label className={`flex cursor-pointer items-start gap-3 rounded-xl p-4 ring-1 transition-all ${
          chargeNow
            ? 'bg-[#1a2744] ring-[#1a2744]'
            : 'bg-slate-50 ring-slate-100 hover:ring-slate-200'
        }`}>
          <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all ${
            chargeNow ? 'border-[#f5a623] bg-[#f5a623]' : 'border-slate-300 bg-white'
          }`}>
            {chargeNow && (
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                <path d="M1 4l3 3 5-6" stroke="#1a2744" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
          <div className="flex-1">
            <input
              type="checkbox"
              checked={chargeNow}
              onChange={e => setChargeNow(e.target.checked)}
              className="sr-only"
            />
            <div className={`text-sm font-semibold ${chargeNow ? 'text-white' : 'text-[#1a2744]'}`}>
              Charge {depositPct}% deposit now — <span className={chargeNow ? 'text-[#f5a623]' : ''}>{formatMoney(quote.deposit)}</span>
            </div>
            <div className={`mt-0.5 text-xs ${chargeNow ? 'text-slate-300' : 'text-slate-400'}`}>
              {chargeNow
                ? `Remaining ${formatMoney(quote.balance)} charged after the job from saved card.`
                : 'Card saved on file only — charge deposit later from the lead page.'}
            </div>
          </div>
        </label>
      )}

      {/* Actions */}
      <div className="flex gap-2.5 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !stripe}
          className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white hover:bg-[#243460] disabled:opacity-50 transition-colors"
        >
          {busy
            ? (chargeNow ? 'Charging…' : 'Saving…')
            : chargeNow && quote
              ? `Charge ${formatMoney(quote.deposit)}`
              : 'Save Card on File'}
        </button>
      </div>
    </form>
  )
}

export function CollectCardModal({ open, lead, quote, onClose, onSuccess }: Props) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,27,56,0.55)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-[420px] overflow-hidden rounded-2xl bg-white shadow-2xl">

        {/* Header — navy band */}
        <div className="relative bg-[#1a2744] px-6 py-5">
          {/* gold rule */}
          <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[#f5a623]" />
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Collect Card Details</h2>
              <p className="mt-0.5 text-xs text-slate-300">
                {quote
                  ? `${formatMoney(quote.deposit)} deposit · card saved for balance`
                  : 'Save card on file for future charges'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <Elements stripe={stripePromise}>
          <CardForm lead={lead} quote={quote} onClose={onClose} onSuccess={onSuccess} />
        </Elements>
      </div>
    </div>
  )
}
