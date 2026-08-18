'use client'

import { useMemo, useState } from 'react'
import type { CRMLead, CRMQuote, PaymentRecordKind, PaymentRecordMethod } from '@/lib/types'
import { deriveMoneyState } from '@/lib/payment-state'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import { deriveBalanceAuthorizationState } from '@/lib/balance-authorization'

const money = (value: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value)

export function PaymentReceiptCenter({ lead, quote, canEdit, onUpdated }: { lead: CRMLead; quote: CRMQuote; canEdit: boolean; onUpdated: (lead: CRMLead, quote: CRMQuote) => void }) {
  const currentUser = useCurrentUser()
  const records = useMemo(() => [...(quote.paymentRecords || [])].sort((a, b) => b.paidAt.localeCompare(a.paidAt)), [quote.paymentRecords])
  const moneyState = useMemo(() => deriveMoneyState(quote, lead), [quote, lead])
  const paid = moneyState.netPaid
  const owing = moneyState.balance
  const [open, setOpen] = useState(false)
  // Deliberately blank: a receipt must reflect a real transaction, never an
  // amount inferred from the quote or remaining balance.
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<PaymentRecordKind>(paid <= 0 ? 'deposit' : owing > 0 ? 'partial' : 'other')
  const [method, setMethod] = useState<PaymentRecordMethod>('etransfer')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [email, setEmail] = useState(lead.email || '')
  const [sendEmail, setSendEmail] = useState(Boolean(lead.email))
  const [sendSms, setSendSms] = useState(Boolean(lead.phone))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const authorization = useMemo(() => deriveBalanceAuthorizationState(quote, lead), [quote, lead])

  async function manageAuthorization(action: 'authorize' | 'increment' | 'capture' | 'cancel') {
    let requestedAmount = authorization.outstanding
    if (action === 'increment' || action === 'capture') {
      const entered = window.prompt(action === 'capture' ? 'Final amount to capture' : 'New total authorization amount', String(action === 'capture' ? Math.min(authorization.outstanding, authorization.authorizedAmount) : authorization.outstanding))
      if (!entered) return
      requestedAmount = Number(entered)
    }
    if (action === 'authorize' && !window.confirm(`Place a temporary ${money(requestedAmount)} authorization hold on the saved card? Confirm that the customer agreed to the pre-service authorization terms.`)) return
    if (action === 'capture' && !window.confirm(`Capture ${money(requestedAmount)} as the final balance? Any unused authorization will be released by the card issuer.`)) return
    if (action === 'cancel' && !window.confirm('Cancel this authorization and release the held funds?')) return
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/sales/stripe/balance-authorization', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: lead.id, quoteId: quote.id, action, amount: requestedAmount, consentConfirmed: action === 'authorize' }) })
      const payload = await response.json() as { ok?: boolean; error?: string; lead?: CRMLead; quote?: CRMQuote }
      if (!response.ok || !payload.ok || !payload.lead || !payload.quote) throw new Error(payload.error || 'Authorization action failed')
      onUpdated(payload.lead, payload.quote)
      setMessage(action === 'authorize' ? 'Balance authorization approved.' : action === 'capture' ? 'Final balance captured and unused hold released.' : action === 'increment' ? 'Authorization increased.' : 'Authorization canceled.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Authorization action failed') }
    finally { setBusy(false) }
  }

  const receiptLink = (payment: { publicToken: string }) => `/receipt?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(payment.publicToken)}`

  async function submit() {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/sales/quotes/${quote.id}/payments`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(amount), kind, method, reference, note, email, sendEmail, sendSms }),
      })
      const payload = await response.json() as { ok?: boolean; error?: string; lead?: CRMLead; quote?: CRMQuote; emailSent?: boolean; smsSent?: boolean; emailError?: string; smsError?: string }
      if (!response.ok || !payload.ok || !payload.lead || !payload.quote) throw new Error(payload.error || 'Payment could not be recorded')
      onUpdated(payload.lead, payload.quote)
      setMessage(`Payment recorded.${payload.emailSent ? ' Email sent.' : ''}${payload.smsSent ? ' SMS sent.' : ''}${payload.emailError ? ` Email: ${payload.emailError}` : ''}${payload.smsError ? ` SMS: ${payload.smsError}` : ''}`)
      setOpen(false); setReference(''); setNote('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Payment could not be recorded') }
    finally { setBusy(false) }
  }

  async function resend(paymentId: string) {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/sales/quotes/${quote.id}/payments`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, email, sendEmail, sendSms }),
      })
      const payload = await response.json() as { ok?: boolean; error?: string; lead?: CRMLead; quote?: CRMQuote }
      if (!response.ok || !payload.ok || !payload.lead || !payload.quote) throw new Error(payload.error || 'Receipt could not be sent')
      onUpdated(payload.lead, payload.quote); setMessage('Receipt delivery completed.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Receipt could not be sent') }
    finally { setBusy(false) }
  }

  async function refund(paymentId: string, refundable: number) {
    const amountText = window.prompt(`Refund amount (maximum ${money(refundable)})`)
    if (!amountText) return
    const reason = window.prompt('Reason for this refund (required)')
    if (!reason?.trim()) return
    const reference = window.prompt('Refund reference (optional)') || ''
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/sales/quotes/${quote.id}/payments`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, amount: Number(amountText), reason, reference }),
      })
      const payload = await response.json() as { ok?: boolean; error?: string; lead?: CRMLead; quote?: CRMQuote }
      if (!response.ok || !payload.ok || !payload.lead || !payload.quote) throw new Error(payload.error || 'Refund could not be recorded')
      onUpdated(payload.lead, payload.quote); setMessage('Refund recorded with an audit note.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Refund could not be recorded') }
    finally { setBusy(false) }
  }

  return (
    <div className="overflow-hidden rounded-[18px] border border-[#E5E7EB] bg-white">
      <div className="bg-[#071421] p-4 text-white">
        <div className="flex items-center justify-between gap-3">
          <div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#C99700]">Payments & receipts</div><div className="mt-1 text-sm font-bold">{money(paid)} collected · {money(owing)} owing</div></div>
          <button onClick={() => setOpen(value => !value)} disabled={!canEdit} className="rounded-[10px] bg-[#C99700] px-3 py-2 text-xs font-extrabold text-[#071421] disabled:opacity-50">{open ? 'Close' : '+ Record payment'}</button>
        </div>
      </div>

      {authorization.outstanding > 0 && <div className={`border-b p-4 ${authorization.live ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#667085]">Balance security</div><div className="mt-1 text-sm font-bold text-[#071421]">{authorization.live ? `${money(authorization.authorizedAmount)} authorized` : `${money(authorization.outstanding)} authorization required`}</div>{authorization.expiresAt && <div className="mt-1 text-[10px] text-[#667085]">Capture before {new Date(authorization.expiresAt).toLocaleString('en-CA')}</div>}</div><span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${authorization.live ? 'bg-emerald-600 text-white' : 'bg-amber-200 text-amber-900'}`}>{authorization.live ? 'Dispatch cleared' : 'Not cleared'}</span></div>
        {canEdit && <div className="mt-3 flex flex-wrap gap-2">{!authorization.live && <button onClick={() => void manageAuthorization('authorize')} disabled={busy} className="rounded-[8px] bg-[#071421] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Authorize balance</button>}{authorization.live && authorization.outstanding > authorization.authorizedAmount && <button onClick={() => void manageAuthorization('increment')} disabled={busy} className="rounded-[8px] bg-amber-600 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Increase hold</button>}{authorization.live && <button onClick={() => void manageAuthorization('capture')} disabled={busy} className="rounded-[8px] bg-emerald-700 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Capture final balance</button>}{authorization.live && <button onClick={() => void manageAuthorization('cancel')} disabled={busy} className="rounded-[8px] border border-rose-300 bg-white px-3 py-2 text-[10px] font-bold text-rose-700 disabled:opacity-50">Release hold</button>}</div>}
      </div>}

      {open && <div className="space-y-3 border-b border-[#E5E7EB] bg-[#F7F4ED] p-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-[#667085]">Amount<input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} className="crm-input mt-1 w-full bg-white text-sm" /></label>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-[#667085]">Payment type<select value={kind} onChange={event => setKind(event.target.value as PaymentRecordKind)} className="crm-input mt-1 w-full bg-white text-sm"><option value="deposit">Deposit</option><option value="partial">Partial payment</option><option value="balance">Balance payment</option><option value="final">Final payment</option><option value="other">Other payment</option></select></label>
          <label className="col-span-2 text-[10px] font-semibold uppercase tracking-wider text-[#667085]">Method<select value={method} onChange={event => setMethod(event.target.value as PaymentRecordMethod)} className="crm-input mt-1 w-full bg-white text-sm"><option value="etransfer">Interac E-Transfer</option><option value="credit_card">Credit card</option><option value="debit">Debit</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
        </div>
        <input value={reference} onChange={event => setReference(event.target.value)} className="crm-input w-full bg-white text-xs" placeholder="Transaction/reference number (optional)" />
        <textarea value={note} onChange={event => setNote(event.target.value)} className="crm-input w-full resize-none bg-white text-xs" rows={2} placeholder="Receipt note (optional)" />
        <input type="email" value={email} onChange={event => setEmail(event.target.value)} className="crm-input w-full bg-white text-xs" placeholder="Receipt email" />
        <div className="flex flex-wrap gap-2 text-xs text-[#111827]"><label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2"><input type="checkbox" checked={sendEmail} onChange={event => setSendEmail(event.target.checked)} /> Email receipt</label><label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2"><input type="checkbox" checked={sendSms} onChange={event => setSendSms(event.target.checked)} disabled={!lead.phone} /> SMS receipt</label></div>
        <button onClick={() => void submit()} disabled={busy || Number(amount) <= 0} className="w-full rounded-[12px] bg-[#C99700] px-4 py-3 text-sm font-extrabold text-[#071421] disabled:opacity-50">{busy ? 'Recording…' : `Record ${money(Number(amount || 0))} & create receipt`}</button>
      </div>}

      <div className="divide-y divide-[#E5E7EB]">
        {records.length === 0 ? <div className="p-4 text-center text-xs text-[#667085]">No modern receipt records yet. Record the next payment here.</div> : records.map(payment => <div key={payment.id} className="p-4">
          <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-bold text-[#071421]">{money(payment.amount)} · {payment.methodLabel}</div><div className="mt-1 text-[10px] text-[#667085]">{payment.receiptNumber} · {new Date(payment.paidAt).toLocaleDateString('en-CA')}{payment.refundedAmount ? ` · ${money(payment.refundedAmount)} refunded` : ''}</div></div><div className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${payment.status === 'refunded' ? 'bg-stone-100 text-stone-600' : payment.status === 'partially_refunded' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{payment.status === 'refunded' ? 'Refunded' : payment.status === 'partially_refunded' ? 'Partial refund' : 'Received'}</div></div>
          <div className="mt-3 flex flex-wrap gap-2"><a href={receiptLink(payment)} target="_blank" className="rounded-[8px] border border-[#E5E7EB] px-2.5 py-1.5 text-[10px] font-semibold text-[#071421]">Preview</a><button onClick={() => void resend(payment.id)} disabled={busy} className="rounded-[8px] border border-[#E5E7EB] px-2.5 py-1.5 text-[10px] font-semibold text-[#071421] disabled:opacity-50">Send again</button>{(currentUser?.role === 'owner' || currentUser?.role === 'manager') && payment.status !== 'refunded' && <button onClick={() => void refund(payment.id, Math.max(0, payment.amount - Number(payment.refundedAmount || 0)))} disabled={busy} className="rounded-[8px] border border-amber-300 px-2.5 py-1.5 text-[10px] font-semibold text-amber-800 disabled:opacity-50">Record refund</button>}{payment.emailSentAt && <span className="px-1 py-1.5 text-[9px] text-[#667085]">Email sent</span>}{payment.smsSentAt && <span className="px-1 py-1.5 text-[9px] text-[#667085]">SMS sent</span>}</div>
        </div>)}
      </div>
      {message && <div className="border-t border-[#E5E7EB] bg-[#F7F4ED] px-4 py-3 text-[10px] font-semibold text-[#667085]">{message}</div>}
    </div>
  )
}
