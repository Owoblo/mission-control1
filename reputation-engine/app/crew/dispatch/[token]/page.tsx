'use client'

import { useEffect, useState, use } from 'react';

type DispatchJob = {
  customerName: string
  moveDate: string
  origin: string
  destination: string
  access: { origin: string; destination: string; parking: string }
  truck: {
    plan: string
    vendor: string
    pickupLocation: string
    pickupTime: string
    returnLocation: string
    reservationNumber: string
    notes: string
  }
  crew: { workerName: string; role: string; expectedHours: number | null; status: string }
  inventory: Array<{ id?: string; name: string; quantity: number; room: string; notes: string; precautions: string }>
  job: { crewSize: number | null; truckCount: number | null; estimatedHours: number | null; crewNote: string; equipmentReady: boolean; briefingReady: boolean; crewBriefing: string; partnerWorkspaceEnabled: boolean; billingModel: string }
}

type PartnerWorkspace = { messages: Array<{ id: string; direction: string; body: string; senderName?: string; urgent: boolean; createdAt: string }>; reports: Array<{ id: string; reportType: string; severity: string; status: string; summary: string; createdAt: string }>; events: Array<{ event_type: string }>; changeOrders: Array<{ id: string; change_type: string; description: string; customer_delta: number; partner_delta: number; status: string }>; operationsPhone: string }

const ROLE_LABELS: Record<string, string> = {
  crew_lead: 'Crew Lead',
  driver: 'Driver',
  mover: 'Mover',
  other: 'Crew',
}

export default function CrewDispatchPage(props: { params: Promise<{ token: string }> }) {
  const params = use(props.params);
  const [job, setJob] = useState<DispatchJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [workspace, setWorkspace] = useState<PartnerWorkspace | null>(null)
  const [partnerMessage, setPartnerMessage] = useState('')
  const [reportType, setReportType] = useState('additional_inventory')
  const [reportSummary, setReportSummary] = useState('')
  const [reportDetails, setReportDetails] = useState('')
  const [reportSeverity, setReportSeverity] = useState<'routine' | 'urgent' | 'critical'>('urgent')
  const [reportMedia, setReportMedia] = useState<Array<{ url: string; contentType?: string }>>([])
  const [changeMode, setChangeMode] = useState(false)
  const [changeLines, setChangeLines] = useState([{ description: '', kind: 'charge' as 'charge' | 'credit', customerAmount: '', partnerAmount: '' }])

  async function load() {
    setLoading(true)
    const response = await fetch(`/api/crew/dispatch/${params.token}`, { cache: 'no-store' })
    const payload = await response.json()
    setJob(response.ok ? payload.job : null)
    setMessage(response.ok ? '' : payload.error || 'Dispatch link unavailable.')
    setLoading(false)
  }

  useEffect(() => { void load() }, [params.token])

  async function loadWorkspace() {
    const response = await fetch(`/api/contractor/jobs/${params.token}/workspace`, { cache: 'no-store' })
    if (response.ok) setWorkspace(await response.json())
  }

  useEffect(() => { if (job?.job.partnerWorkspaceEnabled) void loadWorkspace() }, [job?.job.partnerWorkspaceEnabled])

  async function sendPartnerAction(payload: Record<string, unknown>) {
    setBusy(true); setMessage('')
    const outgoing = payload.action === 'report' || payload.action === 'change_order' ? { ...payload, media: reportMedia } : payload
    const response = await fetch(`/api/contractor/jobs/${params.token}/workspace`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(outgoing) })
    const body = await response.json()
    setMessage(response.ok ? 'Operations received your update.' : body.error || 'Could not send update.')
    if (response.ok) { setPartnerMessage(''); setReportSummary(''); setReportDetails(''); setReportMedia([]); await loadWorkspace() }
    setBusy(false)
  }

  const walkthroughComplete = !!workspace?.events.some(item => item.event_type === 'walkthrough_complete')
  const openChange = workspace?.changeOrders.find(item => ['operations_review', 'customer_authorization'].includes(item.status))
  const netCustomer = changeLines.reduce((sum, item) => sum + (item.kind === 'credit' ? -1 : 1) * Number(item.customerAmount || 0), 0)
  const netPartner = changeLines.reduce((sum, item) => sum + (item.kind === 'credit' ? -1 : 1) * Number(item.partnerAmount || 0), 0)

  async function uploadEvidence(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setMessage('Uploading evidence…')
    const form = new FormData()
    Array.from(files).forEach(file => form.append('files', file))
    form.append('category', reportType)
    const response = await fetch(`/api/contractor/jobs/${params.token}/upload`, { method: 'POST', body: form })
    const body = await response.json()
    if (response.ok) { setReportMedia(current => [...current, ...(body.assets || [])]); setMessage(`${body.assets?.length || 0} evidence file(s) attached.`) }
    else setMessage(body.error || 'Upload failed.')
    setBusy(false)
  }

  async function respond(action: 'confirm' | 'decline') {
    setBusy(true)
    const response = await fetch(`/api/crew/dispatch/${params.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const payload = await response.json()
    if (response.ok) {
      setJob(current => current ? { ...current, crew: { ...current.crew, status: payload.status } } : current)
      setMessage(action === 'confirm' ? 'Confirmed. Saturn Star has your response.' : 'Declined. Saturn Star has your response.')
    } else {
      setMessage(payload.error || 'Could not update response.')
    }
    setBusy(false)
  }

  if (loading) {
    return <main className="min-h-screen bg-slate-50 p-6 text-sm text-slate-500">Loading dispatch...</main>
  }

  if (!job) {
    return <main className="min-h-screen bg-slate-50 p-6 text-sm text-rose-700">{message || 'Dispatch link unavailable.'}</main>
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <section className="rounded-xl bg-[#071421] p-5 text-white shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C99700]">Saturn Star Dispatch</div>
          <h1 className="mt-2 text-2xl font-bold">{job.moveDate}</h1>
          <p className="mt-1 text-sm text-white/70">{ROLE_LABELS[job.crew.role] || job.crew.role} · {job.crew.workerName}</p>
          <div className="mt-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
            Status: {job.crew.status}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Route</div>
          <div className="mt-3 space-y-3 text-sm text-[#071421]">
            <div><span className="font-semibold">From:</span> {job.origin}</div>
            <div><span className="font-semibold">To:</span> {job.destination}</div>
          </div>
        </section>

        {job.job.crewBriefing && <section className="rounded-xl border border-[#C99700]/40 bg-white p-5 shadow-sm"><div className="text-xs font-bold uppercase tracking-[0.16em] text-[#C99700]">Authorized crew briefing</div><pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">{job.job.crewBriefing}</pre></section>}

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Authorized inventory</div><p className="mt-1 text-sm text-slate-600">Walk through this list with the customer before moving anything.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{job.inventory.length} lines</span></div><div className="mt-4 max-h-80 divide-y overflow-y-auto rounded-xl border">{job.inventory.length ? job.inventory.map((item, index) => <div key={item.id || `${item.name}-${index}`} className="p-3"><div className="flex justify-between gap-3 text-sm"><span className="font-semibold">{item.quantity > 1 ? `${item.quantity}× ` : ''}{item.name}</span><span className="text-slate-400">{item.room}</span></div>{(item.precautions || item.notes) && <p className="mt-1 text-xs text-amber-800">{item.precautions || item.notes}</p>}</div>) : <p className="p-4 text-sm text-rose-700">No authorized inventory is attached. Call Operations before starting.</p>}</div></section>

        {job.job.partnerWorkspaceEnabled && <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div><div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Operations communication</div><p className="mt-1 text-sm text-slate-600">Routine updates stay in this job record. For critical safety issues, call Operations immediately.</p>{workspace?.operationsPhone && <a href={`tel:${workspace.operationsPhone}`} className="mt-3 inline-flex rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white">Call Operations · {workspace.operationsPhone}</a>}</div>
          <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3">{workspace?.messages.length ? workspace.messages.map(item => <div key={item.id} className={`rounded-xl p-3 text-sm ${item.direction === 'partner_to_operations' ? 'ml-6 bg-[#071421] text-white' : 'mr-6 border bg-white text-slate-700'}`}><div className="text-[10px] font-bold uppercase opacity-60">{item.senderName || item.direction.replaceAll('_', ' ')} · {new Date(item.createdAt).toLocaleString()}</div><p className="mt-1 whitespace-pre-wrap">{item.body}</p></div>) : <p className="text-sm text-slate-400">No job messages yet.</p>}</div>
          <div className="flex gap-2"><input value={partnerMessage} onChange={event => setPartnerMessage(event.target.value)} placeholder="Send an update to Operations" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"/><button disabled={busy || !partnerMessage.trim()} onClick={() => sendPartnerAction({ action: 'message', body: partnerMessage })} className="rounded-xl bg-[#071421] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Send</button></div>
          <div className="border-t border-slate-200 pt-4"><div className="flex gap-2"><button onClick={() => setChangeMode(false)} className={`rounded-lg px-3 py-2 text-xs font-bold ${!changeMode ? 'bg-[#071421] text-white' : 'border'}`}>Report issue</button><button onClick={() => setChangeMode(true)} className={`rounded-lg px-3 py-2 text-xs font-bold ${changeMode ? 'bg-rose-600 text-white' : 'border text-rose-700'}`}>Request change order</button></div>{changeMode ? <div className="mt-4"><h3 className="font-bold text-rose-700">Document scope difference</h3><select value={reportType} onChange={event => setReportType(event.target.value)} className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="inventory">Inventory differs</option><option value="extra_labor">Extra labour</option><option value="extra_truck">Extra truck</option><option value="extra_trip">Extra trip</option><option value="access">Access differs</option><option value="other">Other</option></select><input value={reportSummary} onChange={event => setReportSummary(event.target.value)} placeholder="What is different from the agreed scope?" className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"/>{changeLines.map((line, index) => <div key={index} className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-4"><input value={line.description} onChange={e => setChangeLines(lines => lines.map((x,i) => i===index ? {...x,description:e.target.value}:x))} placeholder="Item/work" className="rounded-lg border px-2 py-2 text-sm sm:col-span-2"/><select value={line.kind} onChange={e => setChangeLines(lines => lines.map((x,i) => i===index ? {...x,kind:e.target.value as 'charge'|'credit'}:x))} className="rounded-lg border px-2 py-2 text-sm"><option value="charge">Added</option><option value="credit">Removed / credit</option></select><button onClick={() => setChangeLines(lines => lines.filter((_,i) => i!==index))} className="text-xs font-bold text-rose-600">Remove</button><input type="number" min="0" value={line.customerAmount} onChange={e => setChangeLines(lines => lines.map((x,i) => i===index ? {...x,customerAmount:e.target.value}:x))} placeholder="Customer $ suggestion" className="rounded-lg border px-2 py-2 text-sm sm:col-span-2"/><input type="number" min="0" value={line.partnerAmount} onChange={e => setChangeLines(lines => lines.map((x,i) => i===index ? {...x,partnerAmount:e.target.value}:x))} placeholder="Your payout $" className="rounded-lg border px-2 py-2 text-sm sm:col-span-2"/></div>)}<button onClick={() => setChangeLines(lines => [...lines,{description:'',kind:'charge',customerAmount:'',partnerAmount:''}])} className="mt-2 text-xs font-bold text-sky-700">+ Add another line or credit</button><div className="mt-3 rounded-xl border p-3 text-sm"><div>Suggested customer net: <b>${netCustomer.toFixed(2)}</b></div><div>Requested payout net: <b>${netPartner.toFixed(2)}</b></div></div><button disabled={busy || !reportSummary.trim() || !changeLines.some(line => line.description.trim())} onClick={() => sendPartnerAction({ action:'change_order', changeType:reportType, summary:reportSummary, billingModel:job.job.billingModel, lineItems:changeLines })} className="mt-3 w-full rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-40">Pause changed work & send to Operations</button></div> : <div className="mt-4"><h3 className="font-bold text-rose-700">Report an issue</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><select value={reportType} onChange={event => setReportType(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="access_problem">Access problem</option><option value="damage_discovered">Pre-existing damage</option><option value="damage_occurred">Damage occurred</option><option value="truck_issue">Truck issue</option><option value="crew_issue">Crew issue</option><option value="delay">Delay</option><option value="safety_concern">Safety concern</option><option value="payment_issue">Payment issue</option><option value="other">Other</option></select><select value={reportSeverity} onChange={event => setReportSeverity(event.target.value as typeof reportSeverity)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="critical">Critical — call Operations</option></select></div><input value={reportSummary} onChange={event => setReportSummary(event.target.value)} placeholder="Short factual summary" className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"/><textarea value={reportDetails} onChange={event => setReportDetails(event.target.value)} placeholder="Who, what, where, when, and action taken" className="mt-3 min-h-28 w-full rounded-xl border border-slate-300 p-3 text-sm"/><button disabled={busy || !reportSummary.trim()} onClick={() => sendPartnerAction({ action:'report', reportType, severity:reportSeverity, summary:reportSummary, details:reportDetails })} className="mt-3 w-full rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-40">Submit field report</button></div>}<p className="mt-2 text-xs text-slate-500">Do not negotiate customer pricing or perform changed work until Operations authorizes it.</p></div>
          <label className="block rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-semibold text-slate-700">Upload categorized evidence<input type="file" accept="image/*,video/*" multiple onChange={event => void uploadEvidence(event.target.files)} className="mt-2 block w-full text-xs"/>{reportMedia.length > 0 && <span className="mt-2 block text-emerald-700">{reportMedia.length} file(s) ready with this report</span>}</label>
        </section>}

        {job.job.partnerWorkspaceEnabled && <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Mandatory start control</div>{openChange && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-800">Changed work is paused: {openChange.description} ({openChange.status.replaceAll('_',' ')}).</p>}<div className="mt-3 grid gap-3 sm:grid-cols-2"><button disabled={busy || walkthroughComplete} onClick={() => sendPartnerAction({action:'checkpoint',eventType:'walkthrough_complete',details:'Authorized inventory and access reviewed on arrival.'})} className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 disabled:opacity-50">{walkthroughComplete ? '✓ Walkthrough complete' : 'Complete walkthrough'}</button><button disabled={busy || !walkthroughComplete || !!openChange} onClick={() => sendPartnerAction({action:'checkpoint',eventType:'work_started'})} className="rounded-xl bg-[#071421] px-4 py-3 text-sm font-bold text-white disabled:opacity-40">Start authorized work</button></div></section>}

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Plan</div>
          <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
            <div>{job.job.crewSize || '-'} crew</div>
            <div>{job.job.truckCount || '-'} truck(s)</div>
            <div>~{job.crew.expectedHours || job.job.estimatedHours || '-'}h</div>
          </div>
          {job.job.crewNote ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{job.job.crewNote}</p> : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Truck</div>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            <div>{job.truck.plan}</div>
            {job.truck.vendor ? <div>Vendor: {job.truck.vendor}</div> : null}
            {job.truck.pickupLocation ? <div>Pickup: {job.truck.pickupLocation}</div> : null}
            {job.truck.pickupTime ? <div>Pickup time: {new Date(job.truck.pickupTime).toLocaleString()}</div> : null}
            {job.truck.returnLocation ? <div>Return: {job.truck.returnLocation}</div> : null}
            {job.truck.reservationNumber ? <div>Reservation #: {job.truck.reservationNumber}</div> : null}
            {job.truck.notes ? <div className="rounded-xl bg-slate-50 px-3 py-2">{job.truck.notes}</div> : null}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Access</div>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            {job.access.origin ? <div>Origin: {job.access.origin}</div> : null}
            {job.access.destination ? <div>Destination: {job.access.destination}</div> : null}
            {job.access.parking ? <div>Parking: {job.access.parking}</div> : null}
            {!job.access.origin && !job.access.destination && !job.access.parking ? <div>No special access notes yet.</div> : null}
          </div>
        </section>

        {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <button disabled={busy} onClick={() => void respond('confirm')} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
            Confirm I am available
          </button>
          <button disabled={busy} onClick={() => void respond('decline')} className="rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm font-bold text-rose-700 disabled:opacity-60">
            I cannot make it
          </button>
        </div>
      </div>
    </main>
  )
}
