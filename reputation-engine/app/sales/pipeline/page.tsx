'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { deleteSalesLead, fetchSalesOverview, updateSalesLead } from '@/lib/sales-api'
import { formatDate, formatMoney, getLeadAssignedRepName, getSalesBranchLabel, SALES_BRANCHES, isClosedLeadStage } from '@/lib/sales'
import { formatRelativeTime, getLeadGuidance } from '@/lib/lead-guidance'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import type { CRMLead, CRMQuote, FollowUpLog } from '@/lib/types'

const COLUMN_ORDER: CRMLead['stage'][] = ['new', 'contacted', 'estimate_scheduled', 'estimate_completed', 'pricing', 'quoted', 'tentative', 'nurture', 'booked', 'completed', 'customer_success', 'lost']

const COLUMN_ACCENT: Partial<Record<CRMLead['stage'], string>> = {
  tentative: 'border-orange-300 bg-orange-50/60',
  booked: 'border-emerald-200 bg-emerald-50/40',
  completed: 'border-indigo-200 bg-indigo-50/40',
  customer_success: 'border-sky-200 bg-sky-50/40',
}

const COLUMN_HEADER_ACCENT: Partial<Record<CRMLead['stage'], string>> = {
  tentative: 'text-orange-700',
  booked: 'text-emerald-700',
  completed: 'text-indigo-700',
  customer_success: 'text-sky-700',
}

function HeatTag({ label, score, tone }: { label: string; score: number; tone: 'hot' | 'warm' | 'cold' | 'dormant' | 'risk' }) {
  const classes =
    tone === 'risk'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : tone === 'hot'
        ? 'border-orange-200 bg-orange-50 text-orange-700'
        : tone === 'warm'
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : tone === 'dormant'
            ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700'
            : 'border-slate-200 bg-slate-50 text-slate-600'
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${classes}`}>{label} {score}</span>
}

const COLUMN_LABELS: Record<CRMLead['stage'], string> = {
  new: 'New Lead',
  contacted: 'Contacted',
  estimate_scheduled: 'Est. Scheduled',
  estimate_completed: 'Est. Done',
  pricing: 'Building Quote',
  quoted: 'Quote Sent',
  tentative: 'Tentative',
  nurture: 'Shopping Around',
  booked: 'Booked ✓',
  completed: 'Completed',
  customer_success: 'Customer Success',
  lost: 'Lost',
}

const STAGE_COLORS: Partial<Record<CRMLead['stage'], string>> = {
  new: 'bg-sky-50 text-sky-700',
  contacted: 'bg-blue-50 text-blue-700',
  estimate_scheduled: 'bg-violet-50 text-violet-700',
  estimate_completed: 'bg-purple-50 text-purple-700',
  pricing: 'bg-amber-50 text-amber-700',
  quoted: 'bg-orange-50 text-orange-700',
  tentative: 'bg-orange-100 text-orange-800',
  nurture: 'bg-stone-100 text-stone-600',
  booked: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-indigo-50 text-indigo-700',
  customer_success: 'bg-sky-50 text-sky-700',
  lost: 'bg-rose-50 text-rose-600',
}

const SOURCE_LABELS: Record<string, string> = {
  twilio_call: 'Call',
  twilio_sms: 'SMS',
  missed_call: 'Missed Call',
  facebook_lead_ad: 'FB Lead Ad',
  facebook_dm: 'Facebook',
  instagram_dm: 'Instagram',
  email: 'Email',
  website_form: 'Web Form',
  zapier: 'Lead Form',
  manual: 'Manual',
  direct_mail: 'Direct Mail',
  destination_opportunity: 'Destination',
}

const SOURCE_DOT: Record<string, string> = {
  twilio_call: 'bg-blue-400',
  twilio_sms: 'bg-purple-400',
  missed_call: 'bg-red-400',
  facebook_lead_ad: 'bg-[#1877F2]',
  facebook_dm: 'bg-[#1877F2]',
  instagram_dm: 'bg-pink-400',
  email: 'bg-gray-400',
  website_form: 'bg-emerald-400',
  zapier: 'bg-orange-400',
}

type AttentionFilter = 'overdue' | 'cold' | 'no_quote' | 'new_today' | ''
type MoveDateFilter = 'today' | 'this_week' | 'this_month' | ''
type SortMode = 'score' | 'move_date' | 'last_touched' | 'follow_up' | 'created'
type WorkflowFilter = 'all' | 'follow_up' | 'draft' | 'sent' | 'accepted' | 'declined'

function dayStart(d: Date) { const c = new Date(d); c.setHours(0,0,0,0); return c }
function today() { return dayStart(new Date()) }
function daysAgo(n: number) { return new Date(Date.now() - n * 86_400_000) }
function endOfWeek() { const d = today(); d.setDate(d.getDate() + (6 - d.getDay())); return d }
function endOfMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0) }

function timeAgo(iso: string | undefined) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(iso)
}

function SalesPipelineContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentUser = useCurrentUser()
  const query = searchParams.get('q')?.trim().toLowerCase() ?? ''

  const [leads, setLeads] = useState<CRMLead[]>([])
  const [quotes, setQuotes] = useState<CRMQuote[]>([])
  const [followUps, setFollowUps] = useState<FollowUpLog[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ lead: CRMLead; typed: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  // ── View & filters ──
  const [viewMode, setViewMode] = useState<'board' | 'list'>('list')
  const [filterStage, setFilterStage] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterCity, setFilterCity] = useState('')
  const [filterRep, setFilterRep] = useState('')
  const [filterBranch, setFilterBranch] = useState('')
  const [filterMoveDate, setFilterMoveDate] = useState<MoveDateFilter>('')
  const [filterAttention, setFilterAttention] = useState<AttentionFilter>('')
  const [sortMode, setSortMode] = useState<SortMode>('score')
  const [ownershipView, setOwnershipView] = useState<'all' | 'mine' | 'unassigned'>('all')
  const [workflowFilter, setWorkflowFilter] = useState<WorkflowFilter>('all')

  // ── Trash drawer ──
  const [showDeletedDrawer, setShowDeletedDrawer] = useState(false)
  const [deletedLeads, setDeletedLeads] = useState<Array<CRMLead & { _deletedAt?: string }>>([])
  const [deletedLoading, setDeletedLoading] = useState(false)
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null)

  // ── Board drag-and-drop ──
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<CRMLead['stage'] | null>(null)

  async function loadDeletedLeads() {
    setDeletedLoading(true)
    try {
      const res = await fetch('/api/sales/leads/deleted', { credentials: 'include', cache: 'no-store' })
      const data = await res.json() as { leads?: Array<CRMLead & { _deletedAt?: string }> }
      setDeletedLeads(data.leads || [])
    } catch { /* ignore */ } finally { setDeletedLoading(false) }
  }

  async function restoreLead(leadId: string) {
    setRestoreBusyId(leadId)
    try {
      const res = await fetch('/api/sales/leads/deleted', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })
      if (res.ok) { setDeletedLeads(prev => prev.filter(l => l.id !== leadId)); void refresh() }
    } catch { /* ignore */ } finally { setRestoreBusyId(null) }
  }

  async function refresh() {
    try {
      setLoading(true)
      const data = await fetchSalesOverview()
      setLeads(data.leads); setQuotes(data.quotes); setFollowUps(data.followUps); setError(null)
    } catch (err) { setError((err as Error).message) } finally { setLoading(false) }
  }

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => {
      if (document.hidden) return
      fetchSalesOverview().then(data => { setLeads(data.leads); setQuotes(data.quotes); setFollowUps(data.followUps) }).catch(() => {})
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) setViewMode('list')
  }, [])

  useEffect(() => {
    if (currentUser?.role === 'sales_rep') setOwnershipView(c => c === 'all' ? 'mine' : c)
  }, [currentUser?.role])

  function removeLead(event: MouseEvent, lead: CRMLead) {
    event.preventDefault(); event.stopPropagation()
    setDeleteConfirm({ lead, typed: '' })
  }

  async function confirmDelete() {
    if (!deleteConfirm) return
    const { lead } = deleteConfirm
    const prev = leads
    setDeleteConfirm(null)
    try {
      setDeleteBusyId(lead.id)
      setLeads(c => c.filter(i => i.id !== lead.id))
      await deleteSalesLead(lead.id)
    } catch (err) { setLeads(prev); setError((err as Error).message) } finally { setDeleteBusyId(null) }
  }

  async function moveLeadToStage(leadId: string, newStage: CRMLead['stage']) {
    const lead = leads.find(l => l.id === leadId)
    if (!lead || lead.stage === newStage) return
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: newStage } : l))
    try { await updateSalesLead(leadId, { stage: newStage }) }
    catch (err) { setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: lead.stage } : l)); setError((err as Error).message) }
  }

  function handleDragStart(leadId: string) { setDraggedLeadId(leadId) }
  function handleDragEnd() { setDraggedLeadId(null); setDragOverStage(null) }
  function handleDragOver(e: React.DragEvent, stage: CRMLead['stage']) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverStage(stage) }
  function handleDragLeave() { setDragOverStage(null) }
  async function handleDrop(e: React.DragEvent, stage: CRMLead['stage']) {
    e.preventDefault(); setDragOverStage(null)
    if (!draggedLeadId) return
    await moveLeadToStage(draggedLeadId, stage); setDraggedLeadId(null)
  }

  const quoteMap = useMemo(() => new Map(quotes.map(q => [q.id, q])), [quotes])
  function matchesWorkflowFilter(lead: CRMLead, quote: CRMQuote | null | undefined, filter: WorkflowFilter) {
    if (filter === 'all') return true

    const leadClosed = isClosedLeadStage(lead.stage)
    const dueTodayOrEarlier =
      !!lead.followUpDate &&
      dayStart(new Date(lead.followUpDate)).getTime() <= today().getTime()
    const quoteStatus = quote?.status

    if (filter === 'follow_up') {
      return !leadClosed && (dueTodayOrEarlier || quoteStatus === 'sent' || quoteStatus === 'viewed')
    }

    if (filter === 'draft') {
      return !leadClosed && (!quote || quoteStatus === 'draft')
    }

    if (filter === 'sent') {
      return quoteStatus === 'sent' || quoteStatus === 'viewed'
    }

    if (filter === 'accepted') {
      return quoteStatus === 'accepted' || quoteStatus === 'invoiced' || ['booked', 'completed', 'customer_success'].includes(lead.stage)
    }

    return quoteStatus === 'declined' || lead.stage === 'lost'
  }

  const workflowCounts = useMemo(() => {
    const counts: Record<WorkflowFilter, number> = {
      all: leads.length,
      follow_up: 0,
      draft: 0,
      sent: 0,
      accepted: 0,
      declined: 0,
    }

    for (const lead of leads) {
      const quote = lead.quoteId ? quoteMap.get(lead.quoteId) || null : null
      if (matchesWorkflowFilter(lead, quote, 'follow_up')) counts.follow_up += 1
      if (matchesWorkflowFilter(lead, quote, 'draft')) counts.draft += 1
      if (matchesWorkflowFilter(lead, quote, 'sent')) counts.sent += 1
      if (matchesWorkflowFilter(lead, quote, 'accepted')) counts.accepted += 1
      if (matchesWorkflowFilter(lead, quote, 'declined')) counts.declined += 1
    }

    return counts
  }, [leads, quoteMap])
  const followUpsByLead = useMemo(() => {
    const map = new Map<string, FollowUpLog[]>()
    for (const item of followUps) {
      if (!item.leadId) continue
      const existing = map.get(item.leadId) || []
      existing.push(item)
      map.set(item.leadId, existing)
    }
    return map
  }, [followUps])
  const guidanceMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getLeadGuidance>>()
    for (const lead of leads) {
      const quote = lead.quoteId ? quoteMap.get(lead.quoteId) || null : null
      map.set(lead.id, getLeadGuidance(lead, quote, followUpsByLead.get(lead.id) || []))
    }
    return map
  }, [followUpsByLead, leads, quoteMap])

  // ── Smart filter counters ──
  const attentionCounts = useMemo(() => {
    const t = today()
    const ago7 = daysAgo(7)
    const active = leads.filter(l => !isClosedLeadStage(l.stage))
    return {
      overdue: active.filter(l => l.followUpDate && dayStart(new Date(l.followUpDate)) < t).length,
      cold: active.filter(l => {
        const last = l.lastTouchedAt || l.createdAt
        return last && new Date(last) < ago7
      }).length,
      no_quote: active.filter(l => !l.quoteId && ['new','contacted','estimate_scheduled','estimate_completed','pricing'].includes(l.stage)).length,
      new_today: leads.filter(l => l.createdAt && dayStart(new Date(l.createdAt)).getTime() === t.getTime()).length,
    }
  }, [leads])

  // ── Option lists ──
  const sourceOptions = useMemo(() => Array.from(new Set(leads.map(l => l.source).filter(Boolean) as string[])).sort(), [leads])
  const cityOptions   = useMemo(() => Array.from(new Set(leads.map(l => l.originCity).filter(Boolean) as string[])).sort(), [leads])
  const repOptions    = useMemo(() => {
    const map = new Map<string, string>()
    leads.forEach(l => { const n = getLeadAssignedRepName(l); if (n) map.set(l.assignedRepUserId || n, n) })
    return Array.from(map.entries()).map(([v, label]) => ({ value: v, label })).sort((a,b) => a.label.localeCompare(b.label))
  }, [leads])

  // ── Core filter + sort function ──
  function applyFilters(list: CRMLead[]) {
    const t = today()
    const ago7 = daysAgo(7)
    return list
      .filter(l => !filterStage || l.stage === filterStage)
      .filter(l => !filterSource || l.source === filterSource)
      .filter(l => !filterCity || l.originCity === filterCity)
      .filter(l => !filterRep || (l.assignedRepUserId ? l.assignedRepUserId === filterRep : getLeadAssignedRepName(l) === filterRep))
      .filter(l => !filterBranch || l.branch === filterBranch)
      .filter(l => {
        if (ownershipView === 'mine') return (!!currentUser?.userId && l.assignedRepUserId === currentUser.userId) || (!!currentUser?.name && getLeadAssignedRepName(l) === currentUser.name)
        if (ownershipView === 'unassigned') return !l.assignedRepUserId && !getLeadAssignedRepName(l)
        return true
      })
      .filter(l => matchesWorkflowFilter(l, l.quoteId ? quoteMap.get(l.quoteId) || null : null, workflowFilter))
      .filter(l => {
        if (!filterMoveDate || !l.moveDate) return !filterMoveDate
        const md = dayStart(new Date(l.moveDate))
        if (filterMoveDate === 'today') return md.getTime() === t.getTime()
        if (filterMoveDate === 'this_week') return md >= t && md <= endOfWeek()
        if (filterMoveDate === 'this_month') return md >= t && md <= endOfMonth()
        return true
      })
      .filter(l => {
        if (!filterAttention) return true
        if (filterAttention === 'overdue') return !!l.followUpDate && dayStart(new Date(l.followUpDate)) < t && !isClosedLeadStage(l.stage)
        if (filterAttention === 'cold') { const last = l.lastTouchedAt || l.createdAt; return !!last && new Date(last) < ago7 && !isClosedLeadStage(l.stage) }
        if (filterAttention === 'no_quote') return !l.quoteId && ['new','contacted','estimate_scheduled','estimate_completed','pricing'].includes(l.stage)
        if (filterAttention === 'new_today') return !!l.createdAt && dayStart(new Date(l.createdAt)).getTime() === t.getTime()
        return true
      })
      .filter(l => {
        if (!query) return true
        return [l.name, l.phone, l.email, l.originCity, l.destCity, l.originAddress, l.moveType, l.branch]
          .filter(Boolean).join(' ').toLowerCase().includes(query)
      })
      .sort((a, b) => {
        if (sortMode === 'move_date') {
          if (!a.moveDate && !b.moveDate) return 0
          if (!a.moveDate) return 1
          if (!b.moveDate) return -1
          return new Date(a.moveDate).getTime() - new Date(b.moveDate).getTime()
        }
        if (sortMode === 'last_touched') {
          const at = a.lastTouchedAt || a.createdAt || ''
          const bt = b.lastTouchedAt || b.createdAt || ''
          return new Date(at).getTime() - new Date(bt).getTime()
        }
        if (sortMode === 'follow_up') {
          if (!a.followUpDate && !b.followUpDate) return 0
          if (!a.followUpDate) return 1
          if (!b.followUpDate) return -1
          return new Date(a.followUpDate).getTime() - new Date(b.followUpDate).getTime()
        }
        if (sortMode === 'created') return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
        const guideA = guidanceMap.get(a.id)
        const guideB = guidanceMap.get(b.id)
        if ((guideB?.action.priority || 0) !== (guideA?.action.priority || 0)) {
          return (guideB?.action.priority || 0) - (guideA?.action.priority || 0)
        }
        return (guideB?.heat.score || b.leadScore || 0) - (guideA?.heat.score || a.leadScore || 0)
      })
  }

  const grouped = useMemo(() => COLUMN_ORDER.map(stage => ({
    stage, label: COLUMN_LABELS[stage],
    cards: applyFilters(
      leads.filter(l => l.stage === stage).filter(l => {
        if (stage === 'contacted' && !query && !filterAttention) {
          const isJunk = /^(unknown caller|new caller|\+\d{10,}$)/i.test((l.name || '').trim())
          if (isJunk && !l.quoteId && !l.email) return false
        }
        return true
      })
    ),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [guidanceMap, leads, query, filterStage, filterSource, filterCity, filterRep, filterBranch, filterMoveDate, filterAttention, sortMode, ownershipView, workflowFilter, currentUser?.name, currentUser?.userId, quoteMap])

  const visibleLeads = useMemo(() => {
    if (viewMode === 'board') return grouped.flatMap(c => c.cards)
    return applyFilters(leads)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidanceMap, leads, viewMode, grouped, query, filterStage, filterSource, filterCity, filterRep, filterBranch, filterMoveDate, filterAttention, sortMode, ownershipView, workflowFilter, currentUser?.name, currentUser?.userId, quoteMap])

  const activeFilterCount = [filterStage, filterSource, filterCity, filterRep, filterBranch, filterMoveDate, filterAttention, workflowFilter === 'all' ? '' : workflowFilter].filter(Boolean).length

  function clearAllFilters() {
    setFilterStage(''); setFilterSource(''); setFilterCity(''); setFilterRep('')
    setFilterBranch(''); setFilterMoveDate(''); setFilterAttention('')
    setWorkflowFilter('all')
  }

  // ── Urgency helpers for list view ──
  function getUrgency(lead: CRMLead): 'overdue' | 'cold' | 'ok' {
    const t = today()
    if (lead.followUpDate && dayStart(new Date(lead.followUpDate)) < t && !isClosedLeadStage(lead.stage)) return 'overdue'
    const last = lead.lastTouchedAt || lead.createdAt
    if (last && new Date(last) < daysAgo(7) && !isClosedLeadStage(lead.stage)) return 'cold'
    return 'ok'
  }

  async function handleQuickAction(event: MouseEvent, lead: CRMLead, action: 'call' | 'sms' | 'open' | 'snooze', quote?: CRMQuote | null) {
    event.preventDefault()
    event.stopPropagation()

    if (action === 'call') {
      if (lead.phone) {
        window.dispatchEvent(new CustomEvent('crm:open-dialer', { detail: { phone: lead.phone, leadId: lead.id, name: lead.name } }))
      } else {
        router.push(`/sales/leads/${lead.id}`)
      }
      return
    }

    if (action === 'sms') {
      router.push(`/sales/leads/${lead.id}`)
      return
    }

    if (action === 'open') {
      if (quote && (quote.status === 'sent' || quote.status === 'viewed' || quote.status === 'accepted')) {
        router.push(`/sales/quotes/${quote.id}`)
        return
      }
      router.push(`/sales/leads/${lead.id}`)
      return
    }

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    try {
      const updated = await updateSalesLead(lead.id, {
        followUpDate: tomorrow,
        followUpNote: `Snoozed from pipeline on ${new Date().toLocaleDateString('en-CA')}`,
      })
      setLeads(current => current.map(item => item.id === updated.id ? updated : item))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="crm-shell space-y-5">
      {/* ── HEADER ── */}
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-[var(--app-ink)]">Pipeline</h1>
          <div className="mt-1 text-sm text-[var(--app-muted)]">
            {leads.length} leads · {quotes.length} quotes · {formatMoney(quotes.reduce((s, q) => s + q.total, 0))} pipeline value
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Sort */}
          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as SortMode)}
            className="crm-input h-9 w-auto cursor-pointer py-0 text-sm"
          >
            <option value="score">Sort: Heat / Next Action</option>
            <option value="move_date">Sort: Move Date ↑</option>
            <option value="last_touched">Sort: Gone Coldest</option>
            <option value="follow_up">Sort: Follow-up Due</option>
            <option value="created">Sort: Newest First</option>
          </select>
          {/* View toggle */}
          <div className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-panel)] p-1">
            <button onClick={() => setViewMode('list')} className={`rounded-[4px] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${viewMode === 'list' ? 'bg-[var(--app-ink)] text-white' : 'text-[var(--app-muted)]'}`}>List</button>
            <button onClick={() => setViewMode('board')} className={`rounded-[4px] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${viewMode === 'board' ? 'bg-[var(--app-ink)] text-white' : 'text-[var(--app-muted)]'}`}>Board</button>
          </div>
          <button onClick={() => void refresh()} className="crm-button">Refresh</button>
          <Link href="/sales/leads/new" className="crm-button-primary text-xs px-3 py-2">+ New Lead</Link>
        </div>
      </section>

      <section className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-4">
        <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">Simple Workflow</div>
            <div className="mt-1 text-sm text-[var(--app-muted)]">Work from follow-up first, then drafts, then sent quotes. Accepted jobs stay visible without cluttering the chase list.</div>
          </div>
          {workflowFilter !== 'all' ? (
            <button onClick={() => setWorkflowFilter('all')} className="text-xs font-medium text-[var(--app-accent)] hover:underline">
              Show full pipeline
            </button>
          ) : null}
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          {([
            ['follow_up', 'Follow Up Today', workflowCounts.follow_up],
            ['draft', 'Draft / Not Sent', workflowCounts.draft],
            ['sent', 'Quote Sent', workflowCounts.sent],
            ['accepted', 'Accepted / Booked', workflowCounts.accepted],
            ['declined', 'Declined / Lost', workflowCounts.declined],
          ] as Array<[WorkflowFilter, string, number]>).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setWorkflowFilter(current => current === key ? 'all' : key)}
              className={`rounded-[10px] border px-4 py-3 text-left transition ${
                workflowFilter === key
                  ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)]'
                  : 'border-[var(--app-line)] bg-[var(--app-bg)] hover:border-[var(--app-ink)]'
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">{label}</div>
              <div className="mt-2 text-2xl font-semibold text-[var(--app-ink)]">{count}</div>
            </button>
          ))}
        </div>
      </section>

      {/* ── SMART ATTENTION FILTERS ── */}
      <section className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Needs Attention:</span>
        {([
          ['overdue', '🔴', 'Overdue Follow-up', attentionCounts.overdue],
          ['cold',    '🟡', 'Gone Cold 7d+',    attentionCounts.cold],
          ['no_quote','🟠', 'No Quote Sent',    attentionCounts.no_quote],
          ['new_today','🔵','New Today',        attentionCounts.new_today],
        ] as [AttentionFilter, string, string, number][]).map(([key, emoji, label, count]) => (
          <button
            key={key}
            onClick={() => setFilterAttention(filterAttention === key ? '' : key)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
              filterAttention === key
                ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white'
                : count > 0
                ? 'border-[var(--app-line)] bg-[var(--app-panel)] text-[var(--app-ink)] hover:border-[var(--app-ink)]'
                : 'border-[var(--app-line)] bg-[var(--app-panel)] text-[var(--app-muted)] opacity-50'
            }`}
          >
            {emoji} {label} {count > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${filterAttention === key ? 'bg-white/20' : 'bg-[var(--app-wash)]'}`}>{count}</span>}
          </button>
        ))}
      </section>

      {/* ── FILTER BAR ── */}
      <section className="flex flex-wrap items-center gap-2">
        {/* Ownership */}
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-1">
          {(['all','mine','unassigned'] as const).map(v => (
            <button key={v} onClick={() => setOwnershipView(v)} className={`rounded-[6px] px-3 py-1.5 text-xs font-semibold capitalize ${ownershipView === v ? 'bg-[var(--app-ink)] text-white' : 'text-[var(--app-muted)]'}`}>
              {v === 'all' ? 'Team' : v === 'mine' ? 'My Leads' : 'Unassigned'}
            </button>
          ))}
          {(currentUser?.role === 'owner' || currentUser?.role === 'manager') && (
            <button onClick={() => { setShowDeletedDrawer(true); void loadDeletedLeads() }} className="rounded-[6px] px-3 py-1.5 text-xs font-semibold text-rose-500 hover:bg-rose-50">🗑 Trash</button>
          )}
        </div>

        {/* Stage filter */}
        <select value={filterStage} onChange={e => setFilterStage(e.target.value)} className={`crm-input h-9 w-auto cursor-pointer py-0 text-sm ${filterStage ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : ''}`}>
          <option value="">All Stages</option>
          {COLUMN_ORDER.map(s => <option key={s} value={s}>{COLUMN_LABELS[s]}</option>)}
        </select>

        {/* Move date */}
        <select value={filterMoveDate} onChange={e => setFilterMoveDate(e.target.value as MoveDateFilter)} className={`crm-input h-9 w-auto cursor-pointer py-0 text-sm ${filterMoveDate ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : ''}`}>
          <option value="">Move Date: Any</option>
          <option value="today">Moving Today</option>
          <option value="this_week">This Week</option>
          <option value="this_month">This Month</option>
        </select>

        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className={`crm-input h-9 w-auto cursor-pointer py-0 text-sm ${filterSource ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : ''}`}>
          <option value="">All Sources</option>
          {sourceOptions.map(s => <option key={s} value={s}>{SOURCE_LABELS[s] || s}</option>)}
        </select>

        <select value={filterCity} onChange={e => setFilterCity(e.target.value)} className={`crm-input h-9 w-auto cursor-pointer py-0 text-sm ${filterCity ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : ''}`}>
          <option value="">All Cities</option>
          {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <select value={filterRep} onChange={e => setFilterRep(e.target.value)} className={`crm-input h-9 w-auto cursor-pointer py-0 text-sm ${filterRep ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : ''}`}>
          <option value="">All Reps</option>
          {repOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>

        <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)} className={`crm-input h-9 w-auto cursor-pointer py-0 text-sm ${filterBranch ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : ''}`}>
          <option value="">All Branches</option>
          {SALES_BRANCHES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>

        {activeFilterCount > 0 && (
          <button onClick={clearAllFilters} className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100">
            Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} ✕
          </button>
        )}

        <span className="ml-auto text-xs text-[var(--app-muted)]">
          {visibleLeads.length} of {leads.length} leads
          {draggedLeadId && <span className="ml-2 text-[var(--app-accent)]">· Drop to move stage</span>}
        </span>
      </section>

      {error ? <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div> : null}

      {/* Bulk action toolbar */}
      {!loading && visibleLeads.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selectedIds.size === visibleLeads.length && visibleLeads.length > 0}
              ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < visibleLeads.length }}
              onChange={() => setSelectedIds(selectedIds.size === visibleLeads.length ? new Set() : new Set(visibleLeads.map(l => l.id)))}
              className="h-4 w-4 rounded accent-[var(--app-accent)]"
            />
            <span className="text-xs text-[var(--app-muted)]">
              {selectedIds.size === 0 ? 'Select all' : `${selectedIds.size} selected`}
            </span>
          </label>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 ml-2">
              <button
                disabled={bulkBusy}
                onClick={async () => {
                  if (!confirm(`Delete ${selectedIds.size} lead${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`)) return
                  setBulkBusy(true)
                  await Promise.all(Array.from(selectedIds).map(id => deleteSalesLead(id).catch(() => {})))
                  setLeads(prev => prev.filter(l => !selectedIds.has(l.id)))
                  setSelectedIds(new Set())
                  setBulkBusy(false)
                }}
                className="rounded-[6px] border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition disabled:opacity-50">
                {bulkBusy ? 'Working…' : `🗑 Delete ${selectedIds.size}`}
              </button>
              <button
                disabled={bulkBusy}
                onClick={async () => {
                  if (!confirm(`Mark ${selectedIds.size} lead${selectedIds.size !== 1 ? 's' : ''} as lost?`)) return
                  setBulkBusy(true)
                  await Promise.all(Array.from(selectedIds).map(id => updateSalesLead(id, { stage: 'lost' }).catch(() => {})))
                  setLeads(prev => prev.map(l => selectedIds.has(l.id) ? { ...l, stage: 'lost' as const } : l))
                  setSelectedIds(new Set())
                  setBulkBusy(false)
                }}
                className="rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--app-muted)] hover:text-[var(--app-ink)] transition disabled:opacity-50">
                Mark Lost
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-[var(--app-muted)] hover:text-[var(--app-ink)] transition">Clear</button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-16 text-center text-sm text-[var(--app-muted)]">Loading pipeline…</div>
      ) : viewMode === 'list' ? (
        <>
          {/* ── DESKTOP LIST TABLE ── */}
          <div className="hidden rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] md:block overflow-hidden">
            <div className="grid grid-cols-[28px_minmax(180px,1.8fr)_130px_200px_100px_180px_110px_110px_90px] gap-0 border-b border-[var(--app-line)] bg-[var(--app-wash)] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">
              <div />
              <div>Lead</div>
              <div>Stage</div>
              <div>Next Action</div>
              <div>Move Date</div>
              <div>Route</div>
              <div>Follow-up</div>
              <div>Last Contact</div>
              <div>Quote $</div>
            </div>

            {visibleLeads.map(lead => {
              const quote = lead.quoteId ? quoteMap.get(lead.quoteId) : undefined
              const guidance = guidanceMap.get(lead.id)
              const urgency = getUrgency(lead)
              const stageColor = STAGE_COLORS[lead.stage] || 'bg-gray-50 text-gray-600'
              const lastActivity = lead.lastTouchedAt || lead.createdAt
              const isSelected = selectedIds.has(lead.id)

              return (
                <div
                  key={lead.id}
                  className={`group relative grid grid-cols-[28px_minmax(180px,1.8fr)_130px_200px_100px_180px_110px_110px_90px] gap-0 border-b border-[var(--app-line)] px-5 py-3.5 text-sm transition cursor-pointer
                    ${isSelected ? 'bg-[var(--app-accent-soft)]' : guidance?.action.goldenMoment ? 'bg-orange-50/80 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.2)] hover:bg-orange-50' : urgency === 'overdue' ? 'bg-red-50/40 hover:bg-red-50' : urgency === 'cold' ? 'bg-amber-50/30 hover:bg-amber-50/60' : 'hover:bg-[var(--app-bg)]'}`}
                  onClick={() => router.push(`/sales/leads/${lead.id}`)}
                >
                  <div className="flex items-center" onClick={e => { e.stopPropagation(); setSelectedIds(prev => { const n = new Set(prev); n.has(lead.id) ? n.delete(lead.id) : n.add(lead.id); return n }) }}>
                    <input type="checkbox" checked={isSelected} onChange={() => {}} className="h-4 w-4 rounded accent-[var(--app-accent)] cursor-pointer" />
                  </div>
                  {/* Urgency stripe */}
                  {(urgency !== 'ok' || guidance?.action.goldenMoment) && (
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${guidance?.action.goldenMoment ? 'bg-orange-500' : urgency === 'overdue' ? 'bg-red-400' : 'bg-amber-400'}`} />
                  )}

                  {/* Lead name + info */}
                  <div className="pl-2 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-1.5 flex-nowrap overflow-hidden">
                      <span className="font-semibold text-[var(--app-ink)] truncate min-w-0">{lead.name}</span>
                      {guidance ? <HeatTag label={guidance.heat.label} score={guidance.heat.score} tone={guidance.heat.tone} /> : null}
                      {guidance?.action.goldenMoment ? (
                        <span className="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-800">QUOTE VIEWED NOW</span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--app-muted)]">
                      {lead.phone && (
                        <button
                          onClick={e => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('crm:open-dialer', { detail: { phone: lead.phone, leadId: lead.id, name: lead.name } })) }}
                          className="font-mono hover:text-[var(--app-accent)] transition"
                          title={`Call ${lead.phone}`}
                        >
                          {lead.phone}
                        </button>
                      )}
                      {lead.source && (
                        <span className="flex items-center gap-1">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${SOURCE_DOT[lead.source] || 'bg-gray-300'}`} />
                          <span>{SOURCE_LABELS[lead.source] || lead.source}</span>
                        </span>
                      )}
                      {lead.branch ? <span>{getSalesBranchLabel(lead.branch)}</span> : null}
                    </div>
                  </div>

                  {/* Stage inline dropdown */}
                  <div onClick={e => e.stopPropagation()}>
                    <select
                      value={lead.stage}
                      onChange={async e => { e.stopPropagation(); await moveLeadToStage(lead.id, e.target.value as CRMLead['stage']) }}
                      className={`rounded-[6px] border-0 px-2 py-1 text-xs font-semibold cursor-pointer outline-none w-full ${stageColor}`}
                    >
                      {COLUMN_ORDER.map(s => <option key={s} value={s}>{COLUMN_LABELS[s]}</option>)}
                    </select>
                  </div>

                  {/* Next action */}
                  <div className="pr-4">
                    <div className="text-xs font-semibold text-[var(--app-ink)]">{guidance?.action.nextAction || 'Review lead'}</div>
                    <div className="mt-1 text-[11px] leading-5 text-[var(--app-muted)]">
                      {guidance?.action.reason || 'No action selected'}
                    </div>
                    {guidance?.action.goldenMoment ? (
                      <div className="mt-1 text-[11px] font-medium text-orange-700">{guidance.action.goldenMoment}</div>
                    ) : null}
                  </div>

                  {/* Move date */}
                  <div className="text-xs text-[var(--app-muted)] flex items-center">
                    {lead.moveDate ? (
                      <span className={dayStart(new Date(lead.moveDate)) <= today() && !isClosedLeadStage(lead.stage) ? 'text-rose-600 font-semibold' : ''}>
                        {formatDate(lead.moveDate)}
                      </span>
                    ) : <span className="opacity-40">TBD</span>}
                  </div>

                  {/* Route */}
                  <div className="text-xs text-[var(--app-muted)] flex items-center truncate">
                    {lead.originAddress || lead.originCity || lead.destAddress || lead.destCity
                      ? <span className="truncate">{lead.originAddress || lead.originCity || '?'} → {lead.destAddress || lead.destCity || '?'}</span>
                      : <span className="opacity-40">Route TBD</span>}
                  </div>

                  {/* Follow-up */}
                  <div className="text-xs flex items-center">
                    {lead.followUpDate ? (
                      <span className={dayStart(new Date(lead.followUpDate)) < today() ? 'text-red-600 font-semibold' : 'text-[var(--app-muted)]'}>
                        {dayStart(new Date(lead.followUpDate)) < today() ? '⚠ ' : ''}{formatDate(lead.followUpDate)}
                      </span>
                    ) : <span className="opacity-70 text-[var(--app-muted)]">{guidance?.action.dueAt ? formatDate(guidance.action.dueAt) : 'Not set'}</span>}
                  </div>

                  {/* Last contact */}
                  <div className="text-xs text-[var(--app-muted)] flex items-center">
                    <span className={lastActivity && new Date(lastActivity) < daysAgo(7) && !isClosedLeadStage(lead.stage) ? 'text-amber-600' : ''}>
                      {guidance?.latestActivity.at ? formatRelativeTime(guidance.latestActivity.at) : '—'}
                    </span>
                  </div>

                  {/* Quote */}
                  <div className="text-xs font-semibold text-[var(--app-accent)] flex items-center">
                    {quote ? formatMoney(quote.total) : <span className="font-normal opacity-30 text-[var(--app-muted)]">—</span>}
                  </div>

                  <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-[var(--app-line)]">
                    <button onClick={event => void handleQuickAction(event, lead, 'call', quote)} className="rounded-[6px] border border-[var(--app-line)] bg-white px-2 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]">Call</button>
                    <button onClick={event => void handleQuickAction(event, lead, 'sms', quote)} className="rounded-[6px] border border-[var(--app-line)] bg-white px-2 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]">SMS</button>
                    <button onClick={event => void handleQuickAction(event, lead, 'open', quote)} className="rounded-[6px] border border-[var(--app-line)] bg-white px-2 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]">Open</button>
                    <button onClick={event => void handleQuickAction(event, lead, 'snooze', quote)} className="rounded-[6px] border border-[var(--app-line)] bg-white px-2 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]">Snooze</button>
                    <button
                      onClick={e => void removeLead(e, lead)}
                      className="ml-auto px-1 text-[10px] text-[var(--app-muted)] hover:text-rose-600 transition"
                    >
                      {deleteBusyId === lead.id ? '…' : '✕'}
                    </button>
                  </div>
                </div>
              )
            })}

            {visibleLeads.length === 0 && (
              <div className="px-5 py-16 text-center text-sm text-[var(--app-muted)]">
                {activeFilterCount > 0 ? 'No leads match these filters.' : 'No leads yet.'}
              </div>
            )}
          </div>

          {/* ── MOBILE LIST ── */}
          <div className="space-y-3 md:hidden">
            {visibleLeads.map(lead => {
              const quote = lead.quoteId ? quoteMap.get(lead.quoteId) : undefined
              const guidance = guidanceMap.get(lead.id)
              const urgency = getUrgency(lead)
              return (
                <div key={lead.id} className={`relative rounded-[8px] border bg-[var(--app-panel)] transition
                  ${guidance?.action.goldenMoment ? 'border-orange-300 bg-orange-50/40' : urgency === 'overdue' ? 'border-red-300 bg-red-50/30' : urgency === 'cold' ? 'border-amber-200 bg-amber-50/20' : 'border-[var(--app-line)]'}`}>
                  <button onClick={e => void removeLead(e, lead)} className="absolute right-3 top-3 z-10 text-xs text-[var(--app-muted)] hover:text-rose-700">
                    {deleteBusyId === lead.id ? '…' : '✕'}
                  </button>
                  <Link href={`/sales/leads/${lead.id}`} className="block p-4 pr-10">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-semibold text-[var(--app-ink)] truncate">{lead.name}</div>
                          {guidance ? <HeatTag label={guidance.heat.label} score={guidance.heat.score} tone={guidance.heat.tone} /> : null}
                        </div>
                        <div className="mt-1 text-xs text-[var(--app-muted)]">{guidance?.action.nextAction || lead.phone}</div>
                      </div>
                      <span className={`shrink-0 rounded-[6px] px-2 py-1 text-[10px] font-semibold ${STAGE_COLORS[lead.stage] || 'bg-gray-50 text-gray-600'}`}>
                        {COLUMN_LABELS[lead.stage]}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-[var(--app-muted)]">{lead.originAddress || lead.originCity || 'Origin TBD'} → {lead.destAddress || lead.destCity || 'Destination TBD'}</div>
                    <div className="mt-3 flex items-center justify-between border-t border-[var(--app-line)] pt-3 text-xs text-[var(--app-muted)]">
                      <span>{lead.moveDate ? formatDate(lead.moveDate) : 'Date TBD'}</span>
                      <span>{quote ? formatMoney(quote.total) : 'No quote'}</span>
                    </div>
                  </Link>
                  <div className="flex gap-2 border-t border-[var(--app-line)] px-4 py-3">
                    <button onClick={event => void handleQuickAction(event, lead, 'call', quote)} className="flex-1 rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--app-ink)]">Call</button>
                    <button onClick={event => void handleQuickAction(event, lead, 'sms', quote)} className="flex-1 rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--app-ink)]">SMS</button>
                    <button onClick={event => void handleQuickAction(event, lead, 'snooze', quote)} className="flex-1 rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--app-ink)]">Snooze</button>
                  </div>
                </div>
              )
            })}
            {visibleLeads.length === 0 && (
              <div className="rounded-[8px] border border-dashed border-[var(--app-line)] px-4 py-10 text-center text-sm text-[var(--app-muted)]">
                {activeFilterCount > 0 ? 'No leads match these filters.' : 'No leads yet.'}
              </div>
            )}
          </div>
        </>
      ) : (
        /* ── BOARD VIEW ── */
        <div className="overflow-x-auto pb-4">
          <div className="flex min-w-max gap-4">
            {grouped.map(column => (
              <div key={column.stage} className="w-[290px]" onDragOver={e => handleDragOver(e, column.stage)} onDragLeave={handleDragLeave} onDrop={e => void handleDrop(e, column.stage)}>
                <div className="mb-3 flex items-center justify-between border-b border-[var(--app-line)] pb-3">
                  <h2 className={`font-display text-sm font-semibold uppercase tracking-[0.16em] ${COLUMN_HEADER_ACCENT[column.stage] || 'text-[var(--app-ink)]'}`}>{column.label}</h2>
                  <span className="rounded-[4px] bg-[var(--app-wash)] px-2 py-0.5 text-xs text-[var(--app-muted)]">{column.cards.length}</span>
                </div>
                <div className={`min-h-[120px] space-y-3 rounded-[8px] transition-all duration-150 ${dragOverStage === column.stage ? 'bg-[rgba(15,106,83,0.06)] ring-2 ring-[var(--app-accent)] ring-inset' : draggedLeadId ? 'bg-[var(--app-bg)] ring-1 ring-[var(--app-line)] ring-inset' : ''} p-1`}>
                  {column.cards.map(lead => {
                    const quote = lead.quoteId ? quoteMap.get(lead.quoteId) : undefined
                    const guidance = guidanceMap.get(lead.id)
                    const isDragging = draggedLeadId === lead.id
                    return (
                      <div key={lead.id} draggable onDragStart={() => handleDragStart(lead.id)} onDragEnd={handleDragEnd}
                        className={`group relative rounded-[8px] border bg-[var(--app-panel)] transition hover:border-[var(--app-ink)] ${guidance?.action.goldenMoment ? 'border-orange-300 bg-orange-50/40 shadow-sm' : COLUMN_ACCENT[column.stage] || 'border-[var(--app-line)]'} ${isDragging ? 'opacity-40 ring-2 ring-[var(--app-accent)]' : 'cursor-grab active:cursor-grabbing'}`}>
                        <div className="absolute left-2 top-1/2 -translate-y-1/2 select-none text-[10px] text-[var(--app-line)] hover:text-[var(--app-muted)]">⠿</div>
                        <button onClick={e => void removeLead(e, lead)} className="absolute right-3 top-3 z-10 text-xs text-[var(--app-muted)] hover:text-rose-700">
                          {deleteBusyId === lead.id ? '…' : '✕'}
                        </button>
                        <Link href={`/sales/leads/${lead.id}`} className="block pl-6 pr-4 pt-4 pb-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <div className="truncate text-sm font-semibold text-[var(--app-ink)]">{lead.name}</div>
                                {guidance ? <HeatTag label={guidance.heat.label} score={guidance.heat.score} tone={guidance.heat.tone} /> : null}
                                {lead.stage === 'tentative' && lead.followUpDate && new Date(lead.followUpDate) <= new Date() && (
                                  <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[9px] font-bold text-white">CALL TODAY</span>
                                )}
                                {guidance?.action.goldenMoment ? (
                                  <span className="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[9px] font-bold text-orange-800">HOT: CUSTOMER IS REVIEWING QUOTE</span>
                                ) : null}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--app-muted)]">
                                <span>{lead.moveDate ? formatDate(lead.moveDate) : 'Date TBD'} · {lead.moveType || 'Move TBD'}</span>
                                {lead.moveDateFlexible && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Pending close</span>}
                                {lead.branch && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-700">{getSalesBranchLabel(lead.branch)}</span>}
                                {lead.leadKind === 'realtor_opportunity' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Realtor Lead</span>}
                              </div>
                            </div>
                            <span className="mr-5 rounded-[4px] bg-[rgba(15,106,83,0.08)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-accent)]">{guidance?.heat.score || lead.leadScore || 0}</span>
                          </div>
                          <div className="mt-3 flex items-center justify-between text-xs text-[var(--app-muted)]">
                            <span>{lead.originAddress || lead.originCity || 'Origin TBD'} → {lead.destAddress || lead.destCity || 'Destination TBD'}</span>
                            <span>{quote ? formatMoney(quote.total) : 'Est. pending'}</span>
                          </div>
                          <div className="mt-2 text-[11px] text-[var(--app-ink)]">
                            <span className="font-semibold">Next:</span> {guidance?.action.nextAction || lead.intelligence?.nextAction || 'Review lead'}
                          </div>
                          {guidance?.action.reason ? <div className="mt-1 truncate text-[10px] text-[var(--app-muted)]">{guidance.action.reason}</div> : null}
                          <div className="mt-3 flex items-center justify-between border-t border-[var(--app-line)] pt-3 text-xs text-[var(--app-muted)]">
                            <span>{guidance?.latestActivity.at ? `${guidance.latestActivity.text} · ${formatRelativeTime(guidance.latestActivity.at)}` : lead.followUpDate ? `Follow up ${formatDate(lead.followUpDate)}` : 'No follow-up set'}</span>
                            <div className="flex items-center gap-1.5">
                              {getLeadAssignedRepName(lead) && <span className="rounded-full bg-[var(--app-wash)] px-2 py-0.5 font-medium text-[var(--app-ink)]">{getLeadAssignedRepName(lead)}</span>}
                              {lead.phone && (
                                <button onClick={e => void handleQuickAction(e, lead, 'call', quote)}
                                  className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--app-line)] bg-white text-[var(--app-muted)] transition hover:border-[var(--app-accent)] hover:text-[var(--app-accent)]" title={`Call ${lead.phone}`}>☎</button>
                              )}
                            </div>
                          </div>
                          <div className="mt-2 flex gap-1.5">
                            <button onClick={event => void handleQuickAction(event, lead, 'call', quote)} className="rounded-[6px] border border-[var(--app-line)] bg-white px-2 py-1 text-[10px] font-semibold text-[var(--app-ink)]">Call</button>
                            <button onClick={event => void handleQuickAction(event, lead, 'sms', quote)} className="rounded-[6px] border border-[var(--app-line)] bg-white px-2 py-1 text-[10px] font-semibold text-[var(--app-ink)]">SMS</button>
                            <button onClick={event => void handleQuickAction(event, lead, 'open', quote)} className="rounded-[6px] border border-[var(--app-line)] bg-white px-2 py-1 text-[10px] font-semibold text-[var(--app-ink)]">Open</button>
                            <button onClick={event => void handleQuickAction(event, lead, 'snooze', quote)} className="rounded-[6px] border border-[var(--app-line)] bg-white px-2 py-1 text-[10px] font-semibold text-[var(--app-ink)]">Snooze</button>
                          </div>
                        </Link>
                      </div>
                    )
                  })}
                  {column.cards.length === 0 && (
                    <div className={`rounded-[8px] border border-dashed px-4 py-12 text-center text-sm transition ${dragOverStage === column.stage ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : 'border-[var(--app-line)] text-[var(--app-muted)]'}`}>
                      {dragOverStage === column.stage ? 'Drop here →' : 'No leads here yet.'}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-none">
            <h3 className="text-base font-semibold text-[#071421]">Delete lead?</h3>
            <p className="mt-2 text-sm text-stone-500">Permanently removes <span className="font-semibold text-[#071421]">{deleteConfirm.lead.name}</span>. Type their name to confirm.</p>
            <input autoFocus type="text" value={deleteConfirm.typed}
              onChange={e => setDeleteConfirm({ ...deleteConfirm, typed: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter' && deleteConfirm.typed.trim().toLowerCase() === deleteConfirm.lead.name.trim().toLowerCase()) void confirmDelete(); if (e.key === 'Escape') setDeleteConfirm(null) }}
              placeholder={deleteConfirm.lead.name}
              className="mt-4 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#071421] focus:ring-1 focus:ring-[#071421]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50">Cancel</button>
              <button onClick={() => void confirmDelete()} disabled={deleteConfirm.typed.trim().toLowerCase() !== deleteConfirm.lead.name.trim().toLowerCase()} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Trash drawer */}
      {showDeletedDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowDeletedDrawer(false)} />
          <div className="relative flex w-full max-w-md flex-col bg-white shadow-none">
            <div className="flex items-center justify-between border-b border-[var(--app-line)] px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--app-ink)]">🗑 Recently Deleted</h2>
                <p className="text-xs text-[var(--app-muted)]">Leads deleted in the last 30 days.</p>
              </div>
              <button onClick={() => setShowDeletedDrawer(false)} className="rounded-xl p-1.5 text-[var(--app-muted)] hover:bg-[var(--app-bg)]">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-[var(--app-line)]">
              {deletedLoading ? <div className="p-8 text-center text-sm text-[var(--app-muted)]">Loading…</div>
                : deletedLeads.length === 0 ? <div className="p-8 text-center text-sm text-[var(--app-muted)]">No recently deleted leads.</div>
                : deletedLeads.map(lead => (
                  <div key={lead.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[var(--app-ink)]">{lead.name || 'Unknown'}</div>
                      <div className="text-xs text-[var(--app-muted)]">{lead.phone} · {lead.stage} · deleted {lead._deletedAt ? new Date(lead._deletedAt).toLocaleDateString() : ''}</div>
                    </div>
                    <button onClick={() => void restoreLead(lead.id)} disabled={restoreBusyId === lead.id}
                      className="shrink-0 rounded-[6px] border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                      {restoreBusyId === lead.id ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SalesPipelinePage() {
  return (
    <Suspense fallback={<div className="crm-shell"><div className="crm-panel px-5 py-16 text-center text-sm text-[var(--app-muted)]">Loading pipeline…</div></div>}>
      <SalesPipelineContent />
    </Suspense>
  )
}
