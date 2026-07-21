'use client'

import React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChangePasswordButton } from '@/app/components/change-password-button'
import { LogoutButton } from '@/app/components/logout-button'
import { NewLeadModal } from '@/app/components/sales/new-lead-modal'
import { QuickScanModal } from '@/app/components/sales/quick-scan-modal'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import { fetchSalesLeadSearchIndex } from '@/lib/sales-api'
import type { CRMLead } from '@/lib/types'
import type { NotificationItem } from '@/app/api/sales/notifications/route'

// Monotone SVG icons — consistent stroke-based, no emoji/color
const NAV_ICONS: Record<string, React.ReactNode> = {
  'Follow-Up':  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><path d="M10 2a8 8 0 100 16A8 8 0 0010 2z"/><path d="M10 6v5l3 2"/></svg>,
  Dashboard:    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><rect x="2" y="2" width="7" height="7" rx="1.5"/><rect x="11" y="2" width="7" height="7" rx="1.5"/><rect x="2" y="11" width="7" height="7" rx="1.5"/><rect x="11" y="11" width="7" height="7" rx="1.5"/></svg>,
  Leads:        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><circle cx="7" cy="7" r="3"/><path d="M2 17a5 5 0 0110 0M14 6h4M16 4v4"/></svg>,
  Inbox:        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><path d="M2 13l3-7h10l3 7"/><path d="M2 13h4l1 2h6l1-2h4v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-3z"/></svg>,
  Pipeline:     <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><circle cx="4" cy="10" r="2"/><circle cx="10" cy="10" r="2"/><circle cx="16" cy="10" r="2"/><path d="M6 10h2M12 10h2"/></svg>,
  Quotes:       <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><path d="M4 4h12a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z"/><path d="M7 8h6M7 11h4"/></svg>,
  Booked:       <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><path d="M6 10l3 3 5-5"/><rect x="3" y="3" width="14" height="14" rx="2"/></svg>,
  Academy:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><path d="M10 3L2 7l8 4 8-4-8-4z"/><path d="M2 7v5M6 9.5v4a4 4 0 008 0v-4"/></svg>,
  Operations:   <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><path d="M10 2a8 8 0 100 16A8 8 0 0010 2z"/><path d="M10 6v4l3 2"/></svg>,
  'Ops SMS':    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><path d="M3 4h14a1 1 0 011 1v8a1 1 0 01-1 1H6l-4 3V5a1 1 0 011-1z"/></svg>,
  Finance:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><path d="M10 3v14M6 6h5.5a2.5 2.5 0 010 5H6m0 0h5a2.5 2.5 0 010 5H6"/></svg>,
  'Live Feed':  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><circle cx="10" cy="10" r="2"/><path d="M5.5 5.5a6.5 6.5 0 000 9M14.5 5.5a6.5 6.5 0 010 9"/><path d="M3 3a10 10 0 000 14M17 3a10 10 0 010 14"/></svg>,
  Analytics:    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><path d="M3 15l4-5 4 2 5-8"/><circle cx="3" cy="15" r="1" fill="currentColor" stroke="none"/></svg>,
  Reps:         <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><circle cx="8" cy="7" r="3"/><path d="M2 17a6 6 0 0112 0"/><circle cx="15" cy="7" r="2.5"/><path d="M14 17h4a4 4 0 00-4-4"/></svg>,
  Settings:     <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><circle cx="10" cy="10" r="2.5"/><path d="M10 2.5V5M10 15v2.5M2.5 10H5M15 10h2.5M4.4 4.4l1.8 1.8M13.8 13.8l1.8 1.8M4.4 15.6l1.8-1.8M13.8 6.2l1.8-1.8"/></svg>,
  Team:         <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><circle cx="10" cy="7" r="3"/><path d="M4 17a6 6 0 0112 0"/></svg>,
  Partnerships: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><path d="M7 10l2 2 4-4"/><path d="M3 10a7 7 0 1014 0A7 7 0 003 10z"/></svg>,
}

const SALES_ROLES = ['owner', 'manager', 'sales_rep']

const BASE_NAV = [
  { environment: 'Command', href: '/sales', label: 'Dashboard', match: (p: string) => p === '/sales', roles: ['owner', 'manager', 'sales_rep'] },
  { environment: 'Intake', href: '/sales/inbox', label: 'Inbox', match: (p: string) => p.startsWith('/sales/inbox'), roles: ['owner', 'manager', 'sales_rep'] },
  { environment: 'Intake', href: '/sales/leads', label: 'Leads', match: (p: string) => p.startsWith('/sales/leads'), roles: ['owner', 'manager', 'sales_rep'] },
  { environment: 'Intake', href: '/marketing', label: 'Partnerships', match: (p: string) => p.startsWith('/marketing'), roles: ['owner', 'manager', 'partnership_manager'] },
  { environment: 'Sales', href: '/sales/pipeline', label: 'Pipeline', match: (p: string) => p.startsWith('/sales/pipeline'), roles: ['owner', 'manager', 'sales_rep'] },
  { environment: 'Sales', href: '/sales/follow-up', label: 'Follow-Up', match: (p: string) => p.startsWith('/sales/follow-up'), roles: ['owner', 'manager', 'sales_rep'] },
  { environment: 'Sales', href: '/sales/quotes', label: 'Quotes', match: (p: string) => p.startsWith('/sales/quotes'), roles: ['owner', 'manager', 'sales_rep'] },
  { environment: 'Sales', href: '/sales/academy', label: 'Academy', match: (p: string) => p.startsWith('/sales/academy'), roles: ['owner', 'manager', 'sales_rep'] },
  { environment: 'Operations', href: '/sales/booked', label: 'Booked', match: (p: string) => p.startsWith('/sales/booked'), roles: ['owner', 'manager', 'sales_rep'] },
  { environment: 'Operations', href: '/sales/operations', label: 'Operations', match: (p: string) => p.startsWith('/sales/operations') && !p.startsWith('/sales/operations/sms'), roles: ['owner', 'manager', 'operations_lead'] },
  { environment: 'Live', href: '/sales/operations/sms', label: 'Ops SMS', match: (p: string) => p.startsWith('/sales/operations/sms'), roles: ['owner', 'manager', 'operations_lead'] },
  { environment: 'Care', href: '/sales/finance', label: 'Finance', match: (p: string) => p.startsWith('/sales/finance'), roles: ['owner', 'manager'] },
  { environment: 'Management', href: '/sales/activity', label: 'Live Feed', match: (p: string) => p.startsWith('/sales/activity'), roles: ['owner', 'manager'] },
  { environment: 'Management', href: '/sales/analytics', label: 'Analytics', match: (p: string) => p.startsWith('/sales/analytics'), roles: ['owner', 'manager'] },
  { environment: 'Management', href: '/sales/reps', label: 'Reps', match: (p: string) => p.startsWith('/sales/reps'), roles: ['owner', 'manager'] },
  { environment: 'Management', href: '/admin/users', label: 'Team', match: (p: string) => p.startsWith('/admin'), roles: ['owner'] },
  { environment: 'Management', href: '/sales/settings', label: 'Settings', match: (p: string) => p.startsWith('/sales/settings'), roles: ['owner'] },
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
  direct_mail:  '📬',
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

function guardedNavigate(href: string, router: ReturnType<typeof useRouter>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const guard = (window as any).__onNavAttempt
  if (guard) { guard(href) } else { router.push(href) }
}

function readLocalStorageItem(key: string) {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeLocalStorageItem(key: string, value: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage?.setItem(key, value)
  } catch {}
}

export function SalesHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const user = useCurrentUser()
  const role = user?.role ?? 'owner'
  const isDexaView = user?.branch === 'ottawa'
  const canUseSalesActions = SALES_ROLES.includes(role)
  const homeHref = role === 'partnership_manager' ? '/marketing/partners?tab=phone' : role === 'crew' ? '/crew/calendar' : role === 'operations_lead' ? '/sales/operations' : '/sales'
  const [tab, setTab] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    setTab(new URLSearchParams(window.location.search).get('tab'))
  }, [pathname])

  const partnershipInbox = tab !== undefined && pathname.startsWith('/marketing/partners') && (!tab || tab === 'phone' || tab === 'replies')

  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [leadsLoaded, setLeadsLoaded] = useState(false)
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [quickScanOpen, setQuickScanOpen] = useState(false)
  const [allLeads, setAllLeads] = useState<CRMLead[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // ── Notification state ──────────────────────────────────────────────────
  const [notifItems, setNotifItems] = useState<NotificationItem[]>([])
  const [notifBreakdown, setNotifBreakdown] = useState({ leads: 0, sms: 0, emails: 0, alerts: 0 })
  const [notifTotal, setNotifTotal] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const [snoozedBefore, setSnoozedBefore] = useState<number>(() => {
    return parseInt(readLocalStorageItem('ss_notif_snoozed') || '0', 10) || 0
  })

  function markAllRead() {
    const now = Date.now()
    const keys = notifItems.map(item => item.dedupeKey)
    if (keys.length) void fetch('/api/sales/notifications', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dedupeKeys: keys, action: 'acknowledged' }) })
    setSnoozedBefore(now)
    writeLocalStorageItem('ss_notif_snoozed', String(now))
    setNotifOpen(false)
  }
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

  // Load searchable lead data only after the user actually uses search.
  useEffect(() => {
    if (!searchFocused && query.trim().length === 0) return
    if (leadsLoaded) return
    if (!canUseSalesActions) return
    let cancelled = false
    fetchSalesLeadSearchIndex()
      .then(leads => {
        if (cancelled) return
        setAllLeads(leads as CRMLead[])
        setLeadsLoaded(true)
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [canUseSalesActions, leadsLoaded, query, searchFocused])

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
              isDexaView ? 'Dexa — New Lead' : '🌟 Saturn Star — New Lead',
              newest.title || 'New activity'
            )
          }
        }
        data.items.forEach(item => seenIdsRef.current.add(item.id))

        const visibleItems = snoozedBefore > 0
          ? data.items.filter(item => new Date(item.time).getTime() > snoozedBefore)
          : data.items
        setNotifItems(visibleItems)
        setNotifTotal(visibleItems.length)
        setNotifBreakdown({
          leads: visibleItems.filter(i => i.type === 'lead').length,
          sms: visibleItems.filter(i => i.type === 'sms').length,
          emails: visibleItems.filter(i => i.type === 'email').length,
          alerts: visibleItems.filter(i => i.type === 'alert').length,
        })
      } catch { /* non-fatal */ }
    }

    let interval: ReturnType<typeof setInterval> | null = null

    function schedule() {
      if (interval) clearInterval(interval)
      const delay = typeof document !== 'undefined' && document.hidden ? 60_000 : 20_000
      interval = setInterval(() => void fetchNotifications(), delay)
    }

    void fetchNotifications()
    schedule()
    document.addEventListener('visibilitychange', schedule)
    return () => {
      if (interval) clearInterval(interval)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [isDexaView])

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

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = readLocalStorageItem('ss_sales_sidebar_collapsed')
    if (saved === '1') setSidebarCollapsed(true)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    writeLocalStorageItem('ss_sales_sidebar_collapsed', sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

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
    if (!searchFocused) setSearchFocused(true)
    setShowDropdown(nextValue.trim().length >= 1)
  }

  function handleSelectLead(lead: CRMLead) {
    setQuery('')
    setShowDropdown(false)
    router.push(`/sales/leads/${lead.id}`)
  }

  function handleNotifClick(item: NotificationItem) {
    void fetch('/api/sales/notifications', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dedupeKeys: [item.dedupeKey], action: 'acknowledged' }) })
    setNotifItems(current => current.filter(candidate => candidate.dedupeKey !== item.dedupeKey))
    setNotifTotal(current => Math.max(0, current - 1))
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
        <div className="fixed bottom-6 right-6 z-[60] flex max-w-sm items-start gap-3 rounded-[12px] border border-[var(--app-line)] bg-white p-4 shadow-none animate-in slide-in-from-bottom-4 fade-in duration-200">
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
              className="mt-2 rounded-[6px] bg-[var(--app-ink)] px-3 py-1 text-xs font-semibold text-white hover:bg-[#071421]"
            >
              View →
            </button>
          </div>
          <button onClick={() => setToast(null)} className="shrink-0 text-[var(--app-muted)] hover:text-[var(--app-ink)] text-lg leading-none">✕</button>
        </div>
      )}

      <header className={`sticky top-0 z-40 border-b border-[var(--app-line)] bg-[var(--app-panel-strong)] lg:h-screen lg:shrink-0 lg:border-b-0 lg:border-r ${partnershipInbox ? 'hidden lg:block' : ''} ${sidebarCollapsed ? 'lg:w-[var(--crm-shell-sidebar-collapsed)]' : 'lg:w-[var(--crm-shell-sidebar)]'}`}>
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 md:px-8 lg:h-full lg:max-w-none lg:overflow-hidden lg:px-0">

          {/* ── Brand strip — slim full-width horizontal ───────────────── */}
          <div className={`hidden lg:flex items-center border-b border-[var(--app-line)] ${sidebarCollapsed ? 'h-14 justify-center px-0' : 'h-14 gap-2.5 px-4'}`}>
            <Link href={homeHref} className={`flex min-w-0 items-center ${sidebarCollapsed ? 'justify-center' : 'gap-2.5 flex-1 min-w-0'}`}>
              {isDexaView ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[#071421] text-[9px] font-black tracking-tight text-white" aria-label="Dexa Movers">DEXA</span> : <Image src="/brand/saturn-star-icon-full-color.png" alt="Saturn Star" width={32} height={32} className="shrink-0 object-contain" priority />}
              {!sidebarCollapsed && (
                <span className="truncate text-sm font-bold tracking-tight text-[var(--app-ink)]">{isDexaView ? 'Dexa OS' : 'Saturn Star OS'}</span>
              )}
            </Link>
            {!sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--app-muted)] hover:bg-[var(--app-line)] hover:text-[var(--app-ink)] transition text-xs"
                title="Collapse sidebar"
              >‹‹</button>
            )}
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="absolute hidden"
                aria-hidden
              />
            )}
          </div>

          {/* Collapsed expand trigger — click the logo to expand */}
          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="hidden lg:flex absolute top-[18px] left-0 w-[var(--crm-shell-sidebar-collapsed)] h-7 items-center justify-center text-[var(--app-muted)] hover:text-[var(--app-ink)] transition text-xs"
              title="Expand sidebar"
            >››</button>
          )}

          {/* ── Mobile/tablet top bar ─────────────────────────────────── */}
          <div className="flex items-center justify-between gap-4 lg:hidden">
            <Link href={homeHref} className="flex min-w-0 items-center gap-2.5">
              {isDexaView ? <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[6px] bg-[#071421] text-[8px] font-black tracking-tight text-white" aria-label="Dexa Movers">DEXA</span> : <Image src="/brand/saturn-star-icon-full-color.png" alt="Saturn Star" width={30} height={30} className="shrink-0 object-contain" priority />}
              <div className="truncate font-semibold tracking-tight text-[var(--app-ink)]">{isDexaView ? 'Dexa OS' : 'Saturn Star OS'}</div>
            </Link>
            <div className="flex items-center gap-2">
              {canUseSalesActions && (
                <>
                  <button onClick={() => setNewLeadOpen(true)} className="crm-button-dark h-9 px-3 text-sm">New Lead</button>
                  <button onClick={() => setQuickScanOpen(true)} className="flex h-9 items-center gap-1 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2.5 text-sm font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition" title="MLS Quick Inventory Scan">⚡</button>
                </>
              )}
              <div ref={notifRef} className="relative">
                <button
                  onClick={() => { setNotifOpen(v => !v); requestPushPermission() }}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-[8px] border text-lg transition ${notifOpen ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white' : 'border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-ink)] hover:border-[var(--app-ink)]'}`}
                  title="Notifications"
                >
                  🔔
                  {notifTotal > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                      {notifTotal > 9 ? '9+' : notifTotal}
                    </span>
                  )}
                </button>
              </div>
              <ChangePasswordButton compact />
              <LogoutButton compact />
            </div>
          </div>

          {/* ── Desktop action row (New Lead + Bell) ─────────────────── */}
          <div className={`hidden lg:flex items-center gap-2 ${sidebarCollapsed ? 'flex-col px-2 pt-1' : 'px-4'}`}>
            {canUseSalesActions && (
              <>
              <button
                onClick={() => setNewLeadOpen(true)}
                className={`crm-button-dark h-9 text-sm ${sidebarCollapsed ? 'w-10 px-0 justify-center' : 'flex-1 justify-center'}`}
                title="New Lead"
              >
                {sidebarCollapsed ? '+' : 'New Lead'}
              </button>
              <button
                onClick={() => setQuickScanOpen(true)}
                className={`flex h-9 items-center justify-center rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] text-sm font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition ${sidebarCollapsed ? 'w-10' : 'px-2.5'}`}
                title="MLS Quick Inventory Scan"
              >⚡</button>
              </>
            )}

            {/* ── Notification Bell ──────────────────────────────────── */}
            <div ref={notifRef} className="relative">
              <button
                onClick={() => { setNotifOpen(v => !v); requestPushPermission() }}
                className={`relative flex h-9 items-center justify-center rounded-[8px] border text-lg transition ${sidebarCollapsed ? 'w-10' : 'w-9'} ${notifOpen ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white' : 'border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-ink)] hover:border-[var(--app-ink)]'}`}
                title="Notifications — click to enable alert sounds"
              >
                🔔
                {notifTotal > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                    {notifTotal > 9 ? '9+' : notifTotal}
                  </span>
                )}
              </button>

                {/* ── Notification Panel — fixed so it clears the sidebar ── */}
                {notifOpen && (
                  <div className="fixed left-4 right-4 top-4 z-[60] mx-auto max-w-sm max-h-[80vh] overflow-hidden rounded-[12px] border border-[var(--app-line)] bg-white shadow-none flex flex-col lg:left-auto lg:right-6 lg:top-6 lg:w-[400px]">
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
                      <div className="flex items-center gap-2">
                        {notifTotal > 0 && (
                          <button
                            onClick={markAllRead}
                            className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-1 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)]"
                          >
                            Mark all read
                          </button>
                        )}
                        <Link
                          href="/sales/inbox"
                          onClick={() => setNotifOpen(false)}
                          className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-1 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)]"
                        >
                          Open Inbox →
                        </Link>
                      </div>
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
            </div>

          {/* ── Nav ───────────────────────────────────────────────────── */}
          <div className="flex min-h-0 flex-col gap-3 md:flex-row md:items-center md:justify-between lg:flex-1 lg:flex-col lg:items-stretch lg:justify-start">
            <nav className={`-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 md:gap-6 md:px-0 md:pb-0 lg:mx-0 lg:min-h-0 lg:flex-1 lg:flex-col lg:items-stretch lg:gap-0.5 lg:overflow-y-auto lg:p-0 ${sidebarCollapsed ? 'lg:px-2' : 'lg:px-3'}`}>
              {navItems.map((item, index) => {
                const active = item.match(pathname)
                const showInboxDot = item.href === '/sales/inbox' && notifBreakdown.leads > 0 && !active
                const showFollowUpDot = item.href === '/sales/follow-up' && notifBreakdown.leads > 0 && !active
                return (
                  <React.Fragment key={item.href}>
                  {(!index || navItems[index - 1]?.environment !== item.environment) && !sidebarCollapsed && (
                    <div className="hidden px-3 pb-1 pt-4 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--app-muted)] first:pt-1 lg:block">
                      {item.environment}
                    </div>
                  )}
                  <button
                    onClick={() => guardedNavigate(item.href, router)}
                    title={item.label}
                    className={`relative shrink-0 rounded-full border px-3 py-2 text-sm font-medium transition
                      md:rounded-none md:border-x-0 md:border-t-0 md:border-b-2 md:px-0 md:py-1
                      lg:flex lg:w-full lg:rounded-[10px] lg:border lg:py-2
                      ${sidebarCollapsed
                        ? 'lg:flex-col lg:items-center lg:justify-center lg:gap-0 lg:px-0 lg:py-2.5'
                        : 'lg:items-center lg:justify-between lg:px-3'}
                      ${active
                        ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white md:bg-transparent md:text-[var(--app-ink)] lg:border-[var(--app-accent)] lg:bg-[var(--app-accent-soft)] lg:text-[var(--app-accent)]'
                        : 'border-[var(--app-line)] text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] md:border-transparent lg:border-transparent lg:hover:bg-[var(--app-line)]/40'
                      }`}
                  >
                    {/* Desktop: SVG icon always visible */}
                    <span className={`hidden lg:inline-flex shrink-0 items-center justify-center ${sidebarCollapsed ? '' : 'mr-2'}`}>
                      {NAV_ICONS[item.label] ?? <span className="h-4 w-4" />}
                    </span>
                    {/* Label: shown on mobile + desktop expanded */}
                    <span className={`lg:flex-1 lg:text-left ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                      <span className="lg:hidden">{item.label}</span>
                      <span className="hidden lg:inline">{item.label}</span>
                    </span>
                    {showFollowUpDot && (
                      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-rose-500 md:-right-2 md:-top-0.5 lg:right-1 lg:top-1" />
                    )}
                    {showInboxDot && (
                      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-rose-500 md:-right-2 md:-top-0.5 lg:right-1 lg:top-1" />
                    )}
                  </button>
                  </React.Fragment>
                )
              })}
            </nav>

            {canUseSalesActions && (
              <div ref={searchRef} className={`relative w-full md:max-w-[320px] lg:order-first lg:max-w-none ${sidebarCollapsed ? 'lg:hidden' : 'lg:px-3'}`}>
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--app-muted)]">⌕</span>
                <input
                  type="text"
                  placeholder="Search name, phone, email, address..."
                  value={query}
                  onChange={e => updateQuery(e.target.value)}
                  onFocus={() => {
                    setSearchFocused(true)
                    if (query.trim().length >= 1) setShowDropdown(true)
                  }}
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
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#071421] text-[11px] font-bold text-white">
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
            )}

            <div className={`hidden rounded-[16px] border border-[var(--app-line)] bg-[var(--app-bg)] p-2 lg:mt-auto lg:block ${sidebarCollapsed ? 'lg:hidden' : 'lg:mx-3'}`}>
              <div className="mb-2 flex items-center gap-2 rounded-[12px] px-2 py-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--app-line)] text-xs font-semibold text-[var(--app-ink)]">
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--app-ink)]">{user?.name || 'Saturn User'}</div>
                  <div className="truncate text-xs capitalize text-[var(--app-muted)]">{role.replaceAll('_', ' ')}</div>
                </div>
              </div>
              <ChangePasswordButton />
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      <NewLeadModal open={newLeadOpen} onClose={() => setNewLeadOpen(false)} />
      <QuickScanModal open={quickScanOpen} onClose={() => setQuickScanOpen(false)} />
    </>
  )
}
