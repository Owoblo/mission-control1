'use client'

import { useEffect, useMemo, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { formatMoney } from '@/lib/sales'
import type { CRMLead, CRMQuote } from '@/lib/types'

type Props = {
  open: boolean
  lead: CRMLead
  quote: CRMQuote | null
  onClose: () => void
  onSuccess: (result: {
    depositCharged: boolean
    cardLast4: string
    cardBrand: string
    lead: CRMLead
    quote?: CRMQuote | null
  }) => void
}

const CARD_STYLE = {
  style: {
    base: {
      fontSize: '15px',
      color: '#071421',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      fontWeight: '500',
      letterSpacing: '0.02em',
      '::placeholder': { color: '#94a3b8' },
    },
    invalid: { color: '#dc2626' },
  },
}

type CardSetup = {
  clientSecret: string
  setupIntentId: string
  customerId: string
}

function CardForm({ lead, quote, onClose, onSuccess, setup }: Omit<Props, 'open'> & { setup: CardSetup }) {
  const stripe = useStripe()
  const elements = useElements()
  const [chargeNow, setChargeNow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [cardError, setCardError] = useState('')
  const { clientSecret, setupIntentId, customerId } = setup

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
        cardLast4?: string; lead?: CRMLead; quote?: CRMQuote | null; error?: string
      }
      if (!r.ok || !result.ok) throw new Error(result.error || 'Save failed')

      onSuccess({
        depositCharged: result.depositCharged ?? false,
        cardLast4: result.cardLast4 || '????',
        cardBrand: result.cardBrand || 'card',
        lead: result.lead!,
        quote: result.quote,
      })
    } catch (err) {
      setCardError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const depositPct = quote ? Math.round((quote.deposit / quote.total) * 100) : 20

  return (
    <form onSubmit={e => void handleSubmit(e)} className="px-6 pb-6 pt-5 space-y-4">

      {/* Customer pill */}
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#071421] text-xs font-bold text-white">
          {lead.name?.slice(0, 2).toUpperCase() || 'CX'}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#071421]">{lead.name}</div>
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
              : 'border-slate-200 focus-within:border-[#C99700] focus-within:ring-1 focus-within:ring-[#C99700]/40'
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
            ? 'bg-[#071421] ring-[#071421]'
            : 'bg-slate-50 ring-slate-100 hover:ring-slate-200'
        }`}>
          <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all ${
            chargeNow ? 'border-[#C99700] bg-[#C99700]' : 'border-slate-300 bg-white'
          }`}>
            {chargeNow && (
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                <path d="M1 4l3 3 5-6" stroke="#071421" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
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
            <div className={`text-sm font-semibold ${chargeNow ? 'text-white' : 'text-[#071421]'}`}>
              Charge {depositPct}% deposit now — <span className={chargeNow ? 'text-[#C99700]' : ''}>{formatMoney(quote.deposit)}</span>
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
          className="flex-1 rounded-xl bg-[#071421] py-2.5 text-sm font-semibold text-white hover:bg-[#243460] disabled:opacity-50 transition-colors"
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

function AccountScopedCardForm(props: Omit<Props, 'open'>) {
  const [setup, setSetup] = useState<(CardSetup & { publishableKey: string }) | null>(null)
  const [initError, setInitError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const response = await fetch('/api/sales/stripe/setup-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ leadId: props.lead.id, quoteId: props.quote?.id }),
        })
        const data = await response.json() as Partial<CardSetup> & { publishableKey?: string; error?: string }
        if (!response.ok || !data.clientSecret || !data.setupIntentId || !data.customerId || !data.publishableKey) {
          throw new Error(data.error || 'Could not initialize the branch payment account.')
        }
        if (!cancelled) setSetup(data as CardSetup & { publishableKey: string })
      } catch (error) {
        if (!cancelled) setInitError(error instanceof Error ? error.message : 'Setup failed')
      }
    }
    void init()
    return () => { cancelled = true }
  }, [props.lead.id, props.quote?.id])

  const stripePromise = useMemo(
    () => setup?.publishableKey ? loadStripe(setup.publishableKey) : null,
    [setup?.publishableKey]
  )

  if (initError) return (
    <div className="px-6 py-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50"><span className="text-lg">⚠</span></div>
      <p className="text-sm font-medium text-red-600">{initError}</p>
    </div>
  )
  if (!setup || !stripePromise) return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#071421] border-t-transparent" />
      <p className="text-xs text-slate-400">Connecting to the branch Stripe account…</p>
    </div>
  )
  return (
    <Elements stripe={stripePromise}>
      <CardForm {...props} setup={setup} />
    </Elements>
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
      <div className="w-full max-w-[420px] overflow-hidden rounded-xl bg-white shadow-none">

        {/* Header — navy band */}
        <div className="relative bg-[#071421] px-6 py-5">
          {/* gold rule */}
          <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[#C99700]" />
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Take Card By Phone</h2>
              <p className="mt-0.5 text-xs text-slate-300">
                {quote
                  ? `${formatMoney(quote.deposit)} deposit · Stripe-secure card entry`
                  : 'Save a customer card on file with Stripe-secure entry'}
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
        <AccountScopedCardForm lead={lead} quote={quote} onClose={onClose} onSuccess={onSuccess} />
      </div>
    </div>
  )
}
