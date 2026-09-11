'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { EconomicTrace } from '@/lib/economic-truth'

const money = (cents: number | null) => cents === null ? 'Unknown' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)

export default function EconomicTruthPage() {
  const [branch, setBranch] = useState('')
  const [rows, setRows] = useState<EconomicTrace[]>([])
  const [query, setQuery] = useState('')
  const [view, setView] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [checkedAt, setCheckedAt] = useState('')
  const [reload, setReload] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  useEffect(() => { setPageNumber(1) }, [query, view, branch, reload])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setRows([])
    fetch(`/api/sales/economic-truth${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`, { credentials: 'include', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to load review'); return body })
      .then(body => { setRows(body.rows); setCheckedAt(body.checkedAt) })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [branch, reload])
  const filtered = useMemo(() => rows.filter(row => {
    const matchesSearch = [row.name, row.source, row.partnerName, row.owner, row.branch].join(' ').toLowerCase().includes(query.toLowerCase())
    return matchesSearch && (view === 'all' || (view === 'completed' && ['completed', 'customer_success'].includes(row.stage)) ||
      (view === 'source' && !row.acquisitionInterview) || (view === 'partner' && row.partnerId) || (view === 'action' && !['completed', 'customer_success', 'lost'].includes(row.stage) && (!row.owner || !row.nextAction || !row.dueAt || !Number.isFinite(Date.parse(row.dueAt)))))
  }), [rows, query, view])
  const completed = rows.filter(row => ['completed', 'customer_success'].includes(row.stage))
  const connectorRows = useMemo(() => {
    const accounts = new Map<string, { id: string; name: string; leads: number; quoted: number; booked: number; completed: number }>()
    for (const row of rows) {
      const linked = new Map<string, string>()
      if (row.partnerId) linked.set(row.partnerId, row.partnerName || 'Linked partner')
      if (row.acquisitionInterview?.connectorId) linked.set(row.acquisitionInterview.connectorId, row.acquisitionInterview.connectorName)
      for (const [id, name] of linked) {
        const account = accounts.get(id) || { id, name, leads: 0, quoted: 0, booked: 0, completed: 0 }
        account.leads++
        if (row.quoteId) account.quoted++
        if (['booked', 'completed', 'customer_success'].includes(row.stage)) account.booked++
        if (['completed', 'customer_success'].includes(row.stage)) account.completed++
        accounts.set(id, account)
      }
    }
    return [...accounts.values()].sort((a, b) => b.completed - a.completed || b.leads - a.leads || a.name.localeCompare(b.name))
  }, [rows])
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25))
  const currentPage = Math.min(pageNumber, pageCount)
  const visible = filtered.slice((currentPage - 1) * 25, currentPage * 25)
  return <div className="crm-shell space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="font-display text-2xl font-bold text-[#071421]">Economic review</h1>
        <p className="mt-1 text-sm text-[var(--app-muted)]">Read-only review of existing leads, actions, jobs and recorded costs.</p></div>
      <button aria-label="Refresh economic review" className="crm-button-dark" onClick={() => setReload(n => n + 1)} disabled={loading}>Refresh</button>
    </div>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      Quote revenue and posted costs are provisional. Missing costs remain unknown. Final contribution requires confirmed final revenue and complete costs; existing outcome records do not provide that confirmation.
    </div>
    <div className="flex flex-wrap gap-3">
      <label className="text-sm">Branch<select aria-label="Branch" className="ml-2 rounded-lg border p-2" value={branch} onChange={e => setBranch(e.target.value)}>
        <option value="">All authorized branches</option>{['windsor', 'london', 'waterloo', 'ottawa', 'unassigned'].map(b => <option key={b} value={b}>{b}</option>)}
      </select></label>
      <label className="text-sm">Review<select aria-label="Review filter" className="ml-2 rounded-lg border p-2" value={view} onChange={e => setView(e.target.value)}>
        <option value="all">All records</option><option value="completed">Completed jobs</option><option value="partner">Explicit partner referrals</option><option value="source">Source question not asked</option><option value="action">Missing action details</option>
      </select></label>
      <input aria-label="Search economic review" className="w-full rounded-lg border p-2 text-sm sm:w-80" placeholder="Search name, source, partner or owner" value={query} onChange={e => setQuery(e.target.value)} />
    </div>
    {loading ? <p role="status">Loading existing records…</p> : error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p> : <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[['CRM leads', rows.length], ['Completed jobs', completed.length], ['Completed with posted delivery costs', completed.filter(r => r.economics.postedDirectCostsCents !== null).length], ['Explicit partner-linked leads', rows.filter(r => r.partnerId).length]].map(([label, value]) =>
          <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-600">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}
      </div>
      <p className="text-xs text-slate-600">{filtered.length} matching records. Snapshot {new Date(checkedAt).toLocaleString()}. Counts describe CRM records, not total market coverage.</p>
      <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-semibold">Connector tracking · {connectorRows.length} linked contacts</summary>
        <p className="mt-2 text-xs text-slate-600">Referring partners and customer-reported connectors. A lead is counted once per connector; several connectors may assist the same job. These are associated outcomes, not exclusive credit or confirmed profit. Uses all records in the selected branch.</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Connector', 'Linked leads', 'Quote linked', 'Booked or completed', 'Completed'].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{connectorRows.map(c => <tr key={c.id} className="border-t"><td className="p-2">{c.name}</td><td className="p-2">{c.leads}</td><td className="p-2">{c.quoted}</td><td className="p-2">{c.booked}</td><td className="p-2">{c.completed}</td></tr>)}</tbody></table></div>
        {!connectorRows.length && <p className="mt-3 text-sm">No explicit connector links recorded in these leads yet.</p>}
      </details>
      {filtered.length === 0 ? <p>No records match this review.</p> : <div className="space-y-4">{visible.map(row =>
        <article key={row.id} className="rounded-xl border bg-white p-5">
          <div className="flex flex-wrap justify-between gap-3"><div><Link className="font-semibold text-[#071421] underline" href={`/sales/leads/${encodeURIComponent(row.id)}`}>{row.name || 'Unnamed lead'}</Link>
            <p className="mt-1 text-xs text-slate-600">{row.branch} · {row.stage.replaceAll('_', ' ')} · {row.outcomeRecorded ? 'Outcome recorded' : 'No outcome record'}</p></div>
            <Link href="/sales/finance" className="text-sm underline">Review job costs</Link></div>
          <div className="mt-4 grid gap-4 text-sm md:grid-cols-3">
            <div><p className="font-semibold">Origin and relationship</p><p>Recorded source: {row.source || 'Unknown'}</p><p>Referring partner: {row.partnerId ? row.partnerName || 'Linked contact' : 'Not recorded'}</p>
              <p>Source question: {row.acquisitionInterview?.status.replaceAll('_', ' ') || 'Not asked'}</p>
              {row.acquisitionInterview && <div className="mt-1 text-slate-600"><p>Customer reported: {row.acquisitionInterview.channel.replaceAll('_', ' ')}</p>
                {row.acquisitionInterview.postcardRoute !== 'unknown' && <p>Card received: {row.acquisitionInterview.postcardRoute.replaceAll('_', ' ')}</p>}
                {row.acquisitionInterview.postcardLocation && <p>Location: {row.acquisitionInterview.postcardLocation}</p>}
                {row.acquisitionInterview.postcardCode && <p>Reported card code: {row.acquisitionInterview.postcardCode} (not campaign-verified)</p>}
                {row.acquisitionInterview.connectorId && <p>Connector: {row.acquisitionInterview.connectorName} · {row.acquisitionInterview.connectorRole.replaceAll('_', ' ')}</p>}
                {row.acquisitionInterview.customerWords && <p>“{row.acquisitionInterview.customerWords}”</p>}
              </div>}
              {row.sourceDetail && <p className="mt-1 text-slate-600">{row.sourceDetail}</p>}
              {row.attributionTouches.length > 0 && <p className="mt-1 text-slate-600">Touches: {row.attributionTouches.map(t => `${t.channel} (${t.influence.replaceAll('_', ' ')}, ${t.confidence})`).join('; ')}</p>}
            </div>
            <div><p className="font-semibold">Owned action</p><p>{row.nextAction || 'No next action recorded'}</p><p>Owner: {row.owner || 'Unassigned'}</p>
              <p>Due: {row.dueAt && Number.isFinite(Date.parse(row.dueAt)) ? new Date(row.dueAt).toLocaleString() : 'Not set'}</p><p>{row.openTaskCount} open linked tasks</p>
              {row.pursuitReason && <p className="mt-1 text-slate-600">Context: {row.pursuitReason}</p>}
            </div>
            <div><p className="font-semibold">Economic evidence</p><p>Quote before tax: {money(row.economics.quotedRevenueCents)}</p><p>Posted delivery costs: {money(row.economics.postedDirectCostsCents)}</p>
              <p>Posted acquisition costs: {money(row.economics.postedAcquisitionCostsCents)}</p><p>Provisional contribution: {money(row.economics.provisionalContributionCents)}</p>
              <p className="font-semibold">Confirmed contribution: {money(row.economics.confirmedContributionCents)}</p>
            </div>
          </div>
          <p className="mt-4 border-t pt-3 text-xs text-amber-900">To complete this record: {row.gaps.join(' · ') || 'No gaps recorded'}</p>
        </article>)}</div>}
      {pageCount > 1 && <nav aria-label="Review pages" className="flex items-center gap-4 text-sm">
        <button className="rounded-lg border px-3 py-2 disabled:opacity-40" disabled={currentPage === 1} onClick={() => setPageNumber(currentPage - 1)}>Previous</button>
        <span>Page {currentPage} of {pageCount}</span>
        <button className="rounded-lg border px-3 py-2 disabled:opacity-40" disabled={currentPage === pageCount} onClick={() => setPageNumber(currentPage + 1)}>Next</button>
      </nav>}
    </>}
  </div>
}
