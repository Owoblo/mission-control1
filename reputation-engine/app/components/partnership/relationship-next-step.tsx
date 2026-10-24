'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MaterialKind, NextStep } from '@/lib/relationship-next-step'

type Receipt = { id: string; channel: string; at: string; excerpt: string; delivery: string }
type Report = { existingWork?: { id: string; title: string; category: string; owner?: string; dueAt?: string }[]; rows: NextStep[]; total: number; counts: Record<string, number>; generatedAt: string; coverage: { complete: boolean }; receipts: Receipt[] }
const date = (v: string) => new Date(v).toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' })
function useReport(contactId?: string, revision?: string, offset = 0) {
  const [data, setData] = useState<Report | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0)
  const refresh = useCallback(() => setRetry(v => v + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    void fetch(`/api/marketing/next-steps?limit=100&offset=${offset}${contactId ? `&contactId=${encodeURIComponent(contactId)}` : ''}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async r => { const result = await r.json(); if (!r.ok || !result.coverage?.complete) throw Error(result.error || 'Evidence could not refresh.'); return result })
      .then(result => { if (!controller.signal.aborted) setData(result) })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Evidence could not refresh.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [contactId, revision, retry, offset])
  useEffect(() => {
    if (!contactId) return
    const timer = setInterval(() => { if (!document.hidden) refresh() }, 120000)
    return () => clearInterval(timer)
  }, [refresh, contactId])
  return { data, error, loading, refresh }
}
async function record(step: NextStep, action: string, extra: Record<string, string> = {}) {
  const response = await fetch('/api/marketing/next-steps', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId: step.contactId, key: step.key, evidenceVersion: step.evidenceVersion, action, ...extra }) })
  const body = await response.json()
  if (!response.ok) throw Error(body.error || 'Could not save. Refresh to check the recorded result.')
  return body
}
function NextStepItem({ step, receipts, onRefresh, onReview, readOnly = false }: { step: NextStep; receipts: Receipt[]; onRefresh: () => void; onReview?: (kind: MaterialKind) => void; readOnly?: boolean }) {
  const element = useRef<HTMLDivElement>(null), shown = useRef(new Set<string>())
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [mode, setMode] = useState<'defer' | 'correct' | 'receipt' | null>(null), [reviewAt, setReviewAt] = useState(''), [note, setNote] = useState(''), [receiptId, setReceiptId] = useState('')
  useEffect(() => {
    const target = element.current
    if (!target) return
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting) || document.hidden || shown.current.has(step.evidenceVersion)) return
      shown.current.add(step.evidenceVersion)
      void record(step, 'shown').catch(() => { shown.current.delete(step.evidenceVersion) })
    }, { threshold: 0.5 })
    observer.observe(target)
    return () => observer.disconnect()
  }, [step])
  async function act(action: string, extra: Record<string, string> = {}) {
    if (readOnly) return
    setBusy(true); setError(''); setNotice('')
    try {
      await record(step, action, extra)
      if (action === 'review') { onReview?.(step.kind); setNotice('Review opened. The request remains open until an outcome is recorded.') }
      else { setMode(null); onRefresh() }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') }
    finally { setBusy(false) }
  }
  const candidates = receipts.filter(r => step.kind !== 'physical_card' && (step.kind !== 'email' || r.channel === 'email') && r.at >= step.requestedAt)
  const active = ['review', 'waiting', 'submitted'].includes(step.state)
  const state = { review: 'Needs review', waiting: 'Scheduled review', submitted: 'Delivery unconfirmed', fulfilled: 'Delivery recorded', reviewed: 'Human outcome recorded', suppressed: 'Contact restricted' }[step.state]
  return <div ref={element} className="rounded-lg border border-slate-200 bg-white p-3 text-sm" data-next-step={step.key}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold text-slate-900">{step.title}</h4><span className="text-xs text-slate-600">{state}</span></div>
    <p className="mt-1 text-xs leading-5 text-slate-600">{step.reason}</p>
    <p className="mt-1 text-xs text-slate-500">{step.owner ? `Owner: ${step.owner}` : 'Owner not assigned'}{step.dueAt ? ` · Review ${date(step.dueAt)} Eastern` : ''}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {active && onReview && <button disabled={busy || readOnly} className="min-h-10 rounded-lg bg-[#14213d] px-3 text-xs font-semibold text-white disabled:opacity-50" onClick={() => void act('review')}>Review in conversation</button>}
      <button aria-expanded={open} onClick={() => setOpen(v => !v)} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-medium">{open ? 'Hide evidence' : 'View evidence'}</button>
      {step.taskId && <Link className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-3 text-xs font-medium" href={`/sales/tasks?relatedId=${encodeURIComponent(step.contactId)}&relatedLabel=${encodeURIComponent(step.contactName)}`}>Open task</Link>}
    </div>
    {open && <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <div><p className="text-xs font-medium text-slate-500">Original request · {date(step.requestedAt)} Eastern</p><blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-slate-200 pl-3 text-xs leading-5 text-slate-700">{step.excerpt || 'No message text recorded.'}</blockquote></div>
      {step.receiptId && <p className="text-xs text-slate-600">Linked receipt: {step.receiptId} · {step.delivery === 'delivered' ? 'Delivery recorded' : step.delivery === 'submitted' ? 'Submitted; delivery not confirmed' : 'No confirmed provider success'}</p>}
      {active && <div className="flex flex-wrap gap-2">
        {!step.taskId && <button disabled={busy || readOnly} onClick={() => void act('create_task')} className="min-h-10 rounded-lg border px-3 text-xs">Assign review task</button>}
        <button disabled={busy || readOnly} onClick={() => setMode('defer')} className="min-h-10 rounded-lg border px-3 text-xs">Review later</button>
        {!!candidates.length && <button disabled={busy || readOnly} onClick={() => setMode('receipt')} className="min-h-10 rounded-lg border px-3 text-xs">Link existing send</button>}
        <button disabled={busy || readOnly} onClick={() => setMode('correct')} className="min-h-10 rounded-lg border px-3 text-xs">Correct suggestion</button>
      </div>}
      {mode === 'defer' && <form onSubmit={e => { e.preventDefault(); if (reviewAt) void act('defer', { dueAt: new Date(reviewAt).toISOString() }) }} className="space-y-2"><label className="block text-xs">Internal review time (your local time)<input required type="datetime-local" value={reviewAt} onChange={e => setReviewAt(e.target.value)} className="crm-input mt-1 w-full" /></label><p className="text-xs text-slate-500">Schedules internal work. No message will be sent.</p><button disabled={busy || readOnly} className="crm-button min-h-10">Save review time</button></form>}
      {mode === 'correct' && <form onSubmit={e => { e.preventDefault(); void act('correct', { note }) }} className="space-y-2"><label className="block text-xs">What did the system miss?<textarea required maxLength={1000} value={note} onChange={e => setNote(e.target.value)} className="crm-input mt-1 w-full" /></label><p className="text-xs text-slate-500">Retains your correction and the original evidence. Existing tasks stay open until their owner records an outcome; delivery is not confirmed.</p><button disabled={busy || readOnly} className="crm-button min-h-10">Save correction</button></form>}
      {mode === 'receipt' && <form onSubmit={e => { e.preventDefault(); void act('link_receipt', { receiptId }) }} className="space-y-2"><label className="block text-xs">Choose the message that fulfilled this request<select required value={receiptId} onChange={e => setReceiptId(e.target.value)} className="crm-input mt-1 w-full"><option value="">Select a provider record</option>{candidates.map(r => <option key={r.id} value={r.id}>{date(r.at)} · {r.channel} · {r.delivery} · {r.excerpt.slice(0, 100)}</option>)}</select></label><p className="text-xs text-slate-500">Confirm the message contains the requested material. Submission alone will leave delivery unconfirmed.</p><button disabled={busy || readOnly} className="crm-button min-h-10">Link receipt</button></form>}
      {mode && <button disabled={busy || readOnly} onClick={() => setMode(null)} className="min-h-10 px-2 text-xs underline">Cancel</button>}
    </div>}
    {error && <p role="alert" className="mt-2 text-xs text-amber-900">{error} <button className="underline" onClick={onRefresh}>Refresh evidence</button></p>}
    {notice && <p role="status" className="mt-2 text-xs text-slate-600">{notice}</p>}
  </div>
}
export function RelationshipNextStep({ contactId, revision, onReview }: { contactId: string; revision?: string; onReview?: (kind: MaterialKind) => void }) {
  const [offset, setOffset] = useState(0)
  const { data, error, loading, refresh } = useReport(contactId, revision, offset)
  const [showHistory, setShowHistory] = useState(false)
  const active = data?.rows.filter(r => ['review', 'waiting', 'submitted'].includes(r.state)) || []
  return <section aria-label="Next step" className="shrink-0 border-b border-slate-200 bg-slate-50/60 px-3 py-3 sm:px-5">
    <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Next step</h3><button onClick={refresh} disabled={loading} className="min-h-10 px-2 text-xs text-slate-500">Refresh</button></div>
    {loading && !data ? <p className="text-xs text-slate-500">Checking recorded requests…</p> : error && !data ? <p role="alert" className="text-xs text-amber-900">{error} <button className="underline" onClick={refresh}>Retry</button></p> : <>
      {error && <p role="alert" className="mb-2 text-xs text-amber-900">{error} Showing earlier evidence; actions are paused until refresh succeeds.</p>}
      {!!data?.existingWork?.length && <div className="mb-2 text-xs leading-5 text-slate-600">Existing fulfilment work is open. <Link className="underline" href="/marketing/fulfilment">Review fulfilment</Link> or <Link className="underline" href={`/sales/tasks?relatedId=${encodeURIComponent(contactId)}`}>open this partner’s tasks</Link> before arranging another send.</div>}
      {!active.length && <p className="text-xs leading-5 text-slate-600">{data?.counts.suppressed ? 'Contact restrictions are active. Review internally.' : 'No outstanding material requests on this page of recorded evidence. Other promises may remain in the conversation.'}</p>}
      <div className="max-h-64 space-y-2 overflow-y-auto">{(showHistory ? data?.rows || [] : active).map(step => <NextStepItem key={step.key} step={step} receipts={data?.receipts || []} onRefresh={refresh} onReview={onReview} readOnly={Boolean(error) || loading} />)}</div>
      {!!data?.rows.length && data.rows.length > active.length && <button onClick={() => setShowHistory(v => !v)} className="mt-1 min-h-10 text-xs underline">{showHistory ? 'Hide recorded outcomes' : 'Show recorded outcomes'}</button>}
      {data && (offset > 0 || data.total > 100) && <div className="mt-2 flex items-center gap-3 text-xs"><button disabled={loading || offset === 0} onClick={() => setOffset(v => Math.max(0, v - 100))} className="min-h-10 underline disabled:opacity-40">Previous requests</button><span>{offset + 1}–{offset + data.rows.length} of {data.total}</span><button disabled={loading || offset + 100 >= data.total} onClick={() => setOffset(v => v + 100)} className="min-h-10 underline disabled:opacity-40">More requests</button></div>}
    </>}
  </section>
}
export function MaterialRequestQueue() {
  const [offset, setOffset] = useState(0), [visible, setVisible] = useState(5)
  const { data, error, loading, refresh } = useReport(undefined, undefined, offset)
  return <section aria-label="Outstanding partner requests" className="border-b border-[var(--app-line)] pb-5">
    <div className="flex items-center justify-between gap-2"><h3 className="text-lg font-semibold text-[#14213d]">Outstanding requests</h3><button disabled={loading} onClick={refresh} className="min-h-10 px-2 text-xs underline">Refresh</button></div>
    {loading && !data ? <p className="text-sm text-slate-500">Checking recorded requests and fulfilment…</p> : error ? <p role="alert" className="text-sm text-amber-900">{error} <button onClick={refresh} className="underline">Retry</button></p> : <>
      <p className="mt-1 text-xs text-slate-500">{data?.counts.review || 0} need review · {data?.counts.waiting || 0} scheduled · {data?.counts.submitted || 0} awaiting delivery confirmation</p>
      {!data?.total && <p className="mt-3 text-sm text-slate-600">No outstanding material requests found in recorded evidence. Other follow-ups remain below.</p>}
      <div className="mt-3 divide-y divide-slate-100">{data?.rows.slice(0, visible).map(step => <Link key={step.key} className="block py-3 hover:bg-slate-50" href={`/marketing/partners?tab=phone&contact=${encodeURIComponent(step.contactId)}`}><div className="text-sm font-semibold text-slate-900">{step.contactName}</div><div className="mt-1 text-sm text-slate-700">{step.title}</div><div className="mt-1 text-xs text-slate-500">{step.reason}{step.owner ? ` Owner: ${step.owner}.` : ''}{step.dueAt ? ` Review ${date(step.dueAt)} Eastern.` : ''}</div></Link>)}</div>
      {data && data.rows.length > visible && <button className="min-h-10 text-xs underline" onClick={() => setVisible(v => v + 5)}>Show more requests</button>}
      {data && (offset > 0 || data.total > 100) && <div className="flex gap-3 text-xs"><button disabled={loading || offset === 0} onClick={() => { setOffset(v => Math.max(0, v - 100)); setVisible(5) }} className="min-h-10 underline disabled:opacity-40">Previous page</button><span className="py-3">{offset + 1}–{offset + data.rows.length} of {data.total}</span><button disabled={loading || offset + 100 >= data.total} onClick={() => { setOffset(v => v + 100); setVisible(5) }} className="min-h-10 underline disabled:opacity-40">Next page</button></div>}
    </>}
  </section>
}
