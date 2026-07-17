'use client'

import { useMemo, useState } from 'react'
import type { CRMLead, CRMQuote, PaymentRecordKind, PaymentRecordMethod } from '@/lib/types'

const money = (value: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value)

export function PaymentReceiptCenter({ lead, quote, canEdit, onUpdated }: { lead: CRMLead; quote: CRMQuote; canEdit: boolean; onUpdated: (lead: CRMLead, quote: CRMQuote) => void }) {
  const records = useMemo(() => [...(quote.paymentRecords || [])].sort((a, b) => b.paidAt.localeCompare(a.paidAt)), [quote.paymentRecords])
  const recordedPaid = records.reduce((sum, item) => sum + item.amount, 0)
  const legacyPaid = Math.max(Number(quote.depositPaidAmount || 0), Number(lead.depositAmount || 0)) + Number(quote.balancePaidAmount || 0)
  const paid = Math.max(recordedPaid, legacyPaid)
  const owing = Math.max(0, quote.total - paid)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(owing > 0 ? Math.min(owing, quote.deposit || owing) : ''))
  const [kind, setKind] = useState<PaymentRecordKind>(paid <= 0 ? 'deposit' : owing > 0 ? 'partial' : 'other')
  const [method, setMethod] = useState<PaymentRecordMethod>('etransfer')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [email, setEmail] = useState(lead.email || '')
  const [sendEmail, setSendEmail] = useState(Boolean(lead.email))
  const [sendSms, setSendSms] = useState(Boolean(lead.phone))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

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

  return (
    <div className="overflow-hidden rounded-[18px] border border-[#E5E7EB] bg-white">
      <div className="bg-[#071421] p-4 text-white">
        <div className="flex items-center justify-between gap-3">
          <div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#C99700]">Payments & receipts</div><div className="mt-1 text-sm font-bold">{money(paid)} collected · {money(owing)} owing</div></div>
          <button onClick={() => setOpen(value => !value)} disabled={!canEdit} className="rounded-[10px] bg-[#C99700] px-3 py-2 text-xs font-extrabold text-[#071421] disabled:opacity-50">{open ? 'Close' : '+ Record payment'}</button>
        </div>
      </div>

      {open && <div className="space-y-3 border-b border-[#E5E7EB] bg-[#F7F4ED] p-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-[#667085]">Amount<input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} className="crm-input mt-1 w-full bg-white text-sm" /></label>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-[#667085]">Payment type<select value={kind} onChange={event => setKind(event.target.value as PaymentRecordKind)} className="crm-input mt-1 w-full bg-white text-sm"><option value="deposit">Deposit</option><option value="partial">Partial payment</option><option value="balance">Balance payment</option><option value="final">Final payment</option><option value="other">Other payment</option></select></label>
          <label className="col-span-2 text-[10px] font-semibold uppercase tracking-wider text-[#667085]">Method<select value={method} onChange={event => setMethod(event.target.value as PaymentRecordMethod)} className="crm-input mt-1 w-full bg-white text-sm"><option value="etransfer">Interac E-Transfer</option><option value="credit_card">Credit card</option><option value="debit">Debit</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
        </div>
        <input value={reference} onChange={event => setReference(event.target.value)} className="crm-input w-full bg-white text-xs" placeholder="Transaction/reference number (optional)" />
        <textarea value={note} onChange={event => setNote(event.target.value)} className="crm-input w-full resize-none bg-white text-xs" rows={2} placeholder="Receipt note (optional)" />
        <input type="email" value={email} onChange={event => setEmail(event.target.value)} className="crm-input w-full bg-white text-xs" placeholder="Receipt email" />
        <div className="flex flex-wrap gap-2 text-xs text-[#111827]"><label className="flex items-center gap-2 rounded-full bg-white px-3 py-2"><input type="checkbox" checked={sendEmail} onChange={event => setSendEmail(event.target.checked)} /> Email receipt</label><label className="flex items-center gap-2 rounded-full bg-white px-3 py-2"><input type="checkbox" checked={sendSms} onChange={event => setSendSms(event.target.checked)} disabled={!lead.phone} /> SMS receipt</label></div>
        <button onClick={() => void submit()} disabled={busy || Number(amount) <= 0} className="w-full rounded-[12px] bg-[#C99700] px-4 py-3 text-sm font-extrabold text-[#071421] disabled:opacity-50">{busy ? 'Recording…' : `Record ${money(Number(amount || 0))} & create receipt`}</button>
      </div>}

      <div className="divide-y divide-[#E5E7EB]">
        {records.length === 0 ? <div className="p-4 text-center text-xs text-[#667085]">No modern receipt records yet. Record the next payment here.</div> : records.map(payment => <div key={payment.id} className="p-4">
          <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-bold text-[#071421]">{money(payment.amount)} · {payment.methodLabel}</div><div className="mt-1 text-[10px] text-[#667085]">{payment.receiptNumber} · {new Date(payment.paidAt).toLocaleDateString('en-CA')}</div></div><div className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold uppercase text-emerald-700">Received</div></div>
          <div className="mt-3 flex flex-wrap gap-2"><a href={receiptLink(payment)} target="_blank" className="rounded-[8px] border border-[#E5E7EB] px-2.5 py-1.5 text-[10px] font-semibold text-[#071421]">Preview</a><button onClick={() => void resend(payment.id)} disabled={busy} className="rounded-[8px] border border-[#E5E7EB] px-2.5 py-1.5 text-[10px] font-semibold text-[#071421] disabled:opacity-50">Send again</button>{payment.emailSentAt && <span className="px-1 py-1.5 text-[9px] text-[#667085]">Email sent</span>}{payment.smsSentAt && <span className="px-1 py-1.5 text-[9px] text-[#667085]">SMS sent</span>}</div>
        </div>)}
      </div>
      {message && <div className="border-t border-[#E5E7EB] bg-[#F7F4ED] px-4 py-3 text-[10px] font-semibold text-[#667085]">{message}</div>}
    </div>
  )
}
