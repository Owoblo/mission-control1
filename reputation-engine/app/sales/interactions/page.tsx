'use client'
import { useEffect, useState } from 'react'
import { INTERACTION_ACTORS, INTERACTION_INTENTS, INTERACTION_DISPOSITIONS, type InteractionClassification } from '@/lib/interaction-classification'

type Row = { id: string; event: Record<string, unknown>; classification_id: number; classification: InteractionClassification; lead_id?: string; reviewer_id?: string; received_at: string }
const evidenceKeys = ['movingIntent', 'serviceableLocation', 'realIdentity', 'usableContact', 'plausibleOpportunity'] as const
const evidenceLabels = ['Moving-related intent confirmed', 'Location is serviceable', 'Real person or organization verified', 'Usable contact verified', 'Plausible commercial opportunity confirmed']
export default function InteractionReview() {
  const [rows, setRows] = useState<Row[]>([])
  const [selected, setSelected] = useState<Row | null>(null)
  const [classification, setClassification] = useState<InteractionClassification | null>(null)
  const [offset, setOffset] = useState(0)
  const [pending, setPending] = useState(true)
  const [promote, setPromote] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<unknown[]>([])
  useEffect(() => {
    setHistory([])
    if (!selected) return
    const controller = new AbortController()
    void fetch(`/api/sales/interactions?id=${encodeURIComponent(selected.id)}`, { signal: controller.signal }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setHistory(data.history)
    }).catch(error => { if (!controller.signal.aborted) setError(String(error)) })
    return () => controller.abort()
  }, [selected])
  async function load() {
    setError('')
    try {
      const res = await fetch(`/api/sales/interactions?offset=${offset}&pending=${pending}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRows(data.interactions)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load interactions') }
  }
  useEffect(() => { void load() }, [offset, pending])
  async function save() {
    if (!selected || !classification) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/sales/interactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id, expected: selected.classification_id, classification, promote }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSelected(null); setClassification(null); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save review') }
    finally { setBusy(false) }
  }
  return <main className="max-w-6xl mx-auto p-6 space-y-4">
    <h1 className="text-2xl font-semibold">Interaction Review</h1>
    <p>Communications become leads only after qualification. Reviews preserve the original decision and record your correction.</p>
    <label className="flex gap-2"><input type="checkbox" checked={pending} onChange={e => { setPending(e.target.checked); setOffset(0) }} />Unreviewed only</label>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <div className="grid md:grid-cols-2 gap-6">
      <section className="space-y-2">
        {rows.map(row => <button key={row.id} className="block border rounded p-3 text-left w-full" onClick={() => { setSelected(row); setClassification({ ...row.classification, reason: '' }); setPromote(false) }}>
          <strong>{String(row.event.sender || row.lead_id || 'Unknown sender')}</strong>
          <div>{String(row.event.channel || '')} · {row.classification.disposition.replaceAll('_', ' ')}</div>
          <p className="truncate">{String(row.event.body || row.event.source || '')}</p>
        </button>)}
        {!rows.length && <p>No interactions on this page.</p>}
        <div className="flex gap-4"><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><button disabled={rows.length < 50} onClick={() => setOffset(offset + 50)}>Next</button></div>
      </section>
      {selected && classification && <section className="space-y-4">
        <p>Received {selected.received_at}. Previous: {selected.classification.disposition} — {selected.classification.reason}</p>
        <details><summary>Classification and correction history</summary><pre className="whitespace-pre-wrap break-all max-h-96 overflow-auto text-xs">{JSON.stringify(history, null, 2)}</pre></details>
        <details><summary>Original interaction and source metadata</summary><pre className="whitespace-pre-wrap break-all max-h-96 overflow-auto text-xs">{JSON.stringify(selected.event, null, 2)}</pre></details>
        {(['actor', 'intent', 'disposition'] as const).map(field => <label key={field} className="block capitalize">{field}<select className="block border rounded p-2 w-full text-black" value={classification[field]} onChange={e => setClassification({ ...classification, [field]: e.target.value })}>{(field === 'actor' ? INTERACTION_ACTORS : field === 'intent' ? INTERACTION_INTENTS : INTERACTION_DISPOSITIONS).map(value => <option key={value}>{value}</option>)}</select></label>)}
        <label className="block">Confidence (0–1)<input className="block border p-2 text-black" type="number" min="0" max="1" step="0.05" value={classification.confidence} onChange={e => setClassification({ ...classification, confidence: Number(e.target.value) })} /></label>
        {evidenceKeys.map((key, i) => <label key={key} className="flex gap-2"><input type="checkbox" checked={classification.evidence?.[key] || false} onChange={e => setClassification({ ...classification, evidence: { movingIntent: false, serviceableLocation: false, realIdentity: false, usableContact: false, plausibleOpportunity: false, location: '', ...classification.evidence, [key]: e.target.checked } })} />{evidenceLabels[i]}</label>)}
        <label className="block">Verified service location<input className="block border p-2 w-full text-black" value={classification.evidence?.location || ''} onChange={e => setClassification({ ...classification, evidence: { movingIntent: false, serviceableLocation: false, realIdentity: false, usableContact: false, plausibleOpportunity: false, ...classification.evidence, location: e.target.value } })} /></label>
        <label className="block">Reason and evidence<textarea className="block border p-2 w-full text-black" value={classification.reason} onChange={e => setClassification({ ...classification, reason: e.target.value })} /></label>
        {!selected.lead_id && <label className="flex gap-2"><input type="checkbox" checked={promote} onChange={e => setPromote(e.target.checked)} />Promote verified opportunity to CRM</label>}
        <button className="border rounded p-3" disabled={busy || !classification.reason.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save review'}</button>
      </section>}
    </div>
  </main>
}
