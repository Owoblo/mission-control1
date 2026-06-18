'use client'

import { useEffect, useState } from 'react'

interface QueueItem {
  id: string
  contact_id: string | null
  step_number: number
  channel: string
  due_date: string
  label: string
  message_draft: string | null
  status: string
  overdue: boolean
  daysOverdue: number
  signal_id?: string | null
  contact: {
    id: string
    name: string
    company: string
    title: string
    email: string
    phone: string
    city: string
    industry: string
    tier: string
    tracking_code: string
    stage: string
    notes: string
    website: string
  } | null
}

const OUTCOME_OPTIONS = [
  { code: 'left_voicemail', label: 'Left voicemail' },
  { code: 'spoke_to_contact', label: 'Spoke to them' },
  { code: 'no_answer', label: 'No answer' },
  { code: 'not_interested', label: 'Not interested' },
  { code: 'sent_message', label: 'Sent message' },
  { code: 'completed', label: 'Done' },
]

const CHANNEL_META: Record<string, { icon: string; color: string; label: string }> = {
  direct_mail: { icon: '✉️', color: 'bg-amber-50 border-amber-200', label: 'Direct Mail' },
  email:       { icon: '📧', color: 'bg-sky-50 border-sky-200', label: 'Email' },
  phone:       { icon: '📞', color: 'bg-emerald-50 border-emerald-200', label: 'Call' },
  sms:         { icon: '💬', color: 'bg-violet-50 border-violet-200', label: 'SMS' },
  linkedin:    { icon: '💼', color: 'bg-blue-50 border-blue-200', label: 'LinkedIn' },
  in_person:   { icon: '🤝', color: 'bg-orange-50 border-orange-200', label: 'In Person' },
}

const TIER_LABEL: Record<string, string> = {
  A: 'Lawyers & Brokers',
  B: 'Builders & Insurance',
  C: 'Corporate & Employers',
  D: 'Community',
  E: 'Care Facilities',
  HOT: '🔥 Hot Signal',
}

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'today' | 'upcoming' | 'all'>('today')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [outcomeItem, setOutcomeItem] = useState<QueueItem | null>(null)

  async function load() {
    setLoading(true)
    const r = await fetch(`/api/marketing/queue?view=${view}`, { credentials: 'include' })
    if (r.ok) {
      const data = await r.json()
      setItems(data.items)
      setTotal(data.total)
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [view]) // eslint-disable-line

  async function complete(item: QueueItem, outcomeCode = 'completed') {
    setBusy(item.id)
    await fetch('/api/marketing/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'complete', queue_id: item.id, outcome_code: outcomeCode }),
    })
    setDoneIds(prev => new Set(Array.from(prev).concat(item.id)))
    setOutcomeItem(null)
    setBusy(null)
    // Reload after short delay to show next step scheduled
    setTimeout(() => void load(), 800)
  }

  async function skip(item: QueueItem) {
    setBusy(item.id + '-skip')
    await fetch('/api/marketing/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'skip', queue_id: item.id }),
    })
    setItems(prev => prev.filter(x => x.id !== item.id))
    setBusy(null)
  }

  const visible = items.filter(i => !doneIds.has(i.id))
  const overdue = visible.filter(i => i.overdue)
  const today = visible.filter(i => !i.overdue)

  return (
    <div className="crm-shell space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1a2744]">Daily Partnership Queue</h1>
          <p className="mt-1 text-sm text-[var(--app-muted)]">
            {new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}
            {total > 0 && ` · ${total} action${total !== 1 ? 's' : ''} waiting`}
          </p>
        </div>
        <div className="flex gap-2">
          {(['today', 'upcoming', 'all'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition capitalize ${view === v ? 'bg-[#1a2744] text-white' : 'bg-[var(--app-bg)] border border-[var(--app-line)] text-[var(--app-muted)] hover:border-[var(--app-ink)]'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="crm-panel p-16 text-center text-sm text-[var(--app-muted)]">Loading queue...</div>
      ) : visible.length === 0 ? (
        <div className="crm-panel p-16 text-center space-y-3">
          <div className="text-5xl">✅</div>
          <div className="text-lg font-bold text-[#1a2744]">Queue is clear</div>
          <p className="text-sm text-[var(--app-muted)]">
            {view === 'today'
              ? 'Nothing due today. Check Upcoming or move mailed / due accounts into the queue from Partnerships.'
              : 'No actions scheduled for this period.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Overdue */}
          {overdue.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-rose-200" />
                <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-700">
                  Overdue — {overdue.length} action{overdue.length !== 1 ? 's' : ''}
                </span>
                <div className="h-px flex-1 bg-rose-200" />
              </div>
              {overdue.map(item => <ActionCard key={item.id} item={item} expanded={expanded} setExpanded={setExpanded} busy={busy} onComplete={() => setOutcomeItem(item)} onSkip={skip} done={doneIds.has(item.id)} />)}
            </section>
          )}

          {/* Due today */}
          {today.length > 0 && (
            <section className="space-y-3">
              {overdue.length > 0 && (
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="rounded-full bg-[#1a2744] px-3 py-1 text-xs font-bold text-white">
                    Due Today — {today.length}
                  </span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
              )}
              {today.map(item => <ActionCard key={item.id} item={item} expanded={expanded} setExpanded={setExpanded} busy={busy} onComplete={() => setOutcomeItem(item)} onSkip={skip} done={doneIds.has(item.id)} />)}
            </section>
          )}
        </div>
      )}

      {outcomeItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="crm-panel w-full max-w-md space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-[#1a2744]">What happened?</h2>
              <p className="mt-1 text-sm text-[var(--app-muted)]">{outcomeItem.contact?.name ?? outcomeItem.label}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {OUTCOME_OPTIONS.map(option => (
                <button
                  key={option.code}
                  onClick={() => void complete(outcomeItem, option.code)}
                  disabled={busy === outcomeItem.id}
                  className="crm-button justify-start"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button onClick={() => setOutcomeItem(null)} className="w-full text-sm font-medium text-[var(--app-muted)] hover:text-[#1a2744]">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ActionCard({
  item, expanded, setExpanded, busy, onComplete, onSkip, done
}: {
  item: QueueItem
  expanded: string | null
  setExpanded: (id: string | null) => void
  busy: string | null
  onComplete: (item: QueueItem) => void
  onSkip: (item: QueueItem) => void
  done: boolean
}) {
  const ch = CHANNEL_META[item.channel] ?? { icon: '📋', color: 'bg-slate-50 border-slate-200', label: item.channel }
  const isExpanded = expanded === item.id
  const c = item.contact

  const isSignalBlast = !item.contact_id && !!item.signal_id

  if (done) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
        <span className="text-emerald-600">✓</span>
        <span className="text-sm font-medium text-emerald-700">{c?.name ?? item.label}</span>
        <span className="ml-auto text-xs text-emerald-500">{isSignalBlast ? 'Done' : 'Next step scheduled'}</span>
      </div>
    )
  }

  return (
    <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-all ${item.overdue ? 'border-rose-200' : 'border-[var(--app-line)]'}`}>
      {/* Card header — always visible */}
      <button
        className="w-full px-5 py-4 text-left"
        onClick={() => setExpanded(isExpanded ? null : item.id)}
      >
        <div className="flex items-center gap-4">
          {/* Channel badge */}
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-lg ${ch.color}`}>
            {ch.icon}
          </div>

          {/* Contact info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[#1a2744]">
                {isSignalBlast ? '🚨 Signal Blast' : (c?.name ?? 'Unknown')}
              </span>
              {item.overdue && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                  {item.daysOverdue}d overdue
                </span>
              )}
              {!isSignalBlast && (
                <span className="rounded-full bg-[#1a2744]/10 px-2 py-0.5 text-[10px] font-semibold text-[#1a2744]">
                  Tier {c?.tier} · Step {item.step_number}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-[var(--app-muted)]">
              {isSignalBlast
                ? item.label
                : <>{c?.company && <span>{c.company} · </span>}{c?.city}{c?.industry && <span> · {c.industry}</span>}</>
              }
            </div>
          </div>

          {/* Action label + chevron */}
          <div className="shrink-0 flex items-center gap-3">
            <span className="hidden text-sm font-medium text-[#1a2744] sm:block">{ch.label}: {item.label}</span>
            <span className={`text-[var(--app-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▾</span>
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="border-t border-[var(--app-line)] px-5 pb-5 pt-4 space-y-4">
          {/* What to do */}
          <div className="rounded-xl bg-[#1a2744]/5 p-4">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#1a2744]">
              {ch.icon} What to do
            </div>
            <div className="text-sm text-[#1a2744]">{item.message_draft ?? item.label}</div>
          </div>

          {/* Contact details */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {c?.phone && (
              <a href={`tel:${c.phone}`} className="flex items-center gap-2 rounded-lg border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 font-medium text-[#1a2744] hover:bg-[var(--app-wash)] transition">
                📞 {c.phone}
              </a>
            )}
            {c?.email && (
              <a href={`mailto:${c.email}`} className="flex items-center gap-2 rounded-lg border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 font-medium text-[#1a2744] hover:bg-[var(--app-wash)] transition">
                📧 {c.email}
              </a>
            )}
            {c?.website && (
              <a href={c.website} target="_blank" rel="noopener" className="flex items-center gap-2 rounded-lg border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-muted)] hover:text-[#1a2744] transition">
                🌐 Website
              </a>
            )}
            {item.channel === 'linkedin' && c?.name && (
              <a
                href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(c.name + ' ' + (c.company ?? ''))}`}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 transition"
              >
                💼 Find on LinkedIn
              </a>
            )}
          </div>

          {c?.notes && (
            <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
              <span className="font-semibold">Notes: </span>{c.notes}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => void onComplete(item)}
              disabled={busy === item.id}
              className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-bold text-white hover:opacity-90 transition disabled:opacity-60"
            >
              {busy === item.id ? 'Saving...' : `✓ Done — ${ch.label} sent`}
            </button>
            <button
              onClick={() => void onSkip(item)}
              disabled={busy === item.id + '-skip'}
              className="rounded-xl border border-[var(--app-line)] px-4 py-2.5 text-sm font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition"
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
