'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { FOLLOW_UP_REASONS, torontoDay, type FollowUpPlan, type FollowUpReason, type radarState } from '@/lib/follow-up-radar'
type Row = { id: string; name?: string; phone?: string; stage: string; followUpPlan?: FollowUpPlan; canEdit: boolean; state: ReturnType<typeof radarState> }
type Opportunity = { id: string; name: string; stage: string; next_action?: string; next_action_due?: string; assigned_manager_name?: string }
export default function FollowUpRadarPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('all'); const [queue, setQueue] = useState('due'); const [search, setSearch] = useState('')
  const [owner, setOwner] = useState('all'); const [actor, setActor] = useState('')
  const [editing, setEditing] = useState<Row | null>(null); const [plan, setPlan] = useState<FollowUpPlan | null>(null); const [busy, setBusy] = useState(false)
  async function load() {
    try { const r = await fetch('/api/sales/follow-up-radar', { cache: 'no-store' }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setRows(d.leads); setOpportunities(d.opportunities); setActor(d.actor || '') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load follow-ups.') } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  function edit(row: Row) {
    setEditing(row); setPlan(row.followUpPlan || { reason: 'needs_review', policy: 'internal_only', ownerName: row.state.ownerName === 'Unassigned' ? actor : row.state.ownerName,
      reviewOn: torontoDay(), nextAction: '', evidence: '', reviewedAt: '', reviewedBy: '' }); setError('')
  }
  async function save() {
    if (!editing || !plan) return
    setBusy(true)
    try { const r = await fetch('/api/sales/follow-up-radar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing.id, plan, previousReviewedAt: editing.followUpPlan?.reviewedAt || null, previousActivityAt: editing.state.lastActivity }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setEditing(null); setPlan(null); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }
  const filtered = rows.filter(r => (queue !== 'due' || r.state.due) && (category === 'all' || r.state.reason === category) && (owner === 'all' || r.state.ownerName === owner) && `${r.name} ${r.phone} ${r.followUpPlan?.evidence || ''}`.toLowerCase().includes(search.toLowerCase()))
  return <main className="mx-auto max-w-6xl space-y-5 p-4">
    <h1 className="text-2xl font-semibold">Follow-up radar</h1>
    <p>Review at 9 a.m. and 4 p.m. Toronto. Every opportunity needs an owner, a next action and a review date. Read the latest conversation before contacting.</p>
    <div className="flex flex-wrap gap-4 text-sm"><strong>{rows.filter(r => r.state.due).length} reviews due</strong><span>{rows.filter(r => r.state.reason === 'needs_review').length} need categorizing</span><span>{rows.filter(r => r.state.ownerName === 'Unassigned').length} unassigned</span><Link className="underline" href="/sales/follow-up">Follow-up wall</Link><Link className="underline" href="/sales/tasks">Tasks</Link><button className="underline" onClick={() => void load()}>Refresh</button></div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <select aria-label="Review queue" className="crm-input" value={queue} onChange={e => setQueue(e.target.value)}><option value="due">Due / new activity</option><option value="all">All retained opportunities</option></select>
      <select aria-label="Category" className="crm-input" value={category} onChange={e => setCategory(e.target.value)}><option value="all">All categories</option>{Object.entries(FOLLOW_UP_REASONS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select aria-label="Owner" className="crm-input" value={owner} onChange={e => setOwner(e.target.value)}><option value="all">All owners</option>{Array.from(new Set(rows.map(r => r.state.ownerName))).sort().map(o => <option key={o}>{o}</option>)}</select>
      <input aria-label="Search" placeholder="Search names, phone or context" className="crm-input" value={search} onChange={e => setSearch(e.target.value)} />
    </div>
    {loading ? <p>Loading conversations to review…</p> : <p className="text-sm">{filtered.length} records. A review due is not automatically permission to call. Confirmed outcomes and customer preferences take precedence.</p>}
    <div className="grid gap-3 md:grid-cols-2">{filtered.map(r => <article key={r.id} className="rounded-xl border bg-white p-4 space-y-2">
      <Link className="font-semibold underline" href={`/sales/leads/${r.id}`}>{r.name || r.phone || 'Unnamed enquiry'}</Link><p className="text-sm">{r.phone} · {r.state.ownerName}</p>
      <p className="font-medium">{FOLLOW_UP_REASONS[r.state.reason]}</p><p className="text-sm">Review: {r.state.reviewOn} · {r.followUpPlan?.policy?.replaceAll('_',' ') || 'Internal triage'}</p>
      <p>{r.state.instruction}</p>{r.followUpPlan && r.state.instruction !== r.followUpPlan.nextAction && <p className="text-sm">Recorded next step: {r.followUpPlan.nextAction}</p>}{r.followUpPlan && <p className="text-sm text-gray-600">Context: {r.followUpPlan.evidence}</p>}
      <p className="text-sm font-medium text-amber-800">{r.state.flags.join(' · ')}</p>
      {(r.followUpPlan?.policy === 'customer_led' || r.followUpPlan?.policy === 'internal_only') && <p className="text-sm font-semibold">Internal review only — do not chase automatically.</p>}
      <button disabled={!r.canEdit} onClick={() => edit(r)} className="rounded border px-3 py-2 disabled:opacity-50">Record next action</button>
    </article>)}</div>
    {opportunities.length > 0 && <details className="rounded-xl border p-4"><summary className="font-semibold">Partnership opportunities — {opportunities.length}</summary><p className="my-2">Keep the partner relationship separate from each customer job. The manager review task flags missing owners, actions and overdue dates.</p>{opportunities.filter(o => !['closed_won','closed_lost','won','lost','completed','closed'].includes(o.stage)).map(o => <div key={o.id} className="border-t py-2"><strong>{o.name}</strong> · {o.assigned_manager_name || 'Unassigned'} · {o.next_action_due || 'No review date'}<p>{o.next_action || 'Needs next action'}</p></div>)}<Link href="/marketing/partners?tab=pipeline" className="underline">Open sales opportunities</Link></details>}
    {editing && plan && <div className="fixed inset-0 z-50 overflow-auto bg-black/40 p-4"><form onSubmit={e => { e.preventDefault(); void save() }} className="mx-auto my-8 max-w-xl rounded-xl bg-white p-5 space-y-3">
      <h2 className="font-semibold">Next action — {editing.name || editing.phone}</h2>
      <p className="text-sm">Review the latest SMS, email and calls first. Record only what the customer actually said. Closing a plan does not delete history or change the sales stage.</p>
      <label className="block">Category<select className="crm-input block w-full" value={plan.reason} onChange={e => setPlan({ ...plan, reason: e.target.value as FollowUpReason, policy: e.target.value === 'customer_will_contact' ? 'customer_led' : plan.policy })}>{Object.entries(FOLLOW_UP_REASONS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="block">Contact policy<select className="crm-input block w-full" value={plan.policy} onChange={e => setPlan({ ...plan, policy: e.target.value as FollowUpPlan['policy'] })}><option value="proactive">Proactive follow-up when due</option><option value="scheduled">Agreed callback — follow the recorded time</option><option value="customer_led">Customer will contact us — internal review only</option><option value="internal_only">Verify internally before contact</option></select></label>
      <label className="block">Responsible owner<input required className="crm-input block w-full" value={plan.ownerName} onChange={e => setPlan({ ...plan, ownerName: e.target.value })} /></label>
      <label className="block">Next review date<input required={plan.reason !== 'closed'} type="date" className="crm-input block w-full" value={plan.reviewOn} onChange={e => setPlan({ ...plan, reviewOn: e.target.value })} /></label>
      <label className="block">Next action (include agreed callback time and channel)<textarea required className="crm-input block w-full" value={plan.nextAction} onChange={e => setPlan({ ...plan, nextAction: e.target.value })} /></label>
      <label className="block">Conversation evidence / outcome<textarea required className="crm-input block w-full" value={plan.evidence} onChange={e => setPlan({ ...plan, evidence: e.target.value })} /></label>
      {error && <p role="alert" className="text-red-700">{error}</p>}<div className="flex gap-3"><button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-white">{busy ? 'Saving…' : 'Save next action'}</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
    </form></div>}
  </main>
}
