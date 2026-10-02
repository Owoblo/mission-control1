'use client'
import { useState } from 'react'
import type { CRMLead } from '@/lib/types'
import { calendarDate } from '@/lib/nurture-policy'

export function NurtureDialog({ lead, onClose, onSaved }: { lead: CRMLead; onClose: () => void; onSaved: (lead: CRMLead) => void }) {
  const [moveDate, setMoveDate] = useState(lead.moveDate || '')
  const [interval, setInterval] = useState(lead.nurtureIntervalDays || 14)
  const [windowDays, setWindowDays] = useState(lead.nurtureReturnWindowDays ?? 30)
  const [nextDate, setNextDate] = useState(lead.followUpDate || '')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(checkIn = false, returnNow = false) {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/sales/leads/${lead.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        stage: returnNow ? 'contacted' : 'nurture', moveDate, nurtureIntervalDays: interval, nurtureReturnWindowDays: windowDays,
        ...(returnNow ? { followUpDate: calendarDate(), followUpStatus: 'pending' } : nextDate ? { followUpDate: nextDate } : {}),
        ...(checkIn ? { nurtureCheckInNote: notes } : {}),
      }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save Nurture settings.')
      onSaved(data); onClose()
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save.') }
    finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"><div role="dialog" aria-modal="true" aria-label="Nurture settings" className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-auto rounded-xl bg-white p-6 text-slate-900">
    <h2 className="text-lg font-semibold">{lead.stage === 'nurture' ? 'Nurture check-in' : 'Move to Nurture'} — {lead.name}</h2>
    <label className="block text-sm">Expected move date<input required type="date" min={calendarDate()} value={moveDate} onChange={e => setMoveDate(e.target.value)} className="crm-input mt-1 w-full" /></label>
    <label className="block text-sm">Check-in interval<select value={[14,30].includes(interval) ? interval : 'custom'} onChange={e => setInterval(e.target.value === 'custom' ? 21 : Number(e.target.value))} className="crm-input mt-1 w-full"><option value="14">Every 2 weeks</option><option value="30">Every 30 days</option><option value="custom">Custom</option></select><input aria-label="Check-in interval in days" type="number" min="1" max="365" value={interval} onChange={e => setInterval(Number(e.target.value))} className="crm-input mt-1 w-full" /></label>
    <label className="block text-sm">Return to Follow-Up this many days before the move<input type="number" min="0" max="365" value={windowDays} onChange={e => setWindowDays(Number(e.target.value))} className="crm-input mt-1 w-full" /></label>
    {lead.stage === 'nurture' && <>
      <label className="block text-sm">Next check-in date<input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} className="crm-input mt-1 w-full" /></label>
      <label className="block text-sm">Check-in notes<textarea value={notes} onChange={e => setNotes(e.target.value)} className="crm-input mt-1 w-full" placeholder="What did you discuss?" /></label>
      <button disabled={busy || !notes.trim()} onClick={() => void save(true)} className="crm-button-dark disabled:opacity-50">Log check-in & schedule next</button>
      <p className="text-xs text-slate-500">Logging a check-in schedules the next reminder {interval} days from today.</p>
      {(lead.nurtureCheckIns || []).slice().reverse().map(entry => <div key={entry.id} className="rounded border p-2 text-sm"><div>{new Date(entry.at).toLocaleString()} · {entry.actorName}</div><p>{entry.notes}</p></div>)}
      <button disabled={busy} onClick={() => void save(false, true)} className="crm-button">Return to Follow-Up now</button>
    </>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex justify-end gap-2"><button disabled={busy} onClick={onClose} className="crm-button">Cancel</button><button disabled={busy || !moveDate} onClick={() => void save()} className="crm-button-dark disabled:opacity-50">{busy ? 'Saving…' : lead.stage === 'nurture' ? 'Save settings' : 'Move to Nurture'}</button></div>
  </div></div>
}
