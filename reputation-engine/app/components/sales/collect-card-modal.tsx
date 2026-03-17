'use client'

/**
 * CollectCardModal
 * Opens a Stripe Elements card form inside the CRM so the rep can collect
 * card details directly (customer reads card over the phone, or hands device).
 * On submit: saves card to Stripe + optionally charges the deposit immediately.
 */

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
      fontSize: '14px',
      color: '#1a1a1a',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      '::placeholder': { color: '#9ca3af' },
    },
    invalid: { color: '#ef4444' },
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

      // Confirm the SetupIntent client-side — tokenises the card securely
      const { error, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      })

      if (error) {
        setCardError(error.message || 'Card declined')
        return
      }

      if (setupIntent?.status !== 'succeeded') {
        setCardError('Card setup did not complete. Please try again.')
        return
      }

      // Server-side: save payment method + optionally charge deposit
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
        ok?: boolean
        depositCharged?: boolean
        cardBrand?: string
        cardLast4?: string
        lead?: CRMLead
        error?: string
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
    <div className="p-6 text-sm text-red-600">{initError}</div>
  )

  if (!clientSecret) return (
    <div className="flex items-center justify-center p-8 text-sm text-[var(--app-muted)]">
      <span className="animate-pulse">Initialising secure card form…</span>
    </div>
  )

  return (
    <form onSubmit={e => void handleSubmit(e)} className="space-y-5 p-6">
      {/* Customer info row */}
      <div className="rounded-[8px] border border-[var(--app-line)] bg-stone-50 px-4 py-3 text-sm">
        <div className="font-medium text-[var(--app-ink)]">{lead.name}</div>
        {lead.email && <div className="text-xs text-[var(--app-muted)]">{lead.email}</div>}
        {lead.phone && <div className="text-xs text-[var(--app-muted)]">{lead.phone}</div>}
      </div>

      {/* Card input */}
      <div>
        <label className="crm-label mb-2 block">Card Details</label>
        <div className="rounded-[8px] border border-[var(--app-line)] bg-white px-4 py-3 focus-within:border-[var(--app-accent)] focus-within:ring-1 focus-within:ring-[var(--app-accent)]">
          <CardElement options={CARD_STYLE} onChange={e => { if (e.error) { setCardError(e.error.message || '') } else { setCardError('') } }} />
        </div>
        {cardError && <p className="mt-1.5 text-xs text-red-600">{cardError}</p>}
        <p className="mt-1.5 text-[11px] text-[var(--app-muted)]">
          Card is encrypted and stored securely by Stripe. Never touches our servers in plain text.
        </p>
      </div>

      {/* Charge now option */}
      {quote && (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 space-y-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={chargeNow}
              onChange={e => setChargeNow(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-[var(--app-accent)]"
            />
            <div>
              <div className="text-sm font-medium text-[var(--app-ink)]">
                Charge deposit now — {formatMoney(quote.deposit)}
              </div>
              <div className="text-xs text-[var(--app-muted)] mt-0.5">
                Card will be immediately charged for the {Math.round((quote.deposit / quote.total) * 100)}% deposit. The remaining {formatMoney(quote.balance)} can be charged after the job.
              </div>
            </div>
          </label>
          {!chargeNow && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded-[6px] px-3 py-2">
              Card saved on file only — no charge yet. Use "Charge Deposit" or "Charge Balance" buttons on the lead.
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="crm-button flex-1 justify-center"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !stripe}
          className="flex-1 rounded-[8px] bg-[var(--app-accent)] py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {busy
            ? chargeNow ? 'Charging…' : 'Saving…'
            : chargeNow && quote
              ? `Charge ${formatMoney(quote.deposit)} Deposit`
              : 'Save Card on File'}
        </button>
      </div>
    </form>
  )
}

export function CollectCardModal({ open, lead, quote, onClose, onSuccess }: Props) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md overflow-hidden rounded-[12px] bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--app-line)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--app-ink)]">Collect Card Details</h2>
            <p className="mt-0.5 text-xs text-[var(--app-muted)]">
              {quote ? `Charge ${formatMoney(quote.deposit)} deposit + save card for balance` : 'Save card on file for future charges'}
            </p>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--app-muted)] hover:bg-stone-100">✕</button>
        </div>

        {/* Stripe Elements wrapper */}
        <Elements stripe={stripePromise}>
          <CardForm lead={lead} quote={quote} onClose={onClose} onSuccess={onSuccess} />
        </Elements>
      </div>
    </div>
  )
}
