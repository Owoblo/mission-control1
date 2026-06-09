'use client'

import React, { Suspense, useEffect, useDeferredValue, useMemo, useState, useTransition, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { RecordingPlayer } from '@/app/components/sales/recording-player'
import type { SmsThread } from '@/app/api/sales/sms-threads/route'
import {
  getInboundActionTimestamp,
  getInboundDisposition,
  getInboundStatus,
  isAnsweredByRep,
  isHighPriorityLead,
  isMissedCall,
  isQrOrDirectMailLead,
  isWebInquiryLead,
  matchesInboundFocusFilter,
  parseInboundRawData as parseRawData,
} from '@/lib/inbound-inbox'
import { getSaturnBranchLabel, getSaturnBranchNumberFromRawData, getSaturnTrackingLabel } from '@/lib/sales-phones'
import { claimInboundLead, fetchInboundLeads, markInboxRead, markInboundLeadDisposition, markInboundLeadHandled, restoreInboundLead, sendSalesMessage } from '@/lib/sales-api'
import { displayEmailSubject, replyEmailSubject } from '@/lib/email-display'
import type { CRMEmail, InboundClosedFilter, InboundInboxPayload, InboundLead, InboundLeadFocusFilter } from '@/lib/types'

const SOURCE_LABELS: Record<string, string> = {
  twilio_call: 'Inbound Call',
  twilio_sms: 'SMS',
  missed_call: 'Missed Call',
  facebook_dm: 'Facebook DM',
  facebook_lead_ad: 'FB Lead Ad',
  instagram_dm: 'Instagram DM',
  email: 'Email',
  website_form: 'Web Form',
  direct_mail: 'QR / Direct Mail',
  zapier: 'Lead Form',
}

const SOURCE_COLORS: Record<string, string> = {
  twilio_call: 'bg-blue-100 text-blue-700',
  twilio_sms: 'bg-purple-100 text-purple-700',
  missed_call: 'bg-red-100 text-red-700',
  facebook_lead_ad: 'bg-[#1877F2]/10 text-[#1877F2]',
  facebook_dm: 'bg-[#1877F2]/10 text-[#1877F2]',
  instagram_dm: 'bg-pink-100 text-pink-700',
  email: 'bg-gray-100 text-gray-600',
  website_form: 'bg-green-100 text-green-700',
  direct_mail: 'bg-amber-100 text-amber-700',
  zapier: 'bg-orange-100 text-orange-700',
}

const EMPTY_SUMMARY: InboundInboxPayload['summary'] = {
  queue: 0,
  priority: 0,
  webForms: 0,
  recentHandoffs: 0,
  closed: 0,
  focus: {
    needs_action: 0,
    web_qr: 0,
    calls: 0,
    sms: 0,
    high_intent: 0,
    answered: 0,
  },
  closedByDisposition: {
    all: 0,
    junk: 0,
    lost: 0,
    not_interested: 0,
  },
}

function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(value).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

function formatAbsoluteTime(value: string) {
  try {
    return new Date(value).toLocaleString('en-CA', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return value }
}

// Speed-to-lead urgency helpers
function secondsSince(value: string) {
  return Math.floor((Date.now() - new Date(value).getTime()) / 1000)
}

function urgencyTier(secondsOld: number): 'live' | 'warning' | 'urgent' | 'overdue' | null {
  if (secondsOld < 120) return 'live'       // 0–2 min
  if (secondsOld < 300) return 'warning'    // 2–5 min
  if (secondsOld < 900) return 'urgent'     // 5–15 min
  if (secondsOld < 3600) return 'overdue'   // 15–60 min
  return null
}

function liveTimer(secondsOld: number): string {
  const m = Math.floor(secondsOld / 60)
  const s = secondsOld % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1)
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
  } catch { /* ignore — audio not supported */ }
}

function formatPhoneDisplay(value?: string) {
  const digits = (value || '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return value || ''
}

function getInboundBranchMeta(item: InboundLead | null) {
  const raw = parseRawData(item?.raw_data)
  const branchNumber = getSaturnBranchNumberFromRawData(raw)
  const branchLabel =
    getSaturnBranchLabel(branchNumber) ||
    (typeof raw?.branchCity === 'string' ? raw.branchCity : '') ||
    ''
  const trackingLabel =
    (typeof raw?.trackingLabel === 'string' ? raw.trackingLabel : '') ||
    getSaturnTrackingLabel(branchNumber) ||
    ''

  return {
    branchNumber: branchNumber || undefined,
    branchLabel: branchLabel || undefined,
    trackingLabel: trackingLabel || undefined,
  }
}

function getInboxChannelKey(item: InboundLead | null) {
  if (!item) return 'webforms' as const
  if (item.source === 'twilio_sms') return 'sms' as const
  if (item.source === 'email') return 'email' as const
  if (item.source === 'twilio_call' || item.source === 'missed_call') return 'calls' as const
  return 'webforms' as const
}

function getInboundLatestAt(item: InboundLead | null) {
  if (!item) return ''
  const raw = parseRawData(item.raw_data)
  const smsThread = Array.isArray(raw?.smsThread) ? raw.smsThread as Array<Record<string, unknown>> : []
  const threadLatest = smsThread
    .map(entry => (typeof entry.at === 'string' ? entry.at : ''))
    .filter(Boolean)
    .sort()
    .pop()
  return threadLatest || item.created_at
}

function getInboundReadMeta(item: InboundLead | null) {
  if (!item) return null
  const raw = parseRawData(item.raw_data)
  const state = raw?.inboxState?.[getInboxChannelKey(item)] as
    | { lastReadAt?: string; lastReadByName?: string; lastActionAt?: string; lastActionByName?: string }
    | undefined
  return state || null
}

function isInboundItemUnread(item: InboundLead | null) {
  if (!item) return false
  const state = getInboundReadMeta(item)
  if (!state?.lastReadAt) return true
  return new Date(getInboundLatestAt(item)).getTime() > new Date(state.lastReadAt).getTime()
}

function isUnreadEmail(email: CRMEmail) {
  if (email.direction !== 'inbound') return false
  if (!email.readAt) return true
  return new Date(email.sentAt).getTime() > new Date(email.readAt).getTime()
}

function openDialer(phone?: string, name?: string, leadId?: string) {
  if (!phone || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('crm:open-dialer', { detail: { phone, name, leadId } }))
}

function isPlaceholderLeadName(value?: string) {
  const normalized = (value || '').trim().toLowerCase()
  return !normalized || ['unknown caller', 'new caller', 'unknown contact', 'new contact', 'new lead', 'new inquiry'].includes(normalized)
}

function getFallbackLeadLabel(item: InboundLead | null) {
  if (!item) return 'New Lead'
  if (item.phone) return formatPhoneDisplay(item.phone)
  if (item.email) return item.email
  return item.source === 'twilio_call' ? 'New Caller' : item.source === 'twilio_sms' ? 'New Contact' : 'New Lead'
}

function displayLeadName(item: InboundLead | null) {
  if (!item) return 'New Lead'
  const value = item.matchedLeadName?.trim() || item.name?.trim()
  if (!value || isPlaceholderLeadName(value) || /^unknown\b/i.test(value)) return getFallbackLeadLabel(item)
  return value
}

function getClaimLeadName(item: InboundLead | null) {
  if (!item) return 'New Lead'
  const value = item.matchedLeadName?.trim() || item.name?.trim()
  if (value && !isPlaceholderLeadName(value) && !/^unknown\b/i.test(value)) return value
  return item.source === 'twilio_call' ? 'New Caller' : item.source === 'twilio_sms' ? 'New Contact' : 'New Lead'
}

function getLeadFirstName(item: InboundLead | null) {
  if (!item) return 'there'
  const value = item.matchedLeadName?.trim() || item.name?.trim()
  if (!value || isPlaceholderLeadName(value) || /^unknown\b/i.test(value)) return 'there'
  return value.split(/\s+/)[0] || 'there'
}

function getLeadAvatarText(item: InboundLead | null) {
  const label = displayLeadName(item).replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase()
  return label || 'LD'
}

function getLeadPriorityScore(item: InboundLead, rawInput?: Record<string, any> | null) {
  const raw = rawInput ?? parseRawData(item.raw_data)
  const status = getInboundStatus(item, raw)
  let score = 0
  if (status === 'closed') score -= 70
  if (status === 'recent_handoff') score -= 45
  if (isMissedCall(item)) score += 55
  if (isQrOrDirectMailLead(item, raw)) score += 40
  if (item.source === 'website_form') score += 35
  if (item.source === 'email') score += 30
  if (item.source === 'twilio_sms') score += 30
  if (raw?.aiSummary?.moveReadiness === 'hot') score += 24
  if (raw?.routeText || raw?.originCity || raw?.destCity) score += 10
  if (item.phone || item.email) score += 6
  if (isAnsweredByRep(item)) score -= 16
  return score
}

function getLeadActionMeta(item: InboundLead, rawInput?: Record<string, any> | null) {
  const raw = rawInput ?? parseRawData(item.raw_data)
  const disposition = getInboundDisposition(item, raw)
  const status = getInboundStatus(item, raw)
  if (status === 'recent_handoff') {
    return { label: 'Recent Handoff', className: 'border-[rgba(15,106,83,0.2)] bg-[rgba(15,106,83,0.08)] text-[var(--app-accent)]' }
  }
  if (disposition === 'lost') {
    return { label: 'Lost', className: 'border-rose-200 bg-rose-50 text-rose-700' }
  }
  if (disposition === 'junk') {
    return { label: 'Junk / Spam', className: 'border-slate-200 bg-slate-100 text-slate-600' }
  }
  if (disposition === 'not_interested') {
    return { label: 'Not Interested', className: 'border-stone-200 bg-stone-100 text-stone-700' }
  }
  if (isMissedCall(item)) {
    return { label: 'Call Back', className: 'border-rose-200 bg-rose-50 text-rose-700' }
  }
  if (item.source === 'twilio_sms') {
    return { label: 'Reply Needed', className: 'border-violet-200 bg-violet-50 text-violet-700' }
  }
  if (raw?.aiSummary?.moveReadiness === 'hot') {
    return { label: 'High Intent', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
  }
  if (isAnsweredByRep(item)) {
    return { label: 'Rep Spoke With Lead', className: 'border-sky-200 bg-sky-50 text-sky-700' }
  }
  if (isWebInquiryLead(item, raw)) {
    return { label: 'New Inquiry', className: 'border-amber-200 bg-amber-50 text-amber-700' }
  }
  return { label: 'Needs Review', className: 'border-[rgba(15,106,83,0.18)] bg-[rgba(15,106,83,0.08)] text-[var(--app-accent)]' }
}

function getLeadHeadline(item: InboundLead, rawInput?: Record<string, any> | null) {
  const raw = rawInput ?? parseRawData(item.raw_data)
  if (typeof raw?.routeText === 'string' && raw.routeText.trim()) return raw.routeText
  if (item.source === 'email' && typeof raw?.subject === 'string' && raw.subject.trim()) return displayEmailSubject(raw.subject)
  if (item.source === 'twilio_call') {
    return 'Inbound call'
  }
  if (item.source === 'twilio_sms') {
    return 'SMS message'
  }
  if (item.message?.trim()) return item.message
  return item.phone || item.email || 'No contact details'
}

function getLeadSummary(item: InboundLead, rawInput?: Record<string, any> | null) {
  const raw = rawInput ?? parseRawData(item.raw_data)
  return raw?.aiSummary?.summary || raw?.transcript || item.message || 'No summary yet.'
}

function SalesInboxPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [items, setItems] = useState<InboundLead[]>([])
  const [summary, setSummary] = useState<InboundInboxPayload['summary']>(EMPTY_SUMMARY)
  const [viewMode, setViewMode] = useState<'queue' | 'calls' | 'webforms' | 'handoffs' | 'closed' | 'messages' | 'email'>('queue')
  const [focusFilter, setFocusFilter] = useState<InboundLeadFocusFilter>('needs_action')
  const [closedFilter, setClosedFilter] = useState<InboundClosedFilter>('all')
  const [search, setSearch] = useState('')
  const [, startTransition] = useTransition()
  const deferredSearch = useDeferredValue(search)
  const deferredViewMode = useDeferredValue(viewMode)
  const deferredFocusFilter = useDeferredValue(focusFilter)
  const deferredClosedFilter = useDeferredValue(closedFilter)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'priority' | 'recent' | 'oldest'>('recent')
  const deferredSortOrder = useDeferredValue(sortOrder)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [messageBusy, setMessageBusy] = useState(false)
  const [dispositionBusy, setDispositionBusy] = useState<'junk' | 'lost' | 'not_interested' | null>(null)
  const [handledBusy, setHandledBusy] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compose, setCompose] = useState({ emailSubject: 'Following up — Saturn Star Moving', emailBody: '', smsBody: '' })
  const [scGoalOpen, setScGoalOpen] = useState<'email' | 'sms' | null>(null)
  const [scBusy, setScBusy] = useState(false)
  // SMS threads (2-way messages view)
  const [smsThreads, setSmsThreads] = useState<SmsThread[]>([])
  const [threadsLoading, setThreadsLoading] = useState(false)
  const [selectedThread, setSelectedThread] = useState<string | null>(null)
  const [smsReply, setSmsReply] = useState('')
  const [smsReplyBusy, setSmsReplyBusy] = useState(false)
  const [smsMediaFiles, setSmsMediaFiles] = useState<File[]>([])
  const [smsNewChatOpen, setSmsNewChatOpen] = useState(false)
  const [smsNewChatPhone, setSmsNewChatPhone] = useState('')
  const smsFileInputRef = React.useRef<HTMLInputElement>(null)
  // Email inbox state
  const [emailList, setEmailList] = useState<CRMEmail[]>([])
  const [emailLoading, setEmailLoading] = useState(false)
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null)
  const [emailReply, setEmailReply] = useState({ subject: '', body: '' })
  const [emailReplyBusy, setEmailReplyBusy] = useState(false)
  const readStateRef = React.useRef(new Set<string>())
  const inboxRefreshInFlightRef = React.useRef(false)
  const smsThreadsInFlightRef = React.useRef(false)
  const emailsInFlightRef = React.useRef(false)

  // Keep urgency badges fresh without forcing the full inbox to repaint every second.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.hidden) return
      setTick(n => n + 1)
    }, 15_000)
    return () => window.clearInterval(t)
  }, [])

  // Track previous items to detect new arrivals and fire alerts
  const prevItemIdsRef = React.useRef<Set<string>>(new Set())
  useEffect(() => {
    if (items.length === 0) return
    const currentIds = new Set(items.map(i => i.id))
    const newArrivals = items.filter(i =>
      !prevItemIdsRef.current.has(i.id) &&
      prevItemIdsRef.current.size > 0 && // skip on first load
      (i.inboxStatus || 'needs_action') === 'needs_action'
    )
    if (newArrivals.length > 0) {
      playAlertSound()
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = newArrivals[0]
        const name = n.matchedLeadName || n.name || n.phone || 'New lead'
        new Notification('New lead — Saturn Star', {
          body: `${name} just came in. Respond now.`,
          icon: '/icon-192.png',
        })
      } else if ('Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission()
      }
    }
    prevItemIdsRef.current = currentIds
  }, [items])

  const SC_GOALS = [
    { id: 'follow_up', label: '👋 Follow-up', desc: 'Check in after first contact' },
    { id: 'quote_ready', label: '📋 Quote ready', desc: 'Estimate is prepared for them' },
    { id: 'address_objection', label: '🤝 Handle objection', desc: 'Price or timing concern' },
    { id: 're_engage', label: '🔁 Re-engage', desc: 'Cold lead, bring them back' },
    { id: 'confirm_booking', label: '✅ Confirm booking', desc: 'Finalize the job' },
    { id: 'move_reminder', label: '📅 Move day reminder', desc: 'Day-before heads up' },
  ]

  async function runSmartCompose(goal: string, channel: 'email' | 'sms') {
    if (!selected) return
    try {
      setScBusy(true)
      const res = await fetch('/api/sales/smart-compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead: selected, smsHistory: [], emailHistory: [], goal, channel }),
      })
      const data = await res.json() as { ok: boolean; draft?: string; subject?: string; error?: string }
      if (data.ok && data.draft) {
        if (channel === 'email') {
          setCompose(c => ({ ...c, emailBody: data.draft!, ...(data.subject ? { emailSubject: data.subject } : {}) }))
        } else {
          setCompose(c => ({ ...c, smsBody: data.draft! }))
        }
        setScGoalOpen(null)
      }
    } catch {
      // fail silently — user still has compose box
    } finally {
      setScBusy(false)
    }
  }
  function applyTemplate(templateId: string, firstName: string, lead: typeof selected) {
    const phone = '226-773-2993'
    switch (templateId) {
      case 'initial':
        setCompose(c => ({
          ...c,
          emailSubject: 'Following up — Saturn Star Moving',
          emailBody: `Hi ${firstName},\n\nThanks for reaching out to Saturn Star Moving. We'd love to help with your move.\n\nCould you share your move date and the addresses involved so we can prepare the right estimate?\n\nBest,\nSaturn Star Moving\n${phone}`,
          smsBody: `Hi ${firstName}, thanks for contacting Saturn Star Moving. We can help with your move. What date and locations are you planning for? — Saturn Star (${phone})`,
        }))
        break
      case 'quote_ready':
        setCompose(c => ({
          ...c,
          emailSubject: 'Your Saturn Star Moving estimate is ready',
          emailBody: `Hi ${firstName},\n\nYour binding hourly estimate is ready for review. You can accept, decline, or ask us to adjust it.\n\nWe'll hold this rate for 30 days.\n\nBest,\nSaturn Star Moving\n${phone}`,
          smsBody: `Hi ${firstName}, your Saturn Star estimate is ready. Reply here or call us at ${phone} to review it.`,
        }))
        break
      case 'booking_confirmed':
        setCompose(c => ({
          ...c,
          emailSubject: "You're booked — Saturn Star Moving",
          emailBody: `Hi ${firstName},\n\nYou're officially booked with Saturn Star Moving!\n\nWe'll confirm your crew and truck assignment 48 hours before your move.\n\nIf anything changes, just reach out: ${phone}\n\nLooking forward to moving day!\nSaturn Star Moving`,
          smsBody: `Hi ${firstName}, you're booked with Saturn Star! We'll confirm your crew 48 hrs before the move. Questions? Call/text ${phone}.`,
        }))
        break
      case 'day_before':
        setCompose(c => ({
          ...c,
          emailSubject: 'Move day is tomorrow — Saturn Star Moving',
          emailBody: `Hi ${firstName},\n\nJust a reminder — your move is tomorrow! Here's what to expect:\n\n• Your crew will arrive at the scheduled time\n• Please have any fragile or specialty items flagged\n• Ensure clear access at both addresses\n\nCall or text us if anything changes: ${phone}\n\nSee you tomorrow!\nSaturn Star Moving`,
          smsBody: `Hi ${firstName}, your Saturn Star move is TOMORROW! Crew will arrive on time. Any last-minute questions? Call/text ${phone}.`,
        }))
        break
    }
  }

  async function refresh(silent = false) {
    if (inboxRefreshInFlightRef.current) return
    inboxRefreshInFlightRef.current = true
    try {
      if (!silent) setLoading(true)
      const data = await fetchInboundLeads()
      setItems(data.items)
      setSummary(data.summary)
      // Keep current selection if still valid — never auto-open a different lead
      setSelectedId(current => (current && data.items.some(item => item.id === current) ? current : null))
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      inboxRefreshInFlightRef.current = false
      setLoading(false)
    }
  }

  async function markSelectedInboxRead(item: InboundLead) {
    const key = `inbound:${item.id}:${getInboundLatestAt(item)}`
    if (readStateRef.current.has(key) || !isInboundItemUnread(item)) return
    readStateRef.current.add(key)
    try {
      await markInboxRead({ inboundIds: [item.id] })
      await refresh(true)
    } catch {
      readStateRef.current.delete(key)
    }
  }

  async function markThreadRead(thread: SmsThread) {
    const key = `sms:${thread.contactPhone}:${thread.lastAt}`
    if (readStateRef.current.has(key) || !thread.unread) return
    readStateRef.current.add(key)
    try {
      await markInboxRead({
        smsThreads: [{ leadId: thread.leadId, inboundId: thread.inboundLeadId, channel: 'sms' }],
      })
      await fetchSmsThreads(true)
    } catch {
      readStateRef.current.delete(key)
    }
  }

  async function markEmailThreadRead(emailIds: string[], keySeed: string) {
    if (emailIds.length === 0) return
    const key = `email:${keySeed}:${emailIds.join(',')}`
    if (readStateRef.current.has(key)) return
    readStateRef.current.add(key)
    try {
      await markInboxRead({ emailIds })
      await fetchEmails(true)
    } catch {
      readStateRef.current.delete(key)
    }
  }

  async function markVisibleAsRead() {
    try {
      if (viewMode === 'messages') {
        const unreadThreads = filteredSmsThreads
          .filter(thread => thread.unread)
          .map(thread => ({ leadId: thread.leadId, inboundId: thread.inboundLeadId, channel: 'sms' as const }))
        if (unreadThreads.length === 0) return
        await markInboxRead({ smsThreads: unreadThreads })
        await fetchSmsThreads(true)
        return
      }

      if (viewMode === 'email') {
        const unreadEmailIds = emailList.filter(isUnreadEmail).map(email => email.id)
        if (unreadEmailIds.length === 0) return
        await markInboxRead({ emailIds: unreadEmailIds })
        await fetchEmails(true)
        return
      }

      const unreadInboundIds = filteredItems
        .filter(item => (item.inboxStatus || getInboundStatus(item, parseRawData(item.raw_data))) === 'needs_action')
        .filter(item => isInboundItemUnread(item))
        .map(item => item.id)
      if (unreadInboundIds.length === 0) return
      await markInboxRead({ inboundIds: unreadInboundIds })
      await refresh(true)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void refresh()
    void fetchSmsThreads(true)
    void fetchEmails(true)
  }, [])

  useEffect(() => {
    const tab = searchParams.get('tab')
    const phone = searchParams.get('phone')
    const emailId = searchParams.get('id')

    if (tab === 'sms') {
      setViewMode('messages')
      if (phone) setSelectedThread(phone)
      return
    }
    if (tab === 'email') {
      setViewMode('email')
      if (emailId) setSelectedEmailId(emailId)
      return
    }
    if (tab === 'calls') {
      setViewMode('calls')
      return
    }
    if (tab === 'webforms') {
      setViewMode('webforms')
      return
    }
  }, [searchParams])

  useEffect(() => {
    if (viewMode === 'messages') {
      void fetchSmsThreads()
    } else if (viewMode === 'email') {
      void fetchEmails()
    }
  }, [viewMode])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.hidden) return
      if (viewMode === 'messages') {
        void fetchSmsThreads(true)
        return
      }
      if (viewMode === 'email') {
        void fetchEmails(true)
        return
      }
      void refresh(true)
    }, 30000)
    return () => window.clearInterval(interval)
  }, [viewMode])

  const filteredItems = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase()
    let base = [...items]
    // Filter out internal health probes
    base = base.filter(item => {
      if (item.phone === '+15550001111' || item.phone === '5550001111') return false
      if (item.email?.includes('system.invalid')) return false
      if ((item.message || '').toLowerCase().includes('lead flow health')) return false
      return true
    })
    if (deferredViewMode === 'calls') {
      base = base.filter(item => item.source === 'twilio_call')
    } else if (deferredViewMode === 'webforms') {
      base = base.filter(item => {
        const status = item.inboxStatus || getInboundStatus(item, parseRawData(item.raw_data))
        return (item.source === 'website_form' || item.source === 'zapier') && (status === 'needs_action' || status === 'recent_handoff')
      })
    } else if (deferredViewMode === 'handoffs') {
      base = base.filter(item => (item.inboxStatus || getInboundStatus(item, parseRawData(item.raw_data))) === 'recent_handoff')
    } else if (deferredViewMode === 'closed') {
      base = base.filter(item => {
        const raw = parseRawData(item.raw_data)
        const status = item.inboxStatus || getInboundStatus(item, raw)
        const disposition = item.inboxDisposition || getInboundDisposition(item, raw)
        return status === 'closed' && (deferredClosedFilter === 'all' || disposition === deferredClosedFilter)
      })
    } else {
      base = base.filter(item => (item.inboxStatus || getInboundStatus(item, parseRawData(item.raw_data))) === 'needs_action')
    }
    if (deferredViewMode === 'queue') {
      base = base.filter(item => matchesInboundFocusFilter(item, deferredFocusFilter, parseRawData(item.raw_data)))
    }
    const searched = !query ? base : base.filter(item => {
      const raw = parseRawData(item.raw_data)
      const text = [
        displayLeadName(item),
        item.phone,
        item.email,
        item.message,
        raw?.routeText,
        raw?.originCity,
        raw?.destCity,
        raw?.transcript,
        raw?.aiSummary?.summary,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return text.includes(query)
    })
    if (deferredSortOrder === 'oldest') {
      return searched.sort((left, right) => {
        const leftRaw = parseRawData(left.raw_data)
        const rightRaw = parseRawData(right.raw_data)
        return new Date(getInboundActionTimestamp(left, leftRaw)).getTime() - new Date(getInboundActionTimestamp(right, rightRaw)).getTime()
      })
    }
    if (deferredSortOrder === 'priority') {
      return searched.sort((left, right) => {
        const leftRaw = parseRawData(left.raw_data)
        const rightRaw = parseRawData(right.raw_data)
        const scoreDiff = getLeadPriorityScore(right, rightRaw) - getLeadPriorityScore(left, leftRaw)
        if (scoreDiff !== 0) return scoreDiff
        return new Date(getInboundActionTimestamp(right, rightRaw)).getTime() - new Date(getInboundActionTimestamp(left, leftRaw)).getTime()
      })
    }
    // Default: recent first
    return searched.sort((left, right) => {
      const leftRaw = parseRawData(left.raw_data)
      const rightRaw = parseRawData(right.raw_data)
      return new Date(getInboundActionTimestamp(right, rightRaw)).getTime() - new Date(getInboundActionTimestamp(left, leftRaw)).getTime()
    })
  }, [deferredClosedFilter, deferredFocusFilter, items, deferredSearch, deferredViewMode, deferredSortOrder])

  // Filter + sort SMS threads
  // Customer-initiated (has inbound messages) shown first, outbound-only at bottom
  const filteredSmsThreads = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    let threads = smsThreads
    if (q && deferredViewMode === 'messages') {
      threads = threads.filter(thread => {
        const text = [thread.leadName, thread.contactPhone, thread.lastMessage, thread.branchLabel]
          .filter(Boolean).join(' ').toLowerCase()
        return text.includes(q)
      })
    }
    // Sort: inbound threads (customer texted us) before outbound-only
    return [...threads].sort((a, b) => {
      const aHasInbound = a.unreadCount > 0 || a.lastDirection === 'inbound'
      const bHasInbound = b.unreadCount > 0 || b.lastDirection === 'inbound'
      if (aHasInbound && !bHasInbound) return -1
      if (!aHasInbound && bHasInbound) return 1
      return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()
    })
  }, [smsThreads, deferredSearch, deferredViewMode])

  const selected = useMemo(() => filteredItems.find(item => item.id === selectedId) || null, [filteredItems, selectedId])
  const selectedRaw = useMemo(() => parseRawData(selected?.raw_data), [selected?.raw_data])
  const selectedBranch = useMemo(() => getInboundBranchMeta(selected), [selected])
  const selectedDisposition = useMemo(
    () => selected ? (selected.inboxDisposition || getInboundDisposition(selected, selectedRaw)) : 'open',
    [selected, selectedRaw]
  )
  const selectedStatus = useMemo(
    () => selected ? (selected.inboxStatus || getInboundStatus(selected, selectedRaw)) : null,
    [selected, selectedRaw]
  )
  const selectedActionMeta = useMemo(
    () => selected ? getLeadActionMeta(selected, selectedRaw) : null,
    [selected, selectedRaw]
  )
  const selectedHasRoute = useMemo(
    () => !!(
      selectedRaw?.originAddress ||
      selectedRaw?.originCity ||
      selectedRaw?.destAddress ||
      selectedRaw?.destCity ||
      selectedRaw?.distanceText
    ),
    [selectedRaw]
  )
  const selectedIsQrLead = useMemo(
    () => selected ? isQrOrDirectMailLead(selected, selectedRaw) : false,
    [selected, selectedRaw]
  )
  const selectedSmsThreadData = useMemo(
    () => smsThreads.find(thread => thread.contactPhone === selectedThread) || null,
    [selectedThread, smsThreads]
  )
  const aiSummary = selectedRaw?.aiSummary as
    | {
        summary?: string
        nextAction?: string
        moveReadiness?: 'hot' | 'warm' | 'cold'
        leadConcern?: string
        followUpReason?: string
      }
    | undefined
  const transcript = selectedRaw?.transcript as string | undefined
  const recordingUrl = (selectedRaw?.recordingUrl || selectedRaw?.recUrl) as string | undefined
  const recordingSid = selectedRaw?.recordingSid as string | undefined
  const recordingUnavailable = selectedRaw?.recordingUnavailable === true
  const recordingUnavailableReason = selectedRaw?.recordingUnavailableReason as string | undefined
  const shownCount = viewMode === 'messages' ? filteredSmsThreads.length : viewMode === 'email' ? emailList.length : filteredItems.length
  const sectionCounts = useMemo(() => {
    const probeFiltered = items.filter(item => {
      if (item.phone === '+15550001111' || item.phone === '5550001111') return false
      if (item.email?.includes('system.invalid')) return false
      if ((item.message || '').toLowerCase().includes('lead flow health')) return false
      return true
    })
    const live = probeFiltered.filter(item => (item.inboxStatus || getInboundStatus(item, parseRawData(item.raw_data))) === 'needs_action').length
    const calls = probeFiltered.filter(item => {
      const raw = parseRawData(item.raw_data)
      return (item.inboxStatus || getInboundStatus(item, raw)) === 'needs_action' && item.source === 'twilio_call'
    }).length
    const forms = probeFiltered.filter(item => {
      const status = item.inboxStatus || getInboundStatus(item, parseRawData(item.raw_data))
      return (item.source === 'website_form' || item.source === 'zapier') && (status === 'needs_action' || status === 'recent_handoff')
    }).length
    const inboundEmails = emailList.filter(isUnreadEmail).length
    const smsUnread = smsThreads.filter(item => item.unread).length
    return {
      live,
      calls,
      forms,
      sms: smsUnread,
      email: inboundEmails,
      handoffs: summary.recentHandoffs,
      closed: summary.closed,
    }
  }, [emailList, items, smsThreads, summary.closed, summary.recentHandoffs])
  const todayMetrics = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const startMs = start.getTime()
    const todayItems = items.filter(item => new Date(item.created_at).getTime() >= startMs)
    return {
      inbound: todayItems.length,
      calls: todayItems.filter(item => item.source === 'twilio_call').length,
      sms: todayItems.filter(item => item.source === 'twilio_sms').length,
      forms: todayItems.filter(item => {
        const raw = parseRawData(item.raw_data)
        return isWebInquiryLead(item, raw)
      }).length,
      emails: todayItems.filter(item => item.source === 'email').length,
    }
  }, [items])

  useEffect(() => {
    if (viewMode !== 'messages' || !selectedThread) return
    if (smsThreads.some(thread => thread.contactPhone === selectedThread)) return
    setSelectedThread(null)
  }, [selectedThread, smsThreads, viewMode])
  const unreadVisibleCount = useMemo(() => {
    if (viewMode === 'messages') return filteredSmsThreads.filter(thread => thread.unread).length
    if (viewMode === 'email') return emailList.filter(isUnreadEmail).length
    return filteredItems.filter(item => isInboundItemUnread(item)).length
  }, [emailList, filteredItems, filteredSmsThreads, viewMode])
  const selectedRoute = useMemo(
    () => ({
      origin:
        (selectedRaw?.originAddress as string | undefined) ||
        (selectedRaw?.originCity as string | undefined) ||
        'Origin TBD',
      destination:
        (selectedRaw?.destAddress as string | undefined) ||
        (selectedRaw?.destCity as string | undefined) ||
        'Destination TBD',
      distance: (selectedRaw?.distanceText as string | undefined) || 'Route pending',
      originAccess: (selectedRaw?.originAccess as string | undefined) || 'Access not confirmed',
      destinationAccess: (selectedRaw?.destAccess as string | undefined) || 'Access not confirmed',
    }),
    [selectedRaw]
  )
  const threadEvents = useMemo(() => {
    if (!selected) return []
    const base = [
      {
        id: `${selected.id}-captured`,
        actor: 'System',
        type: 'lead captured',
        time: selected.created_at,
        body: selected.message || 'New inbound lead captured.',
      },
    ]
    if (transcript) {
      base.push({
        id: `${selected.id}-transcript`,
        actor: 'Transcript',
        type: 'call transcript',
        time: selected.created_at,
        body: transcript,
      })
    }
    if (aiSummary?.summary) {
      base.push({
        id: `${selected.id}-ai-summary`,
        actor: 'AI',
        type: 'triage summary',
        time: selected.created_at,
        body: aiSummary.summary,
      })
    }
    return base
  }, [aiSummary?.summary, selected, transcript])

  useEffect(() => {
    if (!selected || viewMode === 'messages' || viewMode === 'email') return
    if ((selected.inboxStatus || getInboundStatus(selected, selectedRaw)) !== 'needs_action') return
    void markSelectedInboxRead(selected)
  }, [selected, selectedRaw, viewMode])

  useEffect(() => {
    if (viewMode !== 'messages' || !selectedSmsThreadData) return
    if (!selectedSmsThreadData.unread) return
    void markThreadRead(selectedSmsThreadData)
  }, [selectedSmsThreadData, viewMode])

  useEffect(() => {
    if (viewMode !== 'email' || !selectedEmailId) return
    const selectedEmail = emailList.find(email => email.id === selectedEmailId)
    if (!selectedEmail) return
    const contactEmail = selectedEmail.direction === 'inbound' ? selectedEmail.from : selectedEmail.to
    const unreadInboundIds = emailList
      .filter(email => {
        if (!isUnreadEmail(email)) return false
        if (selectedEmail.leadId && email.leadId) return email.leadId === selectedEmail.leadId
        const emailContact = email.direction === 'inbound' ? email.from : email.to
        return emailContact.toLowerCase() === contactEmail.toLowerCase()
      })
      .map(email => email.id)
    if (unreadInboundIds.length > 0) {
      void markEmailThreadRead(unreadInboundIds, selectedEmailId)
    }
  }, [emailList, selectedEmailId, viewMode])

  useEffect(() => {
    if (!selected || viewMode === 'messages' || viewMode === 'email') return
    const isCall = selected.source === 'twilio_call'
    const needsRefresh =
      isCall &&
      !selectedRaw?.recordingUrl &&
      !selectedRaw?.recordingSid &&
      !selectedRaw?.recordingUnavailable &&
      !selectedRaw?.transcript &&
      timeAgo(selected.created_at).includes('m ago')

    if (!needsRefresh) return

    const interval = window.setInterval(() => {
      void refresh()
    }, 5000)

    return () => window.clearInterval(interval)
  }, [selected, selectedRaw, viewMode])

  useEffect(() => {
    if (!selected) return
    const first = getLeadFirstName(selected)
    setCompose({
      emailSubject: 'Following up — Saturn Star Moving',
      emailBody: `Hi ${first},\n\nThanks for reaching out to Saturn Star Moving. We'd love to help with your move.\n\nCould you share your move date and the addresses involved so we can prepare the right estimate?\n\nBest,\nSaturn Star Moving`,
      smsBody: `Hi ${first}, thanks for contacting Saturn Star Moving. We can help with your move. What date and locations are you planning for?`,
    })
  }, [selected])

  // Deselect if the current item is no longer in the filtered list — but NEVER auto-open another
  useEffect(() => {
    setSelectedId(current => (current && filteredItems.some(item => item.id === current) ? current : null))
  }, [filteredItems])

  async function claimSelected() {
    if (!selected) return
    if (selected.linkedLeadId) {
      router.push(`/sales/leads/${selected.linkedLeadId}`)
      return
    }
    try {
      setBusy(true)
      const lead = await claimInboundLead({
        inboundId: selected.id,
        name: getClaimLeadName(selected),
        phone: selected.phone,
        email: selected.email,
        source: selected.source,
        notes: selected.message,
      })
      router.push(`/sales/leads/${lead.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function send(channel: 'email' | 'sms') {
    if (!selected) return
    const to = channel === 'email' ? selected.email : selected.phone
    const body = channel === 'email' ? compose.emailBody : compose.smsBody
    if (!to || !body) return
    try {
      setMessageBusy(true)
      await sendSalesMessage({
        channel,
        to,
        subject: channel === 'email' ? compose.emailSubject : undefined,
        body,
        inboundId: selected.id,
        fromNumber: channel === 'sms' ? selectedBranch.branchNumber : undefined,
        notes: `${channel === 'email' ? 'Inbox email reply sent' : 'Inbox SMS reply sent'} for inbound lead ${selected.id}.`,
      })
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setMessageBusy(false)
    }
  }

  async function markSelectedDisposition(action: 'junk' | 'lost' | 'not_interested') {
    if (!selected) return
    try {
      setDispositionBusy(action)
      await markInboundLeadDisposition(selected.id, action)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDispositionBusy(null)
    }
  }

  async function markSelectedHandled() {
    if (!selected) return
    try {
      setHandledBusy(true)
      await markInboundLeadHandled(selected.id)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setHandledBusy(false)
    }
  }

  async function restoreSelected() {
    if (!selected) return
    try {
      setRestoreBusy(true)
      await restoreInboundLead(selected.id)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRestoreBusy(false)
    }
  }

  async function fetchSmsThreads(silent = false) {
    if (smsThreadsInFlightRef.current) return
    smsThreadsInFlightRef.current = true
    try {
      if (!silent) setThreadsLoading(true)
      const res = await fetch('/api/sales/sms-threads', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json() as typeof smsThreads
        setSmsThreads(data)
        // Do not auto-open any thread — rep must click explicitly
      }
    } catch { /* non-fatal */ } finally {
      smsThreadsInFlightRef.current = false
      if (!silent) setThreadsLoading(false)
    }
  }

  async function uploadSmsMedia(file: File): Promise<string | null> {
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/sales/operations/upload-media', { method: 'POST', body: fd, credentials: 'include' })
      if (!res.ok) return null
      const data = (await res.json()) as { url?: string }
      return data.url || null
    } catch { return null }
  }

  async function sendSmsReply() {
    if (!selectedThread || (!smsReply.trim() && smsMediaFiles.length === 0)) return
    try {
      setSmsReplyBusy(true)
      const mediaUrls: string[] = []
      for (const file of smsMediaFiles) {
        const url = await uploadSmsMedia(file)
        if (url) mediaUrls.push(url)
      }
      await sendSalesMessage({
        channel: 'sms',
        to: selectedThread,
        body: smsReply.trim() || ' ',
        leadId: selectedSmsThreadData?.leadId || undefined,
        inboundId: selectedSmsThreadData?.inboundLeadId || undefined,
        fromNumber: selectedSmsThreadData?.businessNumber,
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
        notes: 'Reply from inbox messages view',
      })
      setSmsReply('')
      setSmsMediaFiles([])
      await fetchSmsThreads()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSmsReplyBusy(false)
    }
  }

  async function fetchEmails(silent = false) {
    if (emailsInFlightRef.current) return
    emailsInFlightRef.current = true
    try {
      if (!silent) setEmailLoading(true)
      const res = await fetch('/api/sales/emails', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json() as CRMEmail[]
        setEmailList(data)
        if (!selectedEmailId && data.length > 0) setSelectedEmailId(data[0].id)
      }
    } catch { /* non-fatal */ } finally {
      emailsInFlightRef.current = false
      if (!silent) setEmailLoading(false)
    }
  }

  async function sendEmailReply() {
    const selectedEmail = emailList.find(e => e.id === selectedEmailId)
    if (!selectedEmail || !emailReply.body.trim()) return
    const replyTo = selectedEmail.direction === 'inbound' ? selectedEmail.from : selectedEmail.to
    const threadEmailIds = emailList
      .filter(email => {
        if (email.direction !== 'inbound') return false
        if (selectedEmail.leadId && email.leadId) return email.leadId === selectedEmail.leadId
        const emailContact = email.direction === 'inbound' ? email.from : email.to
        return emailContact.toLowerCase() === replyTo.toLowerCase()
      })
      .map(email => email.id)
    try {
      setEmailReplyBusy(true)
      await sendSalesMessage({
        channel: 'email',
        to: replyTo,
        subject: emailReply.subject || `Re: ${selectedEmail.subject}`,
        body: emailReply.body,
        leadId: selectedEmail.leadId || undefined,
        quoteId: selectedEmail.quoteId || undefined,
        replyEmailIds: threadEmailIds,
      })
      setEmailReply({ subject: '', body: '' })
      await fetchEmails()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setEmailReplyBusy(false)
    }
  }

  return (
    <div className="crm-shell">
      <div className="h-[calc(100vh-40px)] overflow-hidden rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] flex flex-col">
        {error ? <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700 shrink-0">{error}</div> : null}
        {loading ? (
          <div className="flex-1 p-16 text-center text-sm text-[var(--app-muted)]">Loading lead inbox...</div>
        ) : (
          <div className="flex-1 min-h-0 min-w-0 md:flex">
            <section className={`${(selected || (viewMode === 'messages' && selectedThread) || (viewMode === 'email' && selectedEmailId)) ? 'hidden md:flex' : 'flex'} w-full flex-shrink-0 overflow-hidden border-r border-[var(--app-line)] bg-[var(--app-panel)] md:w-[470px] min-h-0`}>
              <div className="flex min-h-0 flex-1 h-full">
                <aside className="hidden w-[72px] shrink-0 flex-col border-r border-[var(--app-line)] bg-[var(--app-bg)] py-3 md:flex">
                  <div className="mb-3 px-3">
                    <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--app-muted)]">Inbox</div>
                  </div>
                  {([
                    { id: 'queue',    label: 'Live',     icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><circle cx="10" cy="10" r="3"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.05 5.05l1.41 1.41M13.54 13.54l1.41 1.41M5.05 14.95l1.41-1.41M13.54 6.46l1.41-1.41"/></svg>, count: sectionCounts.live },
                    { id: 'messages', label: 'SMS',      icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><path d="M3 4h14a1 1 0 011 1v8a1 1 0 01-1 1H6l-3 3V5a1 1 0 011-1z"/></svg>, count: sectionCounts.sms },
                    { id: 'calls',    label: 'Calls',    icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><path d="M3 4.5A1.5 1.5 0 014.5 3h1a1.5 1.5 0 011.5 1.5c0 1.128-.15 2.22-.435 3.255a1.5 1.5 0 01-.668.88l-.913.543a11.07 11.07 0 005.487 5.487l.543-.913a1.5 1.5 0 01.88-.668A14.15 14.15 0 0015.5 13a1.5 1.5 0 011.5 1.5v1A1.5 1.5 0 0115.5 17C8.596 17 3 11.404 3 4.5z"/></svg>, count: sectionCounts.calls },
                    { id: 'webforms', label: 'Forms',    icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><rect x="3" y="2" width="14" height="16" rx="2"/><path d="M7 6h6M7 10h6M7 14h4"/></svg>, count: sectionCounts.forms },
                    { id: 'email',    label: 'Email',    icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><rect x="2" y="4" width="16" height="12" rx="2"/><path d="M2 7l8 5 8-5"/></svg>, count: sectionCounts.email },
                    { id: 'handoffs', label: 'Pipeline', icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><circle cx="4" cy="10" r="2"/><circle cx="10" cy="10" r="2"/><circle cx="16" cy="10" r="2"/><path d="M6 10h2M12 10h2"/></svg>, count: sectionCounts.handoffs },
                    { id: 'closed',   label: 'Closed',   icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><path d="M5 10l4 4 6-7"/><rect x="2" y="2" width="16" height="16" rx="3"/></svg>, count: sectionCounts.closed },
                  ] as { id: 'queue'|'messages'|'calls'|'webforms'|'email'|'handoffs'|'closed'; label: string; icon: React.ReactNode; count: number }[]).map(tab => {
                    const active = viewMode === tab.id
                    return (
                      <button
                        key={tab.id}
                        onClick={() => startTransition(() => setViewMode(tab.id))}
                        title={tab.label}
                        className={`relative mb-1 mx-2 flex flex-col items-center gap-1 rounded-[10px] border px-1 py-2.5 transition ${
                          active
                            ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
                            : 'border-transparent text-[var(--app-muted)] hover:border-[var(--app-line)] hover:bg-white hover:text-[var(--app-ink)]'
                        }`}
                      >
                        <span className="flex items-center justify-center">{tab.icon}</span>
                        <span className="text-[9px] font-semibold leading-none">{tab.label}</span>
                        {tab.count > 0 && (
                          <span className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold ${active ? 'bg-[var(--app-accent)] text-white' : 'bg-rose-500 text-white'}`}>
                            {tab.count > 99 ? '99+' : tab.count}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </aside>

                <div className="flex min-h-0 flex-1 flex-col">
                  {/* ── Compact header ── */}
                  <div className="shrink-0 border-b border-[var(--app-line)] px-4 py-3 space-y-2.5">

                    {/* Title row + today stats */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-base font-bold text-[var(--app-ink)]">Inbox</span>
                        <span className="text-xs text-[var(--app-muted)]">
                          {todayMetrics.inbound} today
                          {todayMetrics.calls > 0 ? ` · ${todayMetrics.calls} calls` : ''}
                          {todayMetrics.sms > 0 ? ` · ${todayMetrics.sms} SMS` : ''}
                          {todayMetrics.forms > 0 ? ` · ${todayMetrics.forms} forms` : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {unreadVisibleCount > 0 ? (
                          <button onClick={() => void markVisibleAsRead()} className="rounded-full border border-[var(--app-line)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--app-ink)] transition hover:border-[var(--app-ink)]">
                            Mark all read
                          </button>
                        ) : null}
                        <span className="text-xs font-semibold text-[var(--app-muted)]">
                          {shownCount} shown{unreadVisibleCount > 0 ? ` · ${unreadVisibleCount} unread` : ''}
                        </span>
                      </div>
                    </div>

                    {/* Mobile tab row */}
                    <div className="flex gap-1.5 overflow-x-auto pb-0.5 md:hidden">
                      {([
                        { id: 'queue', label: 'Live', count: sectionCounts.live },
                        { id: 'messages', label: 'SMS', count: sectionCounts.sms },
                        { id: 'calls', label: 'Calls', count: sectionCounts.calls },
                        { id: 'webforms', label: 'Forms', count: sectionCounts.forms },
                        { id: 'email', label: 'Email', count: sectionCounts.email },
                        { id: 'handoffs', label: 'Pipeline', count: sectionCounts.handoffs },
                        { id: 'closed', label: 'Closed', count: sectionCounts.closed },
                      ] as const).map(tab => (
                        <button key={tab.id} onClick={() => startTransition(() => setViewMode(tab.id))}
                          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition ${viewMode === tab.id ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]' : 'border-[var(--app-line)] text-[var(--app-muted)]'}`}>
                          {tab.label}{tab.count > 0 ? <span className="ml-1 opacity-70">{tab.count}</span> : null}
                        </button>
                      ))}
                    </div>

                    {/* Focus filters — live queue only */}
                    {viewMode === 'queue' && (
                      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                        {([
                          { id: 'needs_action', label: 'Needs action', count: summary.focus.needs_action },
                          { id: 'web_qr',       label: 'Web / QR',    count: summary.focus.web_qr },
                          { id: 'calls',        label: 'Calls',       count: summary.focus.calls },
                          { id: 'high_intent',  label: 'High intent', count: summary.focus.high_intent },
                          { id: 'answered',     label: 'Answered',    count: summary.focus.answered },
                        ] as const).map(f => (
                          <button key={f.id} onClick={() => setFocusFilter(f.id)}
                            className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition ${focusFilter === f.id ? 'border-[var(--app-accent)] bg-[rgba(15,106,83,0.08)] text-[var(--app-accent)]' : 'border-[var(--app-line)] text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
                            {f.label} <span className="opacity-60">{f.count}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Closed filters */}
                    {viewMode === 'closed' && (
                      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                        {([
                          { id: 'all',            label: 'All',          count: summary.closedByDisposition.all },
                          { id: 'junk',           label: 'Junk',         count: summary.closedByDisposition.junk },
                          { id: 'lost',           label: 'Lost',         count: summary.closedByDisposition.lost },
                          { id: 'not_interested', label: 'Not interested',count: summary.closedByDisposition.not_interested },
                        ] as const).map(f => (
                          <button key={f.id} onClick={() => setClosedFilter(f.id)}
                            className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition ${closedFilter === f.id ? 'border-[var(--app-accent)] bg-[rgba(15,106,83,0.08)] text-[var(--app-accent)]' : 'border-[var(--app-line)] text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
                            {f.label} <span className="opacity-60">{f.count}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Search + sort */}
                    <div className="flex items-center gap-2">
                      <input
                        className="crm-input flex-1 text-sm"
                        placeholder="Search name, phone, email..."
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                      />
                      <select
                        value={sortOrder}
                        onChange={e => startTransition(() => setSortOrder(e.target.value as typeof sortOrder))}
                        className="crm-input w-28 shrink-0 text-xs"
                      >
                        <option value="recent">Newest</option>
                        <option value="oldest">Oldest</option>
                        <option value="priority">Priority</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto bg-[var(--app-panel)]">
                {/* Speed-to-lead: flash new unattended leads at the very top */}
                {viewMode !== 'email' && viewMode !== 'messages' && viewMode !== 'closed' && (() => {
                  void tick
                  const fresh = items.filter(item => {
                    if (item.phone === '+15550001111' || item.email?.includes('system.invalid')) return false
                    const status = item.inboxStatus || getInboundStatus(item, parseRawData(item.raw_data))
                    if (status !== 'needs_action') return false
                    const secs = secondsSince(item.created_at)
                    return secs < 1800 // within 30 min
                  })
                  if (fresh.length === 0) return null
                  return (
                    <div className="sticky top-0 z-20 border-b-2 border-rose-500 bg-rose-600 px-3 py-2.5 flex items-center gap-2">
                      <span className="animate-ping h-2 w-2 rounded-full bg-white opacity-90 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-bold text-white uppercase tracking-wide">
                          🚨 {fresh.length} new lead{fresh.length > 1 ? 's' : ''} just in — respond before anything else
                        </span>
                        <div className="text-[10px] text-rose-100 mt-0.5">
                          {fresh.map(i => i.matchedLeadName || i.name || i.phone || 'Unknown').slice(0, 3).join(' · ')}
                          {fresh.length > 3 ? ` + ${fresh.length - 3} more` : ''}
                        </div>
                      </div>
                    </div>
                  )
                })()}
                {viewMode === 'email' ? (
                  emailLoading ? (
                    <div className="p-6 text-sm text-[var(--app-muted)]">Loading emails...</div>
                  ) : emailList.length === 0 ? (
                    <div className="p-6 text-sm text-[var(--app-muted)]">No emails yet. Sent and received emails will appear here.</div>
                  ) : emailList.map(em => (
                    <button
                      key={em.id}
                      onClick={() => {
                        setSelectedEmailId(em.id)
                        setEmailReply({ subject: replyEmailSubject(em.subject), body: '' })
                      }}
                      className={`relative block w-full border-b border-[var(--app-line)] p-4 text-left transition ${selectedEmailId === em.id ? 'bg-[rgba(15,106,83,0.05)]' : 'bg-[var(--app-panel)] hover:bg-[var(--app-bg)]'}`}
                    >
                      {(() => {
                        const unread = isUnreadEmail(em)
                        return (
                          <>
                      {selectedEmailId === em.id ? <div className="absolute bottom-0 left-0 top-0 w-1 bg-[var(--app-accent)]" /> : null}
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--app-warm)]" />}
                          <span className={`truncate text-sm font-semibold ${unread ? 'text-[var(--app-ink)]' : 'text-[var(--app-muted)]'}`}>
                            {em.direction === 'inbound' ? em.from : em.to}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs text-[var(--app-muted)]">{timeAgo(em.sentAt)}</span>
                      </div>
                      <p className="text-sm font-medium text-[var(--app-ink)] line-clamp-1">{displayEmailSubject(em.subject)}</p>
                      <p className="mt-0.5 text-xs text-[var(--app-muted)] line-clamp-1">{em.body?.slice(0, 120)}</p>
                      <div className="mt-2 flex gap-2">
                        <span className={`rounded-[4px] border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${em.direction === 'inbound' ? 'border-[var(--app-warm)] bg-[rgba(245,166,35,0.1)] text-[var(--app-warm)]' : 'border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-muted)]'}`}>
                          {em.direction === 'inbound' ? '← Received' : '→ Sent'}
                        </span>
                        {em.templateType && (
                          <span className="rounded-[4px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--app-muted)]">
                            {em.templateType.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                          </>
                        )
                      })()}
                    </button>
                  ))
                ) : viewMode === 'messages' ? (
                  <>
                  <div className="border-b border-[var(--app-line)] px-3 py-2 flex items-center gap-2">
                    {smsNewChatOpen ? (
                      <div className="flex flex-1 gap-1.5">
                        <input autoFocus value={smsNewChatPhone} onChange={e => setSmsNewChatPhone(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && smsNewChatPhone.trim()) { const d = smsNewChatPhone.replace(/\D/g,''); const p = d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : smsNewChatPhone; setSelectedThread(p); setSmsNewChatOpen(false); setSmsNewChatPhone('') } if (e.key === 'Escape') setSmsNewChatOpen(false) }}
                          placeholder="Enter phone number..." className="crm-input flex-1 text-xs py-1" />
                        <button onClick={() => setSmsNewChatOpen(false)} className="text-[10px] text-[var(--app-muted)] px-1">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setSmsNewChatOpen(true)} className="ml-auto rounded-[5px] bg-[var(--app-accent)] px-2.5 py-1 text-[10px] font-semibold text-white hover:opacity-90">+ New</button>
                    )}
                  </div>
                  {threadsLoading ? (
                    <div className="p-6 text-sm text-[var(--app-muted)]">Loading conversations...</div>
                  ) : filteredSmsThreads.length === 0 ? (
                    <div className="p-6 text-sm text-[var(--app-muted)]">No SMS conversations yet. Tap + New to start one.</div>
                  ) : filteredSmsThreads.map(thread => {
                    const hasInbound = thread.unreadCount > 0 || thread.lastDirection === 'inbound'
                    const outboundOnly = !hasInbound
                    return (
                    <button
                      key={thread.contactPhone}
                      onClick={() => startTransition(() => setSelectedThread(thread.contactPhone))}
                      className={`relative block w-full border-b border-[var(--app-line)] px-3 py-3 text-left transition ${selectedThread === thread.contactPhone ? 'bg-[rgba(15,106,83,0.05)]' : outboundOnly ? 'bg-[var(--app-bg)] opacity-70 hover:opacity-100' : 'bg-[var(--app-panel)] hover:bg-[var(--app-bg)]'}`}
                    >
                      {selectedThread === thread.contactPhone ? <div className="absolute bottom-0 left-0 top-0 w-[3px] bg-[var(--app-accent)]" /> : null}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          {thread.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--app-accent)]" />}
                          <span className={`truncate text-sm font-semibold ${thread.unread ? 'text-[var(--app-ink)]' : 'text-[var(--app-muted)]'}`}>
                            {thread.leadName || formatPhoneDisplay(thread.contactPhone)}
                          </span>
                          {thread.unreadCount > 0 && (
                            <span className="shrink-0 rounded-full bg-[var(--app-accent)] px-1.5 text-[9px] font-bold text-white">{thread.unreadCount}</span>
                          )}
                          {!thread.unread && thread.lastReadAt ? (
                            <span className="shrink-0 rounded-[3px] bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
                              Read{thread.lastReadByName ? ` · ${thread.lastReadByName}` : ''}
                            </span>
                          ) : null}
                          {outboundOnly && (
                            <span className="shrink-0 rounded-[3px] bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">No reply</span>
                          )}
                        </div>
                        <span className="shrink-0 text-[10px] text-[var(--app-muted)]">{timeAgo(thread.lastAt)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--app-muted)]">
                        {thread.leadName && <span className="truncate">{formatPhoneDisplay(thread.contactPhone)}</span>}
                        {thread.leadStage && <span className="shrink-0 capitalize opacity-60">{thread.leadStage.replace(/_/g, ' ')}</span>}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--app-muted)] opacity-70">{thread.lastMessage || '—'}</p>
                    </button>
                  )})}
                  </>
                ) : filteredItems.length === 0 ? (
                  <div className="p-6 text-sm text-[var(--app-muted)]">
                    {search.trim() ? 'No conversations match this search.' : 'No conversations in this view.'}
                  </div>
                ) : (() => {
                  // Urgency banner: count hot unresponded leads
                  void tick // reference tick so urgency rerenders live
                  const hotLeads = filteredItems.filter(item => {
                    const status = item.inboxStatus || getInboundStatus(item, parseRawData(item.raw_data))
                    if (status !== 'needs_action') return false
                    const secs = secondsSince(item.created_at)
                    const tier = urgencyTier(secs)
                    return tier === 'urgent' || tier === 'overdue'
                  })
                  return (
                    <>
                      {hotLeads.length > 0 && (
                        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-rose-200 bg-rose-600 px-3 py-2 text-white">
                          <span className="animate-pulse text-base">🔴</span>
                          <span className="text-[11px] font-bold uppercase tracking-wide">
                            {hotLeads.length} lead{hotLeads.length > 1 ? 's' : ''} waiting — respond now
                          </span>
                        </div>
                      )}
                      {filteredItems.map(item => {
                        const raw = parseRawData(item.raw_data)
                        const selectedState = item.id === selectedId
                        const actionMeta = getLeadActionMeta(item, raw)
                        const status = item.inboxStatus || getInboundStatus(item, raw)
                        const unread = isInboundItemUnread(item)
                        const readMeta = getInboundReadMeta(item)
                        const lowPriority = status !== 'needs_action'
                        const qrLead = isQrOrDirectMailLead(item, raw)
                        const { branchLabel, trackingLabel } = getInboundBranchMeta(item)
                        const trackingBadgeLabel = qrLead ? 'QR / Direct Mail' : trackingLabel

                        // Speed-to-lead urgency
                        const secs = status === 'needs_action' ? secondsSince(item.created_at) : Infinity
                        const tier = urgencyTier(secs)

                        const urgencyBorder = ''

                        const urgencyBg =
                          !selectedState && tier === 'live' ? 'bg-emerald-50/60' :
                          !selectedState && tier === 'warning' ? 'bg-amber-50/60' :
                          !selectedState && (tier === 'urgent' || tier === 'overdue') ? 'bg-rose-50/60' : ''

                        return (
                          <button
                            key={item.id}
                            onClick={() => setSelectedId(item.id)}
                            className={`relative block w-full border-b border-[var(--app-line)] px-3 py-3 text-left transition ${urgencyBorder} ${urgencyBg} ${selectedState ? 'bg-[rgba(15,106,83,0.05)]' : 'hover:bg-[var(--app-bg)]'} ${lowPriority ? 'opacity-60' : ''}`}
                          >
                            {selectedState ? <div className="absolute inset-x-0 top-0 h-[2px] bg-[var(--app-accent)]" /> : null}
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-1.5">
                                {tier === 'live' && !selectedState
                                  ? <span className="relative flex h-2 w-2 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
                                  : tier === 'warning' && !selectedState
                                    ? <span className="relative flex h-2 w-2 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" /></span>
                                    : (tier === 'urgent' || tier === 'overdue') && !selectedState
                                      ? <span className="relative flex h-2 w-2 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" /></span>
                                      : status === 'needs_action' && unread && !selectedState
                                        ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--app-accent)]" />
                                        : null}
                                <span className={`truncate text-sm font-semibold ${status === 'needs_action' && unread ? 'text-[var(--app-ink)]' : 'text-[var(--app-muted)]'}`}>{displayLeadName(item)}</span>
                                {item.matchedLeadId && <span className="shrink-0 rounded-[3px] bg-sky-100 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700">EXISTING</span>}
                                {!unread && readMeta?.lastReadAt ? (
                                  <span className="shrink-0 rounded-[3px] bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
                                    Read{readMeta.lastReadByName ? ` · ${readMeta.lastReadByName}` : ''}
                                  </span>
                                ) : null}
                              </div>
                              {/* Live urgency timer or regular timestamp */}
                              {tier === 'live' && !selectedState ? (
                                <span className="shrink-0 rounded-[3px] bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase tracking-wide">LIVE · {liveTimer(secs)}</span>
                              ) : tier === 'warning' && !selectedState ? (
                                <span className="shrink-0 rounded-[3px] bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase tracking-wide">⚠ {liveTimer(secs)}</span>
                              ) : tier === 'urgent' && !selectedState ? (
                                <span className="shrink-0 rounded-[3px] bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase tracking-wide">⚠ URGENT · {liveTimer(secs)}</span>
                              ) : tier === 'overdue' && !selectedState ? (
                                <span className="shrink-0 rounded-[3px] bg-rose-700 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase tracking-wide">OVERDUE · {liveTimer(secs)}</span>
                              ) : (
                                <span className="shrink-0 text-[10px] text-[var(--app-muted)]">{timeAgo(getInboundActionTimestamp(item, raw))}</span>
                              )}
                            </div>
                            <p className="mt-0.5 line-clamp-1 text-xs text-[var(--app-muted)]">
                              {getLeadHeadline(item, raw)}
                            </p>
                            <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--app-muted)] opacity-70">
                              {getLeadSummary(item, raw)}
                            </p>
                            <span className={`rounded-[3px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${actionMeta.className}`}>
                              {actionMeta.label}
                            </span>
                          </button>
                        )
                      })}
                    </>
                  )
                })()}
	                  </div>
	                </div>
	              </div>
	            </section>

            <section className={`${selected || (viewMode === 'messages' && selectedThread) || (viewMode === 'email' && selectedEmailId) ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 overflow-hidden flex-col bg-[var(--app-bg)]`}>
              {viewMode === 'email' ? (
                (() => {
                  const em = emailList.find(e => e.id === selectedEmailId)
                  if (!em) return <div className="flex-1 p-16 text-center text-sm text-[var(--app-muted)]">Select an email.</div>

                  // Thread: same leadId if available, else match by contact email
                  const contactEmail = em.direction === 'inbound' ? em.from : em.to
                  const threadEmails = emailList.filter(e => {
                    if (em.leadId && e.leadId) return e.leadId === em.leadId
                    const c = e.direction === 'inbound' ? e.from : e.to
                    return c.toLowerCase() === contactEmail.toLowerCase()
                  }).sort((a, b) => a.sentAt < b.sentAt ? 1 : -1) // newest first

                  const latestInbound = threadEmails.find(e => e.direction === 'inbound')
                  const replyTo = em.direction === 'inbound' ? em.from : em.to

                  return (
                    <div className="flex min-w-0 flex-1 flex-col min-h-0">
                      {/* Header */}
                      <div className="sticky top-0 z-10 border-b border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-3">
                        <button onClick={() => setSelectedEmailId(null)} className="crm-button mb-2 px-3 md:hidden">← Back</button>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <h2 className="text-base font-semibold text-[var(--app-ink)] line-clamp-1">
                              {displayEmailSubject(em.subject).replace(/^Re:\s*/i, '')}
                            </h2>
                            <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--app-muted)]">
                              <span>{replyTo}</span>
                              <span>·</span>
                              <span>{threadEmails.length} message{threadEmails.length !== 1 ? 's' : ''}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {em.leadId && (
                              <a href={`/sales/leads/${em.leadId}`} className="crm-button text-xs">View Lead →</a>
                            )}
                          </div>
                        </div>
                        {/* New reply banner */}
                        {latestInbound && isUnreadEmail(latestInbound) && (
                          <div className="mt-2 flex items-center gap-2 rounded-[6px] border border-[var(--app-warm)] bg-[rgba(245,166,35,0.08)] px-3 py-1.5">
                            <span className="text-sm">✉️</span>
                            <span className="text-xs font-medium text-[var(--app-warm)]">
                              New reply from {latestInbound.from} · {timeAgo(latestInbound.sentAt)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Thread — newest first */}
                      <div className="flex-1 overflow-y-auto divide-y divide-[var(--app-line)]">
                        {threadEmails.map((msg, idx) => (
                          <div key={msg.id} className={`${msg.direction === 'inbound' ? 'bg-[rgba(245,166,35,0.04)]' : 'bg-[var(--app-panel)]'}`}>
                            <div className="flex items-start gap-3 px-5 py-4">
                              {/* Avatar */}
                              <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${msg.direction === 'inbound' ? 'bg-[var(--app-ink)]' : 'bg-[var(--app-accent)]'}`}>
                                {msg.direction === 'inbound' ? msg.from.slice(0, 1).toUpperCase() : 'S'}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <span className="text-sm font-semibold text-[var(--app-ink)]">
                                      {msg.direction === 'inbound' ? msg.from : 'Saturn Star Movers'}
                                    </span>
                                    <span className="ml-2 text-xs text-[var(--app-muted)]">
                                      {msg.direction === 'inbound' ? '→ business@starmovers.ca' : `→ ${msg.to}`}
                                    </span>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <span className="text-xs text-[var(--app-muted)]">{formatAbsoluteTime(msg.sentAt)}</span>
                                    {idx === 0 && msg.direction === 'inbound' && isUnreadEmail(msg) && (
                                      <span className="rounded-[4px] border border-[var(--app-warm)] bg-[rgba(245,166,35,0.1)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--app-warm)]">New</span>
                                    )}
                                  </div>
                                </div>
                                <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[var(--app-ink)]">{msg.body}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Reply composer */}
                      <div className="border-t-2 border-[var(--app-line)] bg-[var(--app-panel)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-xs font-semibold text-[var(--app-ink)]">
                            Reply to <span className="text-[var(--app-accent)]">{replyTo}</span>
                          </div>
                          <span className="text-xs text-[var(--app-muted)]">Cmd+Enter to send</span>
                        </div>
                        <textarea
                          className="crm-input w-full resize-none"
                          rows={3}
                          placeholder={`Reply to ${replyTo}…`}
                          value={emailReply.body}
                          onChange={e => setEmailReply(r => ({ ...r, body: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendEmailReply() }}
                        />
                        <div className="mt-2 flex items-center justify-between">
                          <input
                            className="crm-input max-w-xs text-xs"
                            placeholder="Subject"
                            value={emailReply.subject}
                            onChange={e => setEmailReply(r => ({ ...r, subject: e.target.value }))}
                          />
                          <button
                            onClick={() => void sendEmailReply()}
                            disabled={emailReplyBusy || !emailReply.body.trim()}
                            className="crm-button-dark disabled:opacity-50"
                          >
                            {emailReplyBusy ? 'Sending…' : '↑ Send'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })()
              ) : viewMode === 'messages' ? (
                // ── 2-WAY SMS THREAD VIEW ───────────────────────────────────
                (() => {
                  const thread = smsThreads.find(t => t.contactPhone === selectedThread)
                  if (!thread) return <div className="flex-1 p-16 text-center text-sm text-[var(--app-muted)]">Select a conversation.</div>
                  return (
                    <div className="flex min-w-0 flex-1 flex-col min-h-0">
                      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--app-line)] bg-[var(--app-panel)] px-4 py-4">
                        <button onClick={() => setSelectedThread(null)} className="crm-button px-3 md:hidden">Back</button>
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(15,106,83,0.1)] text-sm font-bold text-[var(--app-accent)]">
                          {(thread.leadName || thread.contactPhone).slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-base font-semibold text-[var(--app-ink)]">{thread.leadName || formatPhoneDisplay(thread.contactPhone)}</div>
                            {thread.leadStage ? (
                              <span className="rounded-[4px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--app-muted)]">
                                {thread.leadStage.replace(/_/g, ' ')}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs text-[var(--app-muted)]">
                            {thread.leadName ? `${formatPhoneDisplay(thread.contactPhone)} • ` : ''}
                            {thread.messages.length} messages
                            {thread.branchLabel ? ` • replying as ${thread.branchLabel}` : ''}
                            {thread.trackingLabel ? ` • ${thread.trackingLabel}` : ''}
                            {thread.lastReadAt ? ` • read ${timeAgo(thread.lastReadAt)}${thread.lastReadByName ? ` by ${thread.lastReadByName}` : ''}` : ''}
                          </div>
                        </div>
                        {thread.leadId && (
                          <a href={`/sales/leads/${thread.leadId}`} className="ml-auto crm-button text-xs">View Lead →</a>
                        )}
                      </div>
                      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2 px-4 py-4">
                        {thread.messages.map(msg => (
                          <div key={msg.id} className={`flex min-w-0 ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[75%] min-w-0 rounded-[18px] px-3.5 py-2.5 text-sm shadow-sm ${msg.direction === 'outbound' ? 'rounded-br-[4px] bg-[#0b84ff] text-white' : 'rounded-bl-[4px] bg-[#e9e9eb] text-[#1c1c1e]'}`}>
                              <p className="whitespace-pre-wrap break-words break-all">{msg.body}</p>
                              <p className={`mt-1 text-[10px] ${msg.direction === 'outbound' ? 'text-white/60' : 'text-[#8e8e93]'}`}>
                                {new Date(msg.created_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="shrink-0 border-t border-[var(--app-line)] bg-[var(--app-panel)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                        {thread.branchLabel ? (
                          <div className="mb-2 text-xs text-[var(--app-muted)]">
                            Outbound replies go out from <span className="font-semibold text-[var(--app-ink)]">{thread.branchLabel}</span> ({thread.businessNumber}).
                            {thread.trackingLabel ? <span className="ml-1">Tracking: <span className="font-semibold text-[var(--app-ink)]">{thread.trackingLabel}</span>.</span> : null}
                          </div>
                        ) : null}
                        <input ref={smsFileInputRef} type="file" accept="image/*,video/*" multiple className="hidden"
                          onChange={e => { if (e.target.files) setSmsMediaFiles(fs => [...fs, ...Array.from(e.target.files!)]) }} />
                        {smsMediaFiles.length > 0 && (
                          <div className="mb-2 flex gap-2 flex-wrap">
                            {smsMediaFiles.map((f, i) => (
                              <div key={i} className="relative">
                                {f.type.startsWith('image/') ? (
                                  <img src={URL.createObjectURL(f)} alt={f.name} className="h-14 w-14 rounded-[6px] object-cover" />
                                ) : (
                                  <div className="h-14 w-14 rounded-[6px] bg-[var(--app-bg)] flex items-center justify-center text-[9px] text-[var(--app-muted)] text-center px-1">{f.name.slice(0,10)}</div>
                                )}
                                <button onClick={() => setSmsMediaFiles(fs => fs.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">×</button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2 items-end">
                          <button onClick={() => smsFileInputRef.current?.click()} title="Attach image or video"
                            className="shrink-0 rounded-[6px] border border-[var(--app-line)] bg-white px-2 py-1.5 text-base hover:bg-[var(--app-bg)] transition">📎</button>
                          <textarea
                            className="crm-input flex-1 resize-none"
                            rows={2}
                            placeholder={smsMediaFiles.length > 0 ? 'Add a caption...' : 'Type a reply...'}
                            value={smsReply}
                            onChange={e => setSmsReply(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendSmsReply() }}
                          />
                          <button
                            onClick={() => void sendSmsReply()}
                            disabled={smsReplyBusy || (!smsReply.trim() && smsMediaFiles.length === 0)}
                            className="crm-button-dark self-end disabled:opacity-50"
                          >
                            {smsReplyBusy ? '...' : 'Send'}
                          </button>
                        </div>
                        <p className="mt-1.5 text-xs text-[var(--app-muted)]">Cmd+Enter to send · 📎 to attach image/video</p>
                      </div>
                    </div>
                  )
                })()
              ) : !selected ? (
                <div className="flex-1 overflow-y-auto p-16 text-center text-sm text-[var(--app-muted)]">Select an inbound lead.</div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                <div className="min-h-full">
                  <div className="sticky top-0 z-10 flex flex-col gap-4 border-b border-[var(--app-line)] bg-[var(--app-panel)] px-4 py-4 md:flex-row md:items-center md:justify-between md:px-8">
                    <div className="flex items-center gap-3 md:gap-4">
                      <button onClick={() => setSelectedId(null)} className="crm-button px-3 md:hidden">
                        Back
                      </button>
                      <div className="flex h-12 w-12 items-center justify-center rounded-[6px] bg-[rgba(15,106,83,0.1)] text-xl font-semibold text-[var(--app-accent)]">
                        {getLeadAvatarText(selected)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-semibold text-[var(--app-ink)]">{displayLeadName(selected)}</h2>
                          {selected.matchedLeadId && !selected.linkedLeadId ? (
                            <span className="rounded-[4px] border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700">
                              Existing Lead
                            </span>
                          ) : null}
                          {selectedBranch.branchLabel ? (
                            <span className="rounded-[4px] border border-[rgba(15,106,83,0.2)] bg-[rgba(15,106,83,0.08)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--app-accent)]">
                              {selectedBranch.branchLabel}
                            </span>
                          ) : null}
                          {selectedIsQrLead ? (
                            <span className="rounded-[4px] border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                              QR / Direct Mail
                            </span>
                          ) : selectedBranch.trackingLabel ? (
                            <span className="rounded-[4px] border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                              {selectedBranch.trackingLabel}
                            </span>
                          ) : null}
                          {selectedActionMeta ? (
                            <span className={`rounded-[4px] border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${selectedActionMeta.className}`}>
                              {selectedStatus === 'recent_handoff' ? 'Recent Handoff' : selectedActionMeta.label}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--app-muted)]">
                          <span>{SOURCE_LABELS[selected.source] || selected.source}</span>
                          {(selected.email || (selected.phone && (selected.name || (selected.source !== 'twilio_call' && selected.source !== 'missed_call')))) ? <span>•</span> : null}
                          {selected.email ? <span>{selected.email}</span> : null}
                          {selected.email && selected.phone && (selected.name || (selected.source !== 'twilio_call' && selected.source !== 'missed_call')) ? <span>•</span> : null}
                          {selected.phone && (selected.name || (selected.source !== 'twilio_call' && selected.source !== 'missed_call')) ? <span>{formatPhoneDisplay(selected.phone)}</span> : null}
                        </div>
                        {!isInboundItemUnread(selected) && getInboundReadMeta(selected)?.lastReadAt ? (
                          <div className="mt-1 text-xs text-[var(--app-muted)]">
                            Read {timeAgo(getInboundReadMeta(selected)?.lastReadAt || '')}
                            {getInboundReadMeta(selected)?.lastReadByName ? ` by ${getInboundReadMeta(selected)?.lastReadByName}` : ''}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-col items-start gap-2 md:items-end">
                      <div className="flex flex-wrap gap-3">
                        {selectedStatus === 'closed' ? (
                          <button onClick={() => void restoreSelected()} disabled={restoreBusy} className="crm-button">
                            {restoreBusy ? 'Restoring...' : 'Restore'}
                          </button>
                        ) : selected.linkedLeadId ? (
                          <>
                            <button onClick={() => router.push(`/sales/leads/${selected.linkedLeadId}`)} className="crm-button">
                              Open Lead
                            </button>
                            <button
                              onClick={() => void markSelectedHandled()}
                              disabled={handledBusy}
                              className="crm-button"
                            >
                              {handledBusy ? 'Saving...' : 'Handled ✓'}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => void markSelectedHandled()}
                              disabled={handledBusy || dispositionBusy !== null}
                              className="crm-button"
                            >
                              {handledBusy ? 'Saving...' : 'Handled ✓'}
                            </button>
                            <button
                              onClick={() => void markSelectedDisposition('junk')}
                              disabled={dispositionBusy !== null || handledBusy}
                              className="crm-button"
                            >
                              {dispositionBusy === 'junk' ? 'Saving...' : 'Junk'}
                            </button>
                            <button
                              onClick={() => void markSelectedDisposition('not_interested')}
                              disabled={dispositionBusy !== null || handledBusy}
                              className="crm-button"
                            >
                              {dispositionBusy === 'not_interested' ? 'Saving...' : 'Not Interested'}
                            </button>
                            <button
                              onClick={() => void markSelectedDisposition('lost')}
                              disabled={dispositionBusy !== null || handledBusy}
                              className="crm-button"
                            >
                              {dispositionBusy === 'lost' ? 'Saving...' : 'Lost'}
                            </button>
                          </>
                        )}
                        {selected.phone ? <button onClick={() => openDialer(selected.phone, displayLeadName(selected), selected.linkedLeadId || selected.matchedLeadId)} className="crm-button">Call</button> : null}
                        <button onClick={() => void claimSelected()} disabled={busy || selectedStatus === 'closed'} className="crm-button-dark">
                          {selected.linkedLeadId ? 'Open Lead' : selected.matchedLeadId ? (busy ? 'Linking...' : 'Open Existing Lead') : busy ? 'Creating...' : 'Move to Pipeline'}
                        </button>
                      </div>
                      {selectedStatus === 'closed' ? (
                        <p className="text-xs text-[var(--app-muted)]">
                          Closed as <span className="font-medium text-[var(--app-ink)]">{selectedDisposition.replace(/_/g, ' ')}</span>. Restore to put it back in the action queue.
                        </p>
                      ) : selected.matchedLeadId && !selected.linkedLeadId ? (
                        <p className="text-xs text-[var(--app-muted)]">
                          This contact already exists in your pipeline. <span className="font-medium text-[var(--app-ink)]">Open Existing Lead</span> to keep the conversation and follow-up history in one record.
                        </p>
                      ) : !selected.linkedLeadId ? (
                        <p className="text-xs text-[var(--app-muted)]">
                          <span className="font-medium text-[var(--app-ink)]">Move to Pipeline</span> for real leads &middot; mark <span className="font-medium text-[var(--app-ink)]">Junk</span>, <span className="font-medium text-[var(--app-ink)]">Lost</span>, or <span className="font-medium text-[var(--app-ink)]">Not Interested</span> when the inquiry is closed out.
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                  <div className="flex flex-col gap-4 p-4">

                    {/* ── CALL VIEW: compact, recording-first ── */}
                    {(selected.source === 'twilio_call' || selected.source === 'missed_call') ? (
                      <div className="space-y-3">
                        {/* Call meta row */}
                        <div className="flex items-center gap-3 rounded-[8px] border border-[var(--app-line)] bg-white px-4 py-3 text-sm">
                          <div className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-full text-xs font-bold ${selected.source === 'missed_call' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                            {selected.source === 'missed_call' ? '↗' : '↙'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-[var(--app-ink)]">
                              {selected.source === 'missed_call' ? 'Missed call' : 'Inbound call'}
                              {selectedRaw?.callDuration ? ` · ${Math.floor((selectedRaw.callDuration as number) / 60)}m ${(selectedRaw.callDuration as number) % 60}s` : ''}
                            </div>
                            <div className="text-xs text-[var(--app-muted)]">
                              {formatAbsoluteTime(selected.created_at)}
                              {selectedBranch.branchLabel ? ` · ${selectedBranch.branchLabel} line` : ''}
                              {selectedIsQrLead ? ' · QR / Direct Mail' : selectedBranch.trackingLabel ? ` · ${selectedBranch.trackingLabel}` : ''}
                            </div>
                          </div>
                          {selected.phone && (
                            <button onClick={() => openDialer(selected.phone, displayLeadName(selected), selected.linkedLeadId || selected.matchedLeadId)} className="crm-button shrink-0 text-xs">
                              Call back
                            </button>
                          )}
                        </div>

                        {/* Recording */}
                        {(recordingUrl || recordingSid) && (
                          <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3">
                            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Recording</div>
                            <RecordingPlayer recordingUrl={recordingUrl} recordingSid={recordingSid} />
                          </div>
                        )}
                        {recordingUnavailable && (
                          <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            {recordingUnavailableReason || 'No recording available for this call.'}
                          </div>
                        )}

                        {/* AI summary */}
                        {aiSummary?.summary && (
                          <div className="rounded-[8px] border border-[var(--app-line)] bg-white px-4 py-3">
                            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">What we know</div>
                            <p className="text-sm leading-6 text-[var(--app-ink)]">{aiSummary.summary}</p>
                            {aiSummary.leadConcern && (
                              <p className="mt-2 text-xs text-amber-700">Concern: {aiSummary.leadConcern}</p>
                            )}
                            {aiSummary.nextAction && (
                              <p className="mt-1 text-xs font-semibold text-[var(--app-accent)]">→ {aiSummary.nextAction}</p>
                            )}
                          </div>
                        )}

                        {/* Transcript (collapsed) */}
                        {transcript && (
                          <details className="rounded-[8px] border border-[var(--app-line)] bg-white">
                            <summary className="cursor-pointer px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">
                              Transcript
                            </summary>
                            <div className="max-h-48 overflow-y-auto px-4 pb-4 pt-1 whitespace-pre-wrap text-xs leading-6 text-[var(--app-muted)]">
                              {transcript}
                            </div>
                          </details>
                        )}

                        {/* Quick SMS reply */}
                        {selected.phone && (
                          <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">SMS Reply</div>
                              <button onClick={() => setScGoalOpen(scGoalOpen === 'sms' ? null : 'sms')} className="text-[10px] text-[var(--app-accent)] hover:underline">✦ Smart Compose</button>
                            </div>
                            {scGoalOpen === 'sms' && (
                              <div className="mb-2 grid grid-cols-2 gap-1.5">
                                {SC_GOALS.map(g => (
                                  <button key={g.id} onClick={() => void runSmartCompose(g.id, 'sms')} disabled={scBusy}
                                    className="rounded-[6px] border border-[var(--app-line)] px-2 py-1.5 text-left text-[10px] hover:border-[var(--app-accent)] disabled:opacity-50">
                                    <span className="font-medium text-[var(--app-ink)]">{g.label}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                            <textarea rows={2} value={compose.smsBody} onChange={e => setCompose(c => ({ ...c, smsBody: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send('sms') }}
                              className="crm-input w-full resize-none text-sm" placeholder="Type a reply..." />
                            <button onClick={() => void send('sms')} disabled={messageBusy || !compose.smsBody.trim()} className="mt-2 crm-button-dark text-sm disabled:opacity-50">
                              {messageBusy ? 'Sending...' : 'Send SMS'}
                            </button>
                          </div>
                        )}

                        {/* Conversation history */}
                        {threadEvents.length > 0 && (
                          <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3">
                            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">History with this contact</div>
                            <div className="space-y-2">
                              {threadEvents.map(event => (
                                <div key={event.id} className="flex items-start gap-2 border-b border-[var(--app-line)] pb-2 last:border-0 last:pb-0">
                                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--app-bg)] text-[9px] font-bold text-[var(--app-muted)]">
                                    {event.actor.slice(0, 1).toUpperCase()}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--app-muted)]">{event.type}</span>
                                      <span className="text-[10px] text-[var(--app-muted)]">{timeAgo(event.time)}</span>
                                    </div>
                                    <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--app-muted)]">{event.body}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : selectedHasRoute ? (
                      <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-4">
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <div className="crm-label">Origin</div>
                            <div className="mt-1 text-sm font-semibold text-[var(--app-ink)]">{selectedRoute.origin}</div>
                            <div className="mt-1 text-sm text-[var(--app-muted)]">{selectedRoute.originAccess}</div>
                          </div>
                          <div className="px-4 text-center">
                            <div className="text-xs font-medium text-[var(--app-muted)]">{selectedRoute.distance}</div>
                            <div className="mt-2 h-px w-24 bg-[rgba(228,226,220,1)]" />
                          </div>
                          <div className="flex-1 text-right">
                            <div className="crm-label">Destination</div>
                            <div className="mt-1 text-sm font-semibold text-[var(--app-ink)]">{selectedRoute.destination}</div>
                            <div className="mt-1 text-sm text-[var(--app-muted)]">{selectedRoute.destinationAccess}</div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                          <div className="max-w-2xl">
                            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">
                              {SOURCE_LABELS[selected.source] || selected.source}
                              {selectedIsQrLead ? ' · QR / Direct Mail' : ''}
                            </div>
                            <div className="mt-2 font-display text-2xl font-semibold tracking-tight text-[var(--app-ink)]">
                              {selectedActionMeta?.label || 'Needs Review'}
                            </div>
                            <p className="mt-2 text-sm leading-7 text-[var(--app-muted)]">
                              No route captured yet.
                              {selected.phone ? ` Call ${formatPhoneDisplay(selected.phone)} to get origin and destination.` : ' Reply to collect move details.'}
                            </p>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[360px]">
                            <div className="rounded-[8px] bg-[var(--app-bg)] px-4 py-3">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Contact</div>
                              <div className="mt-1.5 text-sm font-semibold text-[var(--app-ink)]">{selected.phone ? formatPhoneDisplay(selected.phone) : selected.email || '—'}</div>
                            </div>
                            <div className="rounded-[8px] bg-[var(--app-bg)] px-4 py-3">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">How they found us</div>
                              <div className="mt-1.5 text-sm font-semibold text-[var(--app-ink)]">{selectedIsQrLead ? 'QR / Direct Mail' : selectedBranch.trackingLabel || SOURCE_LABELS[selected.source] || 'Direct'}</div>
                            </div>
                            <div className="rounded-[8px] bg-[var(--app-bg)] px-4 py-3">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Inbound line</div>
                              <div className="mt-1.5 text-sm font-semibold text-[var(--app-ink)]">{selectedBranch.branchLabel || 'Primary'}</div>
                            </div>
                            <div className="rounded-[8px] bg-[var(--app-bg)] px-4 py-3">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">What to do next</div>
                              <div className="mt-1.5 text-sm font-semibold text-[var(--app-ink)]">{aiSummary?.nextAction || (selected.phone ? 'Call now — get route + details.' : 'Reply and collect route.')}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Non-call detail view: AI summary + timeline + original inquiry */}
                    {selected.source !== 'twilio_call' && selected.source !== 'missed_call' && (
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                      <div className="space-y-6">
                        <div className="overflow-hidden rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)]">
                          <div className="flex items-center gap-2 border-b border-[var(--app-line)] bg-[rgba(15,106,83,0.05)] px-5 py-3">
                            <span className="text-[var(--app-accent)]">✦</span>
                            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--app-accent)]">What we know</h3>
                          </div>
                          <div className="p-5">
                            <p className="text-[15px] leading-8 text-[var(--app-ink)]">
                              {aiSummary?.summary || 'Transcript and summary are still processing for this lead.'}
                            </p>
                            <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-[var(--app-line)] pt-4 text-sm">
                              <div className="flex items-center gap-1">
                                <span className="text-[var(--app-muted)]">▣</span>
                                <span className="font-medium text-[var(--app-ink)]">{selectedRaw?.estimatedCubicFeet || '—'} cu ft</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[var(--app-muted)]">◷</span>
                                <span className="font-medium text-[var(--app-ink)]">{selectedRaw?.moveWindow || 'Flexible date'}</span>
                              </div>
                              {aiSummary?.leadConcern ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-[var(--app-warm)]">△</span>
                                  <span className="font-medium text-[var(--app-warm)]">{aiSummary.leadConcern}</span>
                                </div>
                              ) : null}
                              {aiSummary?.nextAction ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-[var(--app-accent)]">→</span>
                                  <span className="font-medium text-[var(--app-ink)]">{aiSummary.nextAction}</span>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)]">
                          <div className="flex items-center justify-between border-b border-[var(--app-line)] px-5 py-3">
                            <h3 className="font-display text-lg font-semibold text-[var(--app-ink)]">Conversation Timeline</h3>
                            <div className="text-xs text-[var(--app-muted)]">Living lead story</div>
                          </div>
                          <div className="space-y-6 p-5">
                            {threadEvents.map((event, index) => (
                              <div key={event.id} className="relative pl-12">
                                {index !== threadEvents.length - 1 ? <div className="absolute left-[15px] top-8 bottom-[-26px] w-px bg-[var(--app-line)]" /> : null}
                                <div className="absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--app-line)] bg-[var(--app-panel)] text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">
                                  {event.actor.slice(0, 1)}
                                </div>
                                <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-4">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">{event.type}</div>
                                    <div className="text-xs text-[var(--app-muted)]" title={formatAbsoluteTime(event.time)}>{formatAbsoluteTime(event.time)}</div>
                                  </div>
                                  <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[var(--app-ink)]">{event.body}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                          <div className="flex items-center justify-between">
                            <h3 className="font-display text-lg font-semibold text-[var(--app-ink)]">Original Inquiry</h3>
                            <div className="text-xs text-[var(--app-muted)]" title={formatAbsoluteTime(selected.created_at)}>
                              {formatAbsoluteTime(selected.created_at)}
                            </div>
                          </div>
                          <div className="mt-4 grid gap-6 md:grid-cols-2">
                            <div>
                              <div className="crm-label">Name</div>
                              <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">{displayLeadName(selected)}</div>
                            </div>
                            <div>
                              <div className="crm-label">Source</div>
                              <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">{SOURCE_LABELS[selected.source] || selected.source}</div>
                            </div>
                            {selected.source === 'email' && selectedRaw?.subject ? (
                              <div>
                                <div className="crm-label">Subject</div>
                                <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">{displayEmailSubject(selectedRaw.subject as string)}</div>
                              </div>
                            ) : (
                              <div>
                                <div className="crm-label">Move Size</div>
                                <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">{selectedRaw?.moveSize || 'Not captured yet'}</div>
                              </div>
                            )}
                          </div>
                          {selectedBranch.branchLabel || selectedBranch.trackingLabel || selected.phone ? (
                            <div className="mt-4 grid gap-6 md:grid-cols-2">
                              <div>
                                <div className="crm-label">Inbound Line</div>
                                <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">{selectedBranch.branchLabel || 'Primary line'}</div>
                              </div>
                              <div>
                                <div className="crm-label">Tracking</div>
                                <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">{selectedIsQrLead ? 'QR / Direct Mail' : selectedBranch.trackingLabel || 'Standard intake'}</div>
                              </div>
                            </div>
                          ) : null}
                          {selected.source === 'email' && selected.email ? (
                            <div className="mt-4">
                              <div className="crm-label">From</div>
                              <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">{selectedRaw?.from as string || selected.email}</div>
                            </div>
                          ) : null}
                          <div className="mt-6">
                            <div className="crm-label">Message</div>
                            <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[var(--app-muted)]">{selected.message || 'No message body provided.'}</div>
                          </div>
                        </div>

                        {recordingUrl || recordingSid || transcript || recordingUnavailable ? (
                          <div className="space-y-6">
                            <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                              <div className="crm-label">Call Recording</div>
                              {recordingUrl || recordingSid ? (
                                <div className="mt-4">
                                  <RecordingPlayer recordingUrl={recordingUrl} recordingSid={recordingSid} />
                                </div>
                              ) : recordingUnavailable ? (
                                <div className="mt-4 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                                  {recordingUnavailableReason || 'Twilio did not retain a playable recording for this call.'}
                                </div>
                              ) : (
                                <div className="mt-4 text-sm text-[var(--app-muted)]">Recording still processing.</div>
                              )}
                            </div>
                            <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                              <div className="crm-label">Transcript</div>
                              <div className="mt-4 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-[var(--app-muted)]">
                                {transcript || 'Transcript still processing.'}
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {(selected.email || selected.phone) ? (
                          <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                            <div className="mb-3 flex items-center justify-between">
                              <div className="crm-label">Quick Templates</div>
                            </div>
                            <div className="mb-4 flex flex-wrap gap-2">
                              {[
                                { id: 'initial', label: 'Initial Follow-up' },
                                { id: 'quote_ready', label: 'Quote Ready' },
                                { id: 'booking_confirmed', label: 'Booking Confirmed' },
                                { id: 'day_before', label: 'Day-Before Reminder' },
                              ].map(t => (
                                <button
                                  key={t.id}
                                  onClick={() => applyTemplate(t.id, getLeadFirstName(selected), selected)}
                                  className="rounded-full border border-[var(--app-line)] px-3 py-1.5 text-xs font-medium text-[var(--app-muted)] transition hover:border-[var(--app-ink)] hover:text-[var(--app-ink)]"
                                >
                                  {t.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {selected.email ? (
                          <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                            <div className="flex items-center justify-between">
                              <div className="crm-label">Email Reply</div>
                              <button onClick={() => setScGoalOpen(scGoalOpen === 'email' ? null : 'email')} className="text-xs text-[var(--app-accent)] hover:underline">✨ Smart Compose</button>
                            </div>
                            {scGoalOpen === 'email' ? (
                              <div className="mt-3 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3">
                                <div className="mb-2 text-xs font-medium text-[var(--app-ink)]">What's the goal?</div>
                                <div className="grid grid-cols-2 gap-2">
                                  {SC_GOALS.map(g => (
                                    <button key={g.id} onClick={() => void runSmartCompose(g.id, 'email')} disabled={scBusy}
                                      className="flex flex-col items-start rounded-[6px] border border-[var(--app-line)] px-2 py-1.5 text-left text-xs hover:border-[var(--app-accent)] disabled:opacity-50">
                                      <span className="font-medium text-[var(--app-ink)]">{scBusy ? '...' : g.label}</span>
                                      <span className="text-[var(--app-muted)]">{g.desc}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            <input
                              className="crm-input mt-4"
                              value={compose.emailSubject}
                              onChange={event => setCompose(current => ({ ...current, emailSubject: event.target.value }))}
                            />
                            <textarea
                              className="crm-input mt-4 min-h-40"
                              value={compose.emailBody}
                              onChange={event => setCompose(current => ({ ...current, emailBody: event.target.value }))}
                            />
                            <button onClick={() => void send('email')} disabled={messageBusy} className="mt-4 crm-button-dark">
                              {messageBusy ? 'Sending...' : 'Send Email'}
                            </button>
                          </div>
                        ) : null}

                        {selected.phone ? (
                          <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                            <div className="flex items-center justify-between">
                              <div className="crm-label">SMS Reply</div>
                              <button onClick={() => setScGoalOpen(scGoalOpen === 'sms' ? null : 'sms')} className="text-xs text-[var(--app-accent)] hover:underline">✨ Smart Compose</button>
                            </div>
                            {scGoalOpen === 'sms' ? (
                              <div className="mt-3 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3">
                                <div className="mb-2 text-xs font-medium text-[var(--app-ink)]">What's the goal?</div>
                                <div className="grid grid-cols-2 gap-2">
                                  {SC_GOALS.map(g => (
                                    <button key={g.id} onClick={() => void runSmartCompose(g.id, 'sms')} disabled={scBusy}
                                      className="flex flex-col items-start rounded-[6px] border border-[var(--app-line)] px-2 py-1.5 text-left text-xs hover:border-[var(--app-accent)] disabled:opacity-50">
                                      <span className="font-medium text-[var(--app-ink)]">{scBusy ? '...' : g.label}</span>
                                      <span className="text-[var(--app-muted)]">{g.desc}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            <textarea
                              className="crm-input mt-4 min-h-40"
                              value={compose.smsBody}
                              onChange={event => setCompose(current => ({ ...current, smsBody: event.target.value }))}
                            />
                            <button onClick={() => void send('sms')} disabled={messageBusy} className="mt-4 crm-button-dark">
                              {messageBusy ? 'Sending...' : 'Send SMS'}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    )}
                  </div>
                </div>
              </div>
              </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SalesInboxPage() {
  return (
    <Suspense>
      <SalesInboxPageInner />
    </Suspense>
  )
}
