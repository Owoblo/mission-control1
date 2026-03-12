'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchJobs, fetchPartners, removeJob, saveJob } from '@/lib/api'
import { INCENTIVE_AMOUNT } from '@/lib/config'
import { linksSentCount, reviewCount } from '@/lib/store'
import type { Job } from '@/lib/types'

const STATUS_MAP: Record<Job['status'], { label: string; cls: string }> = {
  pending: { label: 'Review Pending', cls: 'badge-pending' },
  sent: { label: 'Link Sent', cls: 'badge-sent' },
  'feedback-received': { label: 'Feedback In', cls: 'badge-sent' },
  'in-progress': { label: 'Reviews Coming', cls: 'badge-progress' },
  complete: { label: 'All 4 Confirmed', cls: 'badge-complete' },
  flagged: { label: 'Flagged - Fix First', cls: 'badge-flagged' },
}

function ReviewDots({ reviews }: { reviews: Job['reviews'] }) {
  const items = [
    { key: 'google', label: 'G' },
    { key: 'yelp', label: 'Y' },
    { key: 'facebook', label: 'F' },
    { key: 'media', label: 'M' },
  ] as const

  return (
    <div className="flex gap-1">
      {items.map(item => (
        <span
          key={item.key}
          title={item.key}
          className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold ${
            reviews[item.key]
              ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-400'
              : 'border-[#2D4A6A] bg-[#0F1B2D] text-slate-600'
          }`}
        >
          {item.label}
        </span>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | Job['status']>('all')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    try {
      setLoading(true)
      const [nextJobs] = await Promise.all([fetchJobs(), fetchPartners()])
      setJobs(nextJobs)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const total = jobs.length
  const linksSent = linksSentCount(jobs)
  const allDone = jobs.filter(job => job.status === 'complete').length
  const incentiveEarned = jobs.filter(job => job.incentiveEarned).length
  const flagged = jobs.filter(job => job.status === 'flagged').length
  const filtered = filter === 'all' ? jobs : jobs.filter(job => job.status === filter)

  async function copyLink(job: Job) {
    const url = `${window.location.origin}/review/${job.id}`
    await navigator.clipboard.writeText(url)
    setCopied(job.id)
    window.setTimeout(() => setCopied(null), 2000)

    if (job.status === 'pending') {
      await saveJob({ ...job, status: 'sent', reviewSentAt: new Date().toISOString() })
      await refresh()
    }
  }

  async function markIncentivePaid(job: Job) {
    await saveJob({ ...job, incentivePaid: true })
    await refresh()
  }

  async function sendProof(job: Job) {
    if (!job.referralPartnerId || !job.referralPartnerName) return
    const partners = await fetchPartners()
    const partner = partners.find(item => item.id === job.referralPartnerId)
    if (!partner) return

    const body = encodeURIComponent(
      `Hi ${partner.name},\n\nGreat news! ${job.customerName}, who moved with us on ${job.moveDate}, confirmed their review package.\n\n` +
        `We appreciate you sending clients our way. If you have anyone else looking to move, we'd love to help them too.\n\n` +
        `Best,\nSaturn Star Movers\n226-724-1730`
    )

    window.open(`mailto:${partner.email}?subject=Your client ${job.customerName} completed their review follow-up&body=${body}`)
    await saveJob({ ...job, proofSentToPartner: true })
    await refresh()
  }

  async function remove(id: string) {
    if (!confirm('Delete this job?')) return
    await removeJob(id)
    await refresh()
  }

  return (
    <div className="animate-fade-in space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Post-Move Engine</h1>
          <p className="mt-0.5 text-sm text-slate-400">Shared review and referral tracking across every device</p>
        </div>
        <Link href="/trigger" className="btn-gold flex items-center gap-2">
          <span className="text-base leading-none">+</span> Mark Job Complete
        </Link>
      </div>

      {error && (
        <div className="card border-red-800/50 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="stat-card">
          <span className="text-2xl font-bold text-white">{total}</span>
          <span className="text-xs text-slate-400">Total Jobs</span>
        </div>
        <div className="stat-card">
          <span className="text-2xl font-bold text-blue-400">{linksSent}</span>
          <span className="text-xs text-slate-400">Links Sent</span>
        </div>
        <div className="stat-card">
          <span className="text-2xl font-bold text-emerald-400">{allDone}</span>
          <span className="text-xs text-slate-400">Confirmed Reviews</span>
        </div>
        <div className="stat-card">
          <span className="text-2xl font-bold text-gold">${incentiveEarned * INCENTIVE_AMOUNT}</span>
          <span className="text-xs text-slate-400">Reward Liability</span>
        </div>
        {flagged > 0 && (
          <div className="stat-card border-red-800/50">
            <span className="text-2xl font-bold text-red-400">{flagged}</span>
            <span className="text-xs text-slate-400">Need Attention</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {(['all', 'pending', 'sent', 'in-progress', 'complete', 'flagged'] as const).map(value => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              filter === value ? 'bg-gold text-navy' : 'text-slate-400 hover:bg-navy-2 hover:text-white'
            }`}
          >
            {value === 'all' ? 'All Jobs' : STATUS_MAP[value]?.label ?? value}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card p-16 text-center text-slate-400">Loading jobs...</div>
      ) : filtered.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="mb-3 text-4xl">[]</div>
          <p className="text-slate-400">
            No jobs yet. <Link href="/trigger" className="text-gold hover:underline">Mark your first job complete</Link>
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(job => {
            const count = reviewCount(job.reviews)
            const status = STATUS_MAP[job.status]

            return (
              <div key={job.id} className="card animate-slide-up p-4 transition-all hover:border-[#3D5A7A]">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white">{job.customerName}</span>
                      <span className={status.cls}>{status.label}</span>
                      {job.incentiveEarned && !job.incentivePaid && (
                        <span className="badge border border-gold/30 bg-gold/20 text-gold">Reward approved</span>
                      )}
                      {job.incentivePaid && (
                        <span className="badge bg-emerald-900/30 text-emerald-400">Paid</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <span className="text-xs text-slate-500">{job.moveDate}</span>
                      <span className="text-xs text-slate-500">{job.moveFrom} to {job.moveTo}</span>
                      {job.referralPartnerName && (
                        <span className="text-xs text-slate-500">
                          via <span className="text-slate-300">{job.referralPartnerName}</span>
                        </span>
                      )}
                      <span className="text-xs text-slate-500">Crew: {job.crewLead}</span>
                    </div>
                    {job.feedbackComment && (
                      <p className="mt-1.5 rounded-lg bg-navy-2 px-3 py-2 text-xs italic text-slate-400">
                        "{job.feedbackComment}"
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-start gap-1.5 md:items-center">
                    <ReviewDots reviews={job.reviews} />
                    <span className="text-xs text-slate-500">{count}/4 steps confirmed</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => void copyLink(job)}
                      className={`rounded-lg border px-3 py-1.5 text-xs transition-all ${
                        copied === job.id
                          ? 'border-emerald-500 bg-emerald-900/20 text-emerald-400'
                          : 'border-[#2D4A6A] text-slate-300 hover:border-gold hover:text-gold'
                      }`}
                    >
                      {copied === job.id ? 'Copied' : 'Copy Link'}
                    </button>

                    {job.status === 'complete' && job.referralPartnerId && !job.proofSentToPartner && (
                      <button
                        onClick={() => void sendProof(job)}
                        className="rounded-lg border border-blue-700 px-3 py-1.5 text-xs text-blue-300 transition-all hover:bg-blue-900/20"
                      >
                        Send Proof
                      </button>
                    )}

                    {job.incentiveEarned && !job.incentivePaid && (
                      <button
                        onClick={() => void markIncentivePaid(job)}
                        className="rounded-lg border border-gold/40 px-3 py-1.5 text-xs text-gold transition-all hover:bg-gold/10"
                      >
                        Mark Paid
                      </button>
                    )}

                    <a
                      href={`/review/${job.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-[#2D4A6A] px-3 py-1.5 text-xs text-slate-400 transition-all hover:text-white"
                    >
                      Preview
                    </a>

                    <button
                      onClick={() => void remove(job.id)}
                      className="rounded-lg px-2 py-1.5 text-xs text-slate-600 transition-all hover:text-red-400"
                    >
                      X
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
