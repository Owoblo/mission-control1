'use client'
import { useState } from 'react'
import type { CRMLead } from '@/lib/types'
import { lostTransitionError } from '@/lib/lead-verification'
import { NurtureDialog } from './nurture-dialog'
import { LOST_REASONS } from '@/lib/sales'

export function LostLeadDialog({ lead, onCancel, onSave, bulkCount }: { bulkCount?: number; lead: CRMLead; onCancel: () => void; onSave: (patch: Partial<CRMLead>) => Promise<void> }) {
  const [showNurture, setShowNurture] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const nurture = reason === 'timing' || reason === 'no_response'
  async function save() {
    if (nurture) { setShowNurture(true); return }
    const validation = nurture ? null : lostTransitionError({ ...lead, stage: 'new' }, { ...lead, stage: 'lost', lostReason: reason, lostNotes: note.trim() })
    if (validation) { setError(validation); return }
    setBusy(true); setError('')
    try { await onSave(nurture ? { stage: 'nurture', followUpNote: note.trim() || (reason === 'timing' ? 'Waiting for the customer’s move timing.' : 'Awaiting a customer response.') } : { stage: 'lost', lostReason: reason, lostNotes: note.trim() }) }
    catch(error) { setError(error instanceof Error ? error.message : 'Could not save stage change.') }
    finally { setBusy(false) }
  }
  if (showNurture) return <NurtureDialog lead={lead} onClose={onCancel} onSaved={() => { window.location.reload() }} />
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div role="dialog" aria-modal="true" aria-labelledby="lost-review-title" className="w-full max-w-md space-y-3 rounded-xl bg-white p-6">
    <h2 id="lost-review-title" className="text-lg font-semibold">{bulkCount ? `Review ${bulkCount} selected leads` : `Review ${lead.name}’s status`}</h2>
    <p className="text-sm">Record evidence of the loss. Waiting for a house sale, a date, or a reply belongs in Nurture.</p>
    {bulkCount && <p className="text-sm">The reason and evidence below apply to every selected lead. Close this dialog and select fewer leads if their reasons differ.</p>}
    <label className="block text-sm">Reason<select aria-label="Loss reason" className="crm-input mt-1 w-full" value={reason} onChange={event => setReason(event.target.value)}><option value="">Choose…</option>{LOST_REASONS.filter(item => !bulkCount || !['timing', 'no_response'].includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label className="block text-sm">Customer evidence<textarea className="crm-input mt-1 w-full" value={note} onChange={event => setNote(event.target.value)} placeholder="What did the customer say? Include the SMS, email, call date or other source." /></label>
    {nurture ? <p className="text-sm text-amber-800">This lead will stay active in Nurture, not Lost.</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onCancel} className="crm-button">Cancel</button><button type="button" disabled={busy || !reason || (!nurture && !note.trim())} onClick={() => void save()} className="crm-button-dark disabled:opacity-50">{busy ? 'Saving…' : nurture ? 'Move to Nurture' : 'Confirm Lost'}</button></div>
  </div></div>
}
