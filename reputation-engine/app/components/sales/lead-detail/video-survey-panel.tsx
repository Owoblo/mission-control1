'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { VideoSurveySession } from '@/lib/video-survey'
import { videoSurveyStatusLabel } from '@/lib/video-survey'

type Props = {
  leadId: string
  leadName?: string
  phone?: string
  email?: string
  canEdit: boolean
}

type CreatedSurvey = {
  session: VideoSurveySession
  url: string
  sms: string
}

type DeliveryChannel = 'sms' | 'email'

export function VideoSurveyPanel({ leadId, leadName, phone, email, canEdit }: Props) {
  const createInFlight = useRef(false)
  const deliveryInFlight = useRef(false)
  const previousLatestStatus = useRef<string | null>(null)
  const [sessions, setSessions] = useState<VideoSurveySession[]>([])
  const [enabled, setEnabled] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreatedSurvey | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState<DeliveryChannel | null>(null)
  const [sentChannels, setSentChannels] = useState<DeliveryChannel[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => {
      void fetch(`/api/sales/leads/${encodeURIComponent(leadId)}/video-surveys`, { signal: controller.signal, cache: 'no-store' })
        .then(response => response.json())
        .then(data => {
          const nextSessions = (data.sessions || []) as VideoSurveySession[]
          const latestStatus = nextSessions[0]?.status || null
          if (latestStatus === 'waiting' && previousLatestStatus.current && previousLatestStatus.current !== 'waiting') {
            setNotice(`${leadName?.split(' ')[0] || 'The customer'} joined the video room and is waiting for you.`)
          }
          previousLatestStatus.current = latestStatus
          setSessions(nextSessions)
          setEnabled(Boolean(data.enabled))
          setConfigured(Boolean(data.configured))
        })
        .catch(() => null)
        .finally(() => setLoading(false))
    }
    refresh()
    const timer = window.setInterval(refresh, 5_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [leadId, leadName])

  async function createSurvey() {
    if (createInFlight.current) return
    createInFlight.current = true
    setCreating(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/sales/leads/${encodeURIComponent(leadId)}/video-surveys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not create video survey.')
      setCreated(data)
      setMessage(data.sms || '')
      setSentChannels([])
      setNotice(data.reused
        ? 'Reusing this customer’s existing private walkthrough link. Review the invitation, then resend it.'
        : 'Private video survey is ready. Review the invitation, then choose SMS or email.')
      setSessions(current => data.reused
        ? current.map(session => session.id === data.session.id ? data.session : session)
        : [data.session, ...current])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create video survey.')
    } finally {
      createInFlight.current = false
      setCreating(false)
    }
  }

  async function sendLink(channel: DeliveryChannel) {
    if (!created || deliveryInFlight.current) return
    const recipient = channel === 'sms' ? phone : email
    if (!recipient) return
    deliveryInFlight.current = true
    setSending(channel)
    setNotice(null)
    try {
      const digits = channel === 'sms' ? recipient.replace(/\D/g, '') : ''
      const to = channel === 'sms'
        ? (digits.startsWith('1') ? `+${digits}` : `+1${digits}`)
        : recipient.trim()
      const response = await fetch('/api/sales/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          to,
          subject: channel === 'email' ? 'Your private Saturn Star video estimate' : undefined,
          body: message,
          leadId,
          notes: `Video survey invitation sent by ${channel.toUpperCase()}`,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || `Could not send the video survey by ${channel.toUpperCase()}.`)
      setSentChannels(current => current.includes(channel) ? current : [...current, channel])
      setNotice(`Video survey link sent by ${channel.toUpperCase()} to ${to}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Could not send the video survey by ${channel.toUpperCase()}.`)
    } finally {
      deliveryInFlight.current = false
      setSending(null)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--app-line)] bg-[rgba(11,112,85,0.04)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">Video Estimate</div>
          <div className="mt-1 text-xs leading-5 text-[var(--app-muted)]">Walk through rooms live, record with consent, and build a reviewable inventory.</div>
        </div>
        <span className="text-lg">📹</span>
      </div>

      {loading ? (
        <div className="mt-3 text-xs text-[var(--app-muted)]">Checking video survey availability…</div>
      ) : !enabled || !configured ? (
        <div className="mt-3 rounded-lg bg-amber-50 p-2.5 text-[10px] leading-4 text-amber-800">
          Video surveys are safely disabled until the Cloudflare app, presets, webhook, and feature flag are configured.
        </div>
      ) : (
        <>
          {sessions[0]?.status === 'waiting' && (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 shadow-[0_0_0_3px_rgba(245,158,11,0.08)]">
              <div className="flex items-start gap-2.5">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-500" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-amber-950">{leadName?.split(' ')[0] || 'Customer'} is waiting in the video room</div>
                  <div className="mt-1 text-[10px] leading-4 text-amber-800">Join now to begin the room-by-room walkthrough.</div>
                </div>
              </div>
              <Link href={`/sales/video-surveys/${sessions[0].id}`} className="mt-3 flex w-full items-center justify-center rounded-lg bg-[#071421] px-3 py-2.5 text-xs font-semibold text-white">
                Join video walkthrough
              </Link>
            </div>
          )}

          {!created && (
            <button onClick={() => void createSurvey()} disabled={!canEdit || creating} className="crm-button mt-3 w-full justify-center border-[rgba(11,112,85,0.25)] bg-white text-[#0b7055] disabled:opacity-50">
              {creating ? 'Preparing private room…' : `Create Video Survey${leadName ? ` for ${leadName.split(' ')[0]}` : ''}`}
            </button>
          )}

          {created && (
            <div className="mt-3 space-y-3 rounded-xl border border-emerald-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Private room ready</div>
                  <div className="mt-0.5 text-[10px] text-[var(--app-muted)]">Review the invitation before sending.</div>
                </div>
                <span aria-hidden className="text-emerald-600">✓</span>
              </div>
              <textarea aria-label="Video survey invitation" value={message} onChange={event => setMessage(event.target.value)} rows={6} className="crm-input w-full resize-y text-xs" />
              <div className="break-all rounded-lg bg-[var(--app-bg)] p-2 text-[10px] leading-4 text-[var(--app-muted)]">{created.url}</div>
              <button onClick={() => void navigator.clipboard.writeText(created.url).then(() => setNotice('Video survey link copied.'))} className="crm-button w-full justify-center">
                Copy link
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => void sendLink('sms')} disabled={!phone || sending !== null || !message.trim()} title={phone ? `Send to ${phone}` : 'No phone number on this lead'} className="crm-button-dark justify-center px-2 disabled:opacity-50">
                  {sending === 'sms' ? 'Sending…' : sentChannels.includes('sms') ? '✓ SMS sent' : 'Send SMS'}
                </button>
                <button onClick={() => void sendLink('email')} disabled={!email || sending !== null || !message.trim()} title={email ? `Send to ${email}` : 'No email address on this lead'} className="crm-button-dark justify-center px-2 disabled:opacity-50">
                  {sending === 'email' ? 'Sending…' : sentChannels.includes('email') ? '✓ Email sent' : 'Send Email'}
                </button>
              </div>
              {(!phone || !email) && (
                <div className="text-[10px] leading-4 text-[var(--app-muted)]">
                  {!phone && !email ? 'Add a phone number or email to deliver this link.' : !phone ? 'SMS unavailable: no phone number on this lead.' : 'Email unavailable: no email address on this lead.'}
                </div>
              )}
              <button onClick={() => { setCreated(null); setMessage(''); setSentChannels([]); setNotice(null) }} className="w-full text-center text-[10px] font-semibold text-[var(--app-muted)] hover:text-[var(--app-ink)]">
                Done
              </button>
            </div>
          )}

          {sessions.length > 0 && (
            <details className="group mt-3 rounded-lg border border-[var(--app-line)] bg-white">
              <summary className="cursor-pointer list-none p-2.5 text-xs">
                <span className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold">Video surveys ({sessions.length})</span>
                    <span className="ml-2 text-[10px] text-[var(--app-muted)]">One customer link · Latest: {videoSurveyStatusLabel(sessions[0].status)}</span>
                  </span>
                  <span className="text-[var(--app-muted)] group-open:rotate-180">⌄</span>
                </span>
              </summary>
              <div className="space-y-2 border-t border-[var(--app-line)] p-2">
                {sessions.slice(0, 5).map((session, index) => (
                  <div key={session.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--app-bg)] p-2.5 text-xs">
                    <div>
                      <div className="font-semibold">{index === 0 ? 'Latest · ' : ''}{videoSurveyStatusLabel(session.status)}</div>
                      <div className="mt-0.5 text-[10px] text-[var(--app-muted)]">{new Date(session.createdAt).toLocaleString()}</div>
                    </div>
                    {!['cancelled', 'failed', 'confirmed'].includes(session.status) && (
                      <Link href={`/sales/video-surveys/${session.id}`} className={`rounded-lg px-3 py-2 text-[10px] font-semibold text-white ${session.status === 'waiting' ? 'animate-pulse bg-amber-600' : 'bg-[#071421]'}`}>
                        {session.status === 'waiting' ? 'Join' : ['recording_processing', 'analysis_pending', 'analyzing', 'review_required'].includes(session.status) ? 'Review' : 'Open'}
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
      {notice && <div className="mt-2 text-[10px] font-medium text-[var(--app-muted)]">{notice}</div>}
    </div>
  )
}
