'use client'
import { useState } from 'react'
import { contextFields, emptyFeedback, feedbackQuestion, feedbackReasons, type CustomerFeedback, type FeedbackEvidence } from '@/lib/customer-feedback'

export function CustomerFeedbackPanel({ leadId, onDraft }: { leadId: string; onDraft: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState<CustomerFeedback>(emptyFeedback)
  const [evidence, setEvidence] = useState<FeedbackEvidence[]>([])
  const [version, setVersion] = useState('')
  const [suppressed, setSuppressed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [message, setMessage] = useState('')
  const [loaded, setLoaded] = useState(false)
  const endpoint = `/api/sales/leads/${encodeURIComponent(leadId)}/feedback`
  async function load() {
    setBusy(true); setMessage(''); setLoaded(false); setReviewed(false)
    try {
      const response = await fetch(endpoint, { cache: 'no-store' }); const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setFeedback(data.feedback); setEvidence(data.evidence); setVersion(data.version); setSuppressed(data.suppressed); setLoaded(true)
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not load feedback.') } finally { setBusy(false) }
  }
  function update(patch: Partial<CustomerFeedback>) { setFeedback(f => ({ ...f, ...patch })); setReviewed(false); setMessage('') }
  async function submit(action: 'save' | 'draft') {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, feedback, version, reviewed }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error)
      if (action === 'draft') {
        // Preserve outreach history when refreshing the editable AI suggestion.
        setFeedback(f => ({ ...data.feedback, status: f.status === 'declined' ? f.status : data.feedback.status === 'not_requested' ? f.status : data.feedback.status, requestedAt: f.requestedAt }))
        setReviewed(false); setMessage('AI suggestion only. Check sources and edit before saving. Existing unsaved fields were replaced.')
      } else { setFeedback(data.feedback); setVersion(data.version); setMessage('Reviewed feedback saved. No customer message was sent.'); setReviewed(false) }
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }
  const input = 'w-full rounded-lg border border-slate-200 p-2 text-sm bg-white'
  const label = (value: string) => value.replaceAll('_', ' ')
  const sourceOptions = <><option value="">Choose evidence</option><option value="manual">Rep-reported phone / email conversation</option>{evidence.map(e => <option key={e.id} value={e.id}>{label(e.kind)} · {e.at.slice(0, 10)} · {e.text.slice(0, 65)}</option>)}</>
  const question = feedbackQuestion(feedback, suppressed)
  return <section className="mx-3 mb-4 rounded-xl border bg-white p-4 md:mx-8">
    <button type="button" className="font-semibold" onClick={() => { setOpen(!open); if (!open && !loaded) void load() }}>{open ? '▾' : '▸'} Customer feedback & service context</button>
    {open && <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-600">Learn why customers choose or decline us. Record stated needs and preferences; leave unknowns blank. AI drafts need review. Nothing here sends automatically.</p>
      <div className="flex gap-3"><button type="button" disabled={busy} onClick={() => void load()}>Reload saved feedback</button><button type="button" disabled={busy || !loaded} onClick={() => void submit('draft')}>Draft from conversation (replaces form)</button></div>
      {message && <p role="status" className="rounded bg-amber-50 p-3 text-sm">{message}</p>}
      {busy && <p role="status">Working…</p>}
      {loaded && <fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label>Customer decision<select className={input} value={feedback.outcome} onChange={e => update({ outcome: e.target.value as CustomerFeedback['outcome'] })}>{['unknown', 'won', 'lost', 'postponed', 'cancelled'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>Feedback status<select className={input} value={feedback.status} onChange={e => update({ status: e.target.value as CustomerFeedback['status'] })}>{['not_requested', 'requested', 'received', 'declined'].map(v => <option key={v} value={v}>{label(v)}</option>)}</select></label>
          <label>Main reason<select className={input} value={feedback.reason} onChange={e => update({ reason: e.target.value as CustomerFeedback['reason'] })}>{feedbackReasons.map(v => <option key={v} value={v}>{label(v)}</option>)}</select></label>
        </div>
        <p className="text-xs text-slate-500">Mark “requested” only after actually asking by phone or sending a message; log when and how in rep notes. “Declined” means they declined to give feedback. Saving does not change the sales stage.</p>
        <label className="block">Feedback source<select className={input} value={feedback.sourceId} onChange={e => update({ sourceId: e.target.value })}>{sourceOptions}</select></label>
        <label className="block">Customer’s exact words<textarea className={input} rows={3} value={feedback.customerWords} onChange={e => update({ customerWords: e.target.value })} /></label>
        <div className="grid gap-3 md:grid-cols-2"><label>Company chosen (only if stated)<input className={input} value={feedback.competitor} onChange={e => update({ competitor: e.target.value })} /></label><label>Competitor price (quote currency and scope)<input className={input} value={feedback.competitorPrice} onChange={e => update({ competitorPrice: e.target.value })} /></label></div>
        <label className="block">Rep notes / interpretation / conversation date<textarea className={input} value={feedback.repNotes} onChange={e => update({ repNotes: e.target.value })} /></label>
        <div className="space-y-3"><strong>Customer service context</strong><p className="text-xs text-slate-500">Ask naturally: “What matters most for this move?” or “What would make moving easier for you?” Record the answer, not assumptions about demographics.</p>
          {feedback.context.map((item, index) => <div className="space-y-2 rounded border p-3" key={index}>
            <select aria-label="Context category" className={input} value={item.field} onChange={e => update({ context: feedback.context.map((c, i) => i === index ? { ...c, field: e.target.value as typeof item.field } : c) })}>{contextFields.map(f => <option key={f} value={f}>{label(f)}</option>)}</select>
            <input aria-label="Stated service need" placeholder="Stated need or preference" className={input} value={item.value} onChange={e => update({ context: feedback.context.map((c, i) => i === index ? { ...c, value: e.target.value } : c) })} />
            <select aria-label="Context source" className={input} value={item.sourceId} onChange={e => update({ context: feedback.context.map((c, i) => i === index ? { ...c, sourceId: e.target.value } : c) })}>{sourceOptions}</select>
            <textarea aria-label="Context evidence quotation" placeholder="Exact supporting words" className={input} value={item.excerpt} onChange={e => update({ context: feedback.context.map((c, i) => i === index ? { ...c, excerpt: e.target.value } : c) })} />
            <button type="button" onClick={() => update({ context: feedback.context.filter((_, i) => i !== index) })}>Remove</button>
          </div>)}
          <button type="button" disabled={feedback.context.length >= 12} onClick={() => update({ context: [...feedback.context, { field: 'priority', value: '', sourceId: '', excerpt: '' }] })}>+ Add stated context</button>
        </div>
        <details><summary>Review evidence ({evidence.length} sources)</summary><p className="text-xs">Latest 100 linked inbound SMS and 30 calls. Emails and unlinked conversations require manual entry. Call transcripts contain both speakers; verify who said it.</p>{evidence.map(e => <blockquote className="my-3 whitespace-pre-wrap border-l-2 pl-3 text-sm" key={e.id}><strong>{label(e.kind)} · {e.at}</strong><br />{e.text}</blockquote>)}</details>
        <label className="flex gap-2"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed the sources, customer decision, and notes. These are not unverified AI assumptions.</label>
        <button type="button" className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-40" disabled={!reviewed} onClick={() => void submit('save')}>Save reviewed feedback</button>
        {question ? <div className="rounded-lg bg-slate-50 p-3"><p className="text-sm">Suggested question: {question}</p><button type="button" className="mt-2 underline" onClick={() => onDraft(question)}>Review in message composer</button><p className="text-xs mt-2">Check contact instructions and prior messages first. After sending, mark feedback requested and save.</p></div> : <p className="text-sm text-slate-500">No outreach suggested: review the decision, existing feedback, and contact restrictions. Do not chase an unanswered request.</p>}
        {feedback.reviewedAt && <p className="text-xs">Last reviewed by {feedback.reviewedBy} · {new Date(feedback.reviewedAt).toLocaleString()}</p>}
      </fieldset>}
    </div>}
  </section>
}
