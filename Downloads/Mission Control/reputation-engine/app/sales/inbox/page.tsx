'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { claimInboundLead, fetchInboundLeads, markInboundLeadJunk, restoreInboundLead, sendSalesMessage } from '@/lib/sales-api'
import type { InboundLead } from '@/lib/types'

const SOURCE_LABELS: Record<string, string> = {
  twilio_call: 'Inbound Call',
  twilio_sms: 'SMS',
  facebook_dm: 'Facebook DM',
  instagram_dm: 'Instagram DM',
  email: 'Email',
  website_form: 'Web Form',
}

function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}h ago`
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
  if (/^unknown$/i.test(value) || /^unknown lead$/i.test(value)) {
    return item.source === 'twilio_call' ? 'New Caller' : item.source === 'twilio_sms' ? 'New Contact' : 'New Lead'
  }
  return value
}

export default function SalesInboxPage() {
  const router = useRouter()
  const [items, setItems] = useState<InboundLead[]>([])
  const [viewMode, setViewMode] = useState<'active' | 'junk'>('active')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [messageBusy, setMessageBusy] = useState(false)
  const [junkBusy, setJunkBusy] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compose, setCompose] = useState({ emailSubject: 'Following up — Saturn Star Moving', emailBody: '', smsBody: '' })

  async function refresh() {
    try {
      setLoading(true)
      const data = await fetchInboundLeads(viewMode === 'junk' ? 'junk' : undefined)
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
    void refresh()
  }, [viewMode])

  const selected = useMemo(() => items.find(item => item.id === selectedId) || null, [items, selectedId])
  const selectedRaw = useMemo(() => parseRawData(selected?.raw_data), [selected?.raw_data])
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
    if (!selected || viewMode === 'junk') return
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

  return (
    <div className="crm-shell">
      <div className="min-h-[calc(100vh-40px)] overflow-hidden rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)]">
        {error ? <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700">{error}</div> : null}
        {loading ? (
          <div className="p-16 text-center text-sm text-[var(--app-muted)]">Loading lead inbox...</div>
        ) : (
          <div className="flex min-h-[calc(100vh-42px)]">
            <section className="flex w-[360px] flex-shrink-0 flex-col border-r border-[var(--app-line)] bg-[var(--app-panel)]">
              <div className="border-b border-[var(--app-line)] p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h1 className="text-[2rem] font-semibold tracking-tight text-[var(--app-ink)]">Lead Inbox</h1>
                    <div className="mt-1 text-sm text-[var(--app-muted)]">New conversations, missed calls, and inbound messages.</div>
                  </div>
                  <button className="text-[var(--app-muted)]">☰</button>
                </div>
                <div className="mb-4 flex items-center gap-4">
                  <button
                    onClick={() => setViewMode('active')}
                    className={`${viewMode === 'active' ? 'border-b-2 border-[var(--app-accent)] text-[var(--app-accent)]' : 'text-[var(--app-muted)]'} pb-1 text-sm font-medium`}
                  >
                    Active <span className="ml-1 text-xs text-[var(--app-muted)]">{viewMode === 'active' ? items.length : unreadCount}</span>
                  </button>
                  <button className="pb-1 text-sm font-medium text-[var(--app-muted)]">Unread <span className="ml-1 text-xs text-[var(--app-accent)]">{unreadCount}</span></button>
                  <button
                    onClick={() => setViewMode('junk')}
                    className={`${viewMode === 'junk' ? 'border-b-2 border-[var(--app-accent)] text-[var(--app-accent)]' : 'text-[var(--app-muted)]'} pb-1 text-sm font-medium`}
                  >
                    Junk
                  </button>
                </div>
                <input className="crm-input" placeholder="Search leads..." />
              </div>
              <div className="flex-1 overflow-y-auto bg-[var(--app-panel)]">
                {items.map(item => {
                  const raw = parseRawData(item.raw_data)
                  const selectedState = item.id === selectedId
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`relative block w-full border-b border-[var(--app-line)] p-4 text-left transition ${selectedState ? 'bg-[rgba(15,106,83,0.05)]' : 'bg-[var(--app-panel)] hover:bg-[var(--app-bg)]'} ${!item.linkedLeadId ? '' : 'opacity-90'}`}
                    >
                      {selectedState ? <div className="absolute bottom-0 left-0 top-0 w-1 bg-[var(--app-accent)]" /> : null}
                      <div className="mb-1 flex items-start justify-between">
                        <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-[var(--app-accent)]" />
                          <span className="text-sm font-semibold text-[var(--app-ink)]">{displayLeadName(item)}</span>
                        </div>
                        <span className="text-xs text-[var(--app-muted)]">{timeAgo(item.created_at)}</span>
                      </div>
                      <p className="mb-1 text-sm font-medium text-[var(--app-ink)] line-clamp-1">
                        {(raw?.routeText as string | undefined) || item.message || `${item.phone || item.email || 'No contact details'} lead`}
                      </p>
                      <p className="line-clamp-2 text-xs text-[var(--app-muted)]">
                        {aiSummary?.summary || transcript || item.message || 'No summary yet.'}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <span className="rounded-[4px] border border-[rgba(228,226,220,1)] bg-[var(--app-bg)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--app-muted)]">
                          {SOURCE_LABELS[item.source] || item.source}
                        </span>
                        {viewMode === 'junk' ? (
                          <span className="rounded-[4px] border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700">
                            Junk
                          </span>
                        ) : aiSummary?.moveReadiness === 'hot' ? (
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

            <section className="flex-1 overflow-y-auto bg-[var(--app-bg)]">
              {!selected ? (
                <div className="p-16 text-center text-sm text-[var(--app-muted)]">Select an inbound lead.</div>
              ) : (
                <div className="min-h-full">
                  <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--app-line)] bg-[var(--app-panel)] px-8 py-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-[6px] bg-[rgba(15,106,83,0.1)] text-xl font-semibold text-[var(--app-accent)]">
                        {displayLeadName(selected).slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-[2rem] font-semibold tracking-tight text-[var(--app-ink)]">{displayLeadName(selected)}</h2>
                          <span className="rounded-[4px] border border-[rgba(15,106,83,0.2)] bg-[rgba(15,106,83,0.08)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--app-accent)]">New</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--app-muted)]">
                          {selected.email ? <span>{selected.email}</span> : null}
                          {selected.email && selected.phone ? <span>•</span> : null}
                          {selected.phone ? <span>{selected.phone}</span> : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      {viewMode === 'junk' ? (
                        <button onClick={() => void restoreSelected()} disabled={restoreBusy} className="crm-button">
                          {restoreBusy ? 'Restoring...' : 'Restore'}
                        </button>
                      ) : (
                        <button onClick={() => void junkSelected()} disabled={junkBusy} className="crm-button">{junkBusy ? 'Rejecting...' : 'Reject'}</button>
                      )}
                      {selected.phone ? <button onClick={() => openDialer(selected.phone, selected.name || undefined, selected.linkedLeadId)} className="crm-button">Call</button> : null}
                      <button onClick={() => void claimSelected()} disabled={busy || viewMode === 'junk'} className="crm-button-dark">{selected.linkedLeadId ? 'Open Lead' : busy ? 'Creating...' : 'Open Lead'}</button>
                    </div>
                  </div>

                  <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
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
                                    <div className="text-xs text-[var(--app-muted)]">{timeAgo(event.time)}</div>
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
                            <div className="text-xs text-[var(--app-muted)]">{timeAgo(selected.created_at)}</div>
                          </div>
                          <div className="mt-4 grid gap-6 md:grid-cols-2">
                            <div>
                              <div className="crm-label">Name</div>
                              <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">{displayLeadName(selected)}</div>
                            </div>
                            <div>
                              <div className="crm-label">Move Size</div>
                              <div className="mt-2 text-sm font-medium text-[var(--app-ink)]">{selectedRaw?.moveSize || 'Not captured yet'}</div>
                            </div>
                          </div>
                          <div className="mt-6">
                            <div className="crm-label">Message</div>
                            <div className="mt-2 text-sm leading-7 text-[var(--app-muted)]">{selected.message || 'No message body provided.'}</div>
                          </div>
                        </div>

                        {recordingUrl || transcript ? (
                          <div className="space-y-6">
                            <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                              <div className="crm-label">Call Recording</div>
                              {recordingUrl ? (
                                <audio controls className="mt-4 w-full" src={recordingUrl}>
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

                        {selected.email ? (
                          <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                            <div className="crm-label">Email Reply</div>
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
                            <div className="crm-label">SMS Reply</div>
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
