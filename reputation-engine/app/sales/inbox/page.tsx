'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSaturnBranchLabel, getSaturnBranchNumberFromRawData } from '@/lib/sales-phones'
import { getRecordingPlaybackUrl } from '@/lib/recording-playback'
import { claimInboundLead, fetchInboundLeads, markInboundLeadJunk, restoreInboundLead, sendSalesMessage } from '@/lib/sales-api'
import type { CRMEmail, InboundLead } from '@/lib/types'

const SOURCE_LABELS: Record<string, string> = {
  twilio_call: 'Inbound Call',
  twilio_sms: 'SMS',
  facebook_dm: 'Facebook DM',
  instagram_dm: 'Instagram DM',
  email: 'Email',
  website_form: 'Web Form',
}

function isMissedCall(item: InboundLead) {
  if (item.source !== 'twilio_call') return false
  const raw = typeof item.raw_data === 'object' && item.raw_data ? item.raw_data as Record<string, unknown> : {}
  return raw.missedCall === true
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

function parseRawData(value: InboundLead['raw_data']) {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, any>
    } catch {
      return null
    }
  }
  return value as Record<string, any>
}

function getInboundBranchMeta(item: InboundLead | null) {
  const raw = parseRawData(item?.raw_data)
  const branchNumber = getSaturnBranchNumberFromRawData(raw)
  const branchLabel =
    getSaturnBranchLabel(branchNumber) ||
    (typeof raw?.branchCity === 'string' ? raw.branchCity : '') ||
    ''

  return {
    branchNumber: branchNumber || undefined,
    branchLabel: branchLabel || undefined,
  }
}

function openDialer(phone?: string, name?: string, leadId?: string) {
  if (!phone || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('crm:open-dialer', { detail: { phone, name, leadId } }))
}

function displayLeadName(item: InboundLead | null) {
  if (!item) return 'New Lead'
  const value = item.name?.trim()
  if (!value) {
    return item.source === 'twilio_call' ? 'New Caller' : item.source === 'twilio_sms' ? 'New Contact' : 'New Lead'
  }
  if (/^unknown\b/i.test(value)) {
    return item.source === 'twilio_call' ? 'New Caller' : item.source === 'twilio_sms' ? 'New Contact' : 'New Lead'
  }
  return value
}

export default function SalesInboxPage() {
  const router = useRouter()
  const [items, setItems] = useState<InboundLead[]>([])
  const [viewMode, setViewMode] = useState<'active' | 'unread' | 'closed' | 'messages' | 'email'>('active')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [messageBusy, setMessageBusy] = useState(false)
  const [junkBusy, setJunkBusy] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compose, setCompose] = useState({ emailSubject: 'Following up — Saturn Star Moving', emailBody: '', smsBody: '' })
  const [notification, setNotification] = useState<{ id: string; name: string; source: string; time: string } | null>(null)
  const [scGoalOpen, setScGoalOpen] = useState<'email' | 'sms' | null>(null)
  const [scBusy, setScBusy] = useState(false)
  // SMS threads (2-way messages view)
  const [smsThreads, setSmsThreads] = useState<Array<{
    contactPhone: string; messages: Array<{ id: string; from_number: string; to_number: string; body: string; direction: 'inbound' | 'outbound'; created_at: string; lead_id: string | null }>
    lastMessage: string; lastAt: string; unread: boolean; leadId: string | null; businessNumber: string; branchLabel: string
  }>>([])
  const [threadsLoading, setThreadsLoading] = useState(false)
  const [selectedThread, setSelectedThread] = useState<string | null>(null)
  const [smsReply, setSmsReply] = useState('')
  const [smsReplyBusy, setSmsReplyBusy] = useState(false)
  // Email inbox state
  const [emailList, setEmailList] = useState<CRMEmail[]>([])
  const [emailLoading, setEmailLoading] = useState(false)
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null)
  const [emailReply, setEmailReply] = useState({ subject: '', body: '' })
  const [emailReplyBusy, setEmailReplyBusy] = useState(false)

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
      const res = await fetch('https://saturn-lead-intake.johnowolabi80.workers.dev/smart-compose', {
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
  const knownIdsRef = useRef<Set<string>>(new Set())

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
    try {
      if (!silent) setLoading(true)
      const data = await fetchInboundLeads(viewMode === 'closed' ? 'closed' : undefined)

      // Detect brand-new arrivals (items we haven't seen before)
      if (knownIdsRef.current.size > 0) {
        const newItems = data.filter(item => !knownIdsRef.current.has(item.id))
        if (newItems.length > 0) {
          const newest = newItems[0]
          setNotification({
            id: newest.id,
            name: displayLeadName(newest),
            source: SOURCE_LABELS[newest.source] || newest.source,
            time: newest.created_at,
          })
          window.setTimeout(() => setNotification(null), 7000)
        }
      }
      data.forEach(item => knownIdsRef.current.add(item.id))

      setItems(data)
      setSelectedId(current => (current && data.some(item => item.id === current) ? current : data[0]?.id || null))
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (viewMode === 'messages') {
      void fetchSmsThreads()
    } else if (viewMode === 'email') {
      void fetchEmails()
    } else {
      void refresh()
    }
  }, [viewMode])

  // Poll for new inbound leads every 30 seconds
  useEffect(() => {
    if (viewMode === 'closed') return
    const interval = window.setInterval(() => { void refresh(true) }, 30000)
    return () => window.clearInterval(interval)
  }, [viewMode])

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    let base = items
    if (viewMode === 'unread') base = items.filter(item => !item.claimed)
    if (!query) return base

    return base.filter(item => {
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
  }, [items, search])
  const selected = useMemo(() => filteredItems.find(item => item.id === selectedId) || null, [filteredItems, selectedId])
  const selectedRaw = useMemo(() => parseRawData(selected?.raw_data), [selected?.raw_data])
  const selectedBranch = useMemo(() => getInboundBranchMeta(selected), [selected])
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
  const recordingPlaybackUrl = getRecordingPlaybackUrl(recordingUrl)
  const unreadCount = useMemo(() => items.filter(item => !item.claimed).length, [items])
  const selectedRoute = useMemo(
    () => ({
      origin: (selectedRaw?.originCity as string | undefined) || 'Origin TBD',
      destination: (selectedRaw?.destCity as string | undefined) || 'Destination TBD',
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
    if (!selected || viewMode === 'closed') return
    const isCall = selected.source === 'twilio_call'
    const needsRefresh =
      isCall &&
      !selectedRaw?.recordingUrl &&
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
    const first = displayLeadName(selected).split(' ')[0]
    setCompose({
      emailSubject: 'Following up — Saturn Star Moving',
      emailBody: `Hi ${first},\n\nThanks for reaching out to Saturn Star Moving. We'd love to help with your move.\n\nCould you share your move date and the addresses involved so we can prepare the right estimate?\n\nBest,\nSaturn Star Moving`,
      smsBody: `Hi ${first}, thanks for contacting Saturn Star Moving. We can help with your move. What date and locations are you planning for?`,
    })
  }, [selected])

  useEffect(() => {
    setSelectedId(current => (current && filteredItems.some(item => item.id === current) ? current : filteredItems[0]?.id || null))
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
        name: displayLeadName(selected),
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

  async function junkSelected() {
    if (!selected) return
    try {
      setJunkBusy(true)
      await markInboundLeadJunk(selected.id)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setJunkBusy(false)
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

  async function fetchSmsThreads() {
    try {
      setThreadsLoading(true)
      const res = await fetch('/api/sales/sms-threads')
      if (res.ok) {
        const data = await res.json() as typeof smsThreads
        setSmsThreads(data)
        if (!selectedThread && data.length > 0) setSelectedThread(data[0].contactPhone)
      }
    } catch { /* non-fatal */ } finally {
      setThreadsLoading(false)
    }
  }

  async function sendSmsReply() {
    if (!selectedThread || !smsReply.trim()) return
    try {
      setSmsReplyBusy(true)
      await sendSalesMessage({
        channel: 'sms',
        to: selectedThread,
        body: smsReply.trim(),
        fromNumber: selectedSmsThreadData?.businessNumber,
        notes: 'Reply from inbox messages view',
      })
      setSmsReply('')
      await fetchSmsThreads()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSmsReplyBusy(false)
    }
  }

  async function fetchEmails() {
    try {
      setEmailLoading(true)
      const res = await fetch('/api/sales/emails')
      if (res.ok) {
        const data = await res.json() as CRMEmail[]
        setEmailList(data)
        if (!selectedEmailId && data.length > 0) setSelectedEmailId(data[0].id)
      }
    } catch { /* non-fatal */ } finally {
      setEmailLoading(false)
    }
  }

  async function sendEmailReply() {
    const selectedEmail = emailList.find(e => e.id === selectedEmailId)
    if (!selectedEmail || !emailReply.body.trim()) return
    const replyTo = selectedEmail.direction === 'inbound' ? selectedEmail.from : selectedEmail.to
    try {
      setEmailReplyBusy(true)
      await sendSalesMessage({
        channel: 'email',
        to: replyTo,
        subject: emailReply.subject || `Re: ${selectedEmail.subject}`,
        body: emailReply.body,
        leadId: selectedEmail.leadId || undefined,
        quoteId: selectedEmail.quoteId || undefined,
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
      {/* ── NEW LEAD NOTIFICATION TOAST ── */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-[12px] border border-[var(--app-line)] bg-white p-4 shadow-xl">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(15,106,83,0.12)] text-lg">🔔</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[var(--app-ink)]">New inbound — {notification.source}</div>
            <div className="mt-0.5 text-sm text-[var(--app-muted)] truncate">{notification.name} · {timeAgo(notification.time)}</div>
            <button
              onClick={() => { setSelectedId(notification.id); setViewMode('active'); setNotification(null) }}
              className="mt-2 rounded-[6px] bg-[var(--app-accent)] px-3 py-1 text-xs font-semibold text-white"
            >
              View Now
            </button>
          </div>
          <button onClick={() => setNotification(null)} className="text-[var(--app-muted)] hover:text-[var(--app-ink)]">✕</button>
        </div>
      )}
      <div className="min-h-[calc(100vh-40px)] overflow-hidden rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)]">
        {error ? <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700">{error}</div> : null}
        {loading ? (
          <div className="p-16 text-center text-sm text-[var(--app-muted)]">Loading lead inbox...</div>
        ) : (
          <div className="min-h-[calc(100vh-42px)] md:flex">
            <section className={`${(selected || (viewMode === 'email' && selectedEmailId)) ? 'hidden md:flex' : 'flex'} w-full flex-shrink-0 flex-col border-r border-[var(--app-line)] bg-[var(--app-panel)] md:w-[360px]`}>
              <div className="border-b border-[var(--app-line)] p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h1 className="text-[2rem] font-semibold tracking-tight text-[var(--app-ink)]">Lead Inbox</h1>
                    <div className="mt-1 text-sm text-[var(--app-muted)]">New conversations, missed calls, and inbound messages.</div>
                  </div>
                  <div className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-1 text-xs font-medium text-[var(--app-muted)]">
                    {filteredItems.length} shown
                  </div>
                </div>
                <div className="mb-4 flex items-center gap-1 border-b border-[var(--app-line)]">
                  {([
                    { id: 'active', label: 'Leads', count: items.length },
                    { id: 'unread', label: 'Unread', count: unreadCount },
                    { id: 'messages', label: '💬 SMS', count: smsThreads.filter(t => t.unread).length || null },
                    { id: 'email', label: '📧 Email', count: emailList.filter(e => e.direction === 'inbound').length || null },
                    { id: 'closed', label: 'Closed', count: null },
                  ] as const).map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setViewMode(tab.id as typeof viewMode)}
                      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-sm font-medium transition ${viewMode === tab.id ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}
                    >
                      {tab.label}
                      {tab.count !== null && tab.count > 0 && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${viewMode === tab.id ? 'bg-[rgba(15,106,83,0.12)] text-[var(--app-accent)]' : 'bg-stone-100 text-[var(--app-muted)]'}`}>
                          {tab.count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <input
                  className="crm-input"
                  placeholder="Search conversations..."
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                />
              </div>
              <div className="flex-1 overflow-y-auto bg-[var(--app-panel)]">
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
                        setEmailReply({ subject: `Re: ${em.subject}`, body: '' })
                      }}
                      className={`relative block w-full border-b border-[var(--app-line)] p-4 text-left transition ${selectedEmailId === em.id ? 'bg-[rgba(15,106,83,0.05)]' : 'bg-[var(--app-panel)] hover:bg-[var(--app-bg)]'}`}
                    >
                      {selectedEmailId === em.id ? <div className="absolute bottom-0 left-0 top-0 w-1 bg-[var(--app-accent)]" /> : null}
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {em.direction === 'inbound' && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--app-warm)]" />}
                          <span className="truncate text-sm font-semibold text-[var(--app-ink)]">
                            {em.direction === 'inbound' ? em.from : em.to}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs text-[var(--app-muted)]">{timeAgo(em.sentAt)}</span>
                      </div>
                      <p className="text-sm font-medium text-[var(--app-ink)] line-clamp-1">{em.subject || '(no subject)'}</p>
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
                    </button>
                  ))
                ) : viewMode === 'messages' ? (
                  threadsLoading ? (
                    <div className="p-6 text-sm text-[var(--app-muted)]">Loading conversations...</div>
                  ) : smsThreads.length === 0 ? (
                    <div className="p-6 text-sm text-[var(--app-muted)]">No SMS conversations yet. Messages from leads will appear here.</div>
                  ) : smsThreads.map(thread => (
                    <button
                      key={thread.contactPhone}
                      onClick={() => setSelectedThread(thread.contactPhone)}
                      className={`relative block w-full border-b border-[var(--app-line)] p-4 text-left transition ${selectedThread === thread.contactPhone ? 'bg-[rgba(15,106,83,0.05)]' : 'bg-[var(--app-panel)] hover:bg-[var(--app-bg)]'}`}
                    >
                      {selectedThread === thread.contactPhone ? <div className="absolute bottom-0 left-0 top-0 w-1 bg-[var(--app-accent)]" /> : null}
                      <div className="mb-1 flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          {thread.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--app-accent)]" />}
                          <span className={`text-sm font-semibold ${thread.unread ? 'text-[var(--app-ink)]' : 'text-[var(--app-muted)]'}`}>{thread.contactPhone}</span>
                        </div>
                        <span className="text-xs text-[var(--app-muted)]">{timeAgo(thread.lastAt)}</span>
                      </div>
                      {thread.branchLabel ? (
                        <div className="mb-1">
                          <span className="rounded-[4px] border border-[rgba(15,106,83,0.18)] bg-[rgba(15,106,83,0.08)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--app-accent)]">
                            Replies as {thread.branchLabel}
                          </span>
                        </div>
                      ) : null}
                      <p className="text-xs text-[var(--app-muted)] line-clamp-1">{thread.lastMessage || '(no message)'}</p>
                    </button>
                  ))
                ) : filteredItems.length === 0 ? (
                  <div className="p-6 text-sm text-[var(--app-muted)]">
                    {search.trim() ? 'No conversations match this search.' : 'No conversations in this view.'}
                  </div>
                ) : filteredItems.map(item => {
                  const raw = parseRawData(item.raw_data)
                  const selectedState = item.id === selectedId
                  const itemSummary = raw?.aiSummary?.summary as string | undefined
                  const itemMoveReadiness = raw?.aiSummary?.moveReadiness as 'hot' | 'warm' | 'cold' | undefined
                  const itemTranscript = raw?.transcript as string | undefined
                  const branchLabel = getInboundBranchMeta(item).branchLabel
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`relative block w-full border-b border-[var(--app-line)] p-4 text-left transition ${selectedState ? 'bg-[rgba(15,106,83,0.05)]' : 'bg-[var(--app-panel)] hover:bg-[var(--app-bg)]'} ${!item.linkedLeadId ? '' : 'opacity-90'}`}
                    >
                      {selectedState ? <div className="absolute bottom-0 left-0 top-0 w-1 bg-[var(--app-accent)]" /> : null}
                      <div className="mb-1 flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          {!item.claimed && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--app-accent)]" />}
                          <span className={`text-sm font-semibold ${item.claimed ? 'text-[var(--app-muted)]' : 'text-[var(--app-ink)]'}`}>{displayLeadName(item)}</span>
                        </div>
                        <span className="text-xs text-[var(--app-muted)]" title={formatAbsoluteTime(item.created_at)}>{timeAgo(item.created_at)}</span>
                      </div>
                      <p className="mb-1 text-sm font-medium text-[var(--app-ink)] line-clamp-1">
                        {(raw?.routeText as string | undefined) || item.message || `${item.phone || item.email || 'No contact details'} lead`}
                      </p>
                      <p className="line-clamp-2 text-xs text-[var(--app-muted)]">
                        {itemSummary || itemTranscript || item.message || 'No summary yet.'}
                      </p>
                      <div className="mt-2 flex gap-2">
                        {branchLabel ? (
                          <span className="rounded-[4px] border border-[rgba(15,106,83,0.18)] bg-[rgba(15,106,83,0.08)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--app-accent)]">
                            {branchLabel}
                          </span>
                        ) : null}
                        {isMissedCall(item) ? (
                          <span className="rounded-[4px] border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700">
                            ☎ Missed Call
                          </span>
                        ) : (
                          <span className="rounded-[4px] border border-[rgba(228,226,220,1)] bg-[var(--app-bg)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--app-muted)]">
                            {SOURCE_LABELS[item.source] || item.source}
                          </span>
                        )}
                        {viewMode === 'closed' && item.linkedLeadId ? (
                          <span className="rounded-[4px] border border-[rgba(15,106,83,0.2)] bg-[rgba(15,106,83,0.08)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--app-accent)]">
                            Moved to Pipeline
                          </span>
                        ) : viewMode === 'closed' ? (
                          <span className="rounded-[4px] border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700">
                            Junk
                          </span>
                        ) : itemMoveReadiness === 'hot' ? (
                          <span className="rounded-[4px] border border-[rgba(34,72,56,0.2)] bg-[rgba(34,72,56,0.08)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--app-accent)]">
                            High Intent
                          </span>
                        ) : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className={`${selected || (viewMode === 'messages' && selectedThread) || (viewMode === 'email' && selectedEmailId) ? 'block' : 'hidden md:block'} flex-1 overflow-y-auto bg-[var(--app-bg)]`}>
              {viewMode === 'email' ? (
                (() => {
                  const em = emailList.find(e => e.id === selectedEmailId)
                  if (!em) return <div className="p-16 text-center text-sm text-[var(--app-muted)]">Select an email.</div>

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
                    <div className="flex h-full flex-col">
                      {/* Header */}
                      <div className="sticky top-0 z-10 border-b border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-3">
                        <button onClick={() => setSelectedEmailId(null)} className="crm-button mb-2 px-3 md:hidden">← Back</button>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <h2 className="text-base font-semibold text-[var(--app-ink)] line-clamp-1">
                              {em.subject?.replace(/^Re:\s*/i, '')}
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
                        {latestInbound && (
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
                                    {idx === 0 && msg.direction === 'inbound' && (
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
                      <div className="border-t-2 border-[var(--app-line)] bg-[var(--app-panel)] p-4">
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
                  if (!thread) return <div className="p-16 text-center text-sm text-[var(--app-muted)]">Select a conversation.</div>
                  return (
                    <div className="flex h-full flex-col">
                      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--app-line)] bg-[var(--app-panel)] px-4 py-4">
                        <button onClick={() => setSelectedThread(null)} className="crm-button px-3 md:hidden">Back</button>
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(15,106,83,0.1)] text-sm font-bold text-[var(--app-accent)]">
                          {thread.contactPhone.slice(-4)}
                        </div>
                        <div>
                          <div className="text-base font-semibold text-[var(--app-ink)]">{thread.contactPhone}</div>
                          <div className="text-xs text-[var(--app-muted)]">
                            {thread.messages.length} messages
                            {thread.branchLabel ? ` • replying as ${thread.branchLabel}` : ''}
                          </div>
                        </div>
                        {thread.leadId && (
                          <a href={`/sales/leads/${thread.leadId}`} className="ml-auto crm-button text-xs">View Lead →</a>
                        )}
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-2 px-4 py-4">
                        {thread.messages.map(msg => (
                          <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[75%] rounded-[18px] px-3.5 py-2.5 text-sm shadow-sm ${msg.direction === 'outbound' ? 'rounded-br-[4px] bg-[#0b84ff] text-white' : 'rounded-bl-[4px] bg-[#e9e9eb] text-[#1c1c1e]'}`}>
                              <p>{msg.body}</p>
                              <p className={`mt-1 text-[10px] ${msg.direction === 'outbound' ? 'text-white/60' : 'text-[#8e8e93]'}`}>
                                {new Date(msg.created_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-[var(--app-line)] bg-[var(--app-panel)] p-4">
                        {thread.branchLabel ? (
                          <div className="mb-2 text-xs text-[var(--app-muted)]">
                            Outbound replies go out from <span className="font-semibold text-[var(--app-ink)]">{thread.branchLabel}</span> ({thread.businessNumber}).
                          </div>
                        ) : null}
                        <div className="flex gap-3">
                          <textarea
                            className="crm-input flex-1 resize-none"
                            rows={2}
                            placeholder="Type a reply..."
                            value={smsReply}
                            onChange={e => setSmsReply(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendSmsReply() }}
                          />
                          <button
                            onClick={() => void sendSmsReply()}
                            disabled={smsReplyBusy || !smsReply.trim()}
                            className="crm-button-dark self-end disabled:opacity-50"
                          >
                            {smsReplyBusy ? '...' : 'Send'}
                          </button>
                        </div>
                        <p className="mt-1.5 text-xs text-[var(--app-muted)]">Cmd+Enter to send</p>
                      </div>
                    </div>
                  )
                })()
              ) : !selected ? (
                <div className="p-16 text-center text-sm text-[var(--app-muted)]">Select an inbound lead.</div>
              ) : (
                <div className="min-h-full">
                  <div className="sticky top-0 z-10 flex flex-col gap-4 border-b border-[var(--app-line)] bg-[var(--app-panel)] px-4 py-4 md:flex-row md:items-center md:justify-between md:px-8">
                    <div className="flex items-center gap-3 md:gap-4">
                      <button onClick={() => setSelectedId(null)} className="crm-button px-3 md:hidden">
                        Back
                      </button>
                      <div className="flex h-12 w-12 items-center justify-center rounded-[6px] bg-[rgba(15,106,83,0.1)] text-xl font-semibold text-[var(--app-accent)]">
                        {displayLeadName(selected).slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-[2rem] font-semibold tracking-tight text-[var(--app-ink)]">{displayLeadName(selected)}</h2>
                          {selectedBranch.branchLabel ? (
                            <span className="rounded-[4px] border border-[rgba(15,106,83,0.2)] bg-[rgba(15,106,83,0.08)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--app-accent)]">
                              {selectedBranch.branchLabel}
                            </span>
                          ) : null}
                          {isMissedCall(selected) ? (
                            <span className="rounded-[4px] border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700">
                              ☎ Missed Call
                            </span>
                          ) : (
                            <span className="rounded-[4px] border border-[rgba(15,106,83,0.2)] bg-[rgba(15,106,83,0.08)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--app-accent)]">
                              {selected.linkedLeadId ? 'Moved to Pipeline' : viewMode === 'closed' ? 'Junk' : 'New'}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--app-muted)]">
                          {selected.email ? <span>{selected.email}</span> : null}
                          {selected.email && selected.phone ? <span>•</span> : null}
                          {selected.phone ? <span>{selected.phone}</span> : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {viewMode === 'closed' ? (
                        selected.linkedLeadId ? (
                          <button onClick={() => router.push(`/sales/leads/${selected.linkedLeadId}`)} className="crm-button">
                            Open Lead
                          </button>
                        ) : (
                          <button onClick={() => void restoreSelected()} disabled={restoreBusy} className="crm-button">
                            {restoreBusy ? 'Restoring...' : 'Restore'}
                          </button>
                        )
                      ) : (
                        <button onClick={() => void junkSelected()} disabled={junkBusy} className="crm-button">{junkBusy ? 'Rejecting...' : 'Reject'}</button>
                      )}
                      {selected.phone ? <button onClick={() => openDialer(selected.phone, selected.name || undefined, selected.linkedLeadId)} className="crm-button">Call</button> : null}
                      <button onClick={() => void claimSelected()} disabled={busy || viewMode === 'closed'} className="crm-button-dark">{selected.linkedLeadId ? 'Open Lead' : busy ? 'Creating...' : 'Move to Pipeline'}</button>
                    </div>
                  </div>

                  <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-8">
                    <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-4">
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <div className="crm-label">Origin</div>
                          <div className="mt-2 font-display text-2xl font-semibold tracking-tight text-[var(--app-ink)]">{selectedRoute.origin}</div>
                          <div className="mt-1 text-sm text-[var(--app-muted)]">{selectedRoute.originAccess}</div>
                        </div>
                        <div className="px-4 text-center">
                          <div className="text-xs font-medium text-[var(--app-muted)]">{selectedRoute.distance}</div>
                          <div className="mt-2 h-px w-24 bg-[rgba(228,226,220,1)]" />
                        </div>
                        <div className="flex-1 text-right">
                          <div className="crm-label">Destination</div>
                          <div className="mt-2 font-display text-2xl font-semibold tracking-tight text-[var(--app-ink)]">{selectedRoute.destination}</div>
                          <div className="mt-1 text-sm text-[var(--app-muted)]">{selectedRoute.destinationAccess}</div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                      <div className="space-y-6">
                        <div className="overflow-hidden rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)]">
                          <div className="flex items-center gap-2 border-b border-[var(--app-line)] bg-[rgba(15,106,83,0.05)] px-5 py-3">
                            <span className="text-[var(--app-accent)]">✦</span>
                            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--app-accent)]">AI Triage Summary</h3>
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
                            {selected.source === 'email' && selectedRaw?.subject ? (
                              <div>
                                <div className="crm-label">Subject</div>
                                <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">{selectedRaw.subject as string}</div>
                              </div>
                            ) : (
                              <div>
                                <div className="crm-label">Move Size</div>
                                <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">{selectedRaw?.moveSize || 'Not captured yet'}</div>
                              </div>
                            )}
                          </div>
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

                        {recordingUrl || transcript ? (
                          <div className="space-y-6">
                            <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                              <div className="crm-label">Call Recording</div>
                              {recordingUrl ? (
                                <audio controls preload="none" className="mt-4 w-full" src={recordingPlaybackUrl}>
                                  Your browser does not support audio playback.
                                </audio>
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
                                  onClick={() => applyTemplate(t.id, displayLeadName(selected).split(' ')[0], selected)}
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
