'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, Plus, X } from 'lucide-react'

/* Human-facing labels for the values the API returns. The API contract is
   unchanged — only what a person reads on screen is translated here. */

function words(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function yesNo(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return words(value)
}

function money(value: unknown): string {
  const n = Number(value || 0)
  return `$${n.toFixed(2)}`
}

function dateOnly(value: unknown): string {
  if (!value) return '—'
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

const LIFECYCLE_LABELS: Record<string, string> = {
  prospect: 'Prospect', invited: 'Invited', onboarding: 'Onboarding', trial: 'Trial period',
  active: 'Active', suspended: 'Paused', offboarded: 'Offboarded',
}

const TIER_LABELS: Record<string, string> = {
  premier: 'Premier', preferred: 'Preferred', standard: 'Standard', trial: 'Trial',
}

const COMPLIANCE_LABELS: Record<string, string> = {
  compliant: 'Up to date', warning: 'Expiring soon', expired: 'Expired', missing: 'Missing',
}

const TAB_LABELS: Record<string, string> = {
  overview: 'Overview', jobs: 'Jobs', team: 'Team', vehicles: 'Vehicles',
  compliance: 'Compliance', claims: 'Claims', earnings: 'Earnings',
  performance: 'Performance', audit: 'Activity log',
}

const BALANCE_META: Record<string, { label: string; help: string }> = {
  total: { label: 'Total recorded', help: 'Everything recorded on your ledger.' },
  available: { label: 'Available now', help: 'Cleared and ready. We\'ll be in touch to arrange your payout.' },
  pending: { label: 'On the way', help: 'Expected from jobs in progress or under review — not cleared yet.' },
}

const METRIC_META: Record<string, { label: string; format: (v: number) => string }> = {
  onTimeRate: { label: 'On-time rate', format: v => `${Math.round(v * 100)}%` },
  acceptanceRate: { label: 'Job acceptance', format: v => `${Math.round(v * 100)}%` },
  cancellationRate: { label: 'Cancellation rate', format: v => `${Math.round(v * 100)}%` },
  customerRating: { label: 'Customer rating', format: v => `${Number(v).toFixed(1)} / 5` },
  claimsRate: { label: 'Claim rate', format: v => `${Math.round(v * 100)}%` },
  communicationRate: { label: 'Communication', format: v => `${Math.round(v * 100)}%` },
  complianceRate: { label: 'Compliance', format: v => `${Math.round(v * 100)}%` },
}

type Column = { key: string; label: string; format?: (v: any, row: any) => string }

const JOB_COLUMNS: Column[] = [
  { key: 'lead_id', label: 'Job' },
  { key: 'role', label: 'Role', format: words },
  { key: 'status', label: 'Status', format: words },
  { key: 'expected_start', label: 'Starts', format: dateOnly },
  { key: 'version', label: 'Briefing update' },
  { key: 'acknowledged_version', label: 'Update confirmed' },
]

const TEAM_COLUMNS: Column[] = [
  { key: 'name', label: 'Name' },
  { key: 'role', label: 'Role', format: words },
  { key: 'status', label: 'Status', format: words },
  { key: 'phone', label: 'Phone' },
  { key: 'approved_for_jobs', label: 'Cleared for jobs', format: yesNo },
]

const VEHICLE_COLUMNS: Column[] = [
  { key: 'unit_code', label: 'Unit' },
  { key: 'vehicle_type', label: 'Type', format: words },
  { key: 'size_label', label: 'Size', format: words },
  { key: 'status', label: 'Status', format: words },
  { key: 'insurance_verified', label: 'Insurance verified', format: yesNo },
  { key: 'brand_compliant', label: 'Brand compliant', format: yesNo },
]

const CLAIM_COLUMNS: Column[] = [
  { key: 'claim_code', label: 'Claim' },
  { key: 'lead_id', label: 'Job' },
  { key: 'title', label: 'Title' },
  { key: 'severity', label: 'Severity', format: words },
  { key: 'status', label: 'Status', format: words },
  { key: 'opened_at', label: 'Opened', format: dateOnly },
]

const LEDGER_COLUMNS: Column[] = [
  { key: 'effective_at', label: 'Date', format: dateOnly },
  { key: 'description', label: 'Details' },
  { key: 'entry_type', label: 'Type', format: words },
  { key: 'state', label: 'Status', format: words },
  { key: 'amount', label: 'Amount', format: money },
]

const AUDIT_COLUMNS: Column[] = [
  { key: 'created_at', label: 'When', format: dateOnly },
  { key: 'entity_type', label: 'Area', format: words },
  { key: 'action', label: 'Action', format: words },
  { key: 'actor_name', label: 'Done by' },
]

const FIELD_LABELS: Record<string, Record<string, string>> = {
  member: { name: 'Full name', email: 'Email', phone: 'Phone', role: 'Role' },
  portal_user: { name: 'Full name', email: 'Email', password: 'Temporary password', role: 'Access level' },
  vehicle: { unit_code: 'Unit code', vehicle_type: 'Vehicle type', size_label: 'Size' },
  claim: { lead_id: 'Job reference', title: 'What happened', description: 'Details', severity: 'How serious' },
}

const SEVERITY_OPTIONS = [
  { value: 'level_1', label: 'Level 1 — minor' },
  { value: 'level_2', label: 'Level 2 — moderate' },
  { value: 'level_3', label: 'Level 3 — serious' },
]

function cellValue(column: Column, row: any): string {
  const raw = row[column.key]
  if (column.format) return column.format(raw, row)
  if (raw === null || raw === undefined || raw === '') return '—'
  return String(raw)
}

export default function Partner360Dashboard({ endpoint, backHref }: { endpoint: string; backHref?: string }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('overview')

  async function load() {
    const response = await fetch(endpoint, { cache: 'no-store' })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error('load-failed')
    setData(body)
  }

  useEffect(() => { load().catch(() => setError('load')) }, [endpoint])

  async function add(resource: string, input: any) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource, input }) })
    if (!response.ok) { setError('save'); return }
    await load().catch(() => setError('load'))
  }

  if (error) {
    return (
      <main className="crm-shell">
        <div className="flex max-w-lg items-start gap-3 rounded-xl border border-[#B42318]/25 bg-[#FEF2F2] p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#B42318]" />
          <div>
            <p className="text-sm font-semibold text-[#B42318]">
              {error === 'save' ? 'Couldn\'t save that.' : 'Couldn\'t load this dashboard.'}
            </p>
            <p className="mt-1 text-sm text-[#B42318]/80">
              {error === 'save'
                ? 'Check your connection and try again. Nothing was changed.'
                : 'Check your connection and refresh the page. If it keeps happening, call us at 226-773-2993.'}
            </p>
            <button onClick={() => { setError(''); void load().catch(() => setError('load')) }} className="mt-3 rounded-lg bg-[#B42318] px-4 py-2 text-xs font-bold text-white">
              Try again
            </button>
          </div>
        </div>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="crm-shell">
        <p className="flex items-center gap-2 text-sm text-[#667085]"><Loader2 className="h-4 w-4 animate-spin" /> Loading your dashboard…</p>
      </main>
    )
  }

  const p = data.partner
  const openClaims = (data.claims || []).filter((x: any) => x.status !== 'closed')
  const openActions = (data.correctiveActions || []).filter((x: any) => x.status !== 'resolved')
  const tabs = ['overview', 'jobs', 'team', 'vehicles', 'compliance', 'claims', 'earnings', 'performance', 'audit']

  return (
    <main className="crm-shell space-y-5">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          {backHref && <Link href={backHref} className="text-xs font-bold text-[#667085]">← Partner network</Link>}
          <p className="mt-2 text-xs font-bold uppercase tracking-[0.18em] text-[#8a6800]">Partner dashboard</p>
          <h1 className="font-display text-2xl font-bold text-[#071421]">{p.company_name}</h1>
          <p className="mt-1 text-sm text-[#667085]">
            {p.partner_code ? `Partner code ${p.partner_code}` : 'Partner code coming soon'}
            {' · '}{LIFECYCLE_LABELS[p.lifecycle_status] || words(p.lifecycle_status)}
            {' · '}{TIER_LABELS[data.performance.tier] || words(data.performance.tier)} tier
          </p>
        </div>
        <div className="rounded-2xl bg-[#071421] px-6 py-4 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Partner score</p>
          <p className="text-3xl font-black">{data.performance.score}<span className="text-base font-semibold text-white/60">/100</span></p>
        </div>
      </header>

      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Dashboard sections">
        {tabs.map(item => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold ${tab === item ? 'bg-[#071421] text-white' : 'border border-[#E5E7EB] bg-white text-[#071421]'}`}
          >
            {TAB_LABELS[item]}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { label: 'Upcoming jobs', value: String((data.assignments || []).filter((x: any) => !['completed', 'cancelled'].includes(x.status)).length), help: 'Jobs assigned to you that haven\'t finished yet.' },
            { label: 'Open claims', value: String(openClaims.length), help: 'Claims still being worked through.' },
            { label: 'Compliance alerts', value: String((data.compliance || []).filter((x: any) => x.state !== 'compliant').length), help: 'Documents that need your attention.' },
            { label: 'Pending earnings', value: data.balances ? money(data.balances.pending) : 'Restricted', help: 'Expected from jobs in progress — not cleared yet.' },
          ].map(card => (
            <div key={card.label} className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#667085]">{card.label}</p>
              <p className="mt-2 text-2xl font-black text-[#071421]">{card.value}</p>
              <p className="mt-1 text-[11px] leading-5 text-[#667085]">{card.help}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'jobs' && <Table rows={data.assignments || []} columns={JOB_COLUMNS} empty="No jobs assigned yet." />}

      {tab === 'team' && (
        <>
          <div className="flex flex-wrap gap-2">
            <QuickAdd label="Add crew member" resource="member" fields={['name', 'email', 'phone', 'role']} defaults={{ role: 'mover', status: 'active' }} onAdd={input => add('member', input)} />
            {backHref && <QuickAdd label="Add a team login" resource="portal_user" fields={['name', 'email', 'password', 'role']} defaults={{ role: 'partner_admin' }} onAdd={input => add('portal_user', input)} />}
          </div>
          <Table rows={data.members || []} columns={TEAM_COLUMNS} empty="No team members added yet." />
        </>
      )}

      {tab === 'vehicles' && (
        <>
          <QuickAdd label="Add vehicle" resource="vehicle" fields={['unit_code', 'vehicle_type', 'size_label']} defaults={{ status: 'active', ownership: 'partner_owned' }} onAdd={input => add('vehicle', input)} />
          <Table rows={data.vehicles || []} columns={VEHICLE_COLUMNS} empty="No vehicles added yet." />
        </>
      )}

      {tab === 'compliance' && (
        <div className="grid gap-3 md:grid-cols-2">
          {(data.compliance || []).map((x: any) => {
            const bad = x.state === 'expired' || x.state === 'missing'
            return (
              <div key={x.id} className={`rounded-xl border p-4 ${bad ? 'border-[#B42318]/25 bg-[#FEF2F2]' : 'border-[#E5E7EB] bg-white'}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-[#071421]">{x.label}</p>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${bad ? 'bg-[#B42318] text-white' : x.state === 'warning' ? 'bg-[#FFFAEB] text-[#92400E]' : 'bg-[#ECFDF3] text-[#0F6A53]'}`}>
                    {COMPLIANCE_LABELS[x.state] || words(x.state)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#667085]">
                  {x.document?.expires_at ? `Expires ${dateOnly(x.document.expires_at)}` : x.conditional_note || 'No expiry recorded'}
                </p>
                {bad && <p className="mt-2 text-xs font-semibold text-[#B42318]">Upload a current document to clear this.</p>}
              </div>
            )
          })}
          {(data.compliance || []).length === 0 && <p className="text-sm text-[#667085]">No compliance items.</p>}
        </div>
      )}

      {tab === 'claims' && (
        <>
          <QuickAdd label="Report an issue" resource="claim" fields={['lead_id', 'title', 'description', 'severity']} defaults={{ severity: 'level_2' }} onAdd={input => add('claim', input)} />
          <Table rows={data.claims || []} columns={CLAIM_COLUMNS} empty="No issues reported." />
        </>
      )}

      {tab === 'earnings' && (
        <>
          {data.balances ? (
            <div className="grid gap-3 md:grid-cols-3">
              {Object.entries(BALANCE_META).map(([key, meta]) => (
                <div key={key} className="rounded-xl border border-[#E5E7EB] bg-white p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#667085]">{meta.label}</p>
                  <p className="mt-1 text-2xl font-black text-[#071421]">{money((data.balances as any)[key])}</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#667085]">{meta.help}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 text-sm text-[#667085]">
              Earnings aren&apos;t visible for this login. Ask your company admin for access.
            </div>
          )}
          <Table rows={data.ledger || []} columns={LEDGER_COLUMNS} empty="No earnings recorded yet." />
        </>
      )}

      {tab === 'performance' && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
            <h2 className="font-bold text-[#071421]">How you&apos;re doing</h2>
            {Object.entries(data.performance.metrics).map(([k, v]) => {
              const meta = METRIC_META[k]
              return (
                <div key={k} className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-[#667085]">{meta ? meta.label : words(k)}</span>
                  <b className="text-[#071421]">{meta && typeof v === 'number' ? meta.format(v) : words(v)}</b>
                </div>
              )
            })}
          </div>
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
            <h2 className="font-bold text-[#071421]">Things to fix</h2>
            {openActions.length ? openActions.map((x: any) => (
              <div key={x.id} className="mt-3 rounded-xl bg-[#FFFAEB] p-3 text-sm">
                <p className="font-semibold text-[#071421]">{x.issue}</p>
                <p className="mt-1 text-[#92400E]">{x.required_action}</p>
              </div>
            )) : <p className="mt-4 text-sm text-[#667085]">Nothing needs fixing right now.</p>}
          </div>
        </div>
      )}

      {tab === 'audit' && <Table rows={data.audits || []} columns={AUDIT_COLUMNS} empty="No activity recorded yet." />}
    </main>
  )
}

function Table({ rows, columns, empty = 'Nothing recorded.' }: { rows: any[]; columns: Column[]; empty?: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[#E5E7EB] bg-white">
      {rows.length ? (
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F9FAFB]">
            <tr>{columns.map(c => <th key={c.key} className="whitespace-nowrap p-3 font-bold uppercase tracking-wide text-[#667085]">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || i} className="border-t border-[#E5E7EB]">
                {columns.map(c => <td key={c.key} className="p-3 text-[#071421]">{cellValue(c, r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="p-8 text-center text-sm text-[#667085]">{empty}</p>}
    </div>
  )
}

function QuickAdd({ label, resource, fields, defaults, onAdd }: { label: string; resource: string; fields: string[]; defaults: any; onAdd: (x: any) => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(defaults)
  const labels = FIELD_LABELS[resource] || {}
  return (
    <div className="mb-3">
      {open ? (
        <form
          onSubmit={e => { e.preventDefault(); onAdd(form); setOpen(false) }}
          className="grid gap-3 rounded-xl border border-[#E5E7EB] bg-white p-4 md:grid-cols-4"
        >
          {fields.map(f => (
            <div key={f}>
              <label htmlFor={`qa-${resource}-${f}`} className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                {labels[f] || words(f)}
              </label>
              {f === 'severity' ? (
                <select
                  id={`qa-${resource}-${f}`}
                  value={form[f] || ''}
                  onChange={e => setForm({ ...form, [f]: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm text-[#071421]"
                >
                  {SEVERITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  id={`qa-${resource}-${f}`}
                  required={f !== 'phone'}
                  type={f === 'email' ? 'email' : f === 'password' ? 'password' : 'text'}
                  value={form[f] || ''}
                  onChange={e => setForm({ ...form, [f]: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm text-[#071421] outline-none focus:border-[#0F6A53]"
                />
              )}
            </div>
          ))}
          <div className="flex items-end gap-2 md:col-span-4">
            <button type="submit" className="min-h-[44px] rounded-lg bg-[#071421] px-4 py-2 text-xs font-bold text-white">Save</button>
            <button type="button" onClick={() => setOpen(false)} className="flex min-h-[44px] items-center gap-1 rounded-lg border border-[#E5E7EB] px-4 py-2 text-xs font-bold text-[#071421]">
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setOpen(true)} className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#071421] px-4 py-2 text-xs font-bold text-white">
          <Plus className="h-4 w-4" /> {label}
        </button>
      )}
    </div>
  )
}
