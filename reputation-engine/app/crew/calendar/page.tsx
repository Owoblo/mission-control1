'use client'

import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import { formatDate, formatMoney } from '@/lib/sales'
import type { CRMLead, CRMQuote, LeadMediaAsset } from '@/lib/types'
import { buildDefaultMoveExecutionEntries, MOVE_EXECUTION_PHASES } from '@/lib/move-execution'

type Job = { lead: CRMLead; quote: CRMQuote | null }

type ExpenseUploadResponse = {
  ok: boolean
  lead: CRMLead
  uploadedCount: number
  createdCost?: {
    id: string
    category: string
    amount_cents: number
  } | null
  error?: string
}

const EXPENSE_CATEGORIES = [
  { value: 'fuel', label: 'Fuel / Gas', icon: '⛽' },
  { value: 'supplies', label: 'Supplies', icon: '📦' },
  { value: 'food', label: 'Food / Crew', icon: '🍕' },
  { value: 'equipment', label: 'Equipment', icon: '🔧' },
  { value: 'truck', label: 'Truck / Rental', icon: '🚛' },
  { value: 'other', label: 'Other', icon: '📋' },
]

function daysUntil(dateStr?: string) {
  if (!dateStr) return null
  const diff = new Date(`${dateStr}T12:00:00`).getTime() - new Date().setHours(12, 0, 0, 0)
  return Math.ceil(diff / 86400000)
}

function getReceiptAssets(lead: CRMLead) {
  return (lead.mediaAssets || [])
    .filter(asset => asset.category === 'receipt' || asset.source === 'receipt_upload')
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
}

function formatTime(value?: string | null) {
  if (!value) return 'Unknown time'
  return new Date(value).toLocaleString()
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

  function replaceLead(nextLead: CRMLead) {
    setJobs(current => current.map(job => (
      job.lead.id === nextLead.id
        ? { ...job, lead: nextLead }
        : job
    )))
  }

  return (
    <div className="space-y-6">
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
              {upcoming.map(job => (
                <JobCard
                  key={job.lead.id}
                  job={job}
                  onLeadUpdated={replaceLead}
                />
              ))}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Past Jobs</h2>
              {past.map(job => (
                <JobCard
                  key={job.lead.id}
                  job={job}
                  onLeadUpdated={replaceLead}
                />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function JobCard({ job, onLeadUpdated }: { job: Job; onLeadUpdated: (lead: CRMLead) => void }) {
  const { lead, quote } = job
  const moveDate = lead.moveDate || quote?.moveDate
  const origin = quote?.originAddress
    ? `${quote.originAddress}${quote.originCity ? ', ' + quote.originCity : ''}`
    : lead.originAddress || lead.originCity || '—'
  const dest = quote?.destCity || lead.destCity || '—'
  const receipts = useMemo(() => getReceiptAssets(lead), [lead])
  const executionEntries = useMemo(() => buildDefaultMoveExecutionEntries(lead.moveExecutionLog?.entries), [lead.moveExecutionLog?.entries])
  const nextPhase = executionEntries.find(entry => !entry.timestamp)
  const completedPhaseCount = executionEntries.filter(entry => entry.timestamp).length

  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [category, setCategory] = useState('fuel')
  const [amount, setAmount] = useState('')
  const [costDate, setCostDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [phaseBusy, setPhaseBusy] = useState(false)
  const [phaseError, setPhaseError] = useState<string | null>(null)

  async function completeNextPhase() {
    if (!nextPhase) return
    setPhaseBusy(true)
    setPhaseError(null)
    try {
      const response = await fetch(`/api/crew/jobs/${lead.id}/execution`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: nextPhase.phase }),
      })
      const payload = await response.json() as { lead?: CRMLead; error?: string }
      if (!response.ok || !payload.lead) throw new Error(payload.error || 'Could not update job progress.')
      onLeadUpdated(payload.lead)
    } catch (error) {
      setPhaseError(error instanceof Error ? error.message : 'Could not update job progress.')
    } finally {
      setPhaseBusy(false)
    }
  }

  async function handleExpenseUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (files.length === 0) {
      setUploadError('Attach at least one receipt or invoice image first.')
      return
    }

    setUploading(true)
    setUploadError(null)
    setUploadMessage(null)

    try {
      const formData = new FormData()
      files.forEach(file => formData.append('files', file))
      formData.append('category', category)
      formData.append('amount', amount)
      formData.append('cost_date', costDate)
      formData.append('notes', notes)

      const response = await fetch(`/api/crew/jobs/${lead.id}/expenses`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })

      const payload = await response.json() as ExpenseUploadResponse
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Upload failed.')
      }

      onLeadUpdated(payload.lead)
      setFiles([])
      setAmount('')
      setNotes('')
      setShowExpenseForm(false)
      setUploadMessage(
        payload.createdCost
          ? `Receipt uploaded and ${formatMoney(payload.createdCost.amount_cents / 100)} logged to finance.`
          : 'Receipt uploaded. Finance can review and log the expense from the receipt inbox.'
      )
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <MoveBadge dateStr={moveDate} />

      <section className="border-y border-[var(--app-line)] py-4">
        <div className="flex items-center justify-between gap-3 text-xs text-slate-500"><span>Move-day progress</span><span>{completedPhaseCount} of {MOVE_EXECUTION_PHASES.length}</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#C99700] transition-all" style={{ width: `${Math.round((completedPhaseCount / MOVE_EXECUTION_PHASES.length) * 100)}%` }} /></div>
        <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Next action</div>
        <div className="mt-1 text-lg font-semibold text-[#071421]">{nextPhase?.label || 'Move workflow complete'}</div>
        {phaseError && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{phaseError}</div>}
        {nextPhase && <button type="button" onClick={() => void completeNextPhase()} disabled={phaseBusy} className="mt-4 min-h-14 w-full rounded-xl bg-[#C99700] px-5 py-3 text-base font-bold text-[#071421] transition hover:bg-[#b88900] disabled:opacity-60">{phaseBusy ? 'Updating…' : `Mark: ${nextPhase.label}`}</button>}
      </section>

      <div className="flex items-start gap-3 text-sm">
        <div className="mt-0.5 flex flex-col items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-[#f5a623]" />
          <div className="w-px flex-1 bg-slate-200" style={{ minHeight: 20 }} />
          <div className="h-2 w-2 rounded-full bg-[#1a2744]" />
        </div>
        <div className="flex-1 space-y-3">
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

      {quote && (quote.crewSize || quote.truckCount || quote.estimatedHours) ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {quote.crewSize ? <span>👥 {quote.crewSize} movers</span> : null}
          {quote.truckCount ? <span>🚛 {quote.truckCount === 1 ? '26ft truck' : `${quote.truckCount} trucks`}</span> : null}
          {quote.estimatedHours ? <span>⏱ ~{quote.estimatedHours}h</span> : null}
        </div>
      ) : null}

      {(lead.moveType || lead.moveReason || (lead.inventory && lead.inventory.length > 0)) && (
        <div className="space-y-1.5 rounded-xl border border-[var(--app-line)] bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
          {lead.moveType && (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[#1a2744]">Move type:</span>
              <span className="capitalize">{lead.moveType.replace(/_/g, ' ')}</span>
            </div>
          )}
          {lead.inventory && lead.inventory.length > 0 && (
            <div>
              <span className="font-semibold text-[#1a2744]">Key items: </span>
              {lead.inventory.slice(0, 6).map(item => item.name).join(', ')}
              {lead.inventory.length > 6 ? ` +${lead.inventory.length - 6} more` : ''}
            </div>
          )}
          {lead.jobFactors?.specialtyNotes && (
            <div className="font-medium text-amber-700">
              ⚠️ Specialty items: {lead.jobFactors.specialtyNotes}
            </div>
          )}
          {lead.crewNote && (
            <div className="whitespace-pre-wrap rounded-lg border border-amber-100 bg-amber-50 px-2 py-1.5 text-amber-800">
              <span className="font-semibold">Note: </span>{lead.crewNote}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {lead.phone && <a href={`tel:${lead.phone}`} className="flex min-h-12 items-center justify-center rounded-xl border border-slate-200 text-sm font-semibold text-[#071421]">Call customer</a>}
        {(lead.originAddress || quote?.originAddress) && <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lead.originAddress || quote?.originAddress || '')}`} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center rounded-xl bg-[#071421] px-3 text-center text-sm font-semibold text-white">Navigate to origin</a>}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Crew Expenses</div>
            <div className="mt-1 text-sm text-slate-600">
              Upload fuel receipts, dump tickets, supplies, or invoices from the field.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowExpenseForm(value => !value)}
            className="rounded-full bg-[#1a2744] px-4 py-2 text-xs font-semibold text-white"
          >
            {showExpenseForm ? 'Hide uploader' : 'Upload receipt'}
          </button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white bg-white px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Receipts on file</div>
            <div className="mt-1 text-lg font-semibold text-[#1a2744]">{receipts.length}</div>
          </div>
          <div className="rounded-xl border border-white bg-white px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Logged in finance</div>
            <div className="mt-1 text-lg font-semibold text-[#1a2744]">
              {receipts.filter(asset => asset.linkedCostId).length}
            </div>
          </div>
          <div className="rounded-xl border border-white bg-white px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Need review</div>
            <div className="mt-1 text-lg font-semibold text-[#1a2744]">
              {receipts.filter(asset => !asset.linkedCostId).length}
            </div>
          </div>
        </div>

        {showExpenseForm && (
          <form onSubmit={handleExpenseUpload} className="mt-4 space-y-3 rounded-xl border border-dashed border-slate-300 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm text-slate-700">
                <span className="font-medium">Category</span>
                <select
                  value={category}
                  onChange={event => setCategory(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2"
                >
                  {EXPENSE_CATEGORIES.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.icon} {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm text-slate-700">
                <span className="font-medium">Amount (optional)</span>
                <input
                  value={amount}
                  onChange={event => setAmount(event.target.value)}
                  placeholder="e.g. 48.90"
                  inputMode="decimal"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm text-slate-700">
                <span className="font-medium">Expense date</span>
                <input
                  type="date"
                  value={costDate}
                  onChange={event => setCostDate(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm text-slate-700">
                <span className="font-medium">Receipt files</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={event => setFiles(Array.from(event.target.files || []))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2"
                />
              </label>
            </div>

            <label className="block space-y-1 text-sm text-slate-700">
              <span className="font-medium">Notes for office / finance</span>
              <textarea
                value={notes}
                onChange={event => setNotes(event.target.value)}
                rows={3}
                placeholder="Fuel stop before the job, dump fee, parking, etc."
                className="w-full rounded-xl border border-slate-200 px-3 py-2"
              />
            </label>

            <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
              If you enter an amount, the expense is logged straight into finance. If you leave it blank, the receipt still lands in the finance inbox for office review.
            </div>

            {uploadError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {uploadError}
              </div>
            )}

            {uploadMessage && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {uploadMessage}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {files.length === 0 ? 'No files selected yet.' : `${files.length} file${files.length > 1 ? 's' : ''} ready.`}
              </div>
              <button
                type="submit"
                disabled={uploading}
                className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading ? 'Uploading…' : 'Save receipt'}
              </button>
            </div>
          </form>
        )}

        {receipts.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Recent receipt uploads</div>
            {receipts.slice(0, 4).map((asset: LeadMediaAsset) => (
              <div key={asset.id} className="flex flex-col gap-2 rounded-xl border border-white bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium text-[#1a2744]">
                    {asset.filename || 'Receipt upload'}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatTime(asset.uploadedAt)}
                    {asset.uploadedByName ? ` · ${asset.uploadedByName}` : ''}
                    {asset.notes ? ` · ${asset.notes}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    asset.linkedCostId
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {asset.linkedCostId ? 'Logged in finance' : 'Needs review'}
                  </span>
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-[#1a2744]"
                  >
                    View
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
