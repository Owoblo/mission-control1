'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { CustomerExperienceChecklist, Job, ReviewProofAsset, ReviewTrackStatus, YelpAccountStatus } from '@/lib/types'

const TRACK_OPTIONS: Array<{ value: ReviewTrackStatus; label: string }> = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'not_applicable', label: 'Not applicable' },
]

const YELP_ACCOUNT_OPTIONS: Array<{ value: YelpAccountStatus; label: string }> = [
  { value: 'unknown', label: 'Not asked' },
  { value: 'yes', label: 'Has Yelp account' },
  { value: 'no', label: 'No Yelp account' },
]

const DEFAULT_CHECKLIST: CustomerExperienceChecklist = {
  googleStatus: 'not_started',
  yelpAccountStatus: 'unknown',
  yelpStatus: 'not_started',
  videoStatus: 'not_started',
  privateFeedbackStatus: 'not_started',
}

function checklist(job: Job) {
  return { ...DEFAULT_CHECKLIST, ...(job.customerExperience || {}) }
}

function statusClass(status: ReviewTrackStatus) {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'in_progress') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'not_applicable') return 'border-slate-200 bg-slate-50 text-slate-500'
  return 'border-[var(--app-line)] bg-white text-[var(--app-muted)]'
}

export default function ReviewsWorkspacePage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)

  async function refresh() {
    try {
      setLoading(true)
      const response = await fetch('/api/jobs', { credentials: 'include', cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not load review workspace')
      setJobs(Array.isArray(payload) ? payload : [])
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load review workspace')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  async function patchJob(job: Job, changes: Partial<Job>) {
    setSavingId(job.id)
    setError(null)
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not save review checklist')
      setJobs(current => current.map(item => item.id === job.id ? payload : item))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not save review checklist')
    } finally {
      setSavingId(null)
    }
  }

  function patchChecklist(job: Job, changes: Partial<CustomerExperienceChecklist>) {
    return patchJob(job, { customerExperience: { ...checklist(job), ...changes, updatedAt: new Date().toISOString() } })
  }

  async function uploadProof(job: Job, platform: NonNullable<ReviewProofAsset['platform']>, files: FileList | null) {
    if (!files?.length) return
    const key = `${job.id}:${platform}`
    setUploadingKey(key)
    setError(null)
    try {
      const formData = new FormData()
      formData.set('platform', platform)
      Array.from(files).forEach(file => formData.append('files', file))
      const response = await fetch(`/api/public/reviews/${job.id}`, { method: 'POST', body: formData })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not upload proof')
      setJobs(current => current.map(item => item.id === job.id ? payload : item))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not upload proof')
    } finally {
      setUploadingKey(null)
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return jobs
      .filter(job => !needle || [job.customerName, job.customerEmail, job.customerPhone, job.moveFrom, job.googleProfileLocation].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => new Date(b.reviewSentAt || b.createdAt).getTime() - new Date(a.reviewSentAt || a.createdAt).getTime())
  }, [jobs, query])

  const completeCount = jobs.filter(job => {
    const item = checklist(job)
    return item.googleStatus === 'completed' && item.privateFeedbackStatus === 'completed'
  }).length

  return (
    <div className="crm-shell space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-[var(--app-ink)]">Customer Reviews</h1>
          <p className="mt-2 text-sm text-[var(--app-muted)]">Manual customer-experience checklist, review proof, testimonials, and follow-up.</p>
        </div>
        <button onClick={() => void refresh()} className="crm-button">Refresh</button>
      </section>

      <section className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-[10px] border border-[var(--app-line)] bg-white p-4"><div className="crm-label">Customers</div><div className="mt-2 text-2xl font-semibold">{jobs.length}</div></div>
        <div className="rounded-[10px] border border-[var(--app-line)] bg-white p-4"><div className="crm-label">Core complete</div><div className="mt-2 text-2xl font-semibold">{completeCount}</div></div>
        <div className="rounded-[10px] border border-[var(--app-line)] bg-white p-4"><div className="crm-label">Google proof</div><div className="mt-2 text-2xl font-semibold">{jobs.filter(job => job.reviewProofAssets?.some(asset => asset.platform === 'google')).length}</div></div>
        <div className="rounded-[10px] border border-[var(--app-line)] bg-white p-4"><div className="crm-label">Videos</div><div className="mt-2 text-2xl font-semibold">{jobs.filter(job => job.reviewProofAssets?.some(asset => asset.platform === 'video')).length}</div></div>
      </section>

      <input value={query} onChange={event => setQuery(event.target.value)} className="crm-input w-full max-w-xl" placeholder="Search customer, origin, phone, email, or profile…" />
      {error ? <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div> : null}

      {loading ? <div className="py-16 text-center text-sm text-[var(--app-muted)]">Loading customer review records…</div> : (
        <div className="space-y-3">
          {filtered.map(job => {
            const cx = checklist(job)
            const open = activeId === job.id
            const proof = job.reviewProofAssets || []
            return (
              <article key={job.id} className="overflow-hidden rounded-[12px] border border-[var(--app-line)] bg-white">
                <button onClick={() => setActiveId(open ? null : job.id)} className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-[var(--app-bg)]">
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--app-ink)]">{job.customerName}</div>
                    <div className="mt-1 truncate text-xs text-[var(--app-muted)]">{job.moveFrom || 'Origin unavailable'} · {job.googleProfileLocation || 'Profile not selected'}</div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusClass(cx.googleStatus)}`}>Google</span>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusClass(cx.privateFeedbackStatus)}`}>Experience</span>
                    <span className="text-[var(--app-muted)]">{open ? '−' : '+'}</span>
                  </div>
                </button>

                {open ? (
                  <div className="border-t border-[var(--app-line)] p-5">
                    <div className="grid gap-5 xl:grid-cols-2">
                      <div className="space-y-4">
                        <Track title="Google review" status={cx.googleStatus} onStatus={value => void patchChecklist(job, { googleStatus: value })} uploading={uploadingKey === `${job.id}:google`} onUpload={files => void uploadProof(job, 'google', files)} />
                        <div className="rounded-[10px] border border-[var(--app-line)] p-4">
                          <div className="flex items-center justify-between gap-3"><div className="font-semibold">Yelp</div><select value={cx.yelpAccountStatus} onChange={event => void patchChecklist(job, { yelpAccountStatus: event.target.value as YelpAccountStatus, yelpStatus: event.target.value === 'no' ? 'not_applicable' : cx.yelpStatus })} className="crm-input max-w-[180px] text-xs">{YELP_ACCOUNT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                          <div className="mt-3"><Track compact title="Yelp follow-up" status={cx.yelpStatus} onStatus={value => void patchChecklist(job, { yelpStatus: value })} uploading={uploadingKey === `${job.id}:yelp`} onUpload={files => void uploadProof(job, 'yelp', files)} /></div>
                        </div>
                        <Track title="Video testimonial" status={cx.videoStatus} onStatus={value => void patchChecklist(job, { videoStatus: value })} uploading={uploadingKey === `${job.id}:video`} onUpload={files => void uploadProof(job, 'video', files)} accept="video/*" />
                        <Track title="Private customer experience" status={cx.privateFeedbackStatus} onStatus={value => void patchChecklist(job, { privateFeedbackStatus: value })} uploading={uploadingKey === `${job.id}:customer_experience`} onUpload={files => void uploadProof(job, 'customer_experience', files)} />
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 text-sm">
                          <div><span className="text-[var(--app-muted)]">Phone:</span> {job.customerPhone || '—'}</div>
                          <div className="mt-1"><span className="text-[var(--app-muted)]">Email:</span> {job.customerEmail || '—'}</div>
                          <div className="mt-1"><span className="text-[var(--app-muted)]">Google:</span> {job.googleProfileLocation || 'Not selected'}</div>
                          {job.crmLeadId ? <Link href={`/sales/leads/${job.crmLeadId}`} className="mt-3 inline-block font-semibold text-[#0f6a53]">Open lead →</Link> : null}
                        </div>
                        <label className="block"><span className="crm-label mb-2 block">Private feedback</span><textarea defaultValue={job.feedbackComment || ''} onBlur={event => void patchJob(job, { feedbackComment: event.target.value, customerExperience: { ...cx, privateFeedbackStatus: event.target.value.trim() ? 'completed' : cx.privateFeedbackStatus, updatedAt: new Date().toISOString() } })} className="crm-input min-h-[110px] w-full resize-y" placeholder="What went well? What could we improve?" /></label>
                        <div className="grid gap-3 sm:grid-cols-2"><label><span className="crm-label mb-2 block">Next follow-up</span><input type="date" value={cx.nextFollowUpAt || ''} onChange={event => void patchChecklist(job, { nextFollowUpAt: event.target.value })} className="crm-input w-full" /></label><label><span className="crm-label mb-2 block">Owner</span><input value={cx.assignedOwner || ''} onChange={event => setJobs(current => current.map(item => item.id === job.id ? { ...item, customerExperience: { ...cx, assignedOwner: event.target.value } } : item))} onBlur={event => void patchChecklist(job, { assignedOwner: event.target.value })} className="crm-input w-full" placeholder="Team member" /></label></div>
                        <label className="block"><span className="crm-label mb-2 block">Working notes</span><textarea value={cx.notes || ''} onChange={event => setJobs(current => current.map(item => item.id === job.id ? { ...item, customerExperience: { ...cx, notes: event.target.value } } : item))} onBlur={event => void patchChecklist(job, { notes: event.target.value })} className="crm-input min-h-[90px] w-full resize-y" placeholder="Manual follow-up notes…" /></label>
                        <div><div className="crm-label mb-2">Saved evidence ({proof.length})</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{proof.map(asset => <a key={asset.id} href={asset.url} target="_blank" rel="noreferrer" className="rounded-[8px] border border-[var(--app-line)] p-2 text-xs hover:border-[#C99700]"><div className="font-semibold capitalize">{asset.platform?.replace('_', ' ') || 'Other'}</div><div className="mt-1 truncate text-[var(--app-muted)]">{asset.filename}</div></a>)}</div></div>
                        {savingId === job.id ? <div className="text-xs text-[var(--app-muted)]">Saving…</div> : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })}
          {!filtered.length ? <div className="py-16 text-center text-sm text-[var(--app-muted)]">No review records match this search.</div> : null}
        </div>
      )}
    </div>
  )
}

function Track({ title, status, onStatus, onUpload, uploading, accept = 'image/*,video/*', compact = false }: { title: string; status: ReviewTrackStatus; onStatus: (value: ReviewTrackStatus) => void; onUpload: (files: FileList | null) => void; uploading: boolean; accept?: string; compact?: boolean }) {
  return <div className={compact ? '' : 'rounded-[10px] border border-[var(--app-line)] p-4'}><div className="flex flex-wrap items-center justify-between gap-3"><div className="font-semibold text-[var(--app-ink)]">{title}</div><div className="flex items-center gap-2"><select value={status} onChange={event => onStatus(event.target.value as ReviewTrackStatus)} className="crm-input max-w-[145px] text-xs">{TRACK_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><label className="crm-button cursor-pointer text-xs">{uploading ? 'Uploading…' : 'Upload'}<input type="file" accept={accept} multiple disabled={uploading} className="sr-only" onChange={event => onUpload(event.target.files)} /></label></div></div></div>
}
