'use client'

import { useEffect, useState } from 'react'
import { computeCrewPayoutAmounts, CREW_PAYOUT_METHOD_LABELS, CREW_PAYOUT_STATUS_LABELS } from '@/lib/operations'
import { updateSalesLead } from '@/lib/sales-api'
import { formatMoney, isBookedLikeStage } from '@/lib/sales'
import { deriveMoneyState } from '@/lib/payment-state'
import { deriveJobTelemetry } from '@/lib/job-telemetry'
import type { CRMLead, CRMQuote, CrewPayoutEntry } from '@/lib/types'

interface JobCost {
  id: string
  lead_id: string
  category: string
  description: string | null
  amount_cents: number
  cost_date: string
  linkedReceiptCount?: number
}

interface ReceiptUpload {
  assetId: string
  leadId: string
  leadName: string
  branch?: string
  moveDate?: string
  url: string
  filename?: string
  mimeType?: string
  uploadedAt: string
  uploadedByName?: string
  notes?: string
  linkedCostId?: string
  linkedCostCategory?: string
  linkedCostAmountCents?: number
  linkedAt?: string
}

interface BookedJob {
  id: string
  name: string
  moveDate?: string
  revenue: number
  quote: CRMQuote | null
  lead: CRMLead
}

type WorkerPayoutRow = {
  leadId: string
  leadName: string
  moveDate?: string
  branch?: string
  entry: CrewPayoutEntry
  totalPay: number
}

const CATEGORIES = [
  { value: 'labor',        label: 'Labor',            icon: '👷' },
  { value: 'truck',        label: 'Truck / Rental',   icon: '🚛' },
  { value: 'fuel',         label: 'Fuel / Gas',       icon: '⛽' },
  { value: 'tolls',        label: 'Tolls / Border',   icon: '🛣️' },
  { value: 'lodging',      label: 'Hotel / Lodging',  icon: '🏨' },
  { value: 'storage',      label: 'Storage',          icon: '🏢' },
  { value: 'supplies',     label: 'Supplies',         icon: '📦' },
  { value: 'extra_fees',   label: 'Extra Fees',       icon: '🧾' },
  { value: 'claims',       label: 'Claims / Damage',  icon: '⚠️' },
  { value: 'food',         label: 'Food / Crew',      icon: '🍕' },
  { value: 'equipment',    label: 'Equipment',        icon: '🔧' },
  { value: 'marketing',    label: 'Marketing',        icon: '📢' },
  { value: 'insurance',    label: 'Insurance',        icon: '🛡️' },
  { value: 'other',        label: 'Other',            icon: '📋' },
]

const CAT_META: Record<string, { label: string; icon: string }> = Object.fromEntries(
  CATEGORIES.map(c => [c.value, { label: c.label, icon: c.icon }])
)

function moneyFromCents(cents: number) {
  return Math.round(Number(cents || 0)) / 100
}

function getPaidSoFar(job: Pick<BookedJob, 'lead' | 'quote'>) {
  const quote = job.quote
  const depositCollected = Math.max(
    Number(quote?.depositPaidAmount || 0),
    job.lead.paymentStatus && job.lead.paymentStatus !== 'pending' ? Number(job.lead.depositAmount || 0) : 0
  )
  const balanceCollected = Math.max(Number(quote?.balancePaidAmount || 0), 0)
  return {
    depositCollected,
    balanceCollected,
    cashCollected: Math.round((depositCollected + balanceCollected) * 100) / 100,
  }
}

function costByCategory(costs: JobCost[], category: string) {
  return moneyFromCents(costs.filter(c => c.category === category).reduce((sum, c) => sum + c.amount_cents, 0))
}

export default function FinancePage() {
  const [costs, setCosts] = useState<JobCost[]>([])
  const [receiptUploads, setReceiptUploads] = useState<ReceiptUpload[]>([])
  const [jobs, setJobs] = useState<BookedJob[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [selectedJob, setSelectedJob] = useState<string>('overhead')
  const [form, setForm] = useState({
    lead_id: 'overhead',
    category: 'labor',
    description: '',
    amount: '',
    cost_date: new Date().toISOString().slice(0, 10),
  })
  const [selectedReceiptIds, setSelectedReceiptIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [tab, setTab] = useState<'jobs' | 'overhead' | 'all'>('jobs')
  const [payoutBusyId, setPayoutBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [costsRes, jobsRes] = await Promise.all([
      fetch('/api/sales/finance', { credentials: 'include' }),
      fetch('/api/sales/overview', { credentials: 'include' }),
    ])
    if (costsRes.ok) {
      const finance = await costsRes.json() as { costs?: JobCost[]; receiptUploads?: ReceiptUpload[] }
      setCosts(finance.costs || [])
      setReceiptUploads(finance.receiptUploads || [])
    }
    if (jobsRes.ok) {
      const d = await jobsRes.json()
      const quotes = (d.quotes || []) as CRMQuote[]
      const quotesByLead = new Map<string, CRMQuote[]>()
      for (const q of quotes) {
        if (!q.leadId) continue
        const list = quotesByLead.get(q.leadId) || []
        list.push(q)
        quotesByLead.set(q.leadId, list)
      }
      // Extract booked leads + their quote totals
      const booked: BookedJob[] = (d.leads || [])
        .filter((l: { stage: string }) => isBookedLikeStage(l.stage))
        .map((l: CRMLead) => {
          const leadQuotes = quotesByLead.get(l.id) || []
          const acceptedQuote =
            leadQuotes.find(q => q.id === l.quoteId) ||
            leadQuotes.find(q => ['accepted', 'invoiced'].includes(q.status)) ||
            leadQuotes[0] ||
            null
          return {
            id: l.id,
            name: l.name,
            moveDate: acceptedQuote?.moveDate || l.moveDate,
            revenue: acceptedQuote?.subtotal || 0,
            quote: acceptedQuote,
            lead: l,
          }
        })
      setJobs(booked)
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function saveCost() {
    if (!form.amount || !form.category || !form.cost_date) return
    setSaving(true)
    await fetch('/api/sales/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        lead_id: form.lead_id || 'overhead',
        category: form.category,
        description: form.description || undefined,
        amount_cents: Math.round(parseFloat(form.amount) * 100),
        cost_date: form.cost_date,
        receipt_asset_ids: selectedReceiptIds,
      }),
    })
    setSaving(false)
    setAddOpen(false)
    setForm(f => ({ ...f, amount: '', description: '' }))
    setSelectedReceiptIds([])
    void load()
  }

  async function deleteCost(id: string) {
    setDeleting(id)
    await fetch(`/api/sales/finance?id=${id}`, { method: 'DELETE', credentials: 'include' })
    setCosts(prev => prev.filter(c => c.id !== id))
    setReceiptUploads(prev => prev.map(receipt => (
      receipt.linkedCostId === id
        ? {
            ...receipt,
            linkedCostId: undefined,
            linkedCostCategory: undefined,
            linkedCostAmountCents: undefined,
            linkedAt: undefined,
          }
        : receipt
    )))
    setDeleting(null)
  }

  async function createLaborCostForPayout(row: WorkerPayoutRow) {
    if (row.entry.financeCostId) return row.entry.financeCostId
    const response = await fetch('/api/sales/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        lead_id: row.leadId,
        category: 'labor',
        description: `Crew payout · ${row.entry.workerName}${row.entry.role ? ` · ${row.entry.role.replace('_', ' ')}` : ''}`,
        amount_cents: Math.round(row.totalPay * 100),
        cost_date: row.moveDate || new Date().toISOString().slice(0, 10),
      }),
    })
    const payload = await response.json().catch(() => null) as JobCost | { error?: string } | null
    if (!response.ok) {
      throw new Error((payload as { error?: string } | null)?.error || 'Failed to log labor cost')
    }
    const created = payload as JobCost
    setCosts(current => [created, ...current])
    return created.id
  }

  function openCostModalForReceipt(receipt: ReceiptUpload) {
    setSelectedJob(receipt.leadId)
    setSelectedReceiptIds([receipt.assetId])
    setForm({
      lead_id: receipt.leadId,
      category: 'fuel',
      description: receipt.notes || receipt.filename || '',
      amount: '',
      cost_date: receipt.uploadedAt.slice(0, 10),
    })
    setAddOpen(true)
  }

  async function updatePayoutStatus(row: WorkerPayoutRow, nextStatus: CrewPayoutEntry['payoutStatus']) {
    setPayoutBusyId(row.entry.id)
    try {
      let financeCostId = row.entry.financeCostId
      if (nextStatus === 'paid' && !financeCostId) {
        financeCostId = await createLaborCostForPayout(row)
      }

      const job = jobs.find(item => item.id === row.leadId)
      if (!job) throw new Error('Job not found')

      const nextPayouts = (job.lead.crewPayouts || []).map(entry =>
        entry.id === row.entry.id
          ? {
              ...entry,
              payoutStatus: nextStatus,
              approvedAt: nextStatus === 'approved' || nextStatus === 'paid' ? (entry.approvedAt || new Date().toISOString()) : entry.approvedAt,
              paidAt: nextStatus === 'paid' ? new Date().toISOString() : entry.paidAt,
              financeCostId,
            }
          : entry
      )

      const updatedLead = await updateSalesLead(row.leadId, {
        crewPayouts: nextPayouts,
      })
      setJobs(current => current.map(item => (
        item.id === row.leadId
          ? { ...item, lead: updatedLead }
          : item
      )))
    } catch (error) {
      window.alert((error as Error).message)
    } finally {
      setPayoutBusyId(null)
    }
  }

  // Compute P&L per job
  const jobPL = jobs.map(job => {
    const jobCosts = costs.filter(c => c.lead_id === job.id)
    const customerTotal = Number(job.quote?.total || 0)
    const telemetry = deriveJobTelemetry({ lead: job.lead, quote: job.quote, costs: jobCosts })
    const totalCosts = telemetry.actualCost
    const profit = telemetry.actualGrossProfit
    const quoteAmount = telemetry.revenue
    const depositRequired = Number(job.quote?.deposit || 0)
    const paid = getPaidSoFar(job)
    const moneyState = deriveMoneyState(job.quote, job.lead)
    const cashPending = Math.max(0, Math.round((customerTotal - paid.cashCollected) * 100) / 100)
    const margin = telemetry.actualMarginPct / 100
    const truckCost = costByCategory(jobCosts, 'truck')
    const laborCost = costByCategory(jobCosts, 'labor')
    const fuelCost = costByCategory(jobCosts, 'fuel')
    const suppliesCost = costByCategory(jobCosts, 'supplies')
    const extraFees = costByCategory(jobCosts, 'extra_fees') + costByCategory(jobCosts, 'equipment') + costByCategory(jobCosts, 'food') + costByCategory(jobCosts, 'tolls') + costByCategory(jobCosts, 'lodging') + costByCategory(jobCosts, 'storage')
    const claimsReserve = costByCategory(jobCosts, 'claims') + costByCategory(jobCosts, 'insurance')
    const estimatedLaborBudget = Number(job.quote?.crewSize || 0) * Number(job.quote?.estimatedHours || 0) * 20
    const warnings = [
      margin > 0 && margin < 0.35 ? 'Low margin job' : '',
      cashPending > 0 && paid.balanceCollected <= 0 && job.lead.stage !== 'booked' ? 'Balance not collected' : '',
      depositRequired > 0 && paid.depositCollected <= 0 ? 'Customer has not paid deposit' : '',
      quoteAmount > 0 && truckCost / quoteAmount > 0.18 ? 'Truck cost too high' : '',
      estimatedLaborBudget > 0 && laborCost > estimatedLaborBudget * 1.15 ? 'Labour cost exceeded estimate' : '',
      quoteAmount > 0 && totalCosts === 0 ? 'No actual costs logged' : '',
      profit < 0 ? 'Job profitable on quote but losing after actual costs' : '',
      moneyState.requiresAttention ? moneyState.explanation : '',
      telemetry.primaryBottleneck !== 'on_plan' ? `Bottleneck: ${telemetry.primaryBottleneck.replaceAll('_', ' ')}` : '',
    ].filter(Boolean)
    return {
      ...job,
      quoteAmount,
      depositRequired,
      depositCollected: paid.depositCollected,
      balanceCollected: paid.balanceCollected,
      cashCollected: paid.cashCollected,
      cashPending,
      moneyState,
      telemetry,
      jobCosts,
      totalCosts,
      truckCost,
      laborCost,
      fuelCost,
      suppliesCost,
      extraFees,
      claimsReserve,
      profit,
      margin,
      warnings,
    }
  })

  const overheadCosts = costs.filter(c => c.lead_id === 'overhead')
  const totalOverhead = overheadCosts.reduce((s, c) => s + c.amount_cents, 0) / 100

  const allRevenue = jobPL.reduce((s, j) => s + j.revenue, 0)
  const allJobCosts = jobPL.reduce((s, j) => s + j.totalCosts, 0)
  const netProfit = allRevenue - allJobCosts - totalOverhead
  const cashCollected = jobPL.reduce((s, j) => s + j.cashCollected, 0)
  const cashPending = jobPL.reduce((s, j) => s + j.cashPending, 0)
  const flaggedJobs = jobPL.filter(job => job.warnings.length > 0)

  const payoutRows: WorkerPayoutRow[] = jobs.flatMap(job =>
    (job.lead.crewPayouts || []).map(entry => ({
      leadId: job.id,
      leadName: job.name,
      moveDate: job.moveDate,
      branch: job.lead.branch,
      entry,
      totalPay: computeCrewPayoutAmounts(entry).totalPay,
    }))
  )
  const pendingPayoutRows = payoutRows.filter(row => row.entry.payoutStatus !== 'paid')
  const approvedPayoutRows = pendingPayoutRows.filter(row => row.entry.payoutStatus === 'approved')
  const pendingPayoutTotal = pendingPayoutRows.reduce((sum, row) => sum + row.totalPay, 0)
  const approvedPayoutTotal = approvedPayoutRows.reduce((sum, row) => sum + row.totalPay, 0)
  const unlinkedReceipts = receiptUploads.filter(receipt => !receipt.linkedCostId)
  const linkedReceipts = receiptUploads.filter(receipt => !!receipt.linkedCostId)

  const visibleCosts =
    tab === 'jobs' ? costs.filter(c => c.lead_id !== 'overhead') :
    tab === 'overhead' ? overheadCosts :
    costs

  return (
    <div className="crm-shell space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#071421]">Finance</h1>
          <p className="mt-1 text-sm text-[var(--app-muted)]">Job P&L, cost tracking, and expense log.</p>
        </div>
        <button
          onClick={() => {
            setSelectedReceiptIds([])
            setForm(f => ({ ...f, lead_id: selectedJob, description: '', amount: '' }))
            setAddOpen(true)
          }}
          className="crm-button-dark text-sm"
        >
          + Log Cost
        </button>
      </div>

      {loading ? (
        <div className="crm-panel p-16 text-center text-sm text-[var(--app-muted)]">Loading...</div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="crm-panel p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--app-muted)]">Booked Revenue</div>
              <div className="mt-2 text-2xl font-bold text-[#071421]">{formatMoney(allRevenue)}</div>
              <div className="mt-0.5 text-xs text-[var(--app-muted)]">quote value, not cash</div>
            </div>
            <div className="crm-panel p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--app-muted)]">Cash Collected</div>
              <div className="mt-2 text-2xl font-bold text-emerald-600">{formatMoney(cashCollected)}</div>
              <div className="mt-0.5 text-xs text-[var(--app-muted)]">deposits + balances paid</div>
            </div>
            <div className="crm-panel p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--app-muted)]">Cash Pending</div>
              <div className={`mt-2 text-2xl font-bold ${cashPending > 0 ? 'text-amber-600' : 'text-[#071421]'}`}>{formatMoney(cashPending)}</div>
              <div className="mt-0.5 text-xs text-[var(--app-muted)]">uncollected quoted balance</div>
            </div>
            <div className="crm-panel p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--app-muted)]">Net Profit</div>
              <div className={`mt-2 text-2xl font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatMoney(netProfit)}
              </div>
              <div className="mt-0.5 text-xs text-[var(--app-muted)]">after all logged costs</div>
            </div>
          </div>

          {flaggedJobs.length > 0 && (
            <div className="crm-panel border-amber-200 bg-amber-50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-amber-900">Finance Warnings</h2>
                  <p className="mt-1 text-sm text-amber-800">{flaggedJobs.length} job{flaggedJobs.length === 1 ? '' : 's'} need cash, margin, or cost review.</p>
                </div>
                <button onClick={() => setTab('jobs')} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100">
                  Review Job Costs
                </button>
              </div>
            </div>
          )}

          <div className="crm-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--app-line)] px-6 py-4">
              <div>
                <h2 className="font-semibold text-[#071421]">Weekly Crew Payout Queue</h2>
                <p className="mt-1 text-xs text-[var(--app-muted)]">Submitted from Operations. Review here, then approve and mark paid manually.</p>
              </div>
              <div className="text-right text-xs text-[var(--app-muted)]">
                <div>Pending: <span className="font-semibold text-[#071421]">{formatMoney(pendingPayoutTotal)}</span></div>
                <div>Approved: <span className="font-semibold text-emerald-700">{formatMoney(approvedPayoutTotal)}</span></div>
              </div>
            </div>
            {pendingPayoutRows.length === 0 ? (
              <div className="p-10 text-center text-sm text-[var(--app-muted)]">
                No pending crew payouts yet. Ops-submitted labor sheets will appear here.
              </div>
            ) : (
              <div className="divide-y divide-[var(--app-line)]">
                {pendingPayoutRows.map(row => (
                  <div key={row.entry.id} className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[#071421]">{row.entry.workerName}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          {CREW_PAYOUT_STATUS_LABELS[row.entry.payoutStatus || 'submitted']}
                        </span>
                        {row.branch ? (
                          <span className="rounded-full bg-[var(--app-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--app-muted)]">
                            {row.branch}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-[var(--app-muted)]">
                        {row.leadName}{row.moveDate ? ` · ${row.moveDate}` : ''} · {row.entry.role ? row.entry.role.replace('_', ' ') : 'worker'} · {row.entry.approvedHours}h @ {formatMoney(row.entry.hourlyRate)}/hr
                      </div>
                      <div className="mt-1 text-xs text-[var(--app-muted)]">
                        {row.entry.paymentMethod ? `${CREW_PAYOUT_METHOD_LABELS[row.entry.paymentMethod]}${row.entry.payoutDestination ? ` · ${row.entry.payoutDestination}` : ''}` : 'Payout details pending'}
                        {row.entry.reimbursementAmount ? ` · reimbursement ${formatMoney(row.entry.reimbursementAmount)}` : ''}
                        {row.entry.receiptReference ? ` · receipt ${row.entry.receiptReference}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-sm font-semibold text-[#071421]">{formatMoney(row.totalPay)}</div>
                        <div className="text-[11px] text-[var(--app-muted)]">
                          labor {formatMoney(row.entry.laborPay || 0)}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {row.entry.payoutStatus !== 'approved' && (
                          <button
                            onClick={() => void updatePayoutStatus(row, 'approved')}
                            disabled={payoutBusyId === row.entry.id}
                            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                          >
                            {payoutBusyId === row.entry.id ? 'Saving...' : 'Approve'}
                          </button>
                        )}
                        <button
                          onClick={() => void updatePayoutStatus(row, 'paid')}
                          disabled={payoutBusyId === row.entry.id}
                          className="rounded-lg bg-[#071421] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                        >
                          {payoutBusyId === row.entry.id ? 'Saving...' : 'Mark Paid'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="crm-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--app-line)] px-6 py-4">
              <div>
                <h2 className="font-semibold text-[#071421]">Receipt Inbox</h2>
                <p className="mt-1 text-xs text-[var(--app-muted)]">Lead-uploaded receipts land here until finance links them to a job cost.</p>
              </div>
              <div className="text-right text-xs text-[var(--app-muted)]">
                <div>Needs logging: <span className="font-semibold text-[#071421]">{unlinkedReceipts.length}</span></div>
                <div>Linked: <span className="font-semibold text-emerald-700">{linkedReceipts.length}</span></div>
              </div>
            </div>
            {receiptUploads.length === 0 ? (
              <div className="p-10 text-center text-sm text-[var(--app-muted)]">
                No lead-side receipts uploaded yet. Reps can attach fuel receipts, truck invoices, and dump tickets from the lead page.
              </div>
            ) : (
              <div className="divide-y divide-[var(--app-line)]">
                {receiptUploads.slice(0, 18).map(receipt => (
                  <div key={receipt.assetId} className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[#071421]">{receipt.leadName}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${receipt.linkedCostId ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          {receipt.linkedCostId ? 'Linked' : 'Needs cost'}
                        </span>
                        {receipt.branch ? (
                          <span className="rounded-full bg-[var(--app-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--app-muted)]">
                            {receipt.branch}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-[var(--app-muted)]">
                        {receipt.filename || 'Receipt upload'}
                        {receipt.moveDate ? ` · move ${receipt.moveDate}` : ''}
                        {receipt.uploadedByName ? ` · uploaded by ${receipt.uploadedByName}` : ''}
                      </div>
                      <div className="mt-1 text-xs text-[var(--app-muted)]">
                        {new Date(receipt.uploadedAt).toLocaleString('en-CA')}
                        {receipt.notes ? ` · ${receipt.notes}` : ''}
                        {receipt.linkedCostCategory ? ` · ${receipt.linkedCostCategory}` : ''}
                        {typeof receipt.linkedCostAmountCents === 'number' ? ` · ${formatMoney(receipt.linkedCostAmountCents / 100)}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={receipt.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-[var(--app-line)] px-3 py-1.5 text-xs font-medium text-[var(--app-muted)] hover:border-[#071421] hover:text-[#071421]"
                      >
                        View file
                      </a>
                      {!receipt.linkedCostId ? (
                        <button
                          onClick={() => openCostModalForReceipt(receipt)}
                          className="rounded-lg bg-[#071421] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                        >
                          Log from receipt
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Job P&L table */}
          {jobPL.length > 0 && (
            <div className="crm-panel overflow-hidden">
              <div className="border-b border-[var(--app-line)] px-6 py-4">
                <h2 className="font-semibold text-[#071421]">Job P&L Breakdown</h2>
              </div>
              <div className="divide-y divide-[var(--app-line)]">
                {jobPL.map(job => (
                  <div key={job.id} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-semibold text-[#071421]">{job.name}</span>
                          {job.moveDate && <span className="text-xs text-[var(--app-muted)]">Move: {job.moveDate}</span>}
                          <span title={job.moneyState.explanation} className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${job.moneyState.requiresAttention ? 'border-amber-300 bg-amber-50 text-amber-800' : job.moneyState.status === 'paid_in_full' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>{job.moneyState.label}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          <span className="text-[var(--app-muted)]">Revenue (pre-tax): <span className="font-semibold text-[#071421]">{formatMoney(job.quoteAmount)}</span></span>
                          <span className="text-[var(--app-muted)]">Deposit collected: <span className={`font-semibold ${job.depositCollected > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{formatMoney(job.depositCollected)}</span></span>
                          <span className="text-[var(--app-muted)]">Balance pending: <span className={`font-semibold ${job.cashPending > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{formatMoney(job.cashPending)}</span></span>
                          <span className="text-[var(--app-muted)]">Costs: <span className="font-semibold text-rose-600">{formatMoney(job.totalCosts)}</span></span>
                          <span className="text-[var(--app-muted)]">Profit: <span className={`font-bold ${job.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatMoney(job.profit)}</span></span>
                          {job.quoteAmount > 0 && (
                            <span className="text-[var(--app-muted)]">Margin: <span className={`font-semibold ${job.margin >= 0.4 ? 'text-emerald-600' : job.margin >= 0.25 ? 'text-amber-600' : 'text-rose-600'}`}>{Math.round(job.margin * 100)}%</span></span>
                          )}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                          <div className="rounded-lg border border-[var(--app-line)] px-2 py-1.5"><span className="text-[var(--app-muted)]">Estimated cost</span><div className="font-semibold text-[#071421]">{formatMoney(job.telemetry.estimatedCost)}</div></div>
                          <div className="rounded-lg border border-[var(--app-line)] px-2 py-1.5"><span className="text-[var(--app-muted)]">Cost variance</span><div className={`font-semibold ${job.telemetry.costVariance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{job.telemetry.costVariance > 0 ? '+' : ''}{formatMoney(job.telemetry.costVariance)}</div></div>
                          <div className="rounded-lg border border-[var(--app-line)] px-2 py-1.5"><span className="text-[var(--app-muted)]">Hours variance</span><div className={`font-semibold ${(job.telemetry.hoursVariance || 0) > 0 ? 'text-rose-600' : 'text-[#071421]'}`}>{job.telemetry.hoursVariance === null ? 'Not logged' : `${job.telemetry.hoursVariance > 0 ? '+' : ''}${job.telemetry.hoursVariance}h`}</div></div>
                          <div className="rounded-lg border border-[var(--app-line)] px-2 py-1.5"><span className="text-[var(--app-muted)]">Primary bottleneck</span><div className="font-semibold capitalize text-[#071421]">{job.telemetry.primaryBottleneck.replaceAll('_', ' ')}</div></div>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-6">
                          <div className="rounded-lg bg-[var(--app-bg)] px-2 py-1.5"><span className="text-[var(--app-muted)]">Truck</span><div className="font-semibold text-[#071421]">{formatMoney(job.truckCost)}</div></div>
                          <div className="rounded-lg bg-[var(--app-bg)] px-2 py-1.5"><span className="text-[var(--app-muted)]">Labour</span><div className="font-semibold text-[#071421]">{formatMoney(job.laborCost)}</div></div>
                          <div className="rounded-lg bg-[var(--app-bg)] px-2 py-1.5"><span className="text-[var(--app-muted)]">Fuel</span><div className="font-semibold text-[#071421]">{formatMoney(job.fuelCost)}</div></div>
                          <div className="rounded-lg bg-[var(--app-bg)] px-2 py-1.5"><span className="text-[var(--app-muted)]">Supplies</span><div className="font-semibold text-[#071421]">{formatMoney(job.suppliesCost)}</div></div>
                          <div className="rounded-lg bg-[var(--app-bg)] px-2 py-1.5"><span className="text-[var(--app-muted)]">Extra fees</span><div className="font-semibold text-[#071421]">{formatMoney(job.extraFees)}</div></div>
                          <div className="rounded-lg bg-[var(--app-bg)] px-2 py-1.5"><span className="text-[var(--app-muted)]">Claims reserve</span><div className="font-semibold text-[#071421]">{formatMoney(job.claimsReserve)}</div></div>
                        </div>
                        {job.warnings.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {job.warnings.map(warning => (
                              <span key={warning} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                {warning}
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Cost breakdown */}
                        {job.jobCosts.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {job.jobCosts.map(c => (
                              <div key={c.id} className="flex items-center gap-1.5 rounded-lg border border-[var(--app-line)] bg-[var(--app-bg)] px-2 py-1 text-xs">
                                <span>{CAT_META[c.category]?.icon ?? '📋'}</span>
                                <span className="text-[var(--app-muted)]">{CAT_META[c.category]?.label ?? c.category}</span>
                                <span className="font-semibold text-[#071421]">{formatMoney(c.amount_cents / 100)}</span>
                                {c.description && <span className="text-[var(--app-muted)]">· {c.description}</span>}
                                {c.linkedReceiptCount ? (
                                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                    {c.linkedReceiptCount} receipt{c.linkedReceiptCount === 1 ? '' : 's'}
                                  </span>
                                ) : null}
                                <button
                                  onClick={() => void deleteCost(c.id)}
                                  disabled={deleting === c.id}
                                  className="ml-1 text-slate-300 hover:text-rose-500 transition"
                                >×</button>
                              </div>
                            ))}
                          </div>
                        )}
                        {job.jobCosts.length === 0 && (
                          <div className="mt-1 text-xs text-[var(--app-muted)]">No costs logged yet.</div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setSelectedJob(job.id)
                          setSelectedReceiptIds([])
                          setForm(f => ({ ...f, lead_id: job.id, description: '', amount: '' }))
                          setAddOpen(true)
                        }}
                        className="shrink-0 rounded-lg border border-[var(--app-line)] px-3 py-1.5 text-xs font-medium text-[var(--app-muted)] hover:border-[#071421] hover:text-[#071421] transition"
                      >
                        + Cost
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {jobPL.length === 0 && (
            <div className="crm-panel p-10 text-center space-y-2">
              <div className="text-3xl">📊</div>
              <div className="font-semibold text-[#071421]">No booked jobs yet</div>
              <p className="text-sm text-[var(--app-muted)]">Once you book jobs in the CRM, they'll appear here with P&L tracking.</p>
            </div>
          )}

          {/* Expense log */}
          <div className="crm-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--app-line)] px-6 py-4">
              <h2 className="font-semibold text-[#071421]">Expense Log</h2>
              <div className="flex gap-1">
                {(['jobs', 'overhead', 'all'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition ${tab === t ? 'bg-[#071421] text-white' : 'text-[var(--app-muted)] hover:bg-[var(--app-bg)]'}`}
                  >
                    {t === 'jobs' ? 'Job Costs' : t === 'overhead' ? 'Overhead' : 'All'}
                  </button>
                ))}
              </div>
            </div>

            {visibleCosts.length === 0 ? (
              <div className="p-10 text-center text-sm text-[var(--app-muted)]">
                No {tab === 'overhead' ? 'overhead expenses' : 'costs'} logged yet. Click "+ Log Cost" to add one.
              </div>
            ) : (
              <div className="divide-y divide-[var(--app-line)]">
                {visibleCosts.map(c => {
                  const job = jobs.find(j => j.id === c.lead_id)
                  return (
                    <div key={c.id} className="flex items-center gap-4 px-6 py-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--app-bg)] text-base">
                        {CAT_META[c.category]?.icon ?? '📋'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[#071421]">
                          {CAT_META[c.category]?.label ?? c.category}
                          {c.description && <span className="ml-1 font-normal text-[var(--app-muted)]">— {c.description}</span>}
                        </div>
                        <div className="text-xs text-[var(--app-muted)]">
                          {c.cost_date}
                          {job ? <span> · {job.name}</span> : c.lead_id === 'overhead' ? ' · Overhead' : null}
                          {c.linkedReceiptCount ? <span> · {c.linkedReceiptCount} linked receipt{c.linkedReceiptCount === 1 ? '' : 's'}</span> : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-sm font-semibold text-rose-600">
                        −{formatMoney(c.amount_cents / 100)}
                      </div>
                      <button
                        onClick={() => void deleteCost(c.id)}
                        disabled={deleting === c.id}
                        className="shrink-0 text-slate-300 hover:text-rose-500 transition text-lg"
                      >×</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Log cost modal */}
      {addOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 md:items-center"
          style={{ background: 'rgba(15,27,56,0.55)', backdropFilter: 'blur(2px)' }}
          onClick={e => {
            if (e.target === e.currentTarget) {
              setAddOpen(false)
              setSelectedReceiptIds([])
            }
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white shadow-none overflow-hidden">
            <div className="bg-[#071421] px-6 py-5" style={{ borderBottom: '2px solid #C99700' }}>
              <h2 className="font-bold text-white">Log a Cost</h2>
              <p className="mt-0.5 text-xs text-white/60">Track expenses per job or as general overhead.</p>
            </div>
            <div className="p-6 space-y-4">
              {/* Job selector */}
              <label className="block">
                <span className="crm-label">Linked to</span>
                <select
                  className="crm-input mt-1"
                  value={form.lead_id}
                  onChange={e => {
                    setSelectedJob(e.target.value)
                    setForm(f => ({ ...f, lead_id: e.target.value }))
                  }}
                >
                  <option value="overhead">General Overhead</option>
                  {jobs.map(j => (
                    <option key={j.id} value={j.id}>{j.name}{j.moveDate ? ` (${j.moveDate})` : ''}</option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="crm-label">Category</span>
                  <select
                    className="crm-input mt-1"
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  >
                    {CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="crm-label">Amount ($)</span>
                  <input
                    className="crm-input mt-1"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  />
                </label>
              </div>

              <label className="block">
                <span className="crm-label">Description <span className="text-[var(--app-muted)] font-normal">(optional)</span></span>
                <input
                  className="crm-input mt-1"
                  placeholder="e.g. John + Mike 6h each, Penske 26ft, Shell Dougall Ave"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </label>

              <label className="block">
                <span className="crm-label">Date</span>
                <input
                  className="crm-input mt-1"
                  type="date"
                  value={form.cost_date}
                  onChange={e => setForm(f => ({ ...f, cost_date: e.target.value }))}
                />
              </label>

              {selectedReceiptIds.length > 0 ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
                  This cost will be linked to {selectedReceiptIds.length} uploaded receipt file{selectedReceiptIds.length === 1 ? '' : 's'}.
                </div>
              ) : null}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setAddOpen(false)
                    setSelectedReceiptIds([])
                  }}
                  className="flex-1 rounded-xl border border-[var(--app-line)] py-2.5 text-sm font-medium text-[var(--app-muted)]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveCost()}
                  disabled={saving || !form.amount || !form.cost_date}
                  className="flex-1 rounded-xl bg-[#071421] py-2.5 text-sm font-bold text-white disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Log Cost'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
