'use client'
import { useState } from 'react'
import { fetchWithReadDeadline } from '@/lib/resilient-read'
import { storageVolumeScenario, type buildLinkedMovePlan } from '@/lib/linked-move-plan'
import type { comparePickupRoutes } from '@/lib/pickup-route-plan'

type Plan = ReturnType<typeof buildLinkedMovePlan>
type Routes = { options: ReturnType<typeof comparePickupRoutes>; resolved: string[]; note: string; truck: string | null; capacity: number | null }
export function LinkedLogisticsPanel({ leadId, jobs }: { leadId: string; jobs: { id: string; label: string; kind: string }[] }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [routes, setRoutes] = useState<Routes | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [height, setHeight] = useState('')
  const [fullness, setFullness] = useState('')
  const [width, setWidth] = useState('5')
  const [depth, setDepth] = useState('10')
  const [instructions, setInstructions] = useState('')
  const [hours, setHours] = useState('')
  const sameMove = jobs.filter(j => j.kind === 'supplement')
  async function load() {
    setBusy(true); setError('')
    try {
      const response = await fetchWithReadDeadline(`/api/sales/leads/${leadId}/linked-plan`, { cache: 'no-store' })
      const data = await response.json(); if (!response.ok) throw new Error(data.error)
      setPlan(data.plan)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  async function compare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setRoutes(null)
    const body = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const response = await fetch(`/api/sales/leads/${leadId}/pickup-options`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000), body: JSON.stringify(body) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error)
      setRoutes(data)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  async function approve() {
    if (!plan) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/sales/leads/${leadId}/linked-plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(25000), body: JSON.stringify({ fingerprint: plan.fingerprint, instructions, plannedHours: Number(hours) }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error)
      await load()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  let scenario: number | null = null
  try { scenario = storageVolumeScenario(Number(width), Number(depth), Number(height), Number(fullness)) } catch { /* missing inputs remain unknown */ }
  if (!sameMove.length) return null
  return <details className="border-t pt-3"><summary className="cursor-pointer text-sm font-semibold">Combined move logistics</summary>
    <div className="mt-3 space-y-3 text-xs">
      <p>Compare pickup order while planning. Only customer-approved additions enter the crew plan; a changed plan needs a new operations review.</p>
      <button disabled={busy} className="crm-button w-full justify-center" onClick={() => void load()}>{busy ? 'Checking…' : 'Review combined load & crew plan'}</button>
      {plan && <div className="space-y-2 rounded border bg-white p-2">
        <p><strong>{plan.volume} cu ft · {plan.weight} lb</strong> in the original move plus approved additions.</p>
        <p>{plan.truck.summary}: {plan.truck.totalUsableCubicFeet} cu ft usable planning capacity; {Math.max(0, plan.truck.totalUsableCubicFeet - plan.volume)} cu ft remaining. Actual vehicle limits must be verified.</p>
        <p>{plan.pending.length} additional request(s) awaiting customer approval; excluded from this crew load.</p>
        {plan.reasons.map(reason => <p key={reason} className="text-red-700">{reason}</p>)}
        <p className="font-semibold">{plan.approved.length ? plan.ready ? 'Combined operations review is current' : 'Combined operations review required' : 'No approved additions yet'}</p>
        {plan.approved.length > 0 && <>
          <label className="block">Stop order, loading sequence, time windows, access and crew instructions<textarea className="crm-input w-full" value={instructions} onChange={e => setInstructions(e.target.value)} /></label>
          <label className="block">Total operational hours<input type="number" min="0.25" step="0.25" className="crm-input w-full" value={hours} onChange={e => setHours(e.target.value)} /></label>
          <button disabled={busy || plan.reasons.length > 0} className="crm-button w-full" onClick={() => void approve()}>Record combined operations review</button>
        </>}
      </div>}
      <form onSubmit={compare} className="space-y-2">
        <label className="block">Additional pickup to compare<select name="additionalLeadId" className="crm-input w-full">{sameMove.map(j => <option key={j.id} value={j.id}>{j.label}</option>)}</select></label>
        <label className="block">Truck departure and return address<input required name="yard" className="crm-input w-full" placeholder="Actual depot address, including city" /></label>
        <button disabled={busy} className="crm-button w-full justify-center">Compare pickup orders</button>
      </form>
      {routes && <div className="space-y-2">
        <p>Check resolved locations: {routes.resolved.join(' · ')}</p>
        {routes.options.map(option => <div key={option.label} className="rounded border bg-white p-2"><strong>{option.label}</strong><p>{option.complete ? `${option.distanceKm} km · ${option.driveHours} driving hours` : 'Route incomplete — cannot compare reliably'}</p><p>Peak load {option.peakCubicFeet} cu ft / {option.peakWeightLbs} lb · {option.capacityStatus === 'fits' ? 'Within planning capacity' : option.capacityStatus === 'exceeds' ? 'Exceeds selected capacity' : 'Truck fit unverified'}</p></div>)}
        <p>{routes.note}</p>
      </div>}
      <details><summary className="cursor-pointer font-semibold">Storage volume scenario</summary>
        <p className="my-2">Floor area is not inventory. Enter observed stack height and fullness for a rough occupied-space scenario; it does not change verified inventory or prove truck fit.</p>
        <div className="grid grid-cols-2 gap-2">{([['Width (ft)', width, setWidth], ['Depth (ft)', depth, setDepth], ['Stack height (ft)', height, setHeight], ['Fullness (%)', fullness, setFullness]] as const).map(([label, value, setter]) => <label key={label}>{label}<input type="number" min="0" step="any" className="crm-input w-full" value={value} onChange={e => setter(e.target.value)} /></label>)}</div>
        <p>{scenario === null ? 'Height and fullness are still unknown.' : `Scenario: ${scenario} cu ft of occupied storage space. Truck packing, item weights and non-stackable pieces still need review.`}</p>
      </details>
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>
  </details>
}
