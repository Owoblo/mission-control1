'use client'

import { useEffect, useState, use } from 'react';
import { ClipboardCheck, ClipboardList, MessageSquare, Route, TriangleAlert, X } from 'lucide-react';
import { findQueuedAction, flushCrewQueue, pendingCrewActionCount, queueCrewAction, queueWalkthroughMedia } from '@/lib/crew-offline-queue';
import CrewBottomNav from '@/app/components/crew-bottom-nav';

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
  job: { planFingerprint?: string; crewSize: number | null; truckCount: number | null; estimatedHours: number | null; crewNote: string; equipmentReady: boolean; briefingReady: boolean; crewBriefing: string; partnerWorkspaceEnabled: boolean }
  briefing: {
    generatedAt: string
    sourceUpdatedAt: string
    quoteStatus: string
    authorizedBrief: string
    routeLegs: Array<{ id: string; label: string; type: string; origin: string; destination: string; scheduledDate: string; notes: string }>
    inventory: Array<{ id: string; label: string; quantity: number; room: string; destinationRoom: string; included: boolean; exclusionReason: string; notes: string; handling: string; handlingFlags: string[]; assemblyRequired: boolean; pathRisks: string[] }>
    photos: Array<{ id: string; url: string; label: string; source: string }>
    specialInstructions: string[]
    scopeLines: Array<{ description: string; details: string }>
    changes: Array<{ id: string; reason: string; note: string; status: string; changedAt: string }>
    intelligence: { level: string; uncertaintyPct: number; risks: string[]; unresolved: string[] }
  }
}

type PartnerWorkspace = { messages: Array<{ id: string; direction: string; body: string; senderName?: string; urgent: boolean; createdAt: string }>; reports: Array<{ id: string; reportType: string; severity: string; status: string; summary: string; createdAt: string }>; operationsPhone: string }
type AcceptedScope = { id: string; scope_code: string; version: number; snapshot_hash: string }

const ROLE_LABELS: Record<string, string> = {
  crew_lead: 'Crew Lead',
  driver: 'Driver',
  mover: 'Mover',
  other: 'Crew',
}

// Uploads arrival photos/videos captured on-device to the contractor upload
// endpoint. Used by the offline queue: queued walkthroughs can't be posted
// until their evidence exists server-side.
async function uploadWalkthroughMedia(token: string, files: File[]): Promise<Array<{ url: string; contentType?: string }>> {
  const form = new FormData()
  files.forEach(file => form.append('files', file))
  form.append('category', 'arrival_walkthrough')
  const response = await fetch(`/api/contractor/jobs/${token}/upload`, { method: 'POST', body: form })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'Evidence upload failed.')
  return (body.assets || []) as Array<{ url: string; contentType?: string }>
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
  const [photo, setPhoto] = useState<{ url: string; label: string } | null>(null)
  const [offlinePending, setOfflinePending] = useState(0)
  const [pendingMedia, setPendingMedia] = useState<File[]>([])
  // walkthroughQueued = saved on this device, not yet accepted by the server.
  // walkthroughDone = the server confirmed it. Never confuse the two in UI copy.
  const [walkthroughQueued, setWalkthroughQueued] = useState(false)

  // Replay any actions queued while offline — on load and when connectivity returns.
  useEffect(() => {
    let cancelled = false
    async function flush() {
      if (!navigator.onLine) return
      const queuedWalkthrough = findQueuedAction(params.token, 'walkthrough')
      const { sent, dropped, remaining, sentIds, droppedIds } = await flushCrewQueue(uploadWalkthroughMedia)
      if (cancelled) return
      if (sent > 0 || dropped > 0) {
        setMessage(
          dropped > 0
            ? `Back online — ${sent} update${sent === 1 ? '' : 's'} sent, ${dropped} rejected by the server (no longer needed).`
            : `Back online — ${sent} queued update${sent === 1 ? '' : 's'} sent to Operations.`,
        )
        void load()
      }
      setOfflinePending(remaining)
      if (queuedWalkthrough) {
        if (sentIds.includes(queuedWalkthrough.id)) {
          // The server accepted it — only now may the UI call it recorded.
          setWalkthroughQueued(false)
          setWalkthroughDone(true)
        } else if (droppedIds.includes(queuedWalkthrough.id)) {
          // Rejected (e.g. the accepted scope changed while offline) — the
          // crew must complete the walkthrough again; never silently drop it.
          setWalkthroughQueued(false)
          setMessage('The saved walkthrough was rejected by the server (the accepted scope may have changed). Please complete the walkthrough again.')
        }
      }
    }
    setOfflinePending(pendingCrewActionCount())
    if (findQueuedAction(params.token, 'walkthrough')) setWalkthroughQueued(true)
    void flush()
    window.addEventListener('online', flush)
    return () => { cancelled = true; window.removeEventListener('online', flush) }
  }, [params.token])

  // Posts a crew action, or queues it on-device when offline.
  // Returns true when the action was queued instead of sent.
  function maybeQueueOffline(endpoint: 'dispatch' | 'workspace' | 'walkthrough', payload: Record<string, unknown>): boolean {
    if (navigator.onLine) return false
    queueCrewAction({ token: params.token, endpoint, payload })
    setOfflinePending(pendingCrewActionCount())
    setMessage('You are offline — this update is saved on your device and will send automatically when you are back online.')
    return true
  }
  const [acceptedScope, setAcceptedScope] = useState<AcceptedScope | null>(null)
  const [expectedBoxes, setExpectedBoxes] = useState(0)
  const [observedBoxes, setObservedBoxes] = useState(0)
  const [walkthroughMatches, setWalkthroughMatches] = useState(true)
  const [walkthroughNote, setWalkthroughNote] = useState('')
  const [walkthroughDone, setWalkthroughDone] = useState(false)

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
    const [response, scopeResponse] = await Promise.all([
      fetch(`/api/contractor/jobs/${params.token}/workspace`, { cache: 'no-store' }),
      fetch(`/api/contractor/jobs/${params.token}/walkthrough`, { cache: 'no-store' }),
    ])
    if (response.ok) setWorkspace(await response.json())
    if (scopeResponse.ok) setAcceptedScope((await scopeResponse.json()).scope)
  }

  async function submitWalkthrough() {
    if (!acceptedScope) return setMessage('The accepted scope is not available. Call Operations.')
    if (walkthroughQueued) return
    if (!reportMedia.length && !pendingMedia.length) return setMessage('Add at least one arrival photo or video before completing the walkthrough. You can take photos offline — they will upload when you are back online.')
    const walkthroughPayload = {
        scopeVersionId: acceptedScope.id,
        inventory: { materiallyMatches: walkthroughMatches, expectedBoxes, observedBoxes, addedItems: [], removedItems: [], garageVerified: null, basementVerified: null, storageVerified: null },
        access: { stairsMatch: walkthroughMatches, elevatorMatch: walkthroughMatches, parkingMatch: walkthroughMatches, carryDistanceMatch: walkthroughMatches, restrictions: walkthroughNote ? [walkthroughNote] : [] },
        handling: { undisclosedHeavyItems: [], unplannedDisassembly: [], missingEquipment: [] },
        capacity: { truckPlanAppropriate: walkthroughMatches, visualAssessment: walkthroughMatches ? 'within_expected' : 'over_expected', note: walkthroughNote },
        evidence: reportMedia.map(item => ({ url: item.url, kind: item.contentType?.startsWith('video/') ? 'video' : 'image', label: 'Arrival walkthrough' })),
        note: walkthroughNote,
      }
    if (!navigator.onLine) {
      // Full offline walkthrough: steps and notes are queued as JSON and any
      // on-device photos are persisted alongside the action. The flush uploads
      // the photos first, then posts — the server rejects evidence-less
      // walkthroughs, so neither half may go without the other.
      const photoCount = pendingMedia.length
      const action = queueCrewAction({ token: params.token, endpoint: 'walkthrough', payload: walkthroughPayload })
      if (photoCount > 0) {
        await queueWalkthroughMedia(action.id, params.token, pendingMedia).catch(() => {})
        setPendingMedia([])
      }
      setOfflinePending(pendingCrewActionCount())
      setWalkthroughQueued(true)
      setMessage(`Walkthrough saved on this device${photoCount > 0 ? ` with ${photoCount} photo${photoCount === 1 ? '' : 's'}` : ''} — it will send to Operations automatically when you are back online.`)
      return
    }
    setBusy(true); setMessage('Saving arrival verification…')
    const response = await fetch(`/api/contractor/jobs/${params.token}/walkthrough`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(walkthroughPayload),
    })
    const body = await response.json()
    setMessage(response.ok ? (body.workMayStart ? 'Walkthrough matches the accepted scope. Work may begin.' : 'Discrepancy recorded. Do not begin changed work until Operations resolves it.') : body.error || 'Could not save walkthrough.')
    if (response.ok) setWalkthroughDone(true)
    setBusy(false)
  }

  useEffect(() => { if (job?.job.partnerWorkspaceEnabled) void loadWorkspace() }, [job?.job.partnerWorkspaceEnabled])

  async function sendPartnerAction(payload: Record<string, unknown>) {
    const outgoing = payload.action === 'report' ? { ...payload, media: reportMedia } : payload
    if (maybeQueueOffline('workspace', outgoing)) return
    setBusy(true); setMessage('')
    const response = await fetch(`/api/contractor/jobs/${params.token}/workspace`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(outgoing) })
    const body = await response.json()
    setMessage(response.ok ? 'Operations received your update.' : body.error || 'Could not send update.')
    if (response.ok) { setPartnerMessage(''); setReportSummary(''); setReportDetails(''); setReportMedia([]); await loadWorkspace() }
    setBusy(false)
  }

  async function uploadEvidence(files: FileList | null) {
    if (!files?.length) return
    if (!navigator.onLine) {
      // Photos can be taken offline — they stay on this device and upload
      // with the queued walkthrough when connectivity returns.
      const count = files.length
      setPendingMedia(current => [...current, ...Array.from(files)])
      setMessage(`${count} photo${count === 1 ? '' : 's'} saved on this device — ${count === 1 ? 'it' : 'they'} will upload when you are back online.`)
      return
    }
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
    const outgoing = { action, planFingerprint: job?.job.planFingerprint }
    if (maybeQueueOffline('dispatch', outgoing)) return
    setBusy(true)
    const response = await fetch(`/api/crew/dispatch/${params.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outgoing),
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
        <section id="crew-job" className="scroll-mt-24 rounded-xl bg-[#071421] p-5 text-white shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C99700]">Saturn Star Dispatch</div>
          <h1 className="mt-2 text-2xl font-bold">{job.moveDate}</h1>
          <p className="mt-1 text-sm text-white/70">{ROLE_LABELS[job.crew.role] || job.crew.role} · {job.crew.workerName}</p>
          <div className="mt-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
            Status: {job.crew.status}
          </div>
        </section>

        <section id="crew-briefing" className="scroll-mt-24 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3"><div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Complete route</div><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold uppercase text-slate-500">Live briefing</span></div>
          <div className="mt-4 space-y-3">{job.briefing.routeLegs.map((leg, index) => <div key={leg.id} className="rounded-xl border border-slate-200 p-4"><div className="text-xs font-bold uppercase tracking-wide text-[var(--app-warm)]">Leg {index + 1} · {leg.type.replaceAll('_', ' ')}</div><div className="mt-1 font-bold text-[#071421]">{leg.label}</div><div className="mt-2 text-sm text-slate-600">{leg.origin} <span className="px-1 text-slate-300">→</span> {leg.destination}</div>{leg.scheduledDate && <div className="mt-1 text-xs text-slate-500">{leg.scheduledDate}</div>}{leg.notes && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{leg.notes}</p>}</div>)}</div>
        </section>

        {(job.briefing.specialInstructions.length > 0 || job.briefing.intelligence.risks.length > 0 || job.briefing.intelligence.unresolved.length > 0) && <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 shadow-sm"><div className="text-xs font-bold uppercase tracking-[0.16em] text-amber-800">Read before arrival</div><div className="mt-3 space-y-2 text-sm text-amber-950">{job.briefing.specialInstructions.map(item => <p key={item}>• {item}</p>)}{job.briefing.intelligence.risks.map(item => <p key={item}>• {item}</p>)}</div>{job.briefing.intelligence.unresolved.length > 0 && <div className="mt-4 rounded-xl border border-rose-200 bg-white p-3"><div className="text-xs font-bold uppercase text-rose-700">Verify with Operations</div>{job.briefing.intelligence.unresolved.map(item => <p key={item} className="mt-1 text-sm text-rose-800">• {item}</p>)}</div>}</section>}

        {job.job.crewBriefing && <section className="rounded-xl border border-[#C99700]/40 bg-white p-5 shadow-sm"><div className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--app-warm)]">Authorized crew briefing</div><pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">{job.job.crewBriefing}</pre></section>}

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Inventory scope</div><div className="text-xs text-slate-500">{job.briefing.inventory.filter(item => item.included).reduce((sum, item) => sum + item.quantity, 0)} pieces</div></div><div className="mt-4 space-y-2">{job.briefing.inventory.filter(item => item.included).map(item => <div key={item.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-[#071421]">{item.quantity > 1 ? `${item.quantity}× ` : ''}{item.label}</div><div className="text-xs text-slate-500">{item.room}{item.destinationRoom ? ` → ${item.destinationRoom}` : ''}</div></div><span className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${item.handling === 'specialty' || item.handling === 'high' ? 'bg-rose-100 text-rose-700' : item.handling === 'elevated' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>{item.handling}</span></div>{item.assemblyRequired && <div className="mt-2 text-xs font-semibold text-blue-700">Tools / disassembly review required</div>}{item.notes && <p className="mt-2 text-xs text-slate-600">{item.notes}</p>}{item.pathRisks.map(risk => <p key={risk} className="mt-1 text-xs text-rose-700"><TriangleAlert className="mr-1 inline h-3.5 w-3.5" aria-hidden />{risk}</p>)}</div>)}</div>{job.briefing.inventory.some(item => !item.included) && <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4"><div className="text-xs font-bold uppercase text-rose-700">Do not move</div>{job.briefing.inventory.filter(item => !item.included).map(item => <p key={item.id} className="mt-2 text-sm text-rose-900"><X className="mr-1 inline h-4 w-4" aria-hidden />{item.quantity > 1 ? `${item.quantity}× ` : ''}{item.label}{item.exclusionReason ? ` — ${item.exclusionReason}` : ''}</p>)}</div>}</section>

        {job.briefing.photos.length > 0 && <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Property & inventory photos</div><p className="mt-1 text-xs text-slate-500">Tap to inspect before arrival. Use the written scope as authority if a reference photo shows excluded property.</p><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{job.briefing.photos.map(item => <button key={item.id} onClick={() => setPhoto(item)} className="overflow-hidden rounded-xl border bg-slate-50 text-left"><img src={item.url} alt={item.label} loading="lazy" className="aspect-square w-full object-cover"/><div className="truncate p-2 text-xs font-semibold text-slate-700">{item.label}</div></button>)}</div></section>}

        {(job.briefing.scopeLines.length > 0 || job.briefing.changes.length > 0) && <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Accepted scope & changes</div><div className="mt-3 space-y-2">{job.briefing.scopeLines.map((line, index) => <div key={`${line.description}-${index}`} className="rounded-xl bg-slate-50 p-3"><div className="text-sm font-semibold text-[#071421]">{line.description}</div>{line.details && <p className="mt-1 text-xs text-slate-600">{line.details}</p>}</div>)}</div>{job.briefing.changes.length > 0 && <div className="mt-4 border-t pt-4">{job.briefing.changes.map(change => <div key={change.id} className="mt-2 text-sm"><span className={`mr-2 rounded-full px-2 py-1 text-[11px] font-bold uppercase ${change.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>{change.status.replaceAll('_', ' ')}</span>{change.reason}{change.note ? ` — ${change.note}` : ''}</div>)}</div>}</section>}

        {job.job.partnerWorkspaceEnabled && <section id="crew-messages" className="scroll-mt-24 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div><div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Operations communication</div><p className="mt-1 text-sm text-slate-600">Routine updates stay in this job record. For critical safety issues, call Operations immediately.</p>{workspace?.operationsPhone && <a href={`tel:${workspace.operationsPhone}`} className="mt-3 inline-flex rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white">Call Operations · {workspace.operationsPhone}</a>}</div>
          <div id="crew-walkthrough" className="scroll-mt-24 rounded-xl border-2 border-[#C99700]/50 bg-amber-50 p-4"><div className="text-xs font-bold uppercase tracking-[0.16em] text-amber-900">Required arrival walkthrough</div>{acceptedScope ? <p className="mt-1 text-xs text-amber-800">Verify against {acceptedScope.scope_code} · immutable version {acceptedScope.version}</p> : <p className="mt-1 text-xs font-semibold text-rose-700">Accepted scope unavailable—call Operations before work starts.</p>}{walkthroughQueued ? <div role="status" className="mt-3 rounded-xl border border-amber-300 bg-white/70 p-4"><div className="text-sm font-bold text-amber-900">Walkthrough saved on this device</div><p className="mt-1 text-xs leading-5 text-amber-800">It will send to Operations automatically when you&apos;re back online. Nothing has been recorded on the server yet — work may not begin until Operations confirms.</p></div> : <><div className="mt-3 grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-700">Expected boxes<input type="number" inputMode="numeric" min="0" value={expectedBoxes} onChange={event => setExpectedBoxes(Number(event.target.value))} className="mt-1 min-h-[44px] w-full rounded-lg border p-2"/></label><label className="text-xs font-semibold text-slate-700">Observed boxes<input type="number" inputMode="numeric" min="0" value={observedBoxes} onChange={event => setObservedBoxes(Number(event.target.value))} className="mt-1 min-h-[44px] w-full rounded-lg border p-2"/></label></div><label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><input type="checkbox" checked={walkthroughMatches} onChange={event => setWalkthroughMatches(event.target.checked)} className="h-6 w-6 shrink-0"/> Inventory, access, handling, and truck plan materially match</label><textarea value={walkthroughNote} onChange={event => setWalkthroughNote(event.target.value)} placeholder="Record every discrepancy or access restriction" className="mt-3 min-h-20 w-full rounded-lg border p-2 text-sm"/>{(reportMedia.length > 0 || pendingMedia.length > 0) && <p className="mt-2 text-xs font-semibold text-amber-900">{reportMedia.length > 0 ? `${reportMedia.length} photo(s) uploaded. ` : ''}{pendingMedia.length > 0 ? `${pendingMedia.length} photo(s) saved on this device — waiting to upload.` : ''}</p>}<button disabled={busy || walkthroughDone || !acceptedScope} onClick={() => void submitWalkthrough()} className="mt-3 w-full rounded-xl bg-[#071421] px-4 py-3 text-sm font-bold text-white disabled:opacity-40">{walkthroughDone ? 'Walkthrough recorded' : 'Complete verified walkthrough'}</button></>}<p className="mt-2 text-xs text-amber-900">At least one arrival photo/video is mandatory. If the checkbox is cleared, work remains blocked pending Operations resolution.</p></div>
          <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3">{workspace?.messages.length ? workspace.messages.map(item => <div key={item.id} className={`rounded-xl p-3 text-sm ${item.direction === 'partner_to_operations' ? 'ml-6 bg-[#071421] text-white' : 'mr-6 border bg-white text-slate-700'}`}><div className="text-[11px] font-bold uppercase opacity-60">{item.senderName || item.direction.replaceAll('_', ' ')} · {new Date(item.createdAt).toLocaleString()}</div><p className="mt-1 whitespace-pre-wrap">{item.body}</p></div>) : <p className="text-sm text-slate-500">No job messages yet.</p>}</div>
          <div className="flex gap-2"><input value={partnerMessage} onChange={event => setPartnerMessage(event.target.value)} placeholder="Send an update to Operations" className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"/><button disabled={busy || !partnerMessage.trim()} onClick={() => sendPartnerAction({ action: 'message', body: partnerMessage })} className="min-h-[44px] rounded-xl bg-[#071421] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Send</button></div>
          <div className="border-t border-slate-200 pt-4"><h3 className="font-bold text-rose-700">Report an issue or scope change</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><select value={reportType} onChange={event => setReportType(event.target.value)} className="min-h-[44px] rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="additional_inventory">Additional inventory</option><option value="access_problem">Access problem</option><option value="parking_problem">Parking problem</option><option value="customer_disagreement">Customer disagreement</option><option value="damage_discovered">Pre-existing damage</option><option value="damage_occurred">Damage occurred</option><option value="truck_issue">Truck issue</option><option value="crew_issue">Crew issue</option><option value="delay">Delay</option><option value="additional_labor">Additional labour</option><option value="additional_truck">Additional truck</option><option value="safety_concern">Safety concern</option><option value="payment_issue">Payment issue</option><option value="other">Other</option></select><select value={reportSeverity} onChange={event => setReportSeverity(event.target.value as typeof reportSeverity)} className="min-h-[44px] rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="critical">Critical — call Operations</option></select></div><input value={reportSummary} onChange={event => setReportSummary(event.target.value)} placeholder="Short factual summary" className="mt-3 min-h-[44px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"/><textarea value={reportDetails} onChange={event => setReportDetails(event.target.value)} placeholder="Who, what, where, when, observed condition, action taken, and what decision you need from Operations" className="mt-3 min-h-28 w-full rounded-xl border border-slate-300 p-3 text-sm"/><button disabled={busy || !reportSummary.trim()} onClick={() => sendPartnerAction({ action: 'report', reportType, severity: reportSeverity, summary: reportSummary, details: reportDetails })} className="mt-3 w-full rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-40">Submit field report</button><p className="mt-2 text-xs text-slate-500">Do not negotiate price or perform added work until Operations authorizes it.</p></div>
          <label className="block rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-semibold text-slate-700">Upload categorized evidence<input type="file" accept="image/*,video/*" capture="environment" multiple onChange={event => void uploadEvidence(event.target.files)} className="mt-2 block w-full text-xs"/>{reportMedia.length > 0 && <span className="mt-2 block text-emerald-700">{reportMedia.length} file(s) ready with this report</span>}</label>
        </section>}

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Plan</div>
          <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
            <div>{job.job.crewSize || '-'} crew</div>
            <div>{job.job.truckCount || '-'} truck(s)</div>
            <div>~{job.crew.expectedHours || job.job.estimatedHours || '-'}h</div>
          </div>
          {job.job.crewNote ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{job.job.crewNote}</p> : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Truck</div>
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
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Access</div>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            {job.access.origin ? <div>Origin: {job.access.origin}</div> : null}
            {job.access.destination ? <div>Destination: {job.access.destination}</div> : null}
            {job.access.parking ? <div>Parking: {job.access.parking}</div> : null}
            {!job.access.origin && !job.access.destination && !job.access.parking ? <div>No special access notes yet.</div> : null}
          </div>
        </section>

        {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
        {offlinePending > 0 ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{offlinePending} update{offlinePending === 1 ? '' : 's'} saved on this device — {offlinePending === 1 ? 'it' : 'they'} will send automatically when you are back online.</div> : null}

        <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:bottom-0">
          <div className="grid gap-3 sm:grid-cols-2">
          <button disabled={busy} onClick={() => void respond('confirm')} className="min-h-[48px] rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
            Confirm I am available
          </button>
          <button disabled={busy} onClick={() => void respond('decline')} className="min-h-[48px] rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm font-bold text-rose-700 disabled:opacity-60">
            I cannot make it
          </button>
          </div>
        </div>
        <p className="pb-24 text-center text-[11px] text-slate-500 md:pb-4">Live job record · refreshed {new Date(job.briefing.generatedAt).toLocaleString()}{job.briefing.sourceUpdatedAt ? ` · scope updated ${new Date(job.briefing.sourceUpdatedAt).toLocaleString()}` : ''}</p>
      </div>
      {photo && <button onClick={() => setPhoto(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" aria-label="Close photo"><div className="max-h-full max-w-4xl"><img src={photo.url} alt={photo.label} className="max-h-[85vh] max-w-full rounded-xl object-contain"/><div className="mt-3 text-center text-sm font-semibold text-white">{photo.label} · tap anywhere to close</div></div></button>}
      <CrewBottomNav items={[
        { id: 'job', label: 'Job', href: '#crew-job', icon: ClipboardList },
        { id: 'briefing', label: 'Briefing', href: '#crew-briefing', icon: Route },
        ...(job.job.partnerWorkspaceEnabled ? [
          { id: 'walkthrough', label: 'Walkthrough', href: '#crew-walkthrough', icon: ClipboardCheck },
          { id: 'messages', label: 'Messages', href: '#crew-messages', icon: MessageSquare },
        ] : []),
      ]} />
    </main>
  )
}
