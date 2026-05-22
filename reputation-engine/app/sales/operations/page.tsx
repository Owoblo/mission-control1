'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { updateSalesLead } from '@/lib/sales-api'
import { formatDate, formatMoney } from '@/lib/sales'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import type { CRMLead, CRMQuote } from '@/lib/types'

interface CrewMember {
  id: string
  name: string
  role: string
}

type Job = {
  lead: CRMLead
  quote: CRMQuote | null
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function daysUntilMove(dateStr?: string) {
  if (!dateStr) return null
  const diff = new Date(`${dateStr}T12:00:00`).getTime() - new Date().setHours(12, 0, 0, 0)
  return Math.ceil(diff / 86400000)
}

function MoveDateBadge({ dateStr }: { dateStr?: string }) {
  const days = daysUntilMove(dateStr)
  if (!dateStr) return <span className="text-xs text-slate-400">No date set</span>
  const label = days === 0 ? 'TODAY' : days === 1 ? 'TOMORROW' : days !== null && days < 0 ? `${Math.abs(days)}d ago` : `In ${days}d`
  const color =
    days === 0 ? 'bg-rose-600 text-white' :
    days === 1 ? 'bg-amber-500 text-white' :
    days !== null && days < 0 ? 'bg-slate-200 text-slate-600' :
    days !== null && days <= 7 ? 'bg-emerald-100 text-emerald-800' :
    'bg-slate-100 text-slate-600'

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold text-[#1a2744]">{formatDate(dateStr)}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${color}`}>{label}</span>
    </div>
  )
}

function PaymentBadge({ lead }: { lead: CRMLead }) {
  if (lead.paymentStatus === 'paid_in_full') {
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Paid in Full</span>
  }
  if (lead.paymentStatus === 'deposit_received') {
    return <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">Deposit Received</span>
  }
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Deposit Pending</span>
}

export default function OperationsPage() {
  const currentUser = useCurrentUser()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [crewPool, setCrewPool] = useState<CrewMember[]>([])
  const [assigningJob, setAssigningJob] = useState<Job | null>(null)

  async function loadJobs() {
    try {
      setLoading(true)
      const r = await fetch('/api/sales/operations/jobs', { credentials: 'include' })
      if (!r.ok) throw new Error(await r.text())
      const data = await r.json() as { jobs: Job[] }
      setJobs(data.jobs)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadJobs()
    // Load crew pool for managers/owners
    fetch('/api/admin/users', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((users: CrewMember[]) => setCrewPool(users.filter(u => u.role === 'crew' || u.role === 'manager')))
      .catch(() => null)
  }, [])

  async function markComplete(job: Job) {
    if (!window.confirm(`Mark ${job.lead.name}'s job as complete? This will trigger the post-move review request.`)) return
    setCompletingId(job.lead.id)
    try {
      await updateSalesLead(job.lead.id, { stage: 'booked' }) // keep booked but mark completed
      // Fire review request
      if (job.lead.email || job.lead.phone) {
        void fetch('/api/sales/review-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            leadName: job.lead.name,
            leadEmail: job.lead.email,
            leadPhone: job.lead.phone,
            quoteNumber: job.quote?.number,
            channel: 'both',
          }),
        }).catch(() => null)
      }
      setCompletedIds(prev => new Set(Array.from(prev).concat(job.lead.id)))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCompletingId(null)
    }
  }

  const today = todayISO()
  const upcomingJobs = jobs.filter(j => {
    const d = j.quote?.moveDate || j.lead.moveDate
    return d && d >= today && !completedIds.has(j.lead.id)
  })
  const otherJobs = jobs.filter(j => {
    const d = j.quote?.moveDate || j.lead.moveDate
    return (!d || d < today) && !completedIds.has(j.lead.id)
  })

  function JobCard({ job }: { job: Job }) {
    const lead = job.lead
    const quote = job.quote
    const moveDate = quote?.moveDate || lead.moveDate
    const origin = quote?.originAddress ? `${quote.originAddress}${quote.originCity ? ', ' + quote.originCity : ''}` : (lead.originAddress || lead.originCity || '—')
    const dest = quote?.destCity || lead.destCity || '—'
    const crewSize = quote?.crewSize
    const truckCount = quote?.truckCount
    const estHours = quote?.estimatedHours
    const isCompleting = completingId === lead.id

    return (
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <MoveDateBadge dateStr={moveDate} />
            <div className="text-base font-semibold text-[#1a2744]">{lead.name}</div>
          </div>
          <PaymentBadge lead={lead} />
        </div>

        {/* Route */}
        <div className="text-sm text-slate-600">
          <span className="font-medium">{origin}</span>
          <span className="mx-2 text-slate-400">→</span>
          <span className="font-medium">{dest}</span>
        </div>

        {/* Job details */}
        {(crewSize || truckCount || estHours) ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {crewSize ? <span>{crewSize} mover{crewSize > 1 ? 's' : ''}</span> : null}
            {truckCount ? <span>{truckCount === 1 ? '26ft truck' : `${truckCount} trucks`}</span> : null}
            {estHours ? <span>~{estHours}h estimated</span> : null}
          </div>
        ) : null}

        {/* Payment summary */}
        {quote && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs">
            <span className="text-slate-500">Deposit: <span className={`font-semibold ${lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' ? 'text-emerald-700' : 'text-amber-700'}`}>{formatMoney(quote.deposit)}{lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' ? ' ✓' : ''}</span></span>
            <span className="text-slate-500">Balance: <span className="font-semibold text-[#1a2744]">{formatMoney(quote.balance)}</span></span>
            <span className="text-slate-500">Total: <span className="font-semibold text-[#1a2744]">{formatMoney(quote.total)}</span></span>
          </div>
        )}

        {/* Assigned crew */}
        {(lead.assignedCrew?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {lead.assignedCrew!.map(id => {
              const member = crewPool.find(c => c.id === id)
              if (!member) return null
              return (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[#1a2744]/10 px-2.5 py-1 text-xs font-medium text-[#1a2744]">
                  👤 {member.name}
                </span>
              )
            })}
          </div>
        )}

        {/* Contact + actions */}
        <div className="flex flex-wrap items-center gap-2">
          {lead.phone ? (
            <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-[#1a2744] hover:bg-slate-50 transition">
              📞 {lead.phone}
            </a>
          ) : null}
          {lead.email ? (
            <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-[#1a2744] hover:bg-slate-50 transition">
              📧 Email
            </a>
          ) : null}
          <div className="ml-auto flex gap-2">
            {(currentUser?.role === 'owner' || currentUser?.role === 'manager' || currentUser?.role === 'sales_rep') && crewPool.length > 0 && (
              <button
                onClick={() => setAssigningJob(job)}
                className="rounded-lg border border-[#1a2744]/30 px-3 py-1.5 text-xs font-medium text-[#1a2744] hover:bg-[#1a2744]/5 transition"
              >
                👥 Crew
              </button>
            )}
            <Link
              href={`/sales/leads/${lead.id}`}
              className="rounded-lg bg-[#1a2744] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition"
            >
              View Lead
            </Link>
            <button
              onClick={() => void markComplete(job)}
              disabled={isCompleting}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-60"
            >
              {isCompleting ? 'Completing...' : 'Mark Complete ✓'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="crm-shell space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1a2744]">Operations</h1>
          <p className="mt-1 text-sm text-slate-500">
            {new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <button onClick={() => void loadJobs()} className="crm-button text-sm">Refresh</button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="crm-panel p-16 text-center text-sm text-slate-400">Loading jobs...</div>
      ) : jobs.length === 0 ? (
        <div className="crm-panel p-16 text-center text-sm text-slate-400">
          No booked jobs found. Jobs appear here when leads are marked Booked with a deposit.
        </div>
      ) : (
        <>
          {/* Upcoming moves */}
          {upcomingJobs.length > 0 && (
            <section>
              <div className="mb-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="rounded-full bg-[#1a2744] px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white">
                  Upcoming Moves
                </span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {upcomingJobs.map(job => (
                  <JobCard key={job.lead.id} job={job} />
                ))}
              </div>
            </section>
          )}

          {/* Undated / past jobs */}
          {otherJobs.length > 0 && (
            <section>
              <div className="mb-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-slate-500">
                  All Booked Jobs
                </span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {otherJobs.map(job => (
                  <JobCard key={job.lead.id} job={job} />
                ))}
              </div>
            </section>
          )}

          {completedIds.size > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
              {completedIds.size} job{completedIds.size > 1 ? 's' : ''} marked complete. Review requests sent automatically.
            </div>
          )}
        </>
      )}

      {/* Crew Assignment Modal */}
      {assigningJob && (
        <CrewAssignModal
          job={assigningJob}
          crewPool={crewPool}
          onClose={() => setAssigningJob(null)}
          onSave={updated => {
            setJobs(prev => prev.map(j => j.lead.id === updated.id ? { ...j, lead: updated } : j))
            setAssigningJob(null)
          }}
        />
      )}
    </div>
  )
}

function CrewAssignModal({
  job,
  crewPool,
  onClose,
  onSave,
}: {
  job: Job
  crewPool: CrewMember[]
  onClose: () => void
  onSave: (lead: CRMLead) => void
}) {
  const [selected, setSelected] = useState<string[]>(job.lead.assignedCrew ?? [])
  const [note, setNote] = useState(job.lead.crewNote ?? '')
  const [busy, setBusy] = useState(false)

  function toggle(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function save() {
    setBusy(true)
    try {
      const { updateSalesLead } = await import('@/lib/sales-api')
      const updated = await updateSalesLead(job.lead.id, {
        assignedCrew: selected,
        crewNote: note || undefined,
      } as Partial<CRMLead>)
      onSave(updated as CRMLead)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,27,56,0.55)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="bg-[#1a2744] px-6 py-5" style={{ borderBottom: '2px solid #f5a623' }}>
          <h2 className="text-base font-bold text-white">Assign Crew</h2>
          <p className="mt-0.5 text-xs text-white/60">{job.lead.name} — {job.quote?.moveDate || job.lead.moveDate || 'Date TBD'}</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-2">
            {crewPool.map(member => (
              <label key={member.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 hover:bg-slate-50 transition">
                <input
                  type="checkbox"
                  checked={selected.includes(member.id)}
                  onChange={() => toggle(member.id)}
                  className="h-4 w-4 accent-[#1a2744]"
                />
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1a2744] text-xs font-bold text-[#f5a623]">
                  {member.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <div>
                  <div className="text-sm font-medium text-[#1a2744]">{member.name}</div>
                  <div className="text-xs capitalize text-slate-400">{member.role.replace('_', ' ')}</div>
                </div>
              </label>
            ))}
            {crewPool.length === 0 && (
              <p className="text-sm text-slate-400">No crew members added yet. Go to Team → Add Team Member.</p>
            )}
          </div>
          <label className="block">
            <span className="crm-label">Crew Notes</span>
            <textarea
              className="crm-input mt-1 h-20 resize-none"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Marcus leads, bring extra wardrobe boxes"
            />
          </label>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">Cancel</button>
            <button
              onClick={() => void save()}
              disabled={busy}
              className="flex-1 rounded-xl bg-[#1a2744] px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition disabled:opacity-60"
            >
              {busy ? 'Saving...' : 'Save Assignment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
