'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LogoutButton } from '@/app/components/logout-button'
import { NewLeadModal } from '@/app/components/sales/new-lead-modal'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import type { CRMLead } from '@/lib/types'
import type { NotificationItem } from '@/app/api/sales/notifications/route'

const BASE_NAV = [
  { href: '/sales', label: 'Dashboard', match: (p: string) => p === '/sales', roles: ['owner', 'manager', 'sales_rep'] },
  { href: '/sales/inbox', label: 'Inbox', match: (p: string) => p.startsWith('/sales/inbox'), roles: ['owner', 'manager', 'sales_rep'] },
  { href: '/sales/pipeline', label: 'Pipeline', match: (p: string) => p.startsWith('/sales/pipeline'), roles: ['owner', 'manager', 'sales_rep'] },
  { href: '/sales/quotes', label: 'Quotes', match: (p: string) => p.startsWith('/sales/quotes'), roles: ['owner', 'manager', 'sales_rep'] },
  { href: '/sales/booked', label: 'Booked', match: (p: string) => p.startsWith('/sales/booked'), roles: ['owner', 'manager', 'sales_rep'] },
  { href: '/sales/academy', label: 'Academy', match: (p: string) => p.startsWith('/sales/academy'), roles: ['owner', 'manager', 'sales_rep'] },
  { href: '/sales/operations', label: 'Operations', match: (p: string) => p.startsWith('/sales/operations'), roles: ['owner', 'manager', 'operations_lead'] },
  { href: '/sales/finance', label: 'Finance', match: (p: string) => p.startsWith('/sales/finance'), roles: ['owner', 'manager'] },
  { href: '/sales/activity', label: 'Live Feed', match: (p: string) => p.startsWith('/sales/activity'), roles: ['owner', 'manager'] },
  { href: '/sales/analytics', label: 'Analytics', match: (p: string) => p.startsWith('/sales/analytics'), roles: ['owner', 'manager'] },
  { href: '/sales/reps', label: 'Reps', match: (p: string) => p.startsWith('/sales/reps'), roles: ['owner', 'manager'] },
  { href: '/admin/users', label: 'Team', match: (p: string) => p.startsWith('/admin'), roles: ['owner'] },
  { href: '/marketing', label: 'Partnerships', match: (p: string) => p.startsWith('/marketing'), roles: ['owner', 'manager'] },
]

const TYPE_ICON: Record<string, string> = {
  lead:  '🆕',
  sms:   '💬',
  email: '📧',
  alert: '🚨',
}

const SOURCE_ICON: Record<string, string> = {
  twilio_call:  '📞',
  twilio_sms:   '💬',
  facebook_dm:  '📘',
  instagram_dm: '📷',
  email:        '📧',
  website_form: '🌐',
  system_alert: '🚨',
}

function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(value).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

export function SalesHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const user = useCurrentUser()
  const role = user?.role ?? 'owner'

  const [query, setQuery] = useState('')
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [allLeads, setAllLeads] = useState<CRMLead[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // ── Notification state ──────────────────────────────────────────────────
  const [notifItems, setNotifItems] = useState<NotificationItem[]>([])
  const [notifBreakdown, setNotifBreakdown] = useState({ leads: 0, sms: 0, emails: 0, alerts: 0 })
  const [notifTotal, setNotifTotal] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const [toast, setToast] = useState<NotificationItem | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  // ── Audio chime ─────────────────────────────────────────────────────────
  function playChime() {
    try {
      if (typeof window === 'undefined') return
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      }
      const ctx = audioCtxRef.current
      // Two-tone chime: pleasant rising interval
      const notes = [523.25, 659.25] // C5 → E5
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.value = freq
        const start = ctx.currentTime + i * 0.18
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(0.35, start + 0.04)
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5)
        osc.start(start)
        osc.stop(start + 0.55)
      })
    } catch { /* audio not available */ }
  }

  // ── Browser push notification ────────────────────────────────────────────
  function showPushNotification(title: string, body: string) {
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    try {
      new Notification(title, { body, icon: '/favicon.ico', tag: 'saturn-lead' })
    } catch { /* non-fatal */ }
  }

  // Request push permission once (called on user interaction)
  function requestPushPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }

  // Load all leads once for search
  useEffect(() => {
    fetch('/api/sales/overview', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { leads: [] })
      .then((d: { leads: CRMLead[] }) => setAllLeads(d.leads || []))
      .catch(() => null)
  }, [])

  // Close search dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Fetch notifications (poll every 30s) ───────────────────────────────
  useEffect(() => {
    async function fetchNotifications() {
      try {
        const res = await fetch('/api/sales/notifications', { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json() as { items: NotificationItem[]; totalCount: number; breakdown: { leads: number; sms: number; emails: number; alerts: number } }

        // Detect new items for toast + chime + push
        if (seenIdsRef.current.size > 0) {
          const newItems = data.items.filter(item => !seenIdsRef.current.has(item.id))
          if (newItems.length > 0) {
            const newest = newItems[0]
            if (toastTimer.current) clearTimeout(toastTimer.current)
            setToast(newest)
            toastTimer.current = setTimeout(() => setToast(null), 7000)
            // 🔔 Audio chime
            playChime()
            // 📱 Browser push notification
            showPushNotification(
              '🌟 Saturn Star — New Lead',
              newest.title || 'New activity'
            )
          }
        }
        data.items.forEach(item => seenIdsRef.current.add(item.id))

        setNotifItems(data.items)
        setNotifTotal(data.totalCount)
        setNotifBreakdown(data.breakdown)
      } catch { /* non-fatal */ }
    }

    void fetchNotifications()
    const interval = setInterval(() => void fetchNotifications(), 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    setQuery(params.get('q') || '')
  }, [pathname])

  useEffect(() => {
    function onOpen() { setNewLeadOpen(true) }
    window.addEventListener('crm:new-lead', onOpen)
    return () => window.removeEventListener('crm:new-lead', onOpen)
  }, [])

  function digitsOnly(s: string) { return s.replace(/\D/g, '') }

  const searchResults = query.trim().length >= 1
    ? allLeads.filter(lead => {
        const q = query.trim().toLowerCase()
        const qDigits = digitsOnly(q)
        if (qDigits.length >= 4 && digitsOnly(lead.phone || '').includes(qDigits)) return true
        const haystack = [lead.name, lead.email, lead.phone, lead.originAddress, lead.originCity, lead.destAddress, lead.destCity, lead.notes]
          .filter(Boolean).join(' ').toLowerCase()
        return haystack.includes(q)
      }).slice(0, 8)
    : []

  function updateQuery(nextValue: string) {
    setQuery(nextValue)
    setShowDropdown(nextValue.trim().length >= 1)
  }

  function handleSelectLead(lead: CRMLead) {
    setQuery('')
    setShowDropdown(false)
    router.push(`/sales/leads/${lead.id}`)
  }

  function handleNotifClick(item: NotificationItem) {
    setNotifOpen(false)
    router.push(item.href)
  }

  const navItems = BASE_NAV
    .filter(item => item.roles.includes(role))
    .filter(item => !(role === 'sales_rep' && ['Finance', 'Live Feed', 'Analytics', 'Reps', 'Team', 'Partnerships'].includes(item.label)))
  const initials = user?.name ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : 'SS'

  return (
    <>
      {/* ── GLOBAL TOAST (fires on any page) ─────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex max-w-sm items-start gap-3 rounded-[12px] border border-[var(--app-line)] bg-white p-4 shadow-2xl animate-in slide-in-from-bottom-4 fade-in duration-200">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgba(15,106,83,0.12)] text-xl">
              {toast.source ? SOURCE_ICON[toast.source] || TYPE_ICON[toast.type] : TYPE_ICON[toast.type]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--app-muted)]">
              {toast.type === 'lead' ? 'New inbound lead' : toast.type === 'sms' ? 'SMS reply' : toast.type === 'email' ? 'Inbound email' : 'System alert'}
            </div>
            <div className="mt-0.5 text-sm font-semibold text-[var(--app-ink)] truncate">{toast.title}</div>
            <div className="mt-0.5 text-xs text-[var(--app-muted)] truncate">
              {toast.branchLabel ? `${toast.branchLabel} • ` : ''}{toast.preview}
            </div>
            <button
              onClick={() => { setToast(null); router.push(toast.href) }}
              className="mt-2 rounded-[6px] bg-[var(--app-ink)] px-3 py-1 text-xs font-semibold text-white hover:bg-[#0f1b2d]"
            >
              View →
            </button>
          </div>
          <button onClick={() => setToast(null)} className="shrink-0 text-[var(--app-muted)] hover:text-[var(--app-ink)] text-lg leading-none">✕</button>
        </div>
      )}

      <header className="sticky top-0 z-40 border-b border-[var(--app-line)] bg-[var(--app-panel-strong)]">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 md:px-8">
          <div className="flex items-center justify-between gap-4">
            <Link href="/sales" className="flex min-w-0 items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-[var(--app-ink)] text-[11px] font-semibold text-white">S</div>
              <div className="truncate font-semibold tracking-tight text-[var(--app-ink)]">Saturn Star OS</div>
            </Link>

            <div className="flex items-center gap-2">
              {(role === 'owner' || role === 'manager' || role === 'sales_rep') && (
                <button onClick={() => setNewLeadOpen(true)} className="crm-button-dark h-9 px-3 text-sm">
                  New Lead
                </button>
              )}

              {/* ── Notification Bell ──────────────────────────────────── */}
              <div ref={notifRef} className="relative">
                <button
                  onClick={() => { setNotifOpen(v => !v); requestPushPermission() }}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-[8px] border text-lg transition ${notifOpen ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white' : 'border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-ink)] hover:border-[var(--app-ink)]'}`}
                  title="Notifications — click to enable alert sounds"
                >
                  🔔
                  {notifTotal > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                      {notifTotal > 99 ? '99+' : notifTotal}
                    </span>
                  )}
                </button>

                {/* ── Notification Panel ──────────────────────────────── */}
                {notifOpen && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-[400px] max-h-[80vh] overflow-hidden rounded-[12px] border border-[var(--app-line)] bg-white shadow-2xl flex flex-col">
                    {/* Panel header */}
                    <div className="flex items-center justify-between border-b border-[var(--app-line)] px-4 py-3">
                      <div>
                        <div className="text-sm font-semibold text-[var(--app-ink)]">Activity</div>
                        <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--app-muted)]">
                          {notifBreakdown.alerts > 0 && <span>🚨 {notifBreakdown.alerts} alert{notifBreakdown.alerts !== 1 ? 's' : ''}</span>}
                          {notifBreakdown.leads > 0 && <span>🆕 {notifBreakdown.leads} lead{notifBreakdown.leads !== 1 ? 's' : ''}</span>}
                          {notifBreakdown.sms > 0 && <span>💬 {notifBreakdown.sms} SMS</span>}
                          {notifBreakdown.emails > 0 && <span>📧 {notifBreakdown.emails} email{notifBreakdown.emails !== 1 ? 's' : ''}</span>}
                          {notifTotal === 0 && <span>All clear</span>}
                        </div>
                      </div>
                      <Link
                        href="/sales/inbox"
                        onClick={() => setNotifOpen(false)}
                        className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-1 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)]"
                      >
                        Open Inbox →
                      </Link>
                    </div>

                    {/* Items */}
                    <div className="flex-1 overflow-y-auto divide-y divide-[var(--app-line)]">
                      {notifItems.length === 0 ? (
                        <div className="px-4 py-10 text-center">
                          <div className="text-3xl">✅</div>
                          <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">All caught up</div>
                          <div className="mt-1 text-xs text-[var(--app-muted)]">No unread leads, SMS, emails, or alerts</div>
                        </div>
                      ) : notifItems.map(item => (
                        <button
                          key={item.id}
                          onClick={() => handleNotifClick(item)}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[var(--app-bg)]"
                        >
                          {/* Type icon */}
                          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${
                            item.type === 'lead'  ? 'bg-emerald-100 text-emerald-700' :
                            item.type === 'sms'   ? 'bg-sky-100 text-sky-700' :
                            item.type === 'email' ? 'bg-amber-100 text-amber-700' :
                            'bg-rose-100 text-rose-700'
                          }`}>
                            {item.source ? SOURCE_ICON[item.source] || TYPE_ICON[item.type] : TYPE_ICON[item.type]}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="truncate text-sm font-semibold text-[var(--app-ink)]">{item.title}</div>
                              <div className="shrink-0 text-[10px] text-[var(--app-muted)]">{timeAgo(item.time)}</div>
                            </div>
                            <div className="mt-0.5 truncate text-xs text-[var(--app-muted)]">
                              {item.branchLabel ? `${item.branchLabel} • ` : ''}{item.preview}
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <span className={`rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ${
                                item.type === 'lead'  ? 'bg-emerald-50 text-emerald-700' :
                                item.type === 'sms'   ? 'bg-sky-50 text-sky-700' :
                                item.type === 'email' ? 'bg-amber-50 text-amber-700' :
                                'bg-rose-50 text-rose-700'
                              }`}>
                                {item.type === 'lead' ? 'New Lead' : item.type === 'sms' ? 'SMS' : item.type === 'email' ? 'Email' : 'Alert'}
                              </span>
                              {item.phone && <span className="text-[10px] text-[var(--app-muted)]">{item.phone}</span>}
                              {item.leadId && <span className="text-[10px] text-[var(--app-muted)]">→ In pipeline</span>}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Footer */}
                    {notifTotal > 0 && (
                      <div className="border-t border-[var(--app-line)] px-4 py-2.5">
                        <Link
                          href="/sales/inbox"
                          onClick={() => setNotifOpen(false)}
                          className="block text-center text-xs font-medium text-[var(--app-accent)] hover:underline"
                        >
                          View all in Inbox
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div
                title={user?.name ?? ''}
                className="hidden h-8 w-8 items-center justify-center rounded bg-[var(--app-line)] text-xs font-semibold text-[var(--app-ink)] sm:flex"
              >
                {initials}
              </div>
              <LogoutButton />
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <nav className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 md:gap-6 md:px-0 md:pb-0">
              {navItems.map(item => {
                const active = item.match(pathname)
                // Inbox link: show a small dot badge if there are unclaimed leads (fast signal)
                const showInboxDot = item.href === '/sales/inbox' && notifBreakdown.leads > 0 && !active
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative shrink-0 rounded-full border px-3 py-2 text-sm font-medium transition md:rounded-none md:border-x-0 md:border-t-0 md:border-b-2 md:px-0 md:py-1 ${
                      active
                        ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white md:bg-transparent md:text-[var(--app-ink)]'
                        : 'border-[var(--app-line)] text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] md:border-transparent'
                    }`}
                  >
                    {item.label}
                    {showInboxDot && (
                      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-rose-500 md:-right-2 md:-top-0.5" />
                    )}
                  </Link>
                )
              })}
              {/* Mobile-only Leads link */}
              <Link
                href="/sales/leads"
                className={`shrink-0 rounded-full border px-3 py-2 text-sm font-medium transition md:hidden ${
                  pathname.startsWith('/sales/leads')
                    ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white'
                    : 'border-[var(--app-line)] text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)]'
                }`}
              >
                Leads
              </Link>
            </nav>

            <div ref={searchRef} className="relative w-full md:max-w-[320px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--app-muted)]">⌕</span>
              <input
                type="text"
                placeholder="Search name, phone, email, address…"
                value={query}
                onChange={e => updateQuery(e.target.value)}
                onFocus={() => query.trim().length >= 1 && setShowDropdown(true)}
                onKeyDown={e => e.key === 'Escape' && setShowDropdown(false)}
                className="h-10 w-full rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] pl-9 pr-4 text-sm text-[var(--app-ink)] outline-none transition focus:border-[var(--app-ink)]"
              />
              {showDropdown && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-[10px] border border-[var(--app-line)] bg-white shadow-lg">
                  {searchResults.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-[var(--app-muted)]">No leads found for &ldquo;{query}&rdquo;</div>
                  ) : (
                    searchResults.map(lead => (
                      <button
                        key={lead.id}
                        onMouseDown={() => handleSelectLead(lead)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[var(--app-bg)] border-b border-[var(--app-line)] last:border-0"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1a2744] text-[11px] font-bold text-white">
                          {(lead.name || lead.phone || '?').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[var(--app-ink)]">{lead.name || lead.phone}</div>
                          <div className="flex flex-wrap gap-x-2 text-xs text-[var(--app-muted)]">
                            {lead.phone && <span>{lead.phone}</span>}
                            {lead.email && <span>{lead.email}</span>}
                          </div>
                          {(lead.originCity || lead.destCity) && (
                            <div className="text-xs text-[var(--app-muted)]">
                              {lead.originCity || '—'} → {lead.destCity || '—'}
                            </div>
                          )}
                        </div>
                        <div className="ml-auto shrink-0 rounded-full border border-[var(--app-line)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">
                          {lead.stage}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <NewLeadModal open={newLeadOpen} onClose={() => setNewLeadOpen(false)} />
    </>
  )
}
