'use client'
import type { JobFactors, QuoteLineItem } from '@/lib/types'
import { DEFAULT_PACKING_PLAN, DEFAULT_TRUCK_HOLD, estimateServicePackage, replaceServicePackage, servicePackageIsStale, suggestedPackingBoxes, type PackingPlan } from '@/lib/estimate-services'

export function ServicePackagePanel({ factors, lines, onChange, onApply }: { factors: JobFactors; lines: QuoteLineItem[]; onChange: (factors: JobFactors) => void; onApply: (lines: QuoteLineItem[]) => void }) {
  const p = { ...DEFAULT_PACKING_PLAN, ...factors.packingPlan }
  const h = { ...DEFAULT_TRUCK_HOLD, ...factors.truckHold }
  const plan = estimateServicePackage(factors)
  const patch = (values: Partial<PackingPlan>) => { const next = { ...p, ...values }; onChange({ ...factors, packingPlan: next, ...(values.confirmed === true ? { estimatedBoxes: next.boxes, packingStatus: next.remaining === 'all' ? 'not-started' as const : 'partial' as const } : {}) }) }
  const number = (key: keyof PackingPlan, label: string, min = 0) => <label className="text-xs">{label}<input aria-label={label} type="number" min={min} value={Number(p[key])} onChange={e => patch({ [key]: Number(e.target.value) })} className="crm-input mt-1 w-full" /></label>
  return <section className="space-y-4 rounded-xl border border-[var(--app-line)] bg-white p-4" aria-label="Packing and service package">
    <div><h3 className="font-semibold">Build their service package</h3><p className="mt-1 text-xs text-[var(--app-muted)]">One customer price. Confirm the work here; labour, materials and margin stay internal.</p></div>
    <div className="flex flex-wrap gap-3">
      <label className="text-sm"><input type="checkbox" checked={p.pack} onChange={e => patch({ pack: e.target.checked, confirmed: false })}/> Packing</label>
      <label className="text-sm"><input type="checkbox" checked={p.materials} onChange={e => patch({ materials: e.target.checked, confirmed: false })}/> Supply materials</label>
      <label className="text-sm">Unpacking <select aria-label="Unpacking level" className="crm-input" value={p.unpack} onChange={e => patch({ unpack: e.target.value as PackingPlan['unpack'], confirmed: false })}><option value="none">None</option><option value="essentials">Essentials only</option><option value="all">All agreed boxes</option></select></label>
    </div>
    {(p.pack || p.materials || p.unpack !== 'none') && <>
      <div className="grid gap-3 sm:grid-cols-3">
        {number('bedrooms', 'Bedrooms (starting point)')}
        <label className="text-xs">How full?<select className="crm-input mt-1 w-full" value={p.fullness} onChange={e => patch({ fullness: e.target.value as PackingPlan['fullness'], confirmed: false })}><option value="light">Light</option><option value="typical">Typical</option><option value="full">Full</option></select></label>
        <label className="text-xs">Packing progress<select className="crm-input mt-1 w-full" value={p.remaining} onChange={e => patch({ remaining: e.target.value as PackingPlan['remaining'], confirmed: false })}><option value="all">Nothing packed</option><option value="half">About half packed</option><option value="mostly_packed">Mostly packed</option></select></label>
        <label className="text-xs sm:col-span-3">Rooms and contents included<input className="crm-input mt-1 w-full" value={p.rooms} onChange={e => patch({ rooms: e.target.value, confirmed: false })} placeholder="Kitchen cupboards, pantry, two bedrooms and closets…"/></label>
        {number('boxes', 'Remaining boxes to handle', 1)}{number('fragileBoxes', 'Of those, fragile boxes')}
        <button type="button" className="crm-button self-end" onClick={() => patch({ boxes: suggestedPackingBoxes(p), confirmed: false })}>Suggest box allowance</button>
      </div>
      <p className="text-xs text-[var(--app-muted)]">The suggested count is a starting estimate. Ask about cupboards, drawers, closets, books and fragile items; furniture photos alone do not establish packing scope.</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={p.confirmed} onChange={e => patch({ confirmed: e.target.checked })}/> Customer confirmed these rooms, remaining boxes and fragile contents</label>
    </>}
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs">Cleaning<select className="crm-input mt-1 w-full" value={p.cleaning} onChange={e => patch({ cleaning: e.target.value as PackingPlan['cleaning'] })}><option value="none">None</option><option value="move_out">Move-out</option><option value="move_in">Move-in</option><option value="both">Both homes</option></select></label>
      {p.cleaning !== 'none' && <><label className="text-xs">Agreed cleaning scope<input className="crm-input mt-1 w-full" value={p.cleaningScope} onChange={e => patch({ cleaningScope: e.target.value })} placeholder="Size, condition, cupboards/appliances included…"/></label>{number('cleaningCost', 'Cleaning supplier / labour cost', 1)}</>}
    </div>
    <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold">Internal cost assumptions</summary><p className="mt-2 text-xs">Planning defaults; confirm against your actual crew and supplier costs. Hours below are person-hours.</p><div className="mt-3 grid gap-3 sm:grid-cols-3">{number('loadedHourlyCost', 'Loaded labour cost / hour', 1)}{number('packMinutesPerBox', 'Packing minutes / box', 1)}{number('unpackMinutesPerBox', 'Unpacking minutes / box', 1)}{number('materialCostPerBox', 'Materials cost / box')}{number('setupCost', 'Additional setup / travel cost')}{number('contingencyPct', 'Service contingency %')}{number('marginPct', 'Target contribution %')}{number('feePct', 'Payment fee %')}</div></details>
    {(p.pack || p.unpack !== 'none' || p.materials || p.cleaning !== 'none' || h.status === 'confirmed') && <div className="rounded-lg bg-slate-50 p-3 text-sm"><div>Packing: {plan.packHours} person-hours · Unpacking: {plan.unpackHours} person-hours</div><div className="mt-1 font-semibold">Service package: ${plan.total.toLocaleString()} before HST</div><p className="mt-1 text-xs">Materials are a fixed agreed kit. Additional scope is reviewed before a price change.</p></div>}
    {plan.issues.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-800">{plan.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    {servicePackageIsStale(factors, lines) && <p role="status" className="text-xs font-semibold text-amber-800">Scope changed. Apply the updated package before previewing.</p>}
    <button type="button" disabled={plan.issues.length > 0} className="crm-button-dark disabled:opacity-50" onClick={() => onApply(replaceServicePackage(lines, factors))}>Apply service package</button>
  </section>
}
