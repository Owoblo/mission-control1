'use client'

import { useEffect, useState } from 'react'

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
  job: { crewSize: number | null; truckCount: number | null; estimatedHours: number | null; crewNote: string; equipmentReady: boolean; briefingReady: boolean }
}

const ROLE_LABELS: Record<string, string> = {
  crew_lead: 'Crew Lead',
  driver: 'Driver',
  mover: 'Mover',
  other: 'Crew',
}

export default function CrewDispatchPage({ params }: { params: { token: string } }) {
  const [job, setJob] = useState<DispatchJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const response = await fetch(`/api/crew/dispatch/${params.token}`, { cache: 'no-store' })
    const payload = await response.json()
    setJob(response.ok ? payload.job : null)
    setMessage(response.ok ? '' : payload.error || 'Dispatch link unavailable.')
    setLoading(false)
  }

  useEffect(() => { void load() }, [params.token])

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
