'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { updateSalesLead } from '@/lib/sales-api'
import { formatDate, formatMoney } from '@/lib/sales'
import type { CRMLead, CRMQuote } from '@/lib/types'

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
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())

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
    </div>
  )
}
