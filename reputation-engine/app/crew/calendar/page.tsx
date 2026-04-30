'use client'

import { useEffect, useState } from 'react'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import Link from 'next/link'
import { buildCrewWorkDoc, formatDate, formatMoney } from '@/lib/sales'
import type { CRMLead, CRMQuote, CRMWorker } from '@/lib/types'

type Job = { lead: CRMLead; quote: CRMQuote | null }

function daysUntil(dateStr?: string) {
  if (!dateStr) return null
  const diff = new Date(`${dateStr}T12:00:00`).getTime() - new Date().setHours(12, 0, 0, 0)
  return Math.ceil(diff / 86400000)
}

function MoveBadge({ dateStr }: { dateStr?: string }) {
  const days = daysUntil(dateStr)
  if (!dateStr) return <span className="text-xs text-slate-400">Date TBD</span>
  const label = days === 0 ? 'TODAY' : days === 1 ? 'TOMORROW' : days !== null && days < 0 ? 'Past' : `In ${days}d`
  const color =
    days === 0 ? 'bg-rose-600 text-white' :
    days === 1 ? 'bg-amber-500 text-white' :
    days !== null && days < 0 ? 'bg-slate-200 text-slate-500' :
    'bg-emerald-100 text-emerald-800'
  return (
    <div className="flex items-center gap-2">
      <span className="font-semibold text-[#1a2744]">{formatDate(dateStr)}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${color}`}>{label}</span>
    </div>
  )
}

function JobCard({ job, workers, onHoursLogged }: { job: Job; workers: CRMWorker[]; onHoursLogged: (leadId: string, hours: number) => void }) {
  const { lead, quote } = job
  const workDoc = buildCrewWorkDoc(lead, quote)
  const [expanded, setExpanded] = useState(daysUntil(workDoc.moveDate) !== null && (daysUntil(workDoc.moveDate) ?? 99) <= 3)
  const [logOpen, setLogOpen] = useState(false)
  const [hoursInput, setHoursInput] = useState(lead.actualHours?.toString() ?? '')
  const [hoursNote, setHoursNote] = useState(lead.actualHoursNote ?? '')
  const [logging, setLogging] = useState(false)

  async function handleLogHours() {
    const hrs = parseFloat(hoursInput)
    if (!hrs || hrs <= 0) return
    setLogging(true)
    try {
      const r = await fetch(`/api/sales/leads/${lead.id}/actual-hours`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ actualHours: hrs, actualHoursNote: hoursNote }),
      })
      if (r.ok) {
        setLogOpen(false)
        onHoursLogged(lead.id, hrs)
      }
    } finally {
      setLogging(false)
    }
  }

  const depositPaid = lead.depositAmount ?? 0
  const crewRate = quote ? (quote.subtotal / (quote.estimatedHours || 1)) : 0
  const actualAmt = lead.actualHours && crewRate ? lead.actualHours * crewRate : null
  const balanceAfterActual = actualAmt !== null ? Math.max(0, actualAmt * 1.13 - depositPaid) : null
  const overByHours = lead.actualHours && quote?.estimatedHours ? lead.actualHours - quote.estimatedHours : null

  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <MoveBadge dateStr={workDoc.moveDate} />
            {workDoc.startTime && (
              <div className="text-xs font-semibold text-[#f5a623]">🕐 Start: {workDoc.startTime}</div>
            )}
          </div>
          <button
            onClick={() => setExpanded(x => !x)}
            className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50"
          >
            {expanded ? 'Less' : 'Details'}
          </button>
        </div>

        {/* Route */}
        <div className="flex items-start gap-3 text-sm">
          <div className="mt-0.5 flex flex-col items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-[#f5a623]" />
            <div className="w-px flex-1 bg-slate-200" style={{ minHeight: 20 }} />
            <div className="h-2 w-2 rounded-full bg-[#1a2744]" />
          </div>
          <div className="space-y-3 flex-1">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">From</div>
              <div className="font-medium text-[#1a2744]">{workDoc.origin}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">To</div>
              <div className="font-medium text-[#1a2744]">{workDoc.destination}</div>
            </div>
          </div>
        </div>

        {/* Quick stats */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span>👥 {workDoc.crewSize} movers</span>
          <span>🚛 {workDoc.truckCount === 1 ? '26ft truck' : `${workDoc.truckCount} trucks`}</span>
          <span>⏱ ~{workDoc.estimatedHours}h estimated</span>
          {lead.actualHours && <span className="font-semibold text-emerald-700">✅ {lead.actualHours}h actual</span>}
        </div>

        {/* Assigned crew */}
        {(lead.assignedCrew?.length ?? 0) > 0 && (() => {
          const assignedWorkers = workers.filter(w => lead.assignedCrew!.includes(w.id))
          if (assignedWorkers.length === 0) return null
          return (
            <div className="flex flex-wrap gap-1.5">
              {assignedWorkers.map(w => (
                <span key={w.id} className="flex items-center gap-1 rounded-full bg-[#1a2744] bg-opacity-10 px-2.5 py-1 text-[11px] font-semibold text-[#1a2744]">
                  {w.role === 'lead' ? '★' : '·'} {w.name.split(' ')[0]}
                  <span className="opacity-50 font-normal capitalize">({w.role})</span>
                </span>
              ))}
            </div>
          )
        })()}

        {/* Special alerts */}
        {workDoc.specialAlerts.length > 0 && (
          <div className="space-y-1">
            {workDoc.specialAlerts.map((a, i) => (
              <div key={i} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800">{a}</div>
            ))}
          </div>
        )}

        {/* Customer contact */}
        {lead.phone && (
          <a href={`tel:${lead.phone}`} className="flex items-center gap-2 text-sm font-medium text-[#1a2744] underline-offset-2 hover:underline">
            📞 {lead.phone}
          </a>
        )}
      </div>

      {/* Expanded scope of work */}
      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4 space-y-4">
          {/* Scope lines */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Scope of Work</div>
            <ul className="space-y-1.5">
              {workDoc.scopeLines.map((line, i) => (
                <li key={i} className={`text-sm ${line.startsWith('  •') ? 'pl-4 text-slate-500' : 'text-slate-700 font-medium'}`}>
                  {line.startsWith('  •') ? line.slice(3) : `· ${line}`}
                </li>
              ))}
            </ul>
          </div>

          {/* Access notes */}
          {workDoc.accessNotes.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Access + Parking</div>
              <ul className="space-y-1">
                {workDoc.accessNotes.map((n, i) => <li key={i} className="text-sm text-slate-600">🏢 {n}</li>)}
                {workDoc.parkingNotes && <li className="text-sm text-slate-600">🅿️ {workDoc.parkingNotes}</li>}
              </ul>
            </div>
          )}

          {/* Crew note from sales */}
          {workDoc.crewNote && (
            <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-1">Sales Note</div>
              <p className="text-sm text-amber-800">{workDoc.crewNote}</p>
            </div>
          )}

          {/* Overtime billing panel */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
              <div>
                <div className="text-xs font-bold text-slate-700">
                  {lead.actualHours ? `✅ Actual: ${lead.actualHours}h logged` : 'Log Actual Hours'}
                </div>
                {lead.actualHours && overByHours !== null && overByHours > 0 && (
                  <div className="text-xs text-amber-600 font-medium mt-0.5">+{overByHours}h over estimate</div>
                )}
              </div>
              {!logOpen && (
                <button
                  onClick={() => setLogOpen(true)}
                  className="rounded-lg bg-[#1a2744] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0f1a35]"
                >
                  {lead.actualHours ? 'Update' : 'Log Hours'}
                </button>
              )}
            </div>

            {logOpen && (
              <div className="px-4 py-4 space-y-3 border-t border-slate-100">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Actual Hours</label>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      value={hoursInput}
                      onChange={e => setHoursInput(e.target.value)}
                      className="mt-1 crm-input w-full"
                      placeholder="e.g. 9.5"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Estimated</label>
                    <div className="mt-1 crm-input w-full bg-slate-50 text-slate-500">{workDoc.estimatedHours}h</div>
                  </div>
                </div>
                <input
                  value={hoursNote}
                  onChange={e => setHoursNote(e.target.value)}
                  className="crm-input w-full"
                  placeholder="Reason (e.g. extra items added, elevator wait time)"
                />
                {hoursInput && parseFloat(hoursInput) > 0 && crewRate > 0 && (
                  <div className="rounded-lg bg-[#f8fafc] border border-slate-200 px-3 py-3 text-sm space-y-1.5">
                    <div className="flex justify-between text-slate-600">
                      <span>Revised total ({hoursInput}h × ${crewRate.toFixed(0)}/h)</span>
                      <span className="font-semibold">{formatMoney(parseFloat(hoursInput) * crewRate * 1.13)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Deposit paid</span>
                      <span className="text-emerald-600 font-semibold">−{formatMoney(depositPaid)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-[#1a2744] pt-1 border-t border-slate-200">
                      <span>Balance due</span>
                      <span>{formatMoney(Math.max(0, parseFloat(hoursInput) * crewRate * 1.13 - depositPaid))}</span>
                    </div>
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setLogOpen(false)} className="crm-button flex-1 text-sm">Cancel</button>
                  <button
                    onClick={() => void handleLogHours()}
                    disabled={logging || !hoursInput || parseFloat(hoursInput) <= 0}
                    className="flex-1 rounded-[10px] bg-[#1a2744] py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {logging ? 'Saving...' : 'Confirm Hours'}
                  </button>
                </div>
              </div>
            )}

            {/* Show calculated balance after actual hours */}
            {lead.actualHours && balanceAfterActual !== null && !logOpen && (
              <div className="px-4 py-3 border-t border-slate-100 bg-white">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Balance due from customer</span>
                  <span className="font-bold text-[#1a2744]">{formatMoney(balanceAfterActual)}</span>
                </div>
                {lead.actualHoursNote && (
                  <p className="mt-1 text-xs text-slate-400">{lead.actualHoursNote}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function CrewCalendarPage() {
  const user = useCurrentUser()
  const [jobs, setJobs] = useState<Job[]>([])
  const [workers, setWorkers] = useState<CRMWorker[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/crew/jobs', { credentials: 'include' }).then(r => r.ok ? r.json() : { jobs: [] }).then((d: { jobs: Job[] }) => d.jobs),
      fetch('/api/sales/workers', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]).then(([jobsList, workersList]) => {
      setJobs(jobsList as Job[])
      setWorkers(workersList as CRMWorker[])
    }).catch(() => null).finally(() => setLoading(false))
  }, [])

  function handleHoursLogged(leadId: string, hours: number) {
    setJobs(prev => prev.map(j =>
      j.lead.id === leadId ? { ...j, lead: { ...j.lead, actualHours: hours } } : j
    ))
  }

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = jobs.filter(j => {
    const d = j.quote?.moveDate || j.lead.moveDate
    return d && d >= today
  })
  const past = jobs.filter(j => {
    const d = j.quote?.moveDate || j.lead.moveDate
    return !d || d < today
  })

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#1a2744] px-6 py-5 text-white">
        <div className="flex items-center justify-between">
          <div className="text-sm text-white/60">
            {new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          <Link href="/crew/workers" className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20">
            👷 Roster ({workers.filter(w => w.available).length} available)
          </Link>
        </div>
        <h1 className="mt-1 text-2xl font-bold">
          Hey {user?.name?.split(' ')[0] ?? 'there'} 👋
        </h1>
        <p className="mt-1 text-sm text-white/70">
          {upcoming.length === 0
            ? 'No upcoming jobs assigned to you.'
            : `You have ${upcoming.length} upcoming move${upcoming.length > 1 ? 's' : ''}.`}
        </p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center text-sm text-slate-400">
          Loading your schedule...
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center text-sm text-slate-400">
          No jobs assigned yet. Your manager will assign you to upcoming moves.
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[#1a2744]">Upcoming Moves</h2>
              {upcoming.map(job => (
                <JobCard key={job.lead.id} job={job} workers={workers} onHoursLogged={handleHoursLogged} />
              ))}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Past Jobs</h2>
              {past.map(job => (
                <JobCard key={job.lead.id} job={job} workers={workers} onHoursLogged={handleHoursLogged} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
