'use client'

import { useState } from 'react'
import type { CRMLead, CRMQuote } from '@/lib/types'
import { buildMoveOperatingPlan } from '@/lib/move-operating-plan'
import { needsItemAssembly, type AssemblyInstructions } from '@/lib/assembly-planning'
import { outcomeReviewReasons, type OperationalOutcome } from '@/lib/move-outcome'

function localDateTime(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function OperatingPlanPanel({ lead, quote, onSaved }: { lead: CRMLead; quote?: CRMQuote | null; onSaved?: (lead: CRMLead) => void }) {
  const plan = buildMoveOperatingPlan(lead, quote)
  const [message, setMessage] = useState('')
  return <div><OperatingPlanEditor key={plan.fingerprint + (lead.operatingReview?.reviewedAt || '') + (lead.operationalOutcome?.revision || 0)} lead={lead} quote={quote} onSaved={onSaved} setMessage={setMessage} />
    {message && <p role="status" className="mt-3 text-sm font-medium">{message}</p>}</div>
}

function OperatingPlanEditor({ lead, quote, onSaved, setMessage }: { lead: CRMLead; quote?: CRMQuote | null; onSaved?: (lead: CRMLead) => void; setMessage: (message: string) => void }) {
  const plan = buildMoveOperatingPlan(lead, quote)
  const [truck, setTruck] = useState(lead.truckSize || quote?.truckSize || plan.truckPlan?.trucks[0]?.size || '')
  const [origin, setOrigin] = useState(lead.originAccess || '')
  const [destination, setDestination] = useState(lead.destAccess || '')
  const [parking, setParking] = useState(lead.parkingNotes || '')
  const [time, setTime] = useState(lead.moveTime || quote?.moveTime || '')
  const [hours, setHours] = useState(String(plan.plannedHours || ''))
  const [rationale, setRationale] = useState(lead.operatingReview?.rationale || '')
  const [items, setItems] = useState((lead.inventory || []).map((item, index) => ({ ...item, id: item.id || `item-${index}` })).filter(item => needsItemAssembly(item) || item.assembly).map(item => ({
    id: item.id!, name: item.name || item.item || 'Item', notes: item.notes || '',
    assembly: item.assembly || { responsibility: 'crew', originMinutes: plan.assembly.tasks.find(t => t.itemKey === item.id && t.end === 'origin')?.minutes! / (item.qty || 1) || 0,
      destinationMinutes: plan.assembly.tasks.find(t => t.itemKey === item.id && t.end === 'destination')?.minutes! / (item.qty || 1) || 0,
      workers: plan.assembly.tasks.find(t => t.itemKey === item.id)?.workers || 1, evidence: '', tools: '' } as AssemblyInstructions,
  })))
  const [initialItems] = useState(items)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Partial<OperationalOutcome>>(lead.operationalOutcome || {})
  const editItem = (id: string, patch: Partial<AssemblyInstructions>) => setItems(current => current.map(item => item.id === id ? { ...item, assembly: { ...item.assembly, ...patch } } : item))
  async function save(approve: boolean) {
    setBusy(true); setMessage('')
    try {
      if (items.some(item => !item.assembly.evidence.trim() && JSON.stringify(item.assembly) !== JSON.stringify(initialItems.find(initial => initial.id === item.id)?.assembly))) throw new Error('Add evidence for changed assembly instructions before saving.')
      const response = await fetch(`/api/sales/leads/${lead.id}/planning`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        fingerprint: plan.fingerprint, approve, truckSize: truck || undefined, originAccess: origin, destAccess: destination, parkingNotes: parking, moveTime: time || undefined,
        plannedHours: Number(hours), rationale,
        items: items.map(item => ({ id: item.id, notes: item.notes, assembly: item.assembly.evidence.trim() ? item.assembly : undefined })),
      }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save plan.')
      onSaved?.(data.lead); setMessage(approve ? 'Operations review recorded for this plan.' : 'Planning details saved; review status recalculated.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed.') } finally { setBusy(false) }
  }
  async function saveOutcome() {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/sales/leads/${lead.id}/outcome`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operational: outcome, expectedRevision: lead.operationalOutcome?.revision || 0 }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save actuals.')
      onSaved?.(data.lead); setMessage(data.warning || 'Actuals saved. Customer pricing is unchanged.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed.') } finally { setBusy(false) }
  }
  return <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-slate-900">
    <h3 className="font-semibold">Operating plan · {plan.ready ? 'Reviewed' : 'Needs review'}</h3>
    {lead.operationalOutcomeReportingPending && <p className="mt-2 font-semibold text-amber-900">Actuals are saved. Reporting sync is pending; save actuals again to retry.</p>}
    <p className="mt-1">{plan.truckPlan?.summary || 'No moving truck'} · Assembly {plan.assembly.hours}h · {plan.plannedHours || '?'}h working plan</p>
    {plan.reasons.length > 0 && <ul className="my-2 list-disc space-y-1 pl-5">{plan.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    {lead.operatingReview && !plan.reviewCurrent && <p className="font-semibold text-red-700">The previously reviewed plan changed. Operations must review it again.</p>}
    <details className="mt-3"><summary className="cursor-pointer font-semibold">Review truck, access and assembly</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {plan.truckPlan && <label>Selected truck<select aria-label="Selected truck" className="crm-input w-full" value={truck} onChange={e => setTruck(e.target.value)}>{['10ft', '15ft', '20ft', '26ft'].map(size => <option key={size}>{size}</option>)}</select></label>}
        <label>Move start time<input type="time" className="crm-input w-full" value={time} onChange={e => setTime(e.target.value)} /></label>
        <label>Origin carrying route<input className="crm-input w-full" value={origin} onChange={e => setOrigin(e.target.value)} placeholder="Floors, stairs/walkout, turns, carry distance" /></label>
        <label>Destination carrying route<input className="crm-input w-full" value={destination} onChange={e => setDestination(e.target.value)} placeholder="Floors, stairs/elevator, placement" /></label>
        <label>Parking / truck-to-door distance<input className="crm-input w-full" value={parking} onChange={e => setParking(e.target.value)} /></label>
        <label>Operational crew-clock hours<input type="number" min="0.25" step="0.25" className="crm-input w-full" value={hours} onChange={e => setHours(e.target.value)} /></label>
      </div>
      <p className="my-3 text-xs">Assembly allowances are provisional until supported by a model, photos, instructions or an operations assessment. Minutes are per item at each end. Tasks are budgeted sequentially; do not divide them by crew size.</p>
      {items.map(item => <fieldset key={item.id} className="my-3 rounded-lg border border-amber-200 bg-white p-3">
        <legend className="font-semibold">{item.name}</legend>
        <label>Mechanism and handling details<input className="crm-input w-full" value={item.notes} onChange={e => setItems(current => current.map(i => i.id === item.id ? { ...i, notes: e.target.value } : i))} /></label>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <label>Responsibility<select className="crm-input w-full" value={item.assembly.responsibility} onChange={e => editItem(item.id, { responsibility: e.target.value as AssemblyInstructions['responsibility'] })}><option value="crew">Crew</option><option value="customer">Customer</option><option value="not_required">Not required</option></select></label>
          <label>Disassemble (min)<input type="number" min="0" className="crm-input w-full" value={item.assembly.originMinutes} onChange={e => editItem(item.id, { originMinutes: Number(e.target.value) })} /></label>
          <label>Reassemble (min)<input type="number" min="0" className="crm-input w-full" value={item.assembly.destinationMinutes} onChange={e => editItem(item.id, { destinationMinutes: Number(e.target.value) })} /></label>
          <label>Workers<input type="number" min="1" className="crm-input w-full" value={item.assembly.workers} onChange={e => editItem(item.id, { workers: Number(e.target.value) })} /></label>
        </div>
        <label>Evidence / model / assessment<input className="crm-input mt-2 w-full" value={item.assembly.evidence} onChange={e => editItem(item.id, { evidence: e.target.value })} /></label>
        <label>Tools and instructions<input className="crm-input mt-2 w-full" value={item.assembly.tools || ''} onChange={e => editItem(item.id, { tools: e.target.value })} /></label>
      </fieldset>)}
      <label>Operations decision<textarea className="crm-input my-2 w-full" rows={3} value={rationale} onChange={e => setRationale(e.target.value)} placeholder="How truck fit, assembly, access, staffing and time concerns were resolved. Document conservative allowances for remaining uncertainty." /></label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void save(false)} className="crm-button">Save planning details</button><button type="button" disabled={busy} onClick={() => void save(true)} className="crm-button-dark">Record operations approval</button></div>
      <p className="mt-2 text-xs">Approval requires operations or manager access and applies only to this version of the plan.</p>
    </details>
    {['booked', 'completed', 'customer_success'].includes(lead.stage) && <details className="mt-4"><summary className="cursor-pointer font-semibold">Actuals and operational learning · {lead.operationalOutcome?.reviewStatus || 'pending'}</summary>
      <ul className="my-2 list-disc pl-5">{outcomeReviewReasons(quote?.estimatedHours, lead.operationalOutcome).map(reason => <li key={reason}>{reason}</li>)}</ul>
      <p className="my-2 text-xs">This records performance and findings. It does not change customer charges. Do not infer work finish from payment time.</p>
      <div className="mb-2 grid gap-2 sm:grid-cols-2">{(['startedAt', 'finishedAt'] as const).map(key => <label key={key}>{key === 'startedAt' ? 'Work started (local time)' : 'Work finished (local time)'}<input type="datetime-local" className="crm-input w-full" value={localDateTime(outcome[key])} onChange={e => setOutcome({ ...outcome, [key]: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /></label>)}</div>
      <div className="grid gap-2 sm:grid-cols-2">{(['actualHours', 'actualCrew', 'breakMinutes', 'truckSwapMinutes'] as const).map(key => <label key={key}>{({ actualHours: 'Actual working hours', actualCrew: 'Actual movers', breakMinutes: 'Break minutes', truckSwapMinutes: 'Truck swap minutes' })[key]}<input className="crm-input w-full" type="number" min="0" step={key === 'actualHours' ? '0.25' : '1'} value={outcome[key] ?? ''} onChange={e => setOutcome({ ...outcome, [key]: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>)}
        <label>Actual truck<input className="crm-input w-full" value={outcome.actualTruck || ''} onChange={e => setOutcome({ ...outcome, actualTruck: e.target.value })} placeholder="26ft, two trucks, or no truck" /></label>
        <label>Review status<select className="crm-input w-full" value={outcome.reviewStatus || 'pending'} onChange={e => setOutcome({ ...outcome, reviewStatus: e.target.value as OperationalOutcome['reviewStatus'] })}><option value="pending">Pending operations review</option><option value="reviewed">Reviewed by operations</option></select></label>
      </div>
      {items.map(item => { const actual = outcome.assemblyActuals?.find(a => a.item === item.name); return <div key={item.id} className="mt-2"><span>{item.name}: actual disassembly / reassembly minutes / workers</span><div className="grid grid-cols-3 gap-2">{(['originMinutes', 'destinationMinutes', 'workers'] as const).map(key => <input key={key} aria-label={`${item.name} actual ${key}`} className="crm-input" type="number" min="0" value={actual?.[key] ?? ''} onChange={e => setOutcome({ ...outcome, assemblyActuals: [...(outcome.assemblyActuals || []).filter(a => a.item !== item.name), { item: item.name, originMinutes: actual?.originMinutes || 0, destinationMinutes: actual?.destinationMinutes || 0, workers: actual?.workers || 1, [key]: Number(e.target.value) }] })} />)}</div></div> })}
      {(['inventoryChanges', 'cause', 'correctiveAction'] as const).map(key => <label key={key} className="mt-2 block">{({ inventoryChanges: 'Actual inventory changes (separate from underestimated known items)', cause: 'Findings and cause', correctiveAction: 'Corrective action and owner' })[key]}<textarea className="crm-input w-full" value={outcome[key] || ''} onChange={e => setOutcome({ ...outcome, [key]: e.target.value })} /></label>)}
      <button type="button" disabled={busy} className="crm-button-dark mt-2" onClick={() => void saveOutcome()}>Save actuals and findings</button>
    </details>}
  </section>
}
