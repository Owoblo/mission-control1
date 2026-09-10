'use client'
import { useEffect, useState } from 'react'
import type { fulfilmentSummary, relationshipIdentity } from '@/lib/relationship-record'
type RecordData = { identity: ReturnType<typeof relationshipIdentity>; address: string | null; channels: Record<string, { inbound: number; outbound: number }>; historyLimited: boolean; tasksLimited: boolean; tasks: ReturnType<typeof fulfilmentSummary>[] }
const labels: Record<string, string> = { print_ready: 'Ready for printer', sent_to_printer: 'Sent to printer', awaiting_printer_confirmation: 'Waiting for printer confirmation', digital_email_sent: 'Email accepted by provider', sent: 'Email accepted by provider', draft: 'Email draft', waiting: 'Needs information', sending: 'Sending — check outcome', review_reply: 'Review reply', address_change_review: 'Review changed address', completed_elsewhere: 'Completed elsewhere' }
const readable = (value: string) => labels[value] || value.replace(/_/g, ' ')
export function RelationshipRecord({ contactId }: { contactId: string }) {
  const [data, setData] = useState<RecordData | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setData(null); setError(false)
    async function refresh() {
      try {
        const response = await fetch(`/api/marketing/contacts/${encodeURIComponent(contactId)}/relationship-record`, { credentials: 'include', signal: controller.signal })
        if (!response.ok) throw new Error('Could not load')
        const result = await response.json()
        if (!controller.signal.aborted) { setData(result); setError(false) }
      } catch { if (!controller.signal.aborted) setError(true) }
    }
    void refresh()
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 60000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [contactId, retry])
  if (error) return <div className="rounded-xl border border-amber-200 p-3 text-xs text-amber-900">Tracking could not refresh. <button className="underline" onClick={() => setRetry(r => r + 1)}>Retry</button></div>
  if (!data) return <div className="p-3 text-xs text-slate-500">Loading relationship tracking…</div>
  const identity = data.identity
  return <section className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
    <h3 className="text-sm font-semibold text-[#071421]">Relationship tracking</h3>
    <dl className="mt-3 space-y-2">
      {[
        ['Category', identity.category.label], ['Role', identity.role], ['Recorded city', identity.city],
        ['Service region', identity.serviceRegion || 'Needs mapping'], ['Phone hub', identity.phoneHub || 'Needs mapping'],
        ['Preferred contact', identity.preferredChannel || 'Not recorded'], ['Mailing address', data.address || 'Not recorded'],
      ].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="break-words font-medium text-slate-800">{value}</dd></div>)}
    </dl>
    <div className="mt-4 border-t border-slate-100 pt-3">
      <h4 className="font-semibold text-slate-800">Recorded communication</h4>
      <div className="mt-2 grid grid-cols-2 gap-2">{[['sms', 'SMS / pictures'], ['email', 'Email'], ['phone', 'Calls'], ['direct_mail', 'Direct mail']].map(([key, label]) => <div key={key} className="rounded-lg bg-slate-50 p-2"><div className="font-medium">{label}</div><div className="mt-1 text-slate-500">{data.channels[key]?.outbound || 0} outbound · {data.channels[key]?.inbound || 0} inbound</div></div>)}</div>
      <p className="mt-2 text-[10px] text-slate-500">{data.historyLimited ? 'Counts cover the latest 500 recorded events.' : 'Counts reflect CRM events, not delivery confirmation.'}</p>
    </div>
    <div className="mt-4 border-t border-slate-100 pt-3">
      <h4 className="font-semibold text-slate-800">Outstanding promises and fulfilment</h4>
      {!data.tasks.length && <p className="mt-2 text-slate-500">No tracked fulfilment tasks. Check the conversation for older commitments.</p>}
      <div className="mt-2 space-y-3">{data.tasks.map(task => <div key={task.id} className="rounded-lg border border-slate-100 p-2">
        <div className="font-semibold text-slate-800">{task.title}</div>
        <div className="mt-1 font-medium text-emerald-800">{readable(task.status)}</div>
        {task.reason && <p className="mt-1 leading-5 text-slate-600">{task.reason}</p>}
        {task.dispatchStatus && <p className="mt-1 text-slate-500">Mailing: {readable(task.dispatchStatus)}</p>}
        {task.receiptStatus && <p className="text-slate-500">Recipient receipt: {readable(task.receiptStatus)}</p>}
        {task.hasPhoto && <p className="mt-1 text-slate-500">Photo evidence: {task.photoReviewed ? 'reviewed' : 'needs review'}</p>}
      </div>)}</div>
      {data.tasksLimited && <p className="mt-2 text-slate-500">Showing the latest 50 fulfilment tasks.</p>}
    </div>
  </section>
}
