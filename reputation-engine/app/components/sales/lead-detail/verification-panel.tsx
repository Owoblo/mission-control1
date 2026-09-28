'use client'

import { useEffect, useState } from 'react'
import type { CRMLead } from '@/lib/types'
import { currentVerification, VERIFICATION_ITEMS, verificationScope, verificationSummary, type VerificationKey, type VerificationMethod, type VerificationStatus } from '@/lib/lead-verification'

const STATUS: Record<VerificationStatus, string> = { contacted: 'Contacted customer', verified: 'Verified', needs_follow_up: 'Needs follow-up', not_applicable: 'Not applicable' }
const METHODS: Record<VerificationMethod, string> = { call: 'Phone call', sms: 'SMS', email: 'Email', photos_video: 'Photos / video', maps: 'Maps / address check', in_person: 'In person', internal: 'Internal review' }

export function VerificationPanel({ lead, draftLead, onSaved, onEditDetails, readOnly = false }: { lead: CRMLead; draftLead?: CRMLead; onSaved: (lead: CRMLead) => void; onEditDetails?: (key: VerificationKey) => void; readOnly?: boolean }) {
  const [historicalStages, setHistoricalStages] = useState<CRMLead['stageHistory']>([])
  const [historyError, setHistoryError] = useState('')
  const [selected, setSelected] = useState<VerificationKey | null>(null)
  const [status, setStatus] = useState<VerificationStatus>('verified')
  const [method, setMethod] = useState<VerificationMethod>('call')
  const [note, setNote] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setSelected(null); setError(''); setHistoricalStages([]); setHistoryError('')
    const controller = new AbortController()
    fetch(`/api/sales/leads/${lead.id}/verifications`, { credentials: 'include', signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'History unavailable'); return result })
      .then(result => setHistoricalStages(result.stageHistory || []))
      .catch(error => { if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : 'History unavailable') })
    return () => controller.abort()
  }, [lead.id])
  const stages = [...(historicalStages || []).filter(entry => !(lead.stageHistory || []).some(current => current.id === entry.id || current.from === entry.from && current.to === entry.to && Math.abs(Date.parse(current.at)-Date.parse(entry.at)) < 10000)), ...(lead.stageHistory || [])]
  const summary = verificationSummary(lead)
  const unsaved = selected && draftLead && verificationScope(draftLead, selected) !== verificationScope(lead, selected)
  function open(key: VerificationKey) { setSelected(key); setNote(''); setFollowUpDate(''); setStatus('verified'); setError('') }
  async function save() {
    if (!selected || busy || unsaved) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/sales/leads/${lead.id}/verifications`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: selected, status, method, note, followUpDate: followUpDate || undefined, scope: verificationScope(lead, selected) }) })
      const result = await response.json()
      if (!response.ok || !result.lead) throw new Error(result.error || 'Could not save verification.')
      onSaved(result.lead); setSelected(null)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save verification.') }
    finally { setBusy(false) }
  }
  return <details id="verification-workspace" className="rounded-lg border border-[var(--app-line)] bg-white p-4">
    <summary className="cursor-pointer text-sm font-semibold">Verification & follow-up · {summary.latest ? `${summary.verified} checks confirmed` : 'No checks recorded yet'}{summary.followUp ? ` · ${summary.followUp} need review` : ''}</summary>
    <p className="mt-2 text-xs text-[var(--app-muted)]">Record what was checked, how, and what happens next. Save changed move details before verifying them.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {VERIFICATION_ITEMS.map(item => {
        const { entry, stale } = currentVerification(lead, item.key)
        return <div key={item.key} className="rounded border border-[var(--app-line)] p-3">
          <div className="flex items-start justify-between gap-2"><strong className="text-xs">{item.label}</strong><span className={`text-xs ${stale || entry?.status === 'needs_follow_up' ? 'text-amber-700' : entry?.status === 'verified' ? 'text-emerald-700' : 'text-[var(--app-muted)]'}`}>{stale ? 'Details changed — recheck' : entry ? STATUS[entry.status] : 'Not recorded'}</span></div>
          <p className="mt-1 text-xs text-[var(--app-muted)]">{item.hint}</p>
          {entry ? <p className="mt-2 text-xs">{entry.note}<span className="mt-1 block text-[var(--app-muted)]">{entry.actorName} · {new Date(entry.recordedAt).toLocaleString()} · {METHODS[entry.method]}{entry.followUpDate ? ` · Follow up ${entry.followUpDate}` : ''}</span></p> : null}
          {!readOnly ? <div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => open(item.key)} className="crm-button text-xs">Record / update</button>{onEditDetails ? <button type="button" onClick={() => onEditDetails(item.key)} className="text-xs underline">Edit move details</button> : null}</div> : null}
        </div>
      })}
    </div>
    {selected ? <div className="mt-3 space-y-3 rounded border border-sky-200 bg-sky-50 p-3">
      <strong className="text-sm">{VERIFICATION_ITEMS.find(item => item.key === selected)?.label}</strong>
      {unsaved ? <p role="alert" className="text-xs text-amber-800">Save your estimate changes first, then record verification of the saved details.</p> : null}
      <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs">Result<select className="crm-input mt-1 w-full" value={status} onChange={event => setStatus(event.target.value as VerificationStatus)}>{Object.entries(STATUS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs">Evidence source<select className="crm-input mt-1 w-full" value={method} onChange={event => setMethod(event.target.value as VerificationMethod)}>{Object.entries(METHODS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <label className="block text-xs">What was confirmed or discovered?<textarea className="crm-input mt-1 w-full" maxLength={4000} value={note} onChange={event => setNote(event.target.value)} placeholder="Customer confirmed by phone… / Waiting for… / Complication found…" /></label>
      <label className="block text-xs">Follow-up date (optional)<input className="crm-input ml-2" type="date" value={followUpDate} onChange={event => setFollowUpDate(event.target.value)} /></label>
      {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
      <div className="flex gap-2"><button type="button" disabled={busy || !note.trim() || Boolean(unsaved)} onClick={() => void save()} className="crm-button-dark text-xs disabled:opacity-50">{busy ? 'Saving…' : 'Save verification'}</button><button type="button" disabled={busy} onClick={() => setSelected(null)} className="crm-button text-xs">Cancel</button></div>
    </div> : null}
    <details className="mt-3 text-xs"><summary className="cursor-pointer font-semibold">Verification and stage history</summary>{historyError ? <p role="status" className="mt-2 text-amber-700">{historyError}</p> : null}<ul className="mt-2 space-y-2">{[...(lead.verificationHistory || []).map(entry => ({ at: entry.recordedAt, id: entry.id, text: `${VERIFICATION_ITEMS.find(item => item.key === entry.key)?.label}: ${STATUS[entry.status]} — ${entry.note} · ${METHODS[entry.method]} · ${entry.actorName}` })), ...stages.map(entry => ({ at: entry.at, id: entry.id, text: `Stage ${entry.from} → ${entry.to} · ${entry.actorName} (${entry.source})${entry.reason ? ` · ${entry.reason}` : ''}${entry.evidence ? ` · ${entry.evidence}` : ''}` }))].sort((a,b) => b.at.localeCompare(a.at)).map(entry => <li key={entry.id}>{new Date(entry.at).toLocaleString()} — {entry.text}</li>)}</ul>{!lead.verificationHistory?.length && !stages.length ? <p className="mt-2">New verification and stage decisions will appear here. Earlier activity remains in the timeline.</p> : null}</details>
  </details>
}
