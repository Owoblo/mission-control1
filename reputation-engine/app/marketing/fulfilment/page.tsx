'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CARD_REGIONS, cardFilename, type EmailTask } from '@/lib/partner-fulfilment'
type Task = EmailTask & { id: string; contact: { id: string; name: string; city: string; company: string; do_not_contact: boolean; stage: string } }
const field = 'w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900'
export default function FulfilmentPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [selected, setSelected] = useState<Task | null>(null)
  const [filter, setFilter] = useState('open')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reviewed, setReviewed] = useState(false)
  const [evidence, setEvidence] = useState('')
  const [dexaSender, setDexaSender] = useState('')
  async function load() {
    try {
      const r = await fetch('/api/marketing/fulfilment', { cache: 'no-store' }); const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setTasks(d.tasks); setDexaSender(d.dexaSender)
      return d.tasks as Task[]
    } catch (e) { setMessage(String(e)); return null } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const closed = (t: Task) => ['sent', 'completed_elsewhere'].includes(t.status)
  const visible = tasks.filter(t => (filter === 'all' || (filter === 'closed' ? closed(t) : !closed(t))) && `${t.contact.name} ${t.contact.city} ${t.to}`.toLowerCase().includes(search.toLowerCase()))
  async function selectTask(id: string) {
    const response = await fetch(`/api/marketing/fulfilment?id=${id}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok || !data.tasks?.length) throw new Error(data.error || 'Task unavailable')
    setSelected(data.tasks[0]); setDirty(false)
  }
  function edit<K extends keyof EmailTask>(key: K, value: EmailTask[K]) { if (selected) { setSelected({ ...selected, [key]: value }); setDirty(true); setReviewed(false) } }
  async function act(action: string) {
    if (!selected) return
    setBusy(true); setMessage('')
    try {
      const r = await fetch('/api/marketing/fulfilment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id, revision: selected.revision, action, draft: selected, reviewed, evidence }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error)
      setMessage(d.warning || (action === 'send' ? 'Email accepted by the provider; receipt saved in CRM.' : action === 'complete' ? 'Fulfilment recorded.' : 'Draft saved.'))
      const refreshed = await load(); if (refreshed) await selectTask(selected.id)
      setReviewed(false)
    } catch (e) {
      setMessage(String(e))
      // Preserve edited text on validation errors. Reloading the task list exposes
      // a send lock if provider acceptance could not be confirmed.
      const refreshed = await load(); const current = refreshed?.find(t => t.id === selected.id)
      if (current && current.revision !== selected.revision) await selectTask(current.id).catch(e => setMessage(String(e)))
    } finally { setBusy(false) }
  }
  async function upload(files: FileList | null) {
    if (!files || !selected) return
    try {
      const existing = selected.attachments || []
      if (existing.length + files.length > 3) throw new Error('Use at most three additional PDFs')
      const added = await Promise.all(Array.from(files).map(async file => {
        if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 2000000) throw new Error('Choose PDFs smaller than 2 MB')
        const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) })
        return { filename: file.name, content }
      }))
      if ([...existing, ...added].reduce((n, a) => n + a.content.length, 0) > 2800000) throw new Error('Additional PDFs must total less than 2 MB')
      edit('attachments', [...existing, ...added])
    } catch (e) { setMessage(String(e)) }
  }
  const locked = Boolean(selected && (closed(selected) || selected.status === 'sending'))
  return <main className="space-y-5 p-2 text-slate-900">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Fulfil promises</h1><p className="mt-1 text-sm text-slate-600">Send requested information, record completed work, and keep a next review date.</p></div><Link href="/marketing/partners?tab=phone" className="text-sm underline">Conversations</Link></div>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">Postcard batch 01: printer verification recorded September 9 for 37 envelopes. Check delivery lists for dispatch updates. <Link className="underline" href="/marketing/partners?tab=lists">Open delivery lists</Link></div>
    <div className="flex flex-wrap gap-3 text-sm"><span>{tasks.filter(t => !closed(t)).length} open</span><span>{tasks.filter(t => t.status === 'waiting').length} waiting</span><span>{tasks.filter(closed).length} closed</span></div>
    {message && <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">{message}</div>}
    <div className="grid gap-5 lg:grid-cols-[310px_1fr]">
      <aside className="space-y-3"><input aria-label="Search recipients" placeholder="Search name, city or email" className={field} value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Filter tasks" className={field} value={filter} onChange={e => setFilter(e.target.value)}><option value="open">Open promises</option><option value="closed">Closed promises</option><option value="all">All promises</option></select>
        <div className="max-h-[65vh] space-y-2 overflow-auto">{loading ? <p>Loading promises…</p> : visible.length === 0 ? <p className="p-3 text-sm text-slate-500">No matching promises.</p> : visible.map(t => <button key={t.id} disabled={busy} onClick={() => { if (selected && dirty && !window.confirm('Leave this unsaved draft?')) return; void selectTask(t.id).catch(e => setMessage(String(e))); setReviewed(false); setEvidence(''); setMessage('') }} className={`w-full rounded-xl border p-3 text-left ${selected?.id === t.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`}><div className="font-semibold">{t.contact.name}</div><div className="text-xs text-slate-500">{t.contact.city} · {t.brand === 'dexa' ? 'Dexa' : 'Saturn Star'}</div><div className="mt-1 text-xs">{t.status.replaceAll('_', ' ')}{t.nextReview ? ` · Review ${t.nextReview}` : ''}</div></button>)}</div>
      </aside>
      {selected ? <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div><h2 className="text-xl font-semibold">{selected.contact.name}</h2><p className="text-sm text-slate-500">{selected.contact.company}</p><Link target="_blank" href={`/marketing/partners?tab=phone&contact=${selected.contact.id}`} className="text-sm underline">Read conversation</Link></div>
        <p className="text-sm">From: {selected.brand === 'ssm' ? 'Saturn Star Movers <business@starmovers.ca>' : dexaSender || 'Dexa sender needs configuration — copy draft for your Dexa mailbox'}</p>
        {selected.status === 'sending' && <p className="rounded bg-amber-50 p-3 text-sm">Send outcome needs checking. Check the business sent-mail/provider record before recording completion. Sending again is disabled.</p>}
        {closed(selected) && <p className="rounded bg-green-50 p-3 text-sm">{selected.status === 'sent' ? `Email accepted ${selected.sentAt}. Delivery or reply is not yet confirmed.` : selected.evidence}</p>}
        <fieldset disabled={busy || locked} className="space-y-3 disabled:opacity-75">
          <label className="block text-sm">To<input type="email" className={field} value={selected.to} onChange={e => edit('to', e.target.value)} /></label>
          <label className="block text-sm">Subject<input className={field} value={selected.subject} onChange={e => edit('subject', e.target.value)} /></label>
          <label className="block text-sm">Message<textarea rows={12} className={field} value={selected.body} onChange={e => edit('body', e.target.value)} /></label>
          <label className="block text-sm">Regional business card<select className={field} value={selected.region} onChange={e => edit('region', e.target.value)}><option value="">No regional card</option>{CARD_REGIONS.filter(r => (r === 'ottawa') === (selected.brand === 'dexa')).map(r => <option key={r} value={r}>{r}</option>)}</select></label>
          {selected.region && <a target="_blank" rel="noreferrer" className="inline-block text-sm underline" href={`/partner-cards/${cardFilename(selected.region)}`}>Preview selected PDF</a>}
          <label className="block text-sm">Additional PDFs (rates, insurance or company information; 2 MB total)<input type="file" accept="application/pdf" multiple className="mt-1 block text-sm" onChange={e => { void upload(e.target.files); e.target.value = '' }} /></label>
          {(selected.attachments || []).map((a, i) => <div key={`${a.filename}-${i}`} className="text-sm">{a.filename} <button type="button" className="underline" onClick={() => edit('attachments', selected.attachments?.filter((_, j) => i !== j))}>Remove</button></div>)}
          <label className="block text-sm">Internal notes<textarea className={field} rows={3} value={selected.note} onChange={e => edit('note', e.target.value)} /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Readiness<select className={field} value={selected.status} onChange={e => edit('status', e.target.value as EmailTask['status'])}><option value="draft">Ready to review/send</option><option value="waiting">Waiting on information</option>{locked && <option value={selected.status}>{selected.status}</option>}</select></label><label className="text-sm">Next review<input className={field} type="date" value={selected.nextReview} onChange={e => edit('nextReview', e.target.value)} /></label></div>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I checked recent conversation and sent-mail, the recipient, regional coverage and attachments.</label>
          <div className="flex gap-3"><button type="button" onClick={() => void act('save')} className="rounded-lg border px-4 py-2 text-sm">Save draft</button><button type="button" disabled={!reviewed || selected.status === 'waiting' || (selected.brand === 'dexa' && !dexaSender)} onClick={() => void act('send')} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">Send email with attachments</button></div>
        </fieldset>
        <button className="text-sm underline" onClick={() => void navigator.clipboard.writeText(`Subject: ${selected.subject}\n\n${selected.body}`).then(() => setMessage('Draft copied. Attach the PDFs separately.')).catch(() => setMessage('Clipboard unavailable. Select and copy the message.'))}>Copy subject and message</button>
        {!closed(selected) && <div className="space-y-2 border-t pt-4"><label className="block text-sm">Already fulfilled elsewhere? Record the date, channel and what you sent.<textarea className={field} value={evidence} onChange={e => setEvidence(e.target.value)} /></label><button disabled={busy || evidence.trim().length < 8} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40" onClick={() => void act('complete')}>Record completed elsewhere</button></div>}
      </section> : <div className="rounded-xl border p-6 text-slate-500">Select a promise to review its draft and attachments.</div>}
    </div>
  </main>
}
