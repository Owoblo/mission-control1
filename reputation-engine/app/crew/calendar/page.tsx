'use client'

import { useEffect, useState } from 'react'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import { formatDate, formatMoney } from '@/lib/sales'
import type { CRMLead, CRMQuote } from '@/lib/types'

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

export default function CrewCalendarPage() {
  const user = useCurrentUser()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/crew/jobs', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { jobs: [] })
      .then((d: { jobs: Job[] }) => setJobs(d.jobs))
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [])

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
      {/* Greeting */}
      <div className="rounded-2xl bg-[#1a2744] px-6 py-5 text-white">
        <div className="text-sm text-white/60">
          {new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}
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
              {upcoming.map(job => <JobCard key={job.lead.id} job={job} />)}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Past Jobs</h2>
              {past.map(job => <JobCard key={job.lead.id} job={job} />)}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function JobCard({ job }: { job: Job }) {
  const { lead, quote } = job
  const moveDate = quote?.moveDate || lead.moveDate
  const origin = quote?.originAddress
    ? `${quote.originAddress}${quote.originCity ? ', ' + quote.originCity : ''}`
    : lead.originAddress || lead.originCity || '—'
  const dest = quote?.destCity || lead.destCity || '—'

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-3">
      <MoveBadge dateStr={moveDate} />

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
            <div className="font-medium text-[#1a2744]">{origin}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">To</div>
            <div className="font-medium text-[#1a2744]">{dest}</div>
          </div>
        </div>
      </div>

      {/* Job details */}
      {quote && (quote.crewSize || quote.truckCount || quote.estimatedHours) ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {quote.crewSize ? <span>👥 {quote.crewSize} movers</span> : null}
          {quote.truckCount ? <span>🚛 {quote.truckCount === 1 ? '26ft truck' : `${quote.truckCount} trucks`}</span> : null}
          {quote.estimatedHours ? <span>⏱ ~{quote.estimatedHours}h</span> : null}
        </div>
      ) : null}

      {/* Job nature */}
      {(lead.moveType || lead.moveReason || (lead.inventory && lead.inventory.length > 0)) && (
        <div className="rounded-xl border border-[var(--app-line)] bg-slate-50 px-3 py-2.5 space-y-1.5 text-xs text-slate-600">
          {lead.moveType && (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[#1a2744]">Move type:</span>
              <span className="capitalize">{lead.moveType.replace(/_/g, ' ')}</span>
            </div>
          )}
          {lead.inventory && lead.inventory.length > 0 && (
            <div>
              <span className="font-semibold text-[#1a2744]">Key items: </span>
              {lead.inventory.slice(0, 6).map(i => i.name).join(', ')}
              {lead.inventory.length > 6 ? ` +${lead.inventory.length - 6} more` : ''}
            </div>
          )}
          {lead.jobFactors?.specialtyNotes && (
            <div className="font-medium text-amber-700">
              ⚠️ Specialty items: {lead.jobFactors.specialtyNotes}
            </div>
          )}
          {lead.crewNote && (
            <div className="rounded-lg bg-amber-50 border border-amber-100 px-2 py-1.5 text-amber-800">
              <span className="font-semibold">Note: </span>{lead.crewNote}
            </div>
          )}
        </div>
      )}

      {/* Contact */}
      {lead.phone && (
        <a
          href={`tel:${lead.phone}`}
          className="flex items-center gap-2 text-sm font-medium text-[#1a2744] underline-offset-2 hover:underline"
        >
          📞 {lead.phone}
        </a>
      )}
    </div>
  )
}
