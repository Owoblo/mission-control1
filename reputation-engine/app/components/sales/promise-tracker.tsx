'use client'

import { useState } from 'react'
import type { CRMLead, PromiseChannel } from '@/lib/types'

export function PromiseTracker({ lead, onUpdated }: { lead: CRMLead; onUpdated: (lead: CRMLead) => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ action: '', reason: '', channel: 'email' as PromiseChannel, dueAt: '', intendedOutcome: '' })
  const promises = (lead.promises || []).filter(item => item.status === 'open').sort((a, b) => a.dueAt.localeCompare(b.dueAt))

  async function send(body: object) {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/sales/leads/${lead.id}/promises`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const payload = await response.json() as { lead?: CRMLead; error?: string }
      if (!response.ok || !payload.lead) throw new Error(payload.error || 'Promise could not be saved.')
      onUpdated(payload.lead)
      return true
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Promise could not be saved.'); return false }
    finally { setBusy(false) }
  }

  async function create() {
    if (await send(form)) { setForm({ action: '', reason: '', channel: 'email', dueAt: '', intendedOutcome: '' }); setOpen(false) }
  }
  async function complete(id: string) {
    const evidence = window.prompt('What confirms this promise was completed?')?.trim()
    if (evidence) await send({ promiseId: id, completionEvidence: evidence })
  }

  return <section className={`border-x border-b border-[var(--app-line)] bg-white px-5 md:px-7 ${promises.length || open ? 'py-4' : 'py-3'}`}>
    <div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-baseline gap-2"><h2 className="text-sm font-semibold text-[#071421]">Promises</h2>{!open ? <span className="truncate text-xs text-[var(--app-muted)]">{promises.length ? `${promises.length} open commitment${promises.length === 1 ? '' : 's'}` : 'None open'}</span> : null}</div><button type="button" onClick={() => setOpen(value => !value)} className="crm-button">{open ? 'Cancel' : 'Add promise'}</button></div>
    {promises.length > 0 ? <div className="mt-3 divide-y divide-[var(--app-line)] border-t border-[var(--app-line)]">{promises.map(item => <div key={item.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-[#071421]">{item.action}</div><div className="mt-1 text-xs text-[var(--app-muted)]">{item.reason} · {item.channel.replace('_', ' ')} · Due {new Date(item.dueAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {item.ownerName}</div><div className="mt-1 text-xs text-[#344054]">Outcome: {item.intendedOutcome}</div></div><button type="button" disabled={busy} onClick={() => void complete(item.id)} className="crm-button">Complete</button></div>)}</div> : null}
    {open ? <div className="mt-4 grid gap-3 border-t border-[var(--app-line)] pt-4 md:grid-cols-2"><label className="text-xs font-semibold text-[#344054]">Action<input aria-label="Promise action" value={form.action} onChange={event => setForm(value => ({ ...value, action: event.target.value }))} className="crm-input mt-1" /></label><label className="text-xs font-semibold text-[#344054]">Reason<input aria-label="Promise reason" value={form.reason} onChange={event => setForm(value => ({ ...value, reason: event.target.value }))} className="crm-input mt-1" /></label><label className="text-xs font-semibold text-[#344054]">Channel<select aria-label="Promise channel" value={form.channel} onChange={event => setForm(value => ({ ...value, channel: event.target.value as PromiseChannel }))} className="crm-input mt-1"><option value="email">Email</option><option value="sms">SMS</option><option value="call">Call</option><option value="in_person">In person</option><option value="internal">Internal</option></select></label><label className="text-xs font-semibold text-[#344054]">Due date and time<input aria-label="Promise due date and time" type="datetime-local" value={form.dueAt} onChange={event => setForm(value => ({ ...value, dueAt: event.target.value }))} className="crm-input mt-1" /></label><label className="text-xs font-semibold text-[#344054] md:col-span-2">Intended outcome<input aria-label="Promise intended outcome" value={form.intendedOutcome} onChange={event => setForm(value => ({ ...value, intendedOutcome: event.target.value }))} className="crm-input mt-1" /></label><div className="md:col-span-2 flex items-center justify-between gap-3">{error ? <div role="alert" className="text-sm text-rose-700">{error}</div> : <span />}<button type="button" disabled={busy} onClick={() => void create()} className="crm-button-dark">{busy ? 'Saving…' : 'Save promise'}</button></div></div> : null}
  </section>
}
