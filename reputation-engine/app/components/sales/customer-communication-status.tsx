'use client'
import { useEffect, useState } from 'react'
import type { CRMLead } from '@/lib/types'

type Status = { sms: Array<{ id: string; created_at: string }>; quoteChannels: Array<{ id: string; channel: string; status: string; created_at: string }> }
export function CustomerCommunicationStatus({ lead, canEdit, onSaved }: { lead: CRMLead; canEdit: boolean; onSaved: (lead: CRMLead) => void }) {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const response = await fetch(`/api/sales/leads/${encodeURIComponent(lead.id)}/communication-status`, { credentials: 'include', cache: 'no-store' })
        if (!response.ok) throw Error('Delivery status could not be refreshed.')
        const body = await response.json(); if (active) { setStatus(body); setError('') }
      } catch (error) { if (active) setError(String(error instanceof Error ? error.message : error)) }
    }
    void load(); const interval = setInterval(load, 30_000)
    return () => { active = false; clearInterval(interval) }
  }, [lead.id])
  const review = lead.conversationReview?.status === 'open' ? lead.conversationReview : null
  const callback = lead.callbackCommitment?.status === 'open' ? lead.callbackCommitment : null
  const failedEmail = status?.quoteChannels.filter(job => job.channel === 'email' && job.status === 'failed') || []
  const failedSms = status?.sms || []
  async function resolve(confirmDate: boolean) {
    const date = confirmDate ? window.prompt('Move date confirmed with the customer (YYYY-MM-DD):', lead.moveDate || '') : undefined
    if (confirmDate && !date) return
    const note = window.prompt('Record what the customer confirmed or what resolves this review:')
    if (!note) return
    setSaving(true)
    try {
      const response = await fetch(`/api/sales/leads/${encodeURIComponent(lead.id)}/communication-status`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: confirmDate ? 'confirm-date' : 'resolve-review', date, note }) })
      const body = await response.json(); if (!response.ok) throw Error(body.error || 'Decision could not be saved')
      onSaved(body.lead); setError('')
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) } finally { setSaving(false) }
  }
  async function complete(delivery = false) {
    const note = window.prompt(delivery ? 'Record how the customer was reached or their number was verified:' : 'Record what happened on the completed callback:')
    if (!note) return
    setSaving(true)
    try {
      const response = await fetch(`/api/sales/leads/${encodeURIComponent(lead.id)}/communication-status`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: delivery ? 'resolve-delivery' : 'complete-callback', note }) })
      const body = await response.json(); if (!response.ok) throw Error(body.error || 'Callback completion could not be saved')
      onSaved(body.lead);if (delivery) setStatus(previous => previous ? { ...previous, sms: [] } : previous);setError('')
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) } finally { setSaving(false) }
  }
  if (!review && !callback && !failedSms.length && !failedEmail.length && !error && lead.moveDateConfirmation !== 'unconfirmed') return null
  return <section className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-slate-900" aria-label="Customer communication needs attention">
    <div className="font-semibold">Customer follow-up needs attention</div>
    {failedSms.length ? <p className="mt-2 text-red-800">{failedSms.length} SMS {failedSms.length === 1 ? 'was' : 'were'} not delivered. Call the customer or verify their number; they may be waiting for our response.</p> : null}
    {canEdit && lead.deliveryFailureReview?.status === 'open' ? <button disabled={saving} className="crm-button mt-2" onClick={() => void complete(true)}>Record delivery follow-up</button> : null}
    {failedEmail.length ? <p className="mt-2 text-red-800">Quote email delivery failed. A successful SMS does not confirm email delivery. <a href="#section-quote" className="underline">Review the quote before sending again.</a></p> : null}
    {review ? <><p className="mt-2 font-medium">{review.kind === 'declined' ? 'Customer indicated they are not proceeding. Review and record the outcome before further sales follow-up.' : review.kind === 'no_active_move' ? 'No active move is confirmed. Review whether this is a referral or future opportunity.' : 'Customer said their moving date is uncertain.'}</p><p className="mt-1 text-slate-600">{review.evidence}</p></> : null}
    {callback ? <p className="mt-2">{callback.customerWillReply ? 'Customer said they will reply. Wait before following up.' : 'Callback commitment shared with all reps.'} Contact from {new Date(callback.notBefore).toLocaleString('en-CA', { timeZone: 'America/Toronto' })}; follow-up due {new Date(callback.dueAt).toLocaleString('en-CA', { timeZone: 'America/Toronto' })}.</p> : null}
    {canEdit && callback && Date.parse(callback.notBefore) <= Date.now() ? <button disabled={saving} className="crm-button mt-2" onClick={() => void complete()}>Record callback completion</button> : null}
    {lead.moveDateConfirmation === 'unconfirmed' ? <p className="mt-2">The recorded move date {lead.moveDate || '(not set)'} is unconfirmed. Confirm it before booking.</p> : null}
    {canEdit && review ? <button className="crm-button mt-3" disabled={saving} onClick={() => void resolve(lead.moveDateConfirmation === 'unconfirmed')}>{saving ? 'Saving…' : lead.moveDateConfirmation === 'unconfirmed' ? 'Record confirmed move date' : 'Record review decision'}</button> : null}
    {error ? <p role="alert" className="mt-2 text-red-800">{error}</p> : null}
  </section>
}
