'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { summarizeFeedback, type CustomerFeedback } from '@/lib/customer-feedback'
type Report = { summary: ReturnType<typeof summarizeFeedback>; records: { id: string; name: string; market: string; source: string; feedback: CustomerFeedback }[] }
export default function FeedbackReport() {
  const [start, setStart] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10))
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(); setReport(null); setError('')
    fetch(`/api/sales/feedback?start=${encodeURIComponent(start)}`, { signal: controller.signal }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); setReport(data) }).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
    return () => controller.abort()
  }, [start])
  return <main className="mx-auto max-w-6xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">Weekly customer feedback</h1>
    <p>Reviewed feedback and stated service needs across your markets. This is the latest saved review per customer, filtered by review date; it is not a complete quote conversion report or a historical snapshot.</p>
    <label>Seven-day period starting (UTC) <input className="rounded border p-2" type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}{!report && !error && <p>Loading report…</p>}
    {report && <>
      <div className="grid gap-3 sm:grid-cols-3">{Object.entries({ 'Reviewed records': report.summary.reviewed, 'Feedback received': report.summary.received, 'Awaiting reply': report.summary.awaiting, 'Declined feedback': report.summary.declined, 'Won (reviewed sample)': report.summary.won, 'Lost (reviewed sample)': report.summary.lost }).map(([title, count]) => <div className="rounded border bg-white p-4" key={title}><div>{title}</div><strong className="text-2xl">{count}</strong></div>)}</div>
      <p className="text-sm">Reasons below use the {report.summary.received} feedback respondents as their denominator. Unknown outcomes: {report.summary.unknownOutcome}. Unreviewed customers and nonrespondents are not evidence of a loss reason. Counts mix customer messages with clearly labelled rep-reported conversations.</p>
      <p className="text-sm">Tracked request response rate in this reviewed sample: {report.summary.requestedCohort ? `${report.summary.requestedResponses} / ${report.summary.requestedCohort} (${Math.round(100 * report.summary.requestedResponses / report.summary.requestedCohort)}%)` : 'No tracked requests yet'}. This excludes unsolicited feedback and requests not logged by the rep.</p>
      <div className="grid gap-5 md:grid-cols-2">{[['Reasons among respondents', report.summary.reasons], ['Reviewed records by market', report.summary.markets]].map(([title, counts]) => <div key={String(title)} className="rounded border p-4"><h2 className="font-semibold">{String(title)}</h2>{Object.entries(counts).map(([key, count]) => <p key={key}>{key.replaceAll('_', ' ')}: {count}</p>)}{!Object.keys(counts).length && <p>No records in this period.</p>}</div>)}</div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Customer / market', 'Decision / reason', 'Customer words & provenance', 'Service context', 'Rep interpretation'].map(t => <th className="p-3" key={t}>{t}</th>)}</tr></thead><tbody>{report.records.map(row => <tr key={row.id} className="border-t align-top"><td className="p-3"><Link className="underline" href={`/sales/leads/${encodeURIComponent(row.id)}`}>{row.name || row.id}</Link><br />{row.market}<br />Source: {row.source}</td><td className="p-3">{row.feedback.outcome}<br />{row.feedback.reason}<br />{row.feedback.status.replaceAll('_', ' ')}<br />{row.feedback.competitor}</td><td className="p-3 whitespace-pre-wrap">{row.feedback.customerWords || 'Not recorded'}<br /><small>{row.feedback.sourceId === 'manual' || row.feedback.sourceId.startsWith('note:') ? 'Rep-reported' : row.feedback.sourceId.startsWith('call:') ? 'Call transcript — rep reviewed' : row.feedback.sourceId ? 'Linked inbound SMS — rep reviewed' : 'No source'} · {row.feedback.reviewedBy}</small></td><td className="p-3">{row.feedback.context.map((c, i) => <p key={i}>{c.field.replaceAll('_', ' ')}: {c.value} <small>({c.sourceId === 'manual' || c.sourceId.startsWith('note:') ? 'rep-reported' : 'linked evidence, rep reviewed'})</small></p>)}</td><td className="p-3 whitespace-pre-wrap">{row.feedback.repNotes}</td></tr>)}</tbody></table></div>
    </>}
  </main>
}
