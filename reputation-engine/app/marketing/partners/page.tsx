'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { PARTNERSHIP_STAGE_META } from '@/lib/marketing'
import { sendSalesMessage } from '@/lib/sales-api'
import { prepareUploadFile } from '@/lib/browser-media'
import { PARTNER_CATEGORIES, CATEGORY_LIST, SERVICE_AREAS, suggestBatchName, getCategoryMeta } from '@/lib/partner-categories'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Batch {
  id: string
  name: string
  industry: string | null
  city: string | null
  status: string
  sequence_type: string
  mail_sent_date: string | null
  email_delay_days: number
  sms_delay_days: number
  rep_name: string
  partnership_phone: string
  tracking_code: string | null
  notes: string | null
  created_at: string
  total_contacts: number
  responded_count: number
  engaged_count: number
  partner_count: number
  sms_jobs_total?: number
  sms_sent_total?: number
  sms_pending_total?: number
  sms_sent_today?: number
  sms_pending_today?: number
  sms_failed_total?: number
  sms_cancelled_total?: number
}

interface Contact {
  id: string
  name: string
  company: string | null
  title: string | null
  email: string | null
  phone: string | null
  address?: string | null
  city: string | null
  industry: string | null
  tier?: string | null
  tracking_code?: string | null
  stage: string | null
  pipeline?: string | null
  pipeline_phase: string | null
  decision: string | null
  sequence_step: number
  sequence_paused: boolean
  sequence_paused_reason: string | null
  next_follow_up: string | null
  last_touch_at: string | null
  email_scheduled_at: string | null
  sms_scheduled_at: string | null
  batch_id: string | null
  touch_count: number
  pending_queue_count?: number
  next_queue_due?: string | null
  next_queue_label?: string | null
  needs_follow_up: boolean
  normalized_stage: string
  latest_touch_channel?: string | null
  latest_touch_direction?: string | null
  latest_touch_note?: string | null
  latest_touch_metadata?: Record<string, unknown> | null
  latest_inbound_at?: string | null
  latest_inbound_note?: string | null
  latest_inbound_metadata?: Record<string, unknown> | null
  outreach_tier?: number | null
  owner_name?: string | null
  owner_email?: string | null
  priority?: string | null
  referred_lead_count?: number | null
  instantly_status?: string | null
  instantly_campaign_id?: string | null
  affiliate_partner_id?: string | null
  category?: string | null
  playbook?: PartnershipAiSuggestion | null
}

interface SheetUpdateForm {
  action: InboxQuickAction | ''
  sheetNote: string
  sheetTarget: string
  name: string
  company: string
  title: string
  email: string
  phone: string
  address: string
  city: string
  industry: string
  nextFollowUp: string
}

interface Touch {
  id: string
  contact_id?: string
  channel: string
  direction: string
  notes: string | null
  created_by?: string | null
  created_at: string
  outcome_code: string | null
  next_step: string | null
  metadata: Record<string, unknown> | null
}

interface ReplyItem {
  contact: Contact
  latest_touch: Touch
  bucket: 'needs_reply' | 'context' | 'postcard' | 'appointment' | 'opt_out' | 'closed' | 'review'
  needs_response: boolean
  playbook?: PartnershipAiSuggestion | null
}

interface PartnershipAiSuggestion {
  intent: string
  confidence: number
  goal_state: {
    digital_package: string
    physical_delivery: string
    referral_program: string
    meeting: string
  }
  extracted: {
    email?: string
    address?: string
    brokerage_location?: string
    time_window?: string
    asks_pricing?: boolean
    asks_service_area?: boolean
    asks_social_media?: boolean
    low_referral_activity?: boolean
    delivery_instructions?: string
  }
  recommended_action: string
  quick_action?: InboxQuickAction
  draft_sms: string
  draft_email_subject?: string
  draft_email_body?: string
  suggested_media_urls?: string[]
  risk_flags: string[]
  rationale: string
  package_configured: boolean
}

interface List {
  id: string
  name: string
  description: string | null
  tier: number | null
  color: string
  contact_count: number
  created_at: string
}

interface Appointment {
  id: string
  contact_id: string
  title: string
  scheduled_at: string
  duration_minutes: number
  channel: string
  notes: string | null
  status: string
}

interface AppointmentSuggestion {
  title: string
  scheduledAtLocal: string
  channel: string
  notes: string
}

interface InstantlyCampaign {
  id: string
  name: string
  status: number
}

interface PartnershipSmsPreview {
  ok?: boolean
  dry_run?: boolean
  total_input: number
  usable_with_phone: number
  no_primary_phone: number
  invalid_phone: number
  existing_phone_matches: number
  existing_exact_name_matches: number
  existing_skipped_no_repeat: number
  duplicate_in_file: number
  would_insert: number
  would_schedule: number
  days_to_finish: number
  sender_numbers: string[]
  timezone: string
  start_hour: number
  end_hour: number
  preview?: Array<{
    name: string
    phone: string
    city: string | null
    scheduled_at: string | null
    from_number: string | null
    message: string
  }>
  error?: string
}

type BrowserSpeechRecognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition

// ─── Utils ────────────────────────────────────────────────────────────────────

function readLocalStorageFlag(key: string) {
  try {
    if (typeof window === 'undefined') return false
    return window.localStorage?.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeLocalStorageFlag(key: string, value: boolean) {
  try {
    if (typeof window === 'undefined') return
    window.localStorage?.setItem(key, value ? '1' : '0')
  } catch {}
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtTime(d?: string | null) {
  if (!d) return ''
  return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function parseBatchNotes(notes?: string | null) {
  if (!notes) return null
  try {
    const parsed = JSON.parse(notes) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function timeAgo(d?: string | null) {
  if (!d) return '—'
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (diff < 1) return 'just now'
  if (diff < 60) return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return `${Math.floor(diff / 1440)}d ago`
}

function daysUntil(d?: string | null) {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)
}

function getPartnerReferralCode(contact: Contact) {
  return contact.tracking_code || contact.affiliate_partner_id || null
}

function getNextPartnerAction(contact: Contact) {
  if (contact.next_queue_label || contact.next_queue_due) {
    return {
      label: contact.next_queue_label || 'Follow up',
      due: contact.next_queue_due || null,
      overdue: contact.next_queue_due ? new Date(contact.next_queue_due).getTime() < Date.now() : false,
    }
  }
  if (contact.next_follow_up) {
    return {
      label: 'Follow up',
      due: contact.next_follow_up,
      overdue: new Date(contact.next_follow_up).getTime() < Date.now(),
    }
  }
  return null
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }

  const [header, ...data] = rows.filter(r => r.some(cell => cell.trim()))
  if (!header) return []
  const headers = header.map(h => h.trim())
  return data.map(values => Object.fromEntries(headers.map((key, index) => [key, (values[index] || '').trim()])))
}

function truncateText(value: string, max = 120) {
  const s = value.replace(/\s+/g, ' ').trim()
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`
}

function stripTouchPrefix(value: string) {
  return value
    .replace(/^Inbound SMS:\s*/i, '')
    .replace(/^SMS sent:\s*/i, '')
    .replace(/^Auto-SMS sent:\s*/i, '')
    .trim()
}

function cleanRichSmsFallback(value: string) {
  return value
    .replace(/\uFFFD/g, ' ')
    .replace(/â€[\u0098\u0099\u009c\u009d]?/g, ' ')
    .replace(/â[^\s]*/g, ' ')
    .replace(/ð[^\s]*/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanRichSmsDisplay(value: string) {
  return value
    .replace(/\uFFFD/g, ' ')
    .replace(/â€[\u0098\u0099\u009c\u009d]?/g, ' ')
    .replace(/â[^\s]*/g, ' ')
    .replace(/ð[^\s]*/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function hasRichSmsArtifact(value: string) {
  return /â€|�|ð/.test(value)
}

function normalizeReactionCompare(value: string) {
  return cleanRichSmsFallback(stripTouchPrefix(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getReactionKeyword(value: string) {
  const normalized = cleanRichSmsFallback(stripTouchPrefix(value)).toLowerCase()
  if (/\bloved\b|\blove\b/.test(normalized)) return 'loved'
  if (/\bliked\b|\blike\b/.test(normalized)) return 'liked'
  if (/\bemphasized\b|\bemphasis\b/.test(normalized)) return 'emphasized'
  if (/\blaughed\b|\blaugh\b|\bhaha\b/.test(normalized)) return 'laughed'
  if (/\bdisliked\b|\bdislike\b/.test(normalized)) return 'disliked'
  if (/\bquestioned\b|\bquestion\b/.test(normalized)) return 'questioned'
  return null
}

function reactionSymbol(kind: string | null) {
  if (kind === 'liked') return '👍'
  if (kind === 'emphasized') return '‼'
  if (kind === 'laughed') return '😂'
  if (kind === 'disliked') return '👎'
  if (kind === 'questioned') return '?'
  return '♥'
}

function detectSmsReaction(current: Touch, priorTouches: Touch[]) {
  if (current.channel !== 'sms' || current.direction !== 'inbound') return null
  const body = stripTouchPrefix(current.notes || '')
  const cleaned = normalizeReactionCompare(body)
  if (!cleaned) return null

  const previousOutbound = [...priorTouches].reverse().find(touch => touch.channel === 'sms' && touch.direction === 'outbound')
  if (!previousOutbound?.notes) return null

  const outbound = normalizeReactionCompare(previousOutbound.notes.replace(/\n?\[MMS:\s*[^\]]+\]/ig, ''))
  if (!outbound || outbound.length < 20) return null

  const containsQuotedOutbound = cleaned.includes(outbound.slice(0, Math.min(outbound.length, 80)))
  const mostlyQuotedOutbound = outbound.length > 0 && cleaned.length / outbound.length < 1.35
  const hasKnownReaction = getReactionKeyword(body)
  const hasRichEncodingArtifact = /â€|�|ð/.test(body)

  if (!containsQuotedOutbound && !(hasRichEncodingArtifact && mostlyQuotedOutbound && cleaned.includes(outbound.slice(0, 28)))) return null

  return {
    kind: hasKnownReaction || 'loved',
    preview: truncateText(cleanRichSmsFallback(stripTouchPrefix(previousOutbound.notes || '')), 96),
  }
}

function unwrapAutoTouch(value: string, prefix: string) {
  return value.replace(prefix, '').trim().replace(/^"/, '').replace(/"$/, '')
}

function summarizeTouch(channel: string, direction?: string | null, notes?: string | null) {
  const text = (notes || '').trim()
  const smsText = channel === 'sms' ? stripTouchPrefix(text) : text
  const reactionKeyword = getReactionKeyword(text)
  const smsArtifactPreview = channel === 'sms' && direction === 'inbound' && hasRichSmsArtifact(text) && reactionKeyword
    ? `${reactionSymbol(reactionKeyword)} reacted to your SMS`
    : null
  const cleanSmsArtifactText = channel === 'sms' && hasRichSmsArtifact(smsText) ? cleanRichSmsFallback(smsText) : smsText
  if (text.startsWith('Auto-SMS sent:')) return { label: 'Auto', body: cleanRichSmsDisplay(unwrapAutoTouch(text, 'Auto-SMS sent:')), auto: true }
  if (text.startsWith('Auto-email sent:')) return { label: 'Auto Email', body: unwrapAutoTouch(text, 'Auto-email sent:'), auto: true }
  if (text.startsWith('Added to Instantly')) return { label: 'Added to Instantly', body: text, auto: true }
  const src = (text.match(/source["\s:]+instantly/i) || (notes && JSON.stringify(notes).includes('instantly')))
  if (channel === 'email' && direction === 'inbound' && text.includes('Instantly')) return { label: 'Instantly Reply', body: text }
  if (channel === 'email' && text.includes('opened')) return { label: 'Email Opened', body: text, auto: true }
  if (channel === 'email' && text.includes('clicked')) return { label: 'Link Clicked', body: text, auto: true }
  if (channel === 'direct_mail') return { label: 'Direct Mail', body: text || 'Direct mail sent' }
  if (channel === 'phone' || channel === 'call') return { label: direction === 'inbound' ? 'Inbound Call' : 'Call', body: text || 'Call logged' }
  if (channel === 'email') return { label: direction === 'inbound' ? 'Email reply' : 'Email sent', body: text || 'Email' }
  if (channel === 'sms') return { label: direction === 'inbound' ? 'Received' : 'Sent', body: smsArtifactPreview || cleanSmsArtifactText || 'Message' }
  if (channel === 'note') return { label: 'Note', body: text || 'Note saved' }
  if (channel === 'appointment' || text.includes('Appointment')) return { label: 'Appointment', body: text }
  return { label: channel.replace(/_/g, ' '), body: text }
}

function getContactPreview(contact: Contact) {
  if (contact.latest_inbound_note) return summarizeTouch(contact.latest_touch_channel || 'sms', 'inbound', contact.latest_inbound_note)
  if (contact.latest_touch_note) return summarizeTouch(contact.latest_touch_channel || 'note', contact.latest_touch_direction, contact.latest_touch_note)
  return null
}

function isStackableMessage(touch?: Touch | null) {
  if (!touch) return false
  if (touch.channel === 'note' || touch.channel === 'appointment') return false
  return touch.direction === 'inbound' || touch.direction === 'outbound'
}

function sameMessageGroup(current?: Touch | null, adjacent?: Touch | null) {
  if (!isStackableMessage(current) || !isStackableMessage(adjacent)) return false
  if (current?.direction !== adjacent?.direction) return false
  const currentAt = current?.created_at ? new Date(current.created_at).getTime() : 0
  const adjacentAt = adjacent?.created_at ? new Date(adjacent.created_at).getTime() : 0
  if (!currentAt || !adjacentAt) return true
  return Math.abs(adjacentAt - currentAt) < 10 * 60 * 1000
}

function formatPlaybookLabel(value?: string | null) {
  return value ? value.replace(/_/g, ' ') : 'unknown'
}

function datetimeLocalFromDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function nextWeekdayDate(targetDay: number) {
  const date = new Date()
  date.setSeconds(0, 0)
  const daysAhead = (targetDay + 7 - date.getDay()) % 7 || 7
  date.setDate(date.getDate() + daysAhead)
  return date
}

function parseConversationAppointmentSuggestion(contact: Contact, context?: string): AppointmentSuggestion | null {
  const raw = [
    context,
    contact.latest_inbound_note,
    contact.latest_touch_note,
    contact.playbook?.draft_sms,
    contact.playbook?.rationale,
    contact.playbook?.extracted?.time_window,
  ].filter(Boolean).join(' ')
  const text = raw.toLowerCase()
  if (!text.trim()) return null
  if (/\bappointment booked:|reminder saved\b/.test(text)) return null

  const hasAppointmentLanguage = /\b(call|phone|meeting|appointment|meet|set it|schedule|scheduled|book|10am it is|works for you|works for me)\b/.test(text)
  const hasTimeLanguage = /\b(today|tomorrow|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|morning|afternoon|evening|\d{1,2}(?::\d{2})?\s?(?:am|pm)?)\b/.test(text)
  if (!hasAppointmentLanguage || !hasTimeLanguage) return null

  const dayMap: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 }
  const dayMatch = text.match(/\b(today|tomorrow|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/)
  let scheduled = new Date()
  scheduled.setSeconds(0, 0)
  if (dayMatch?.[1] === 'tomorrow') {
    scheduled.setDate(scheduled.getDate() + 1)
  } else if (dayMatch?.[1] && dayMatch[1] !== 'today') {
    scheduled = nextWeekdayDate(dayMap[dayMatch[1]])
  }

  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\b/)
  let hour = text.includes('afternoon') ? 14 : text.includes('evening') ? 17 : 10
  let minute = 0
  if (timeMatch) {
    hour = Number(timeMatch[1])
    minute = timeMatch[2] ? Number(timeMatch[2]) : 0
    const meridiem = timeMatch[3]
    if (meridiem === 'pm' && hour < 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
    if (!meridiem && hour < 8) hour += 12
  }
  scheduled.setHours(hour, minute, 0, 0)
  if (scheduled.getTime() < Date.now() && !dayMatch) scheduled.setDate(scheduled.getDate() + 1)

  const physical = /\b(postcards?|post cards?|drop cards?|flyers?|drop off|come by|stop by|deliver|office|reception|front desk)\b/.test(text)
  const phone = /\b(call|phone)\b/.test(text) && !physical
  return {
    title: physical ? 'Postcard drop-off' : phone ? 'Partnership call' : 'Partnership meeting',
    scheduledAtLocal: datetimeLocalFromDate(scheduled),
    channel: physical ? 'in_person' : phone ? 'phone' : 'meeting',
    notes: truncateText(cleanRichSmsFallback(stripTouchPrefix(raw)), 320),
  }
}

// ─── Small components ─────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: string }) {
  const meta = PARTNERSHIP_STAGE_META[stage as keyof typeof PARTNERSHIP_STAGE_META]
  if (!meta) return <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500">{stage}</span>
  return <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${meta.color}`}>{meta.label}</span>
}

function TierBadge({ tier }: { tier?: number | null }) {
  if (!tier) return null
  const styles: Record<number, string> = {
    1: 'bg-amber-100 text-amber-800',
    2: 'bg-sky-100 text-sky-700',
    3: 'bg-slate-100 text-slate-600',
  }
  return <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${styles[tier] ?? 'bg-slate-100 text-slate-500'}`}>T{tier}</span>
}

function CategoryBadge({ categoryId }: { categoryId?: string | null }) {
  const meta = getCategoryMeta(categoryId)
  if (!meta) return null
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${meta.color}`}>
      {meta.icon} {meta.label}
    </span>
  )
}

function InstantlyBadge({ status }: { status?: string | null }) {
  if (!status) return null
  const styles: Record<string, string> = {
    active: 'bg-violet-100 text-violet-700',
    sent: 'bg-violet-100 text-violet-700',
    opened: 'bg-blue-100 text-blue-700',
    clicked: 'bg-cyan-100 text-cyan-700',
    replied: 'bg-emerald-100 text-emerald-700',
    bounced: 'bg-rose-100 text-rose-700',
    removed: 'bg-slate-100 text-slate-400',
  }
  return <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${styles[status] ?? 'bg-slate-100 text-slate-500'}`}>✉ {status}</span>
}

function ChannelIcon({ channel, direction }: { channel: string; direction?: string }) {
  if (channel === 'call' || channel === 'phone') return <span>{direction === 'inbound' ? '📲' : '📞'}</span>
  if (channel === 'sms') return <span>💬</span>
  if (channel === 'email') return <span>✉️</span>
  if (channel === 'direct_mail') return <span>📬</span>
  if (channel === 'linkedin') return <span>🔗</span>
  if (channel === 'note') return <span>📝</span>
  if (channel === 'appointment') return <span>📅</span>
  return <span>📌</span>
}

// ─── Dialer hook ──────────────────────────────────────────────────────────────

type DialStatus = 'idle' | 'loading' | 'ready' | 'connecting' | 'ringing' | 'connected'
type TwilioVoiceCall = {
  accept?: () => void
  reject?: () => void
  disconnect?: () => void
  on: (event: string, cb: () => void) => void
  parameters?: Record<string, string>
}

function useDialer() {
  const [status, setStatus] = useState<DialStatus>('idle')
  const deviceRef = useRef<unknown>(null)
  const callRef = useRef<unknown>(null)
  const [incomingFrom, setIncomingFrom] = useState<string | null>(null)

  async function ensureReady() {
    if (deviceRef.current) return true
    setStatus('loading')
    await new Promise<void>(resolve => {
      if ((window as unknown as Record<string, unknown>).Twilio) { resolve(); return }
      const s = document.createElement('script')
      s.src = 'https://media.twiliocdn.com/sdk/js/voice/v2.0/twilio.min.js'
      s.onload = () => resolve()
      document.head.appendChild(s)
    })
    const res = await fetch('/api/marketing/dialer/token', { credentials: 'include' })
    if (!res.ok) { setStatus('idle'); return false }
    const { token } = await res.json() as { token: string }
    const TwilioSDK = (window as unknown as Record<string, unknown>).Twilio as { Device: new (token: string) => unknown }
    const device = new TwilioSDK.Device(token) as {
      on?: (event: string, cb: (call: TwilioVoiceCall) => void) => void
      register?: () => Promise<void>
    }
    device.on?.('incoming', call => {
      callRef.current = call
      setIncomingFrom(call.parameters?.From || 'Incoming partnership call')
      setStatus('ringing')
      call.on('accept', () => { setIncomingFrom(null); setStatus('connected') })
      call.on('disconnect', () => { setIncomingFrom(null); setStatus('ready'); callRef.current = null })
      call.on('cancel', () => { setIncomingFrom(null); setStatus('ready'); callRef.current = null })
      call.on('reject', () => { setIncomingFrom(null); setStatus('ready'); callRef.current = null })
      call.on('error', () => { setIncomingFrom(null); setStatus('ready'); callRef.current = null })
    })
    await device.register?.()
    deviceRef.current = device
    setStatus('ready')
    return true
  }

  async function call(phoneNumber: string) {
    const ready = await ensureReady()
    if (!ready || !deviceRef.current) return
    setStatus('connecting')
    const device = deviceRef.current as { connect: (opts?: unknown) => Promise<unknown> }
    const conn = await device.connect({ params: { To: phoneNumber } } as unknown) as TwilioVoiceCall
    callRef.current = conn
    conn.on('accept', () => setStatus('connected'))
    conn.on('disconnect', () => { setStatus('ready'); callRef.current = null })
    conn.on('error', () => { setStatus('ready'); callRef.current = null })
  }

  function hangup() {
    const conn = callRef.current as { disconnect?: () => void } | null
    conn?.disconnect?.()
  }

  function acceptIncoming() {
    const conn = callRef.current as TwilioVoiceCall | null
    conn?.accept?.()
  }

  function rejectIncoming() {
    const conn = callRef.current as TwilioVoiceCall | null
    conn?.reject?.()
    setIncomingFrom(null)
    setStatus('ready')
    callRef.current = null
  }

  return { status, incomingFrom, call, hangup, acceptIncoming, rejectIncoming, ensureReady }
}

// ─── Appointment Modal ────────────────────────────────────────────────────────

function AppointmentModal({ contact, onClose, onDone }: {
  contact: Contact
  onClose: () => void
  onDone: () => void
}) {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  now.setHours(now.getHours() + 1)
  const [form, setForm] = useState({ title: 'Follow-up call', scheduled_at: now.toISOString().slice(0, 16), duration_minutes: 30, channel: 'phone', notes: '' })
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/marketing/appointments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_id: contact.id, ...form, scheduled_at: new Date(form.scheduled_at).toISOString() }),
    })
    onDone()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-[#1a2744]">Book Appointment</h3>
        <p className="mt-0.5 text-sm text-slate-500">{contact.name}</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Title</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-500">Date & Time</label>
              <input type="datetime-local" value={form.scheduled_at} onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))} required
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Channel</label>
              <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]">
                <option value="phone">📞 Phone</option>
                <option value="in_person">🤝 In person</option>
                <option value="email">✉️ Email</option>
                <option value="video">📹 Video</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Book'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Add to Instantly Modal ───────────────────────────────────────────────────

function AddToInstantlyModal({ contact, onClose, onDone }: {
  contact: Contact
  onClose: () => void
  onDone: () => void
}) {
  const [campaigns, setCampaigns] = useState<InstantlyCampaign[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/marketing/instantly/campaigns', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.campaigns) setCampaigns(d.campaigns) })
  }, [])

  async function submit() {
    if (!selectedId || !contact.email) return
    setSaving(true)
    const nameParts = contact.name.trim().split(' ')
    const res = await fetch('/api/marketing/instantly/leads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({
        contact_id: contact.id,
        campaign_id: selectedId,
        email: contact.email,
        first_name: nameParts[0] ?? '',
        last_name: nameParts.slice(1).join(' ') ?? '',
        company_name: contact.company ?? '',
        phone: contact.phone ?? '',
      }),
    })
    const data = await res.json() as { error?: string }
    if (!res.ok) { setError(data.error ?? 'Failed'); setSaving(false); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-[#1a2744]">Add to Instantly</h3>
        <p className="mt-0.5 text-sm text-slate-500">{contact.name} · {contact.email ?? 'no email'}</p>
        {!contact.email && <div className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">This contact has no email address.</div>}
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Campaign</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]">
              <option value="">— select campaign —</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {error && <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={submit} disabled={saving || !selectedId || !contact.email}
              className="flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Adding…' : 'Add to Campaign'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Add to List Modal ────────────────────────────────────────────────────────

function AddToListModal({ contact, lists, onClose, onDone }: {
  contact: Contact
  lists: List[]
  onClose: () => void
  onDone: () => void
}) {
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!selectedId) return
    setSaving(true)
    await fetch(`/api/marketing/lists/${selectedId}/contacts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_ids: [contact.id] }),
    })
    onDone()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-[#1a2744]">Add to List</h3>
        <p className="mt-0.5 text-sm text-slate-500">{contact.name}</p>
        <div className="mt-4 space-y-3">
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]">
            <option value="">— select list —</option>
            {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={submit} disabled={saving || !selectedId}
              className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Adding…' : 'Add'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Decision Modal ───────────────────────────────────────────────────────────

function DecisionModal({ contact, onClose, onDone }: { contact: Contact; onClose: () => void; onDone: () => void }) {
  const [decision, setDecision] = useState<'agreed' | 'rejected' | 'thinking'>('agreed')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    setSaving(true)
    await fetch('/api/marketing/touches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({
        contact_id: contact.id, channel: 'note', direction: 'internal',
        notes: `Decision: ${decision}. ${notes}`.trim(),
        outcome_code: decision,
        new_stage: decision === 'agreed' ? 'partnership_active' : decision === 'rejected' ? 'dormant' : 'qualified',
      }),
    })
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-[#1a2744]">Log Decision</h3>
        <p className="mt-0.5 text-sm text-slate-500">{contact.name}</p>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {(['agreed', 'thinking', 'rejected'] as const).map(d => (
            <button key={d} onClick={() => setDecision(d)}
              className={`rounded-[14px] border py-3 text-sm font-semibold capitalize transition ${decision === d ? 'border-[#1a2744] bg-[#1a2744] text-white' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-[#1a2744]'}`}>
              {d === 'agreed' ? '✅ Won' : d === 'thinking' ? '🤔 Maybe' : '❌ Pass'}
            </button>
          ))}
        </div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes…"
          className="mt-4 h-20 w-full resize-none rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Log'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Contact Drawer ───────────────────────────────────────────────────────────

function ContactDrawer({ contact, lists, onClose, onRefresh }: {
  contact: Contact
  lists: List[]
  onClose: () => void
  onRefresh: () => void
}) {
  const [touches, setTouches] = useState<Touch[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [showDecision, setShowDecision] = useState(false)
  const [showAppointment, setShowAppointment] = useState(false)
  const [showInstantly, setShowInstantly] = useState(false)
  const [showAddToList, setShowAddToList] = useState(false)
  const [affiliateInfo, setAffiliateInfo] = useState<{ portalUrl: string; isNew: boolean } | null>(null)
  const [activatingAffiliate, setActivatingAffiliate] = useState(false)
  const [copiedPortal, setCopiedPortal] = useState(false)

  async function activateAffiliate() {
    setActivatingAffiliate(true)
    try {
      const res = await fetch(`/api/marketing/contacts/${contact.id}/decide`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ decision: 'agreed', notes: 'Activated via contact drawer' }),
      })
      const data = await res.json() as { ok?: boolean }
      if (data.ok) {
        // Poll briefly for affiliate info
        await new Promise(r => setTimeout(r, 1200))
        const contactRes = await fetch(`/api/marketing/contacts?q=${encodeURIComponent(contact.name)}&limit=1`, { credentials: 'include' })
        const cData = await contactRes.json() as { contacts?: Array<{ affiliate_partner_id?: string }> }
        const partnerId = cData.contacts?.[0]?.affiliate_partner_id
        if (partnerId) {
          const appUrl = window.location.origin
          setAffiliateInfo({ portalUrl: `${appUrl}/affiliate?token=`, isNew: true })
        }
        onRefresh()
      }
    } finally {
      setActivatingAffiliate(false)
    }
  }

  // Load affiliate info if contact is already active
  useEffect(() => {
    if (contact.affiliate_partner_id) {
      fetch(`/api/sales/affiliate-partners`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then((partners: Array<{ id: string; portalUrl: string | null }>) => {
          const p = partners.find(x => x.id === contact.affiliate_partner_id)
          if (p?.portalUrl) setAffiliateInfo({ portalUrl: p.portalUrl, isNew: false })
        }).catch(() => {})
    }
  }, [contact.affiliate_partner_id])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/marketing/touches?contact_id=${contact.id}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch(`/api/marketing/appointments?contact_id=${contact.id}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]).then(([t, a]) => {
      setTouches(Array.isArray(t) ? t : [])
      setAppointments(Array.isArray(a) ? a : [])
    }).finally(() => setLoading(false))
  }, [contact.id])

  async function saveNote() {
    if (!noteText.trim()) return
    setSavingNote(true)
    await fetch('/api/marketing/touches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_id: contact.id, channel: 'note', direction: 'internal', notes: noteText.trim() }),
    })
    setNoteText('')
    const t = await fetch(`/api/marketing/touches?contact_id=${contact.id}`, { credentials: 'include' }).then(r => r.json())
    setTouches(Array.isArray(t) ? t : [])
    setSavingNote(false)
  }

  async function updateApptStatus(id: string, status: string) {
    await fetch('/api/marketing/appointments', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ id, status }),
    })
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a))
  }

  const upcoming = appointments.filter(a => a.status === 'scheduled' && new Date(a.scheduled_at) > new Date())
  const past = appointments.filter(a => a.status !== 'scheduled' || new Date(a.scheduled_at) <= new Date())
  const referralCode = getPartnerReferralCode(contact)
  const nextAction = getNextPartnerAction(contact)
  const owner = contact.owner_name || contact.owner_email || 'Unassigned'
  const referralCount = contact.referred_lead_count ?? 0

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="shrink-0 border-b border-slate-100 px-5 py-4">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-semibold text-[#1a2744]">{contact.name}</span>
                <TierBadge tier={contact.outreach_tier} />
                <StageBadge stage={contact.normalized_stage} />
                {contact.instantly_status && <InstantlyBadge status={contact.instantly_status} />}
              </div>
              <div className="mt-0.5 text-sm text-slate-500">{contact.company ?? contact.industry ?? 'No company'}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                {contact.phone && <a href={`tel:${contact.phone}`} className="hover:text-[#1a2744]">📞 {contact.phone}</a>}
                {contact.email && <a href={`mailto:${contact.email}`} className="hover:text-[#1a2744]">✉️ {contact.email}</a>}
                {contact.city && <span>📍 {contact.city}</span>}
              </div>
            </div>
            <button onClick={onClose} className="ml-2 shrink-0 rounded-full p-2 text-slate-400 hover:bg-slate-100">✕</button>
          </div>

          {/* Action buttons */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => setShowAppointment(true)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-[#1a2744] hover:text-[#1a2744] transition">
              📅 Book Appointment
            </button>
            {!contact.instantly_campaign_id && contact.email && (
              <button onClick={() => setShowInstantly(true)}
                className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition">
                ⚡ Add to Instantly
              </button>
            )}
            <button onClick={() => setShowAddToList(true)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-[#1a2744] hover:text-[#1a2744] transition">
              + Add to List
            </button>
            {contact.sequence_paused && !contact.decision && (
              <button onClick={() => setShowDecision(true)}
                className="rounded-xl bg-[#1a2744] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#243560] transition">
                Log Decision
              </button>
            )}
            {(contact.normalized_stage === 'partnership_active' || contact.decision === 'agreed') && (
              affiliateInfo?.portalUrl ? (
                <button
                  onClick={() => { navigator.clipboard.writeText(affiliateInfo.portalUrl); setCopiedPortal(true); setTimeout(() => setCopiedPortal(false), 2000) }}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition">
                  {copiedPortal ? '✓ Copied!' : '🔗 Copy Portal Link'}
                </button>
              ) : !contact.affiliate_partner_id ? (
                <button onClick={() => void activateAffiliate()} disabled={activatingAffiliate}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-50">
                  {activatingAffiliate ? '⏳ Creating portal…' : '🤝 Create Affiliate Portal'}
                </button>
              ) : null
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Owner</div>
              <div className="mt-1 truncate text-xs font-semibold text-[#1a2744]">{owner}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Category</div>
              <div className="mt-1 truncate text-xs font-semibold text-[#1a2744]">{contact.industry || contact.category || 'Uncategorized'}</div>
            </div>
            <div className={`col-span-2 rounded-xl border px-3 py-2 ${nextAction?.overdue ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Next Action</div>
                  <div className="mt-1 truncate text-xs font-semibold text-[#1a2744]">{nextAction?.label || 'No next action set'}</div>
                </div>
                <div className={`shrink-0 text-xs font-semibold ${nextAction?.overdue ? 'text-amber-700' : 'text-slate-500'}`}>{nextAction?.due ? fmtDate(nextAction.due) : '—'}</div>
              </div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-emerald-700/70">Referral Code</div>
              <div className="mt-1 truncate text-xs font-bold text-emerald-800">{referralCode || 'Not assigned'}</div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Referrals</div>
              <div className="mt-1 text-xs font-bold text-[#1a2744]">{referralCount} captured</div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* Upcoming appointments */}
          {upcoming.length > 0 && (
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Upcoming</div>
              <div className="space-y-2">
                {upcoming.map(a => (
                  <div key={a.id} className="flex items-center justify-between rounded-[14px] border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <div>
                      <div className="text-sm font-semibold text-[#1a2744]">{a.title}</div>
                      <div className="text-xs text-slate-500">{fmtDateTime(a.scheduled_at)} · {a.duration_minutes}min · {a.channel}</div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => updateApptStatus(a.id, 'completed')} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100">Done</button>
                      <button onClick={() => updateApptStatus(a.id, 'cancelled')} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Note input */}
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="flex gap-2">
              <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={2} placeholder="Add a note…"
                className="flex-1 resize-none rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
              <button onClick={saveNote} disabled={savingNote || !noteText.trim()}
                className="self-end rounded-[14px] bg-[#1a2744] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {savingNote ? '…' : 'Save'}
              </button>
            </div>
          </div>

          {/* Timeline */}
          <div className="px-5 py-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Timeline</div>
            {loading ? (
              <div className="py-8 text-center text-xs text-slate-400">Loading…</div>
            ) : touches.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">No activity yet.</div>
            ) : (
              <div className="space-y-2">
                {touches.map(t => {
                  const s = summarizeTouch(t.channel, t.direction, t.notes)
                  const isInbound = t.direction === 'inbound'
                  return (
                    <div key={t.id} className="flex gap-3 rounded-[14px] border border-slate-100 bg-slate-50 p-3">
                      <div className="mt-0.5 text-base shrink-0"><ChannelIcon channel={t.channel} direction={t.direction} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-[#1a2744]">{s.label}</span>
                            {s.auto && <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">Auto</span>}
                            {isInbound && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">Inbound</span>}
                          </div>
                          <span className="shrink-0 text-[10px] text-slate-400">{fmtDate(t.created_at)} {fmtTime(t.created_at)}</span>
                        </div>
                        {s.body && <div className="mt-0.5 text-xs text-slate-600 line-clamp-3">{s.body}</div>}
                        {t.outcome_code && <div className="mt-1 text-[10px] font-semibold uppercase text-slate-400">{t.outcome_code.replace(/_/g, ' ')}</div>}
                      </div>
                    </div>
                  )
                })}
                {past.length > 0 && (
                  <div className="pt-1">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-300">Past Appointments</div>
                    {past.map(a => (
                      <div key={a.id} className="flex items-center gap-3 rounded-[14px] border border-slate-100 bg-slate-50 p-3">
                        <span className="text-base">📅</span>
                        <div>
                          <div className="text-xs font-semibold text-slate-600">{a.title}</div>
                          <div className="text-[10px] text-slate-400">{fmtDateTime(a.scheduled_at)} · <span className={a.status === 'completed' ? 'text-emerald-600' : 'text-slate-400'}>{a.status}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showDecision && <DecisionModal contact={contact} onClose={() => setShowDecision(false)} onDone={() => { setShowDecision(false); onRefresh(); onClose() }} />}
      {showAppointment && <AppointmentModal contact={contact} onClose={() => setShowAppointment(false)} onDone={() => { setShowAppointment(false); const a = fetch(`/api/marketing/appointments?contact_id=${contact.id}`, { credentials: 'include' }).then(r => r.json()).then(d => setAppointments(Array.isArray(d) ? d : [])) }} />}
      {showInstantly && <AddToInstantlyModal contact={contact} onClose={() => setShowInstantly(false)} onDone={() => { setShowInstantly(false); onRefresh() }} />}
      {showAddToList && <AddToListModal contact={contact} lists={lists} onClose={() => setShowAddToList(false)} onDone={() => { setShowAddToList(false) }} />}
    </>
  )
}

// ─── New Batch Modal ──────────────────────────────────────────────────────────

function NewBatchModal({ onClose, onDone }: { onClose: () => void; onDone: (batch: Batch) => void }) {
  const [category, setCategory] = useState('')
  const [city, setCity] = useState('windsor')
  const [form, setForm] = useState({ name: '', industry: '', city: 'windsor', email_delay_days: 10, sms_delay_days: 5, rep_name: 'Hunter' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-suggest batch name when category + city are selected
  function handleCategoryChange(catId: string) {
    setCategory(catId)
    const suggested = suggestBatchName(city, catId)
    if (suggested) setForm(f => ({ ...f, name: suggested, industry: PARTNER_CATEGORIES[catId]?.label || f.industry }))
  }

  function handleCityChange(cityId: string) {
    setCity(cityId)
    if (category) {
      const suggested = suggestBatchName(cityId, category)
      if (suggested) setForm(f => ({ ...f, name: suggested, city: cityId }))
    } else {
      setForm(f => ({ ...f, city: cityId }))
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Batch name required'); return }
    setSaving(true)
    const res = await fetch('/api/marketing/batches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ ...form, city, category, sequence_type: getCategoryMeta(category)?.tier === 2 ? 'corporate' : 'standard' }),
    })
    const data = await res.json() as { ok?: boolean; batch?: Batch; error?: string }
    if (!res.ok || !data.ok) { setError(data.error ?? 'Failed'); setSaving(false); return }
    onDone(data.batch!)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#1a2744]">New Batch</h3>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">✕</button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">

          {/* City + Category — the two most important fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500">City *</label>
              <select value={city} onChange={e => handleCityChange(e.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]">
                {SERVICE_AREAS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Category *</label>
              <select value={category} onChange={e => handleCategoryChange(e.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]">
                <option value="">— select —</option>
                <optgroup label="Tier 1 — High Frequency">
                  {CATEGORY_LIST.filter(c => c.tier === 1).map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                </optgroup>
                <optgroup label="Tier 2 — Commercial">
                  {CATEGORY_LIST.filter(c => c.tier === 2).map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                </optgroup>
                <optgroup label="Tier 3 — Community">
                  {CATEGORY_LIST.filter(c => c.tier === 3).map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                </optgroup>
              </select>
            </div>
          </div>

          {/* Suggested cold call script */}
          {category && PARTNER_CATEGORIES[category] && (
            <div className="rounded-[10px] border border-[#1a2744]/10 bg-[#f8f9fc] px-3 py-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Opening line</div>
              <div className="text-xs text-slate-600 italic">"{PARTNER_CATEGORIES[category].suggestedScript}"</div>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-500">Batch Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder={category && city ? suggestBatchName(city, category) || 'e.g. Windsor Realtors — Q2 2026' : 'e.g. Windsor Realtors — Q2 2026'}
              required className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500">Email delay (days)</label>
              <input type="number" min={1} max={30} value={form.email_delay_days} onChange={e => setForm(f => ({ ...f, email_delay_days: Number(e.target.value) }))}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">SMS delay (days)</label>
              <input type="number" min={1} max={30} value={form.sms_delay_days} onChange={e => setForm(f => ({ ...f, sms_delay_days: Number(e.target.value) }))}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Rep Name</label>
            <input value={form.rep_name} onChange={e => setForm(f => ({ ...f, rep_name: e.target.value }))}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Mark Mailed Modal ────────────────────────────────────────────────────────

function MarkMailedModal({ batch, onClose, onDone }: { batch: Batch; onClose: () => void; onDone: () => void }) {
  const [mailDate, setMailDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const emailDate = addDays(mailDate, batch.email_delay_days ?? 10)
  const smsDate = addDays(emailDate, batch.sms_delay_days ?? 5)

  async function submit() {
    setSaving(true)
    const res = await fetch(`/api/marketing/batches/${batch.id}/mark-mailed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ mail_date: mailDate }),
    })
    const data = await res.json() as { ok?: boolean; error?: string }
    if (!res.ok || !data.ok) { setError(data.error ?? 'Failed'); setSaving(false); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[#1a2744]">Mark as Mailed</h3>
            <p className="mt-0.5 text-sm text-slate-500">{batch.name}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">✕</button>
        </div>
        <div className="mt-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">Date Mailed</label>
            <input type="date" value={mailDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setMailDate(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Auto-sequence fires:</div>
            <div className="flex justify-between"><span className="text-slate-600">✉️ Email</span><span className="font-semibold text-[#1a2744]">{fmtDate(emailDate)}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">💬 SMS</span><span className="font-semibold text-[#1a2744]">{fmtDate(smsDate)}</span></div>
          </div>
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex-1 rounded-xl bg-[#f5a623] py-2.5 text-sm font-semibold text-[#1a2744] disabled:opacity-50">{saving ? 'Saving…' : '✓ Confirm'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── CSV Import Modal ─────────────────────────────────────────────────────────

function CsvImportModal({ batch, onClose, onDone }: { batch: Batch; onClose: () => void; onDone: (n: number) => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const FIELDS = ['name', 'company', 'title', 'email', 'phone', 'address', 'city', 'industry', 'website', 'category']

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const parsed = parseCSV(ev.target?.result as string)
      if (parsed.length === 0) { setError('Could not parse CSV'); return }
      const cols = Object.keys(parsed[0])
      setHeaders(cols); setRows(parsed); setError(null)
      const auto: Record<string, string> = {}
      for (const f of FIELDS) {
        const m = cols.find(c => c.toLowerCase().includes(f) || f.includes(c.toLowerCase()))
        if (m) auto[f] = m
      }
      setMapping(auto)
    }
    reader.readAsText(file)
  }

  async function doImport() {
    if (!mapping.name) { setError('Name column required'); return }
    setImporting(true)
    const contacts = rows.map(row => {
      const c: Record<string, string> = {}
      for (const [f, col] of Object.entries(mapping)) { if (col) c[f] = row[col] ?? '' }
      return c
    })
    const res = await fetch('/api/marketing/contacts/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ batch_id: batch.id, contacts }),
    })
    const data = await res.json() as { ok?: boolean; inserted?: number; error?: string }
    if (!res.ok || !data.ok) { setError(data.error ?? 'Import failed'); setImporting(false); return }
    onDone(data.inserted ?? 0)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[#1a2744]">Import Contacts</h3>
            <p className="mt-0.5 text-sm text-slate-500">{batch.name}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">✕</button>
        </div>
        {rows.length === 0 ? (
          <div className="mt-6">
            <div onClick={() => fileRef.current?.click()}
              className="cursor-pointer rounded-[18px] border-2 border-dashed border-slate-300 p-10 text-center hover:border-[#1a2744]">
              <div className="text-2xl">📄</div>
              <div className="mt-2 text-sm font-medium text-slate-600">Click to upload CSV</div>
              <div className="mt-1 text-xs text-slate-400">Name, Email, Phone, Company, City…</div>
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-[14px] border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500">{rows.length} rows — map columns</div>
            <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto">
              {FIELDS.map(field => (
                <div key={field}>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{field}</label>
                  <select value={mapping[field] ?? ''} onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}
                    className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-[#1a2744] outline-none">
                    <option value="">— skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={doImport} disabled={importing} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{importing ? 'Importing…' : `Import ${rows.length}`}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({ batches, contacts, loading, onRefresh, onTabChange }: {
  batches: Batch[]; contacts: Contact[]; loading: boolean; onRefresh: () => void; onTabChange: (t: Tab) => void
}) {
  const [newBatch, setNewBatch] = useState(false)
  const [markMailed, setMarkMailed] = useState<Batch | null>(null)
  const [csvBatch, setCsvBatch] = useState<Batch | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const totalMailed = batches.reduce((s, b) => s + (b.total_contacts || 0), 0)
  const totalResponded = batches.reduce((s, b) => s + (b.responded_count || 0), 0)
  const totalPartners = batches.reduce((s, b) => s + (b.partner_count || 0), 0)
  const needsReply = contacts.filter(c => c.sequence_paused && !c.decision)

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[14px] bg-[#1a2744] px-5 py-3 text-sm font-medium text-white shadow-xl">{toast}</div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total Mailed', value: totalMailed, color: 'text-[#1a2744]' },
          { label: 'Responded', value: totalResponded, color: 'text-violet-700' },
          { label: 'Needs Reply', value: needsReply.length, color: needsReply.length > 0 ? 'text-amber-600' : 'text-[#1a2744]' },
          { label: 'Partners Won', value: totalPartners, color: 'text-emerald-700' },
        ].map(s => (
          <div key={s.label} className="rounded-[20px] border border-slate-200 bg-white p-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{s.label}</div>
            <div className={`mt-2 text-4xl font-bold tracking-tight ${s.color}`}>{loading ? '—' : s.value}</div>
          </div>
        ))}
      </div>

      {needsReply.length > 0 && (
        <button onClick={() => onTabChange('pipeline')}
          className="w-full rounded-[20px] border-2 border-amber-300 bg-amber-50 p-4 text-left hover:bg-amber-100 transition">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔔</span>
              <div>
                <div className="font-semibold text-amber-800">{needsReply.length} contact{needsReply.length !== 1 ? 's' : ''} responded — ready for follow-up</div>
                <div className="mt-0.5 text-xs text-amber-600">{needsReply.slice(0, 3).map(c => c.name).join(', ')}{needsReply.length > 3 ? ` +${needsReply.length - 3} more` : ''}</div>
              </div>
            </div>
            <span className="text-sm font-semibold text-amber-700">Open Pipeline →</span>
          </div>
        </button>
      )}

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#1a2744]">Batches</h2>
          <button onClick={() => setNewBatch(true)} className="rounded-xl bg-[#f5a623] px-4 py-2 text-sm font-semibold text-[#1a2744] hover:brightness-95 transition">+ New Batch</button>
        </div>

        {loading ? (
          <div className="rounded-[20px] border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : batches.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-slate-300 bg-white p-10 text-center">
            <div className="text-3xl">📬</div>
            <div className="mt-3 text-sm font-semibold text-slate-600">No batches yet</div>
            <button onClick={() => setNewBatch(true)} className="mt-4 rounded-xl bg-[#1a2744] px-5 py-2 text-sm font-semibold text-white">+ New Batch</button>
          </div>
        ) : (
          <div className="space-y-3">
            {batches.map(batch => {
              const notes = parseBatchNotes(batch.notes)
              const isSmsCampaign = notes?.type === 'partnership_sms_campaign' || (batch.sms_jobs_total ?? 0) > 0
              const smsTotal = batch.sms_jobs_total ?? 0
              const smsSent = batch.sms_sent_total ?? 0
              const smsPending = batch.sms_pending_total ?? 0
              const smsSentToday = batch.sms_sent_today ?? 0
              const smsPendingToday = batch.sms_pending_today ?? 0
              const smsProgress = smsTotal > 0 ? Math.round((smsSent / smsTotal) * 100) : 0
              const mailed = !!batch.mail_sent_date
              const emailDate = mailed ? addDays(batch.mail_sent_date!, batch.email_delay_days ?? 10) : null
              const smsDate = emailDate ? addDays(emailDate, batch.sms_delay_days ?? 5) : null
              const emailDays = emailDate ? daysUntil(emailDate) : null
              const smsDays = smsDate ? daysUntil(smsDate) : null
              return (
                <div key={batch.id} className="rounded-[22px] border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[#1a2744]">{batch.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${batch.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{batch.status}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                        {batch.industry && <span>{batch.industry}</span>}
                        {batch.city && <span>{batch.city}</span>}
                        <span>{batch.total_contacts} contacts</span>
                        {batch.responded_count > 0 && <span className="text-violet-600">{batch.responded_count} responded</span>}
                        {batch.partner_count > 0 && <span className="text-emerald-600">{batch.partner_count} partners</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 items-end">
                      {!isSmsCampaign && !mailed && batch.total_contacts > 0 && (
                        <button onClick={() => setMarkMailed(batch)} className="rounded-xl bg-[#f5a623] px-3 py-1.5 text-xs font-semibold text-[#1a2744] hover:brightness-95">Mark Mailed</button>
                      )}
                      {!isSmsCampaign && <button onClick={() => setCsvBatch(batch)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">+ Import</button>}
                    </div>
                  </div>
                  {isSmsCampaign && (
                    <div className="mt-4 space-y-3">
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-[var(--app-accent)] transition-all" style={{ width: `${smsProgress}%` }} />
                      </div>
                      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                        <div className="rounded-[14px] bg-emerald-50 p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Sent today</div>
                          <div className="mt-1 text-xl font-bold text-emerald-800">{smsSentToday}</div>
                        </div>
                        <div className="rounded-[14px] bg-amber-50 p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Left today</div>
                          <div className="mt-1 text-xl font-bold text-amber-800">{smsPendingToday}</div>
                        </div>
                        <div className="rounded-[14px] bg-slate-50 p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Sent total</div>
                          <div className="mt-1 text-xl font-bold text-[#1a2744]">{smsSent}</div>
                        </div>
                        <div className="rounded-[14px] bg-slate-50 p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Remaining</div>
                          <div className="mt-1 text-xl font-bold text-[#1a2744]">{smsPending}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                        <span>{smsProgress}% complete</span>
                        {(batch.sms_failed_total ?? 0) > 0 && <span className="text-rose-600">{batch.sms_failed_total} failed</span>}
                        {(batch.sms_cancelled_total ?? 0) > 0 && <span>{batch.sms_cancelled_total} cancelled/skipped</span>}
                        {typeof notes?.startHour === 'number' && typeof notes?.endHour === 'number' && (
                          <span>Window {notes.startHour}:00-{notes.endHour}:00</span>
                        )}
                      </div>
                    </div>
                  )}
                  {!isSmsCampaign && mailed && (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-[14px] bg-slate-50 p-3">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Mailed</div>
                        <div className="mt-1 text-sm font-semibold text-[#1a2744]">{fmtDate(batch.mail_sent_date)}</div>
                      </div>
                      <div className={`rounded-[14px] p-3 ${emailDays !== null && emailDays <= 0 ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">✉️ Email</div>
                        <div className="mt-1 text-sm font-semibold text-[#1a2744]">{emailDays !== null && emailDays <= 0 ? '✅ Sent' : fmtDate(emailDate)}</div>
                        {emailDays !== null && emailDays > 0 && <div className="text-[10px] text-amber-600 font-semibold">in {emailDays}d</div>}
                      </div>
                      <div className={`rounded-[14px] p-3 ${smsDays !== null && smsDays <= 0 ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">💬 SMS</div>
                        <div className="mt-1 text-sm font-semibold text-[#1a2744]">{smsDays !== null && smsDays <= 0 ? '✅ Sent' : fmtDate(smsDate)}</div>
                        {smsDays !== null && smsDays > 0 && <div className="text-[10px] text-amber-600 font-semibold">in {smsDays}d</div>}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {newBatch && <NewBatchModal onClose={() => setNewBatch(false)} onDone={b => { setNewBatch(false); onRefresh(); showToast(`Batch "${b.name}" created`) }} />}
      {markMailed && <MarkMailedModal batch={markMailed} onClose={() => setMarkMailed(null)} onDone={() => { setMarkMailed(null); onRefresh(); showToast('Sequence timer started') }} />}
      {csvBatch && <CsvImportModal batch={csvBatch} onClose={() => setCsvBatch(null)} onDone={n => { setCsvBatch(null); onRefresh(); showToast(`${n} contacts imported`) }} />}
    </div>
  )
}

// ─── Tab: Lists ───────────────────────────────────────────────────────────────

function ListsTab({ contacts, onSelectContact }: { contacts: Contact[]; onSelectContact: (c: Contact) => void }) {
  const [lists, setLists] = useState<List[]>([])
  const [selectedList, setSelectedList] = useState<List | null>(null)
  const [listContacts, setListContacts] = useState<Contact[]>([])
  const [loadingContacts, setLoadingContacts] = useState(false)
  const [showNewList, setShowNewList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newListTier, setNewListTier] = useState<string>('')
  const [savingList, setSavingList] = useState(false)
  const [search, setSearch] = useState('')
  const [addSearch, setAddSearch] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500) }

  useEffect(() => {
    fetch('/api/marketing/lists', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setLists(Array.isArray(d) ? d : []))
  }, [])

  async function loadListContacts(list: List) {
    setSelectedList(list)
    setLoadingContacts(true)
    const data = await fetch(`/api/marketing/lists/${list.id}/contacts`, { credentials: 'include' }).then(r => r.ok ? r.json() : [])
    setListContacts(Array.isArray(data) ? data : [])
    setLoadingContacts(false)
  }

  async function createList() {
    if (!newListName.trim()) return
    setSavingList(true)
    const res = await fetch('/api/marketing/lists', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ name: newListName.trim(), tier: newListTier ? Number(newListTier) : null }),
    })
    const data = await res.json() as { ok?: boolean; list?: List }
    if (data.ok && data.list) setLists(prev => [{ ...data.list!, contact_count: 0 }, ...prev])
    setNewListName(''); setNewListTier(''); setShowNewList(false); setSavingList(false)
  }

  async function deleteList(id: string) {
    if (!confirm('Delete this list?')) return
    await fetch(`/api/marketing/lists?id=${id}`, { method: 'DELETE', credentials: 'include' })
    setLists(prev => prev.filter(l => l.id !== id))
    if (selectedList?.id === id) { setSelectedList(null); setListContacts([]) }
  }

  async function addContactToList(contact: Contact) {
    if (!selectedList) return
    await fetch(`/api/marketing/lists/${selectedList.id}/contacts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_ids: [contact.id] }),
    })
    setListContacts(prev => prev.some(c => c.id === contact.id) ? prev : [contact, ...prev])
    setLists(prev => prev.map(l => l.id === selectedList.id ? { ...l, contact_count: l.contact_count + 1 } : l))
    setAddSearch('')
    showToast(`${contact.name} added`)
  }

  async function removeContactFromList(contactId: string) {
    if (!selectedList) return
    await fetch(`/api/marketing/lists/${selectedList.id}/contacts`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_id: contactId }),
    })
    setListContacts(prev => prev.filter(c => c.id !== contactId))
    setLists(prev => prev.map(l => l.id === selectedList.id ? { ...l, contact_count: Math.max(0, l.contact_count - 1) } : l))
  }

  const tierColors: Record<number, string> = { 1: 'bg-amber-100 text-amber-800', 2: 'bg-sky-100 text-sky-700', 3: 'bg-slate-100 text-slate-600' }
  const addSuggestions = addSearch.length > 1
    ? contacts.filter(c => !listContacts.some(lc => lc.id === c.id) && (
        c.name.toLowerCase().includes(addSearch.toLowerCase()) ||
        (c.company ?? '').toLowerCase().includes(addSearch.toLowerCase())
      )).slice(0, 6)
    : []
  const fieldVisitContacts = contacts
    .filter(c => c.pipeline_phase === 'field_visit' || (c.sequence_paused_reason ?? '').startsWith('quick_action:drop_cards') || (c.sequence_paused_reason ?? '').startsWith('quick_action:meeting_requested'))
    .sort((a, b) => (a.city || '').localeCompare(b.city || '') || a.name.localeCompare(b.name))
  const fieldVisitCities = Array.from(new Set(fieldVisitContacts.map(c => c.city || 'No city')))

  return (
    <div className="space-y-4">
      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[14px] bg-[#1a2744] px-5 py-3 text-sm font-medium text-white shadow-xl">{toast}</div>}

      <div className="rounded-[22px] border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#1a2744]">Field visits</h2>
            <p className="text-xs text-slate-500">{fieldVisitContacts.length} contact{fieldVisitContacts.length !== 1 ? 's' : ''} marked for cards, flyers, or meetings</p>
          </div>
          <div className="hidden text-xs font-semibold text-slate-400 sm:block">{fieldVisitCities.slice(0, 4).join(' · ')}</div>
        </div>
        {fieldVisitContacts.length > 0 ? (
          <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {fieldVisitContacts.slice(0, 24).map(c => (
              <button key={c.id} onClick={() => onSelectContact(c)}
                className="min-w-[220px] rounded-[16px] border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-[#1a2744] hover:bg-white">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#1a2744]">{c.name}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">{c.company || 'No brokerage'}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">{c.city || 'No city'}</span>
                </div>
                {c.latest_inbound_note && <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{c.latest_inbound_note}</div>}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-[16px] border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-400">
            Tap Postcards or Meeting in the inbox to build this list.
          </div>
        )}
      </div>

      <div className="flex gap-5 h-[calc(100vh-380px)] min-h-[420px]">
      {/* Left: list directory */}
      <div className="w-64 shrink-0 flex flex-col rounded-[22px] border border-slate-200 bg-white overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-[#1a2744]">Lists</span>
            <button onClick={() => setShowNewList(v => !v)} className="rounded-lg bg-[#1a2744] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#243560]">+ New</button>
          </div>
          {showNewList && (
            <div className="space-y-2">
              <input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="List name…" autoFocus
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
              <select value={newListTier} onChange={e => setNewListTier(e.target.value)}
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none">
                <option value="">No tier</option>
                <option value="1">Tier 1 — High freq</option>
                <option value="2">Tier 2 — Commercial</option>
                <option value="3">Tier 3 — Community</option>
              </select>
              <button onClick={createList} disabled={savingList || !newListName.trim()}
                className="w-full rounded-xl bg-[#1a2744] py-2 text-xs font-semibold text-white disabled:opacity-40">{savingList ? 'Creating…' : 'Create'}</button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {lists.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">No lists yet.</div>
          ) : lists.map(list => (
            <button key={list.id} onClick={() => loadListContacts(list)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition ${selectedList?.id === list.id ? 'bg-slate-50' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[#1a2744] truncate">{list.name}</span>
                <div className="flex items-center gap-1">
                  {list.tier && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${tierColors[list.tier]}`}>T{list.tier}</span>}
                  <button onClick={e => { e.stopPropagation(); deleteList(list.id) }}
                    className="rounded px-1 text-slate-300 hover:text-rose-500 text-xs">✕</button>
                </div>
              </div>
              <div className="mt-0.5 text-xs text-slate-400">{list.contact_count} contacts</div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: contacts in list */}
      <div className="flex-1 flex flex-col rounded-[22px] border border-slate-200 bg-white overflow-hidden">
        {!selectedList ? (
          <div className="flex flex-1 items-center justify-center text-slate-400">
            <div className="text-center">
              <div className="text-3xl">📋</div>
              <div className="mt-3 text-sm font-medium">Select a list</div>
            </div>
          </div>
        ) : (
          <>
            <div className="shrink-0 border-b border-slate-100 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-[#1a2744]">{selectedList.name}</div>
                  <div className="text-xs text-slate-400">{listContacts.length} contacts</div>
                </div>
                <div className="relative flex-1 max-w-xs">
                  <input value={addSearch} onChange={e => setAddSearch(e.target.value)} placeholder="Add contact by name…"
                    className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
                  {addSuggestions.length > 0 && (
                    <div className="absolute top-10 left-0 right-0 z-10 rounded-[14px] border border-slate-200 bg-white shadow-lg">
                      {addSuggestions.map(c => (
                        <button key={c.id} onClick={() => addContactToList(c)}
                          className="w-full px-3 py-2.5 text-left text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0">
                          <div className="font-medium text-[#1a2744]">{c.name}</div>
                          <div className="text-xs text-slate-400">{c.company ?? c.industry ?? ''}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter list…"
                className="mt-3 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingContacts ? (
                <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
              ) : listContacts.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-400">No contacts in this list. Search above to add one.</div>
              ) : listContacts
                .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.company ?? '').toLowerCase().includes(search.toLowerCase()))
                .map(c => (
                  <div key={c.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 hover:bg-slate-50">
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelectContact(c)}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-[#1a2744] truncate">{c.name}</span>
                        <TierBadge tier={c.outreach_tier} />
                      </div>
                      <div className="text-xs text-slate-400 truncate">{c.company ?? c.industry ?? ''} {c.city ? `· ${c.city}` : ''}</div>
                    </div>
                    <StageBadge stage={(c as Contact & { normalized_stage: string }).normalized_stage ?? c.stage ?? ''} />
                    <button onClick={() => removeContactFromList(c.id)} className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition">Remove</button>
                  </div>
                ))
              }
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  )
}

// ─── Tab: Pipeline ────────────────────────────────────────────────────────────

const PIPELINE_COLS = [
  { key: 'connected', label: 'Conversation Started', color: 'bg-emerald-50 border-emerald-200' },
  { key: 'qualified', label: 'Meeting / Visit', color: 'bg-sky-50 border-sky-200' },
  { key: 'follow_up_due', label: 'Follow-Up Needed', color: 'bg-amber-50 border-amber-200' },
  { key: 'partnership_active', label: 'Active Partner', color: 'bg-emerald-50 border-emerald-200' },
  { key: 'dormant', label: 'Inactive / Nurture', color: 'bg-slate-50 border-slate-200' },
]

function PipelineTab({ contacts, onSelect, onStageChange }: {
  contacts: Contact[]
  onSelect: (c: Contact) => void
  onStageChange: (id: string, stage: string) => Promise<void>
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [tierFilter, setTierFilter] = useState<number | null>(null)

  const inPlay = contacts.filter(c => {
    const status = getInboxStatus(c)
    return (
      c.sequence_paused ||
      Boolean(c.latest_inbound_at || c.latest_inbound_note) ||
      ['connected', 'qualified', 'follow_up_due', 'partnership_active', 'dormant'].includes(c.normalized_stage) ||
      status === 'promising' ||
      status === 'postcard' ||
      status === 'follow_up' ||
      status === 'active'
    )
  })
  const filtered = tierFilter ? inPlay.filter(c => c.outreach_tier === tierFilter) : inPlay

  if (inPlay.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white p-16 text-center">
        <div className="text-4xl">📭</div>
        <div className="mt-4 text-base font-semibold text-[#1a2744]">No partnership work in play yet</div>
        <div className="mt-2 text-sm text-slate-500">Replies, postcard requests, follow-ups, and active partners show up here.</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-[#1a2744]">Relationship Pipeline</h2>
          <p className="text-sm text-slate-500">{filtered.length} partner opportunit{filtered.length === 1 ? 'y' : 'ies'} in play</p>
        </div>
        <div className="flex gap-1.5">
          {[null, 1, 2, 3].map(t => (
            <button key={t ?? 'all'} onClick={() => setTierFilter(t)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${tierFilter === t ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {t ? `Tier ${t}` : 'All'}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PIPELINE_COLS.map(col => {
          const colContacts = filtered.filter(c => c.normalized_stage === col.key)
          return (
            <div key={col.key}
              onDragOver={e => { e.preventDefault(); if (draggingId) setDropTarget(col.key) }}
              onDragLeave={e => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; setDropTarget(curr => curr === col.key ? null : curr) }}
              onDrop={e => {
                e.preventDefault()
                const contactId = e.dataTransfer.getData('text/plain') || draggingId
                setDropTarget(null); setDraggingId(null)
                if (!contactId) return
                const curr = inPlay.find(c => c.id === contactId)
                if (!curr || curr.normalized_stage === col.key) return
                setMovingId(contactId)
                void onStageChange(contactId, col.key).finally(() => setMovingId(id => id === contactId ? null : id))
              }}
              className={`rounded-[22px] border p-4 transition ${col.color} ${dropTarget === col.key ? 'ring-2 ring-[#1a2744] ring-offset-2 ring-offset-white' : ''}`}>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">{col.label}</span>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{colContacts.length}</span>
              </div>
              <div className="space-y-2">
                {colContacts.length === 0 ? (
                  <div className={`rounded-[14px] border border-dashed border-slate-200 bg-white/50 p-4 text-center text-xs text-slate-400 transition ${dropTarget === col.key ? 'border-[#1a2744] bg-white text-[#1a2744]' : ''}`}>Drop here</div>
                ) : colContacts.map(c => {
                  const nextAction = getNextPartnerAction(c)
                  const referralCode = getPartnerReferralCode(c)
                  return (
                    <div key={c.id} role="button" tabIndex={0} draggable
                      onClick={() => onSelect(c)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c) } }}
                      onDragStart={e => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; setDraggingId(c.id) }}
                      onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
                      className={`w-full rounded-[16px] border border-white bg-white p-3 text-left shadow-sm transition hover:shadow-md ${draggingId === c.id ? 'cursor-grabbing opacity-50' : 'cursor-grab'} ${movingId === c.id ? 'pointer-events-none opacity-60' : ''}`}>
                      <div className="flex items-start justify-between gap-1">
                        <div className="text-sm font-semibold text-[#1a2744] truncate">{c.name}</div>
                        <TierBadge tier={c.outreach_tier} />
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 truncate">{c.company ?? c.industry ?? ''}</div>
                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                        <span>{c.city ?? ''}</span>
                        {movingId === c.id ? <span>Saving…</span> : c.last_touch_at && <span>{timeAgo(c.last_touch_at)}</span>}
                      </div>
                      {(nextAction || referralCode) && (
                        <div className="mt-2 space-y-1 rounded-[10px] bg-slate-50 px-2 py-1.5 text-[10px]">
                          {nextAction && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-semibold text-slate-600">{nextAction.label}</span>
                              <span className={nextAction.overdue ? 'font-semibold text-amber-700' : 'text-slate-400'}>{fmtDate(nextAction.due)}</span>
                            </div>
                          )}
                          {referralCode && (
                            <div className="truncate font-semibold text-emerald-700">Code: {referralCode}</div>
                          )}
                        </div>
                      )}
                      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${inboxStatusClass(getInboxStatus(c))}`}>
                          {inboxStatusLabel(getInboxStatus(c))}
                        </span>
                        {c.instantly_status && <InstantlyBadge status={c.instantly_status} />}
                        {c.decision && (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.decision === 'agreed' ? 'bg-emerald-100 text-emerald-700' : c.decision === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                            {c.decision}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tab: Partnership Replies ────────────────────────────────────────────────

const REPLY_BUCKETS: Array<{ key: ReplyItem['bucket'] | 'all'; label: string }> = [
  { key: 'context', label: 'Context' },
  { key: 'needs_reply', label: 'Needs reply' },
  { key: 'postcard', label: 'Postcard' },
  { key: 'appointment', label: 'Appointment' },
  { key: 'review', label: 'Review' },
  { key: 'opt_out', label: 'Opt-out' },
  { key: 'all', label: 'All' },
]

function replyBucketLabel(bucket: ReplyItem['bucket']) {
  if (bucket === 'context') return 'Needs context'
  if (bucket === 'postcard') return 'Postcard request'
  if (bucket === 'appointment') return 'Meeting / call'
  if (bucket === 'opt_out') return 'Opt-out'
  if (bucket === 'closed') return 'Closed'
  if (bucket === 'review') return 'Review'
  return 'Needs reply'
}

function replyBucketClass(bucket: ReplyItem['bucket']) {
  if (bucket === 'context') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (bucket === 'postcard') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (bucket === 'appointment') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (bucket === 'opt_out' || bucket === 'closed') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (bucket === 'review') return 'border-slate-200 bg-slate-50 text-slate-600'
  return 'border-[rgba(15,106,83,0.16)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
}

function RepliesTab({ onSelectContact, onOpenThread }: {
  onSelectContact: (c: Contact) => void
  onOpenThread: (c: Contact) => void
}) {
  const [items, setItems] = useState<ReplyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<ReplyItem['bucket'] | 'all'>('needs_reply')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const loadReplies = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/marketing/sms/replies?limit=300', { credentials: 'include' })
    if (r.ok) {
      const d = await r.json() as { responses?: ReplyItem[] }
      const responses = d.responses ?? []
      setItems(responses)
      setSelectedId(curr => curr && responses.some(item => item.contact.id === curr) ? curr : responses[0]?.contact.id ?? null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadReplies() }, [loadReplies])

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 2500)
  }

  const filtered = items.filter(item => {
    if (filter !== 'all' && item.bucket !== filter) return false
    if (!search.trim()) return true
    const haystack = `${item.contact.name} ${item.contact.company ?? ''} ${item.contact.city ?? ''} ${item.contact.phone ?? ''} ${item.latest_touch.notes ?? ''}`.toLowerCase()
    return haystack.includes(search.toLowerCase())
  })

  const selected = items.find(item => item.contact.id === selectedId) ?? filtered[0] ?? null
  const counts = REPLY_BUCKETS.reduce<Record<string, number>>((acc, bucket) => {
    acc[bucket.key] = bucket.key === 'all' ? items.length : items.filter(item => item.bucket === bucket.key).length
    return acc
  }, {})

  async function logReplyAction(item: ReplyItem, action: 'postcard' | 'handled' | 'not_interested') {
    setSaving(action)
    const contactId = item.contact.id
    const baseNote = item.latest_touch.notes ? `Latest reply: ${item.latest_touch.notes}` : 'Latest reply handled.'
    const actionConfig = {
      postcard: {
        touch: {
          contact_id: contactId,
          channel: 'direct_mail',
          direction: 'internal',
          notes: `Postcard requested. ${baseNote}`,
          outcome_code: 'postcard_requested',
          next_step: 'Drop or send postcard, then follow up.',
          new_stage: 'qualified',
          schedule_follow_up_days: 3,
          metadata: { source: 'partnership_reply_desk' },
        },
        contact: { id: contactId, sequence_paused: false, sequence_paused_reason: null, stage: 'qualified' },
        toast: 'Postcard request logged',
      },
      handled: {
        touch: {
          contact_id: contactId,
          channel: item.latest_touch.channel || 'sms',
          direction: 'internal',
          notes: `Reply handled by rep. ${baseNote}`,
          outcome_code: 'replied_positive',
          next_step: 'Continue manual relationship follow-up.',
          new_stage: 'connected',
          schedule_follow_up_days: 7,
          metadata: { source: 'partnership_reply_desk' },
        },
        contact: { id: contactId, sequence_paused: false, sequence_paused_reason: null, stage: 'connected' },
        toast: 'Reply marked handled',
      },
      not_interested: {
        touch: {
          contact_id: contactId,
          channel: item.latest_touch.channel || 'sms',
          direction: 'internal',
          notes: `Marked not interested. ${baseNote}`,
          outcome_code: 'replied_negative',
          next_step: 'Do not continue outreach unless they re-engage.',
          new_stage: 'closed_lost',
          next_follow_up: null,
          metadata: { source: 'partnership_reply_desk' },
        },
        contact: { id: contactId, sequence_paused: false, sequence_paused_reason: null, stage: 'closed_lost', decision: 'rejected' },
        toast: 'Marked not interested',
      },
    }[action]

    try {
      await fetch('/api/marketing/touches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(actionConfig.touch),
      })
      await fetch('/api/marketing/contacts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(actionConfig.contact),
      })
      showToast(actionConfig.toast)
      await loadReplies()
    } catch {
      showToast('Could not save action')
    }
    setSaving(null)
  }

  return (
    <div className="space-y-4">
      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[14px] bg-[#1a2744] px-5 py-3 text-sm font-medium text-white shadow-xl">{toast}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[var(--app-ink)]">Reply Desk</h2>
          <p className="mt-1 text-sm text-[var(--app-muted)]">Inbound SMS and email replies from partnership outreach.</p>
        </div>
        <div className="flex items-center gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search replies…" className="crm-input h-10 w-48 text-sm" />
          <button onClick={() => void loadReplies()} className="crm-button h-10 text-sm">Refresh</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {REPLY_BUCKETS.map(bucket => (
          <button key={bucket.key} onClick={() => setFilter(bucket.key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${filter === bucket.key ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white' : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
            {bucket.label}
            {counts[bucket.key] > 0 && <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] ${filter === bucket.key ? 'bg-white/20 text-white' : 'bg-[var(--app-wash)] text-[var(--app-muted)]'}`}>{counts[bucket.key]}</span>}
          </button>
        ))}
      </div>

      <div className="grid min-h-[560px] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-[18px] border border-[var(--app-line)] bg-white">
          <div className="border-b border-[var(--app-line)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--app-muted)]">
            {loading ? 'Loading replies' : `${filtered.length} visible replies`}
          </div>
          <div className="max-h-[620px] overflow-y-auto">
            {!loading && filtered.length === 0 && (
              <div className="p-8 text-center text-sm text-[var(--app-muted)]">No replies in this bucket.</div>
            )}
            {filtered.map(item => (
              <button key={`${item.contact.id}-${item.latest_touch.id}`} onClick={() => setSelectedId(item.contact.id)}
                className={`w-full border-b border-[var(--app-line)] px-4 py-3 text-left transition hover:bg-[var(--app-wash)] ${selected?.contact.id === item.contact.id ? 'bg-[var(--app-accent-soft)]' : 'bg-white'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--app-ink)]">{item.contact.name}</div>
                    <div className="mt-0.5 truncate text-xs text-[var(--app-muted)]">{item.contact.company || item.contact.city || item.contact.phone || 'No company'}</div>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${replyBucketClass(item.bucket)}`}>{replyBucketLabel(item.bucket)}</span>
                </div>
                <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                  {summarizeTouch(item.latest_touch.channel, item.latest_touch.direction, item.latest_touch.notes).body || 'No message body saved.'}
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--app-muted)]">
                  <span>{String(item.latest_touch.channel || 'reply').toUpperCase()}</span>
                  <span>{timeAgo(item.latest_touch.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[18px] border border-[var(--app-line)] bg-white p-5">
          {!selected ? (
            <div className="flex h-full min-h-[420px] items-center justify-center text-center text-sm text-[var(--app-muted)]">Select a reply.</div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-semibold text-[var(--app-ink)]">{selected.contact.name}</h3>
                    <StageBadge stage={selected.contact.normalized_stage} />
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${replyBucketClass(selected.bucket)}`}>{replyBucketLabel(selected.bucket)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--app-muted)]">
                    {selected.contact.company && <span>{selected.contact.company}</span>}
                    {selected.contact.city && <span>{selected.contact.city}</span>}
                    {selected.contact.phone && <span>{selected.contact.phone}</span>}
                    {selected.contact.email && <span>{selected.contact.email}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => onOpenThread(selected.contact)} className="crm-button text-sm">Open thread</button>
                  <button onClick={() => onSelectContact(selected.contact)} className="crm-button text-sm">Profile</button>
                </div>
              </div>

              <div className="rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-muted)]">
                  <span>Latest reply</span>
                  <span>{fmtDateTime(selected.latest_touch.created_at)}</span>
                </div>
                <div className="whitespace-pre-wrap text-base leading-7 text-[var(--app-ink)]">
                  {summarizeTouch(selected.latest_touch.channel, selected.latest_touch.direction, selected.latest_touch.notes).body || 'No message body saved.'}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <button disabled={!!saving} onClick={() => void logReplyAction(selected, 'postcard')}
                  className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50">
                  Mark postcard requested
                </button>
                <button disabled={!!saving} onClick={() => void logReplyAction(selected, 'handled')}
                  className="rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50">
                  Mark handled
                </button>
                <button disabled={!!saving} onClick={() => void logReplyAction(selected, 'not_interested')}
                  className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50">
                  Not interested
                </button>
              </div>

              <div className="rounded-[14px] border border-[var(--app-line)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--app-muted)]">Recommended handling</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Keep the first response human. If they ask for a postcard, log it here, send or drop the card, then use the profile to schedule a follow-up. If they ask to stop, mark not interested so future campaign jobs stay off this contact.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Phone ───────────────────────────────────────────────────────────────

const PARTNERSHIP_FROM_NUMBER = '+12268870667'  // Primary Windsor dedicated outbound number
const PARTNERSHIP_FROM_NUMBERS = ['+12268870667', '+12266055008']
const TEMP_SALES_RECOVERY_NUMBER = '+12267732993'
const PARTNERSHIP_REPLY_FROM_NUMBERS = [...PARTNERSHIP_FROM_NUMBERS, TEMP_SALES_RECOVERY_NUMBER]

function normalizePhoneNumber(value: unknown) {
  if (typeof value !== 'string') return ''
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return value.trim()
}

function normalizePartnershipFromNumber(value: unknown) {
  const normalized = normalizePhoneNumber(value)
  return PARTNERSHIP_REPLY_FROM_NUMBERS.includes(normalized) ? normalized : ''
}

function displayReplyNumber(value: string) {
  const normalized = normalizePhoneNumber(value)
  const digits = normalized.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return value
}

function metadataString(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function threadFromNumber(touches: Touch[]) {
  const sorted = [...touches].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

  for (const touch of sorted) {
    const metadata = touch.metadata || {}
    const scheduled = metadata.scheduled_reply && typeof metadata.scheduled_reply === 'object'
      ? metadata.scheduled_reply as Record<string, unknown>
      : {}
    const candidate = touch.direction === 'inbound'
      ? metadataString(metadata, ['to', 'To', 'to_number', 'toNumber'])
      : metadataString(metadata, ['from', 'From', 'from_number', 'fromNumber']) ||
        metadataString(scheduled, ['fromNumber', 'from_number', 'from'])
    const normalized = normalizePartnershipFromNumber(candidate)
    if (normalized) return normalized
  }

  return PARTNERSHIP_FROM_NUMBER
}

function getTouchMediaUrls(touch: Touch) {
  const urls = new Set<string>()
  const metadata = touch.metadata || {}
  const candidates = [
    metadata.mediaUrls,
    metadata.media_urls,
    metadata.media,
    metadata.attachments,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      candidate.forEach(item => {
        if (typeof item === 'string') urls.add(item)
        else if (item && typeof item === 'object') {
          const value = (item as Record<string, unknown>).url
          if (typeof value === 'string') urls.add(value)
        }
      })
    }
  }

  const mmsMatch = touch.notes?.match(/\[MMS:\s*([^\]]+)\]/i)
  if (mmsMatch) {
    mmsMatch[1].split(',').map(url => url.trim()).filter(Boolean).forEach(url => urls.add(url))
  }

  return Array.from(urls)
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)
}

function isTwilioApiUrl(url: string) {
  try {
    return new URL(url).hostname === 'api.twilio.com'
  } catch {
    return false
  }
}

function mediaPlaybackUrl(url: string) {
  return isTwilioApiUrl(url) ? `/api/marketing/twilio-media?url=${encodeURIComponent(url)}` : url
}

function isImageUrl(url: string) {
  return /\.(png|jpe?g|gif|webp|heic|heif)(\?|$)/i.test(url)
}

function mediaFileName(url: string) {
  try {
    const pathname = new URL(url).pathname
    return decodeURIComponent(pathname.split('/').pop() || 'Attachment')
  } catch {
    return url.split('/').pop() || 'Attachment'
  }
}

function datetimeLocalValue(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function isBusinessDay(date: Date) {
  const day = date.getDay()
  return day !== 0 && day !== 6
}

function nextBusinessMorning(date: Date) {
  const next = new Date(date)
  if (next.getHours() >= 18 || !isBusinessDay(next)) next.setDate(next.getDate() + 1)
  next.setHours(8, 45, 0, 0)
  while (!isBusinessDay(next)) next.setDate(next.getDate() + 1)
  return next
}

function isUrgentPartnerReply(suggestion?: PartnershipAiSuggestion | null) {
  if (!suggestion) return false
  const haystack = [
    suggestion.intent,
    suggestion.draft_sms,
    suggestion.rationale,
    suggestion.extracted.asks_pricing ? 'pricing' : '',
  ].join(' ').toLowerCase()
  return /\b(price|pricing|rate|rates|charge|cost|client|customer|buyer|seller|quote|moving|move)\b/.test(haystack)
}

function defaultScheduledReplyTime(suggestion?: PartnershipAiSuggestion | null) {
  const date = new Date()
  date.setSeconds(0, 0)
  const inBusinessHours = isBusinessDay(date) && date.getHours() >= 8 && date.getHours() < 18
  if (!inBusinessHours) return datetimeLocalValue(nextBusinessMorning(date))

  const delayMinutes = isUrgentPartnerReply(suggestion) ? 3 : 6
  date.setMinutes(date.getMinutes() + delayMinutes)
  if (date.getHours() >= 18) return datetimeLocalValue(nextBusinessMorning(date))
  return datetimeLocalValue(date)
}

type InboxQuickAction = 'active_partner' | 'drop_cards' | 'meeting_requested' | 'needs_follow_up' | 'not_interested' | 'wrong_number'
type InboxFilter = 'sales_line' | 'context' | 'needs_reply' | 'responded' | 'no_response' | 'promising' | 'package_sent' | 'postcard' | 'appointment' | 'waiting' | 'follow_up' | 'active' | 'closed' | 'all'
type InboxStatus = 'context' | 'needs_reply' | 'promising' | 'package_sent' | 'postcard' | 'appointment' | 'waiting' | 'follow_up' | 'active' | 'closed' | 'review'

const INBOX_QUICK_ACTIONS: Array<{ key: InboxQuickAction; label: string; tone: 'green' | 'blue' | 'amber' | 'slate' | 'red' }> = [
  { key: 'active_partner', label: 'Active partner', tone: 'green' },
  { key: 'drop_cards', label: 'Postcards', tone: 'blue' },
  { key: 'meeting_requested', label: 'Meeting', tone: 'blue' },
  { key: 'needs_follow_up', label: 'Follow-up', tone: 'amber' },
  { key: 'not_interested', label: 'Not interested', tone: 'slate' },
  { key: 'wrong_number', label: 'Wrong #', tone: 'red' },
]

const REPLY_DESK_STAGE_ACTIONS: Array<{ key: string; label: string; helper: string; tone: 'green' | 'blue' | 'amber' | 'slate' | 'red' }> = [
  { key: 'connected', label: 'Conversation', helper: 'Conversation started', tone: 'blue' },
  { key: 'qualified', label: 'Meeting / Visit', helper: 'Good partner fit', tone: 'amber' },
  { key: 'partnership_active', label: 'Active partner', helper: 'Referral-ready', tone: 'green' },
  { key: 'follow_up_due', label: 'Follow-up', helper: 'Needs next action', tone: 'amber' },
  { key: 'dormant', label: 'Inactive', helper: 'Nurture later', tone: 'slate' },
  { key: 'closed_lost', label: 'Lost', helper: 'Do not pursue', tone: 'red' },
]

function defaultSheetUpdateForm(contact: Contact): SheetUpdateForm {
  return {
    action: '',
    sheetNote: '',
    sheetTarget: '',
    name: contact.name || '',
    company: contact.company || '',
    title: contact.title || '',
    email: contact.email || '',
    phone: contact.phone || '',
    address: contact.address || '',
    city: contact.city || '',
    industry: contact.industry || '',
    nextFollowUp: contact.next_follow_up || '',
  }
}

function sheetUpdateFormHasChanges(form: SheetUpdateForm | null, contact: Contact) {
  if (!form) return false
  return (
    form.action !== '' ||
    form.sheetNote.trim() !== '' ||
    form.sheetTarget.trim() !== '' ||
    form.name.trim() !== (contact.name || '') ||
    form.company.trim() !== (contact.company || '') ||
    form.title.trim() !== (contact.title || '') ||
    form.email.trim() !== (contact.email || '') ||
    form.phone.trim() !== (contact.phone || '') ||
    form.address.trim() !== (contact.address || '') ||
    form.city.trim() !== (contact.city || '') ||
    form.industry.trim() !== (contact.industry || '') ||
    form.nextFollowUp.trim() !== (contact.next_follow_up || '')
  )
}

function quickActionClass(tone: 'green' | 'blue' | 'amber' | 'slate' | 'red', active: boolean) {
  if (active) return 'border-[#1a2744] bg-[#1a2744] text-white'
  if (tone === 'green') return 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
  if (tone === 'blue') return 'border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100'
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
  if (tone === 'red') return 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
  return 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
}

const INBOX_FILTERS: Array<{ key: InboxFilter; label: string }> = [
  { key: 'sales_line', label: 'Sales line' },
  { key: 'context', label: 'Context' },
  { key: 'needs_reply', label: 'Needs reply' },
  { key: 'responded', label: 'Responded' },
  { key: 'no_response', label: 'No response' },
  { key: 'all', label: 'All' },
  { key: 'promising', label: 'Positive' },
  { key: 'package_sent', label: 'Digital sent' },
  { key: 'postcard', label: 'Postcards' },
  { key: 'appointment', label: 'Appointments' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'active', label: 'Partners' },
  { key: 'closed', label: 'Closed' },
]

function sourceBadge(contact: Contact) {
  const channel = contact.latest_touch_channel || (contact.phone ? 'sms' : contact.email ? 'email' : 'realtor')
  if (channel === 'email') return 'Email'
  if (channel === 'sms') return 'SMS'
  if (channel === 'phone' || channel === 'call') return 'Call'
  return contact.category || contact.industry || 'Realtor'
}

function partnerLinkSlug(contact: Contact) {
  const value = [
    contact.name,
    contact.city,
    contact.company,
  ].filter(Boolean).join(' ')
  const slug = value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || `partner-${contact.id.slice(0, 8).toLowerCase()}`
}

function partnerPackageUrl(contact: Contact) {
  return `https://starmovers.ca/partner/${partnerLinkSlug(contact)}`
}

function partnerQuoteUrl(contact: Contact) {
  const market = (contact.city || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `https://starmovers.ca/quote?ref=${encodeURIComponent(partnerLinkSlug(contact))}${market ? `&market=${encodeURIComponent(market)}` : ''}`
}

function partnerPackageMessage(contact: Contact) {
  return `Here is your Saturn Star Movers partner package: ${partnerPackageUrl(contact)}`
}

function hasDigitalPackageTouch(contact: Contact) {
  const text = [
    contact.latest_touch_note,
    contact.latest_inbound_note,
    contact.playbook?.draft_sms,
    contact.playbook?.draft_email_body,
  ].filter(Boolean).join(' ').toLowerCase()
  if (text.includes('starmovers.ca/partner/') || text.includes('saturn star movers partner package')) return true
  if (text.includes('[mms:')) return true
  if (/\b(download|digital package|partner package|referral link|business card|flyer|rate sheet|pricing sheet|payment methods?)\b/.test(text)) return true
  if (/https?:\/\/\S+\.(pdf|png|jpe?g|webp|docx?|xlsx?)/.test(text)) return true
  return false
}

function hasPostcardLogisticsIntent(contact: Contact) {
  const text = [
    contact.latest_inbound_note,
    contact.latest_touch_note,
    contact.playbook?.intent,
    contact.playbook?.recommended_action,
    contact.playbook?.goal_state?.physical_delivery,
    contact.playbook?.extracted?.address,
    contact.playbook?.extracted?.brokerage_location,
    contact.playbook?.extracted?.time_window,
    contact.playbook?.extracted?.delivery_instructions,
    contact.playbook?.draft_sms,
  ].filter(Boolean).join(' ').toLowerCase()

  if (!text) return false
  if (/\b(digital only|email only|text me|send it digitally|digital is good|no postcard|no cards|don't drop|do not drop)\b/.test(text)) return false
  if (/\b(postcards?|post cards?|business cards?|drop cards?|flyers?|brochures?|printed package|physical package)\b/.test(text)) return true
  if (/\b(drop|stop|come|swing)\s+(it|them|by|off|over)\b/.test(text)) return true
  if (/\b(mail|send|deliver|leave)\s+(it|them|cards?|flyers?|package|at|to)\b/.test(text)) return true
  if (/\b(reception|front desk|office|brokerage|suite|unit)\b/.test(text) && /\b(address|drop|deliver|leave|mail|cards?|flyers?)\b/.test(text)) return true
  return false
}

function latestTouchIsAfterLatestInbound(contact: Contact) {
  const latestTouchAt = contact.last_touch_at ? new Date(contact.last_touch_at).getTime() : 0
  const latestInboundAt = contact.latest_inbound_at ? new Date(contact.latest_inbound_at).getTime() : 0
  return !latestInboundAt || latestTouchAt >= latestInboundAt
}

function isClosingAcknowledgementInbound(value?: string | null) {
  const text = cleanRichSmsFallback(stripTouchPrefix(String(value || ''))).toLowerCase()
  if (!text) return false
  if (text.includes('?')) return false
  if (text.length > 220) return false
  if (/\b(when|where|what|who|how|which|can you|could you|would you|please send|send me|call me|email me|appointment|meeting|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|address|office|drop off|drop by|postcard|flyer|business card|price|pricing|rate|referral link|package)\b/.test(text)) return false
  return /\b(thanks?|thank you|appreciate|awesome|sounds good|perfect|ok|okay|alright|all right|no problem|great|will keep (you|u) in mind|keep you in mind|added (you|u) to (my )?contacts?|have a great day|talk soon|cheers|you're welcome|you are welcome)\b/.test(text)
}

function isContextLossInbound(value?: string | null) {
  const text = cleanRichSmsFallback(stripTouchPrefix(String(value || ''))).toLowerCase()
  if (!text) return false
  return /\b(who is this|who'?s this|what is this|what'?s this|what is this for|what'?s this for|what is this about|what'?s this about|don'?t see (?:an |the )?earlier text|missing.*conversation|missing.*part|part of a conversation|not sure what this is|what conversation|remind me|sorry.*missing)\b/i.test(text)
}

function touchMetadataSender(metadata: Record<string, unknown> | null | undefined, direction?: string | null) {
  if (!metadata) return ''
  const scheduled = metadata.scheduled_reply && typeof metadata.scheduled_reply === 'object'
    ? metadata.scheduled_reply as Record<string, unknown>
    : {}
  const candidate = direction === 'inbound'
    ? metadataString(metadata, ['to', 'To', 'to_number', 'toNumber'])
    : metadataString(metadata, ['from', 'From', 'from_number', 'fromNumber']) ||
      metadataString(scheduled, ['fromNumber', 'from_number', 'from'])
  return normalizePartnershipFromNumber(candidate)
}

function contactThreadFromNumber(contact: Contact) {
  return touchMetadataSender(contact.latest_inbound_metadata, 'inbound') ||
    touchMetadataSender(contact.latest_touch_metadata, contact.latest_touch_direction) ||
    PARTNERSHIP_FROM_NUMBER
}

function isSalesLineThread(contact: Contact) {
  return contactThreadFromNumber(contact) === TEMP_SALES_RECOVERY_NUMBER
}

function latestInboundNeedsReply(contact: Contact) {
  if (isPassiveInboundReaction(contact.latest_inbound_note || '')) return false
  if (isClosingAcknowledgementInbound(contact.latest_inbound_note || '')) return false
  const latestTouchAt = contact.last_touch_at ? new Date(contact.last_touch_at).getTime() : 0
  const latestInboundAt = contact.latest_inbound_at ? new Date(contact.latest_inbound_at).getTime() : 0
  if (contact.latest_touch_direction === 'inbound') return true
  if (!latestInboundAt) return Boolean(contact.sequence_paused && contact.latest_inbound_note)
  if (!latestTouchAt) return true
  return latestInboundAt >= latestTouchAt
}

function isPassiveInboundReaction(value?: string | null) {
  const text = cleanRichSmsFallback(stripTouchPrefix(String(value || ''))).toLowerCase()
  return /^(loved|liked|emphasized|laughed at|questioned|disliked)\s+[“"].+[”"]$/.test(text)
}

function hasPartnerInbound(contact: Contact) {
  return Boolean(contact.latest_inbound_at || contact.latest_inbound_note || contact.latest_touch_direction === 'inbound')
}

function hasRepResponded(contact: Contact) {
  if (!hasPartnerInbound(contact)) return false
  const latestTouchAt = contact.last_touch_at ? new Date(contact.last_touch_at).getTime() : 0
  const latestInboundAt = contact.latest_inbound_at ? new Date(contact.latest_inbound_at).getTime() : 0
  const lastDirection = contact.latest_touch_direction
  const stage = contact.normalized_stage || contact.stage || ''
  if ((lastDirection === 'outbound' || lastDirection === 'system' || lastDirection === 'internal') && latestTouchAt > 0 && (!latestInboundAt || latestTouchAt >= latestInboundAt)) return true
  if (['connected', 'qualified', 'partnership_active', 'dormant', 'closed_lost'].includes(stage) && !latestInboundNeedsReply(contact)) return true
  return false
}

function hasNoPartnerResponse(contact: Contact) {
  if (hasPartnerInbound(contact)) return false
  const lastDirection = contact.latest_touch_direction
  return lastDirection === 'outbound' || lastDirection === 'system' || contact.last_touch_at !== null
}

function workflowActionFromReason(reason?: string | null) {
  const value = String(reason || '')
  if (value.includes(':')) return value.split(':').pop() || ''
  return value
}

function isPostcardIntent(intent?: string | null) {
  return [
    'postcard_yes',
    'drop_by_anytime',
    'gives_address',
    'gives_time_window',
  ].includes(String(intent || ''))
}

function isFieldWorkIntent(intent?: string | null) {
  return [
    'postcard_yes',
    'drop_by_anytime',
    'gives_address',
    'gives_time_window',
    'asks_for_pricing',
    'asks_referral_program',
    'asks_social_media',
  ].includes(String(intent || ''))
}

function isPackageIntent(intent?: string | null) {
  return [
    'send_digital_package',
    'send_card_or_flyer_media',
    'digital_only_no_postcard',
    'asks_contact_info',
    'asks_for_email',
    'asks_for_references',
    'refers_to_another_contact',
    'lead_disposition_update',
  ].includes(String(intent || ''))
}

function getInboxStatus(contact: Contact): InboxStatus {
  const stage = contact.normalized_stage || contact.stage || ''
  const hasInbound = Boolean(contact.latest_inbound_at || contact.latest_inbound_note || contact.latest_touch_direction === 'inbound')
  const lastDirection = contact.latest_touch_direction
  const followUpDue = Boolean(contact.needs_follow_up || contact.next_follow_up)
  const pauseReason = contact.sequence_paused_reason || ''
  const workflowAction = workflowActionFromReason(pauseReason)
  const handledWorkflowAction = pauseReason.startsWith('quick_action:') || pauseReason.startsWith('sheet_update:')
  const playbookAction = contact.playbook?.quick_action
  const playbookIntent = contact.playbook?.intent
  const recommendedAction = contact.playbook?.recommended_action
  const closed = contact.decision === 'not_interested' || contact.decision === 'rejected' || contact.decision === 'bad_number' || stage === 'not_interested' || stage === 'closed_lost' || stage === 'dnc'
  const active = contact.decision === 'agreed' || stage === 'partnership_active'
  const appointmentWork =
    workflowAction === 'meeting_requested' ||
    playbookAction === 'meeting_requested' ||
    recommendedAction === 'book_meeting' ||
    (latestTouchIsAfterLatestInbound(contact) && Boolean(parseConversationAppointmentSuggestion(contact)))
  const postcardWork =
    contact.pipeline_phase === 'field_visit' ||
    workflowAction === 'drop_cards' ||
    playbookAction === 'drop_cards' ||
    recommendedAction === 'schedule_delivery' ||
    isPostcardIntent(playbookIntent) ||
    hasPostcardLogisticsIntent(contact)
  const packageSent = hasDigitalPackageTouch(contact) && (lastDirection === 'outbound' || lastDirection === 'system') && latestTouchIsAfterLatestInbound(contact)
  const promising =
    stage === 'connected' ||
    stage === 'qualified' ||
    isPackageIntent(playbookIntent) ||
    isFieldWorkIntent(playbookIntent) ||
    (hasInbound && handledWorkflowAction)

  if (closed) return 'closed'
  if (active) return 'active'
  if (hasInbound && isContextLossInbound(contact.latest_inbound_note || contact.latest_touch_note)) return 'context'
  if (hasInbound && !contact.decision && !handledWorkflowAction && latestInboundNeedsReply(contact)) return 'needs_reply'
  if (appointmentWork) return 'appointment'
  if (postcardWork) return 'postcard'
  if (packageSent) return 'package_sent'
  if (promising) return 'promising'
  if (followUpDue) return 'follow_up'
  if ((lastDirection === 'outbound' || lastDirection === 'system') && !contact.decision) return 'waiting'
  return 'review'
}

function inboxStatusLabel(status: InboxStatus) {
  if (status === 'context') return 'Needs context'
  if (status === 'needs_reply') return 'Needs reply'
  if (status === 'promising') return 'Positive'
  if (status === 'package_sent') return 'Digital sent'
  if (status === 'postcard') return 'Postcards'
  if (status === 'appointment') return 'Appointment'
  if (status === 'waiting') return 'Waiting'
  if (status === 'follow_up') return 'Follow-up'
  if (status === 'active') return 'Partner'
  if (status === 'closed') return 'Closed'
  return 'Review'
}

function inboxStatusClass(status: InboxStatus) {
  if (status === 'context') return 'bg-rose-50 text-rose-700'
  if (status === 'needs_reply') return 'bg-amber-50 text-amber-700'
  if (status === 'promising') return 'bg-emerald-50 text-emerald-700'
  if (status === 'package_sent') return 'bg-teal-50 text-teal-700'
  if (status === 'postcard') return 'bg-sky-50 text-sky-700'
  if (status === 'appointment') return 'bg-indigo-50 text-indigo-700'
  if (status === 'waiting') return 'bg-slate-100 text-slate-600'
  if (status === 'follow_up') return 'bg-sky-50 text-sky-700'
  if (status === 'active') return 'bg-emerald-100 text-emerald-800'
  if (status === 'closed') return 'bg-rose-50 text-rose-700'
  return 'bg-violet-50 text-violet-700'
}

function inboxUrgencyRank(contact: Contact) {
  const status = getInboxStatus(contact)
  if (status === 'context') return 0
  if (status === 'needs_reply') return 1
  if (status === 'appointment') return 2
  if (status === 'postcard') return 3
  if (status === 'follow_up') return 3
  if (status === 'promising') return 4
  if (status === 'package_sent') return 5
  if (status === 'waiting') return 6
  if (status === 'review') return 6
  if (status === 'active') return 7
  return 7
}

function matchesInboxFilter(contact: Contact, filter: InboxFilter) {
  const status = getInboxStatus(contact)
  if (filter === 'all') return true
  if (filter === 'sales_line') return isSalesLineThread(contact)
  if (filter === 'context') return status === 'context'
  if (filter === 'responded') return hasRepResponded(contact)
  if (filter === 'no_response') return hasNoPartnerResponse(contact)
  if (filter === 'needs_reply') return status === 'needs_reply'
  if (filter === 'promising') return status === 'promising'
  if (filter === 'package_sent') return status === 'package_sent'
  if (filter === 'postcard') return status === 'postcard'
  if (filter === 'appointment') return status === 'appointment'
  if (filter === 'waiting') return status === 'waiting'
  if (filter === 'follow_up') return status === 'follow_up'
  if (filter === 'active') return status === 'active'
  if (filter === 'closed') return status === 'closed'
  return true
}

function normalizeInboxCategory(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_')
  if (!normalized) return ''
  if (['real_estate', 'real_estate_agent', 'real_estate_agents', 'realtor', 'realtors'].includes(normalized)) return 'realtor'
  return normalized
}

function getContactCategoryKey(contact: Contact) {
  return normalizeInboxCategory(contact.category) || normalizeInboxCategory(contact.industry)
}

function inboxCategoryLabel(category: string) {
  if (category === 'realtor') return 'Realtors'
  return getCategoryMeta(category)?.label || category.replace(/_/g, ' ')
}

const PARTNERSHIP_AREA_GROUPS = [
  {
    id: 'windsor_area',
    label: 'Windsor area',
    cityKeys: ['windsor', 'lasalle', 'tecumseh', 'lakeshore', 'belle_river', 'amherstburg', 'essex', 'harrow', 'kingsville', 'leamington', 'stoney_point', 'chatham_kent'],
  },
  {
    id: 'kwg_area',
    label: 'KWG area',
    cityKeys: ['kitchener', 'waterloo', 'cambridge', 'guelph', 'kitchener_waterloo'],
  },
  {
    id: 'london_area',
    label: 'London area',
    cityKeys: ['london', 'st_thomas', 'strathroy', 'woodstock'],
  },
  {
    id: 'ottawa_area',
    label: 'Ottawa area',
    cityKeys: ['ottawa', 'kanata', 'nepean', 'orleans', 'gatineau'],
  },
]

const CITY_LABELS: Record<string, string> = {
  amherstburg: 'Amherstburg',
  belle_river: 'Belle River',
  cambridge: 'Cambridge',
  chatham_kent: 'Chatham Kent',
  essex: 'Essex',
  gatineau: 'Gatineau',
  guelph: 'Guelph',
  harrow: 'Harrow',
  kanata: 'Kanata',
  kingsville: 'Kingsville',
  kitchener: 'Kitchener',
  kitchener_waterloo: 'Kitchener/Waterloo',
  lakeshore: 'Lakeshore',
  lasalle: 'LaSalle',
  leamington: 'Leamington',
  london: 'London',
  nepean: 'Nepean',
  orleans: 'Orleans',
  ottawa: 'Ottawa',
  st_thomas: 'St. Thomas',
  stoney_point: 'Stoney Point',
  strathroy: 'Strathroy',
  tecumseh: 'Tecumseh',
  waterloo: 'Waterloo',
  windsor: 'Windsor',
  woodstock: 'Woodstock',
}

function normalizeInboxCity(value: string | null | undefined) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!normalized) return ''
  if (['la_salle', 'lasalle'].includes(normalized)) return 'lasalle'
  if (['chathamkent', 'chatham_kent', 'chatham'].includes(normalized)) return 'chatham_kent'
  if (['kitchener_waterloo', 'kitchener_and_waterloo', 'kw', 'kwg'].includes(normalized)) return 'kitchener_waterloo'
  if (['stoney_pt', 'stoney_point'].includes(normalized)) return 'stoney_point'
  if (['st_thomas', 'saint_thomas'].includes(normalized)) return 'st_thomas'
  return normalized
}

function inboxCityLabel(cityKey: string) {
  return CITY_LABELS[cityKey] || cityKey.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function areaForCity(cityKey: string) {
  return PARTNERSHIP_AREA_GROUPS.find(area => area.cityKeys.includes(cityKey))
}

function PhoneTab({
  contacts,
  batches,
  lists,
  onSelectContact,
  onContactUpdated,
  onContactDeleted,
}: {
  contacts: Contact[]
  batches: Batch[]
  lists: List[]
  onSelectContact: (c: Contact) => void
  onContactUpdated: (c: Contact) => void
  onContactDeleted: (id: string) => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState('')
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('needs_reply')
  const [areaFilter, setAreaFilter] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [batchFilter, setBatchFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [replyContacts, setReplyContacts] = useState<Contact[]>([])
  const [replyLoading, setReplyLoading] = useState(false)
  const [touches, setTouches] = useState<Touch[]>([])
  const [touchLoading, setTouchLoading] = useState(false)
  const [mobileListOpen, setMobileListOpen] = useState(false)
  const [composeChannel, setComposeChannel] = useState<'sms' | 'email'>('sms')
  const [smsBody, setSmsBody] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [mediaUrls, setMediaUrls] = useState<string[]>([])
  const [mediaUploading, setMediaUploading] = useState(false)
  const [scheduleMode, setScheduleMode] = useState(false)
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledReplyTime)
  const [sending, setSending] = useState(false)
  const [aiReplyLoading, setAiReplyLoading] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState<PartnershipAiSuggestion | null>(null)
  const [quickActionSaving, setQuickActionSaving] = useState<InboxQuickAction | null>(null)
  const [deletingContact, setDeletingContact] = useState(false)
  const [actionPanelOpen, setActionPanelOpen] = useState(false)
  const [sheetUpdateOpen, setSheetUpdateOpen] = useState(false)
  const [sheetInstruction, setSheetInstruction] = useState('')
  const [sheetForm, setSheetForm] = useState<SheetUpdateForm | null>(null)
  const [sheetUpdating, setSheetUpdating] = useState(false)
  const [partnerInfoCollapsed, setPartnerInfoCollapsed] = useState(() => readLocalStorageFlag('ss_partner_inbox_info_collapsed'))
  const [toast, setToast] = useState<string | null>(null)
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [appointmentSaving, setAppointmentSaving] = useState(false)
  const [stageSaving, setStageSaving] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const touchRequestRef = useRef(0)
  const dialer = useDialer()

  const inboxContacts = useMemo(() => {
    const byId = new Map<string, Contact>()
    contacts.forEach(contact => byId.set(contact.id, contact))
    replyContacts.forEach(contact => byId.set(contact.id, { ...(byId.get(contact.id) || {} as Contact), ...contact }))
    return Array.from(byId.values())
  }, [contacts, replyContacts])

  const batchMeta = useMemo(() => {
    const sortedBatches = [...batches].sort((a, b) => a.created_at.localeCompare(b.created_at))
    return new Map(sortedBatches.map((batch, index) => [
      batch.id,
      {
        label: `Batch ${index + 1}`,
        name: batch.name,
        city: batch.city,
        industry: batch.industry,
      },
    ]))
  }, [batches])

  const segmentContacts = useMemo(() => inboxContacts.filter(contact => {
    const cityKey = normalizeInboxCity(contact.city)
    if (areaFilter) {
      const area = PARTNERSHIP_AREA_GROUPS.find(item => item.id === areaFilter)
      if (area && !area.cityKeys.includes(cityKey)) return false
    }
    if (cityFilter && cityKey !== cityFilter) return false
    if (categoryFilter && getContactCategoryKey(contact) !== categoryFilter) return false
    if (batchFilter && contact.batch_id !== batchFilter) return false
    return true
  }), [inboxContacts, areaFilter, cityFilter, categoryFilter, batchFilter])

  const cityOptions = useMemo(() => {
    const area = PARTNERSHIP_AREA_GROUPS.find(item => item.id === areaFilter)
    return Array.from(new Set(inboxContacts
      .map(contact => normalizeInboxCity(contact.city))
      .filter(Boolean)
      .filter(cityKey => !area || area.cityKeys.includes(cityKey))))
      .map(cityKey => ({ key: cityKey, label: inboxCityLabel(cityKey) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [inboxContacts, areaFilter])

  useEffect(() => {
    if (!cityFilter) return
    if (!cityOptions.some(city => city.key === cityFilter)) setCityFilter('')
  }, [cityFilter, cityOptions])

  const categoryOptions = useMemo(() => Array.from(new Set(inboxContacts
    .map(contact => getContactCategoryKey(contact))
    .filter(Boolean)))
    .sort((a, b) => {
      const aLabel = inboxCategoryLabel(a)
      const bLabel = inboxCategoryLabel(b)
      return aLabel.localeCompare(bLabel)
    }), [inboxContacts])

  const batchOptions = useMemo(() => {
    const usedBatchIds = new Set(inboxContacts.map(contact => contact.batch_id).filter(Boolean))
    return Array.from(batchMeta.entries())
      .filter(([id]) => usedBatchIds.has(id))
      .map(([id, meta]) => ({ id, ...meta }))
  }, [batchMeta, inboxContacts])

  const hasSegmentFilter = Boolean(areaFilter || cityFilter || categoryFilter || batchFilter)

  const sorted = useMemo(() => [...segmentContacts]
    .filter(c => matchesInboxFilter(c, inboxFilter))
    .sort((a, b) => {
      const urgency = inboxUrgencyRank(a) - inboxUrgencyRank(b)
      if (urgency !== 0) return urgency
      return (b.last_touch_at || b.latest_inbound_at || '').localeCompare(a.last_touch_at || a.latest_inbound_at || '')
    })
    .filter(c => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      const status = inboxStatusLabel(getInboxStatus(c)).toLowerCase()
      const preview = getContactPreview(c)?.body ?? ''
      return [
        c.name,
        c.company,
        c.email,
        c.phone,
        c.city,
        areaForCity(normalizeInboxCity(c.city))?.label,
        c.industry,
        c.category,
        c.batch_id ? batchMeta.get(c.batch_id)?.name : '',
        c.batch_id ? batchMeta.get(c.batch_id)?.label : '',
        c.normalized_stage,
        c.latest_inbound_note,
        c.latest_touch_note,
        preview,
        status,
      ].filter(Boolean).join(' ').toLowerCase().includes(q)
    }), [segmentContacts, inboxFilter, search, batchMeta])

  const filterCounts = useMemo(() => {
    return INBOX_FILTERS.reduce((acc, filter) => {
      acc[filter.key] = segmentContacts.filter(contact => matchesInboxFilter(contact, filter.key)).length
      return acc
    }, {} as Record<InboxFilter, number>)
  }, [segmentContacts])

  const selected = inboxContacts.find(c => c.id === selectedId) ?? null
  const selectedFromQuery = searchParams.get('contact')
  const selectedThreadFromNumber = selected
    ? touches.length > 0
      ? threadFromNumber(touches)
      : contactThreadFromNumber(selected)
    : PARTNERSHIP_FROM_NUMBER
  const selectedUsingSalesLine = selectedThreadFromNumber === TEMP_SALES_RECOVERY_NUMBER
  const appointmentSuggestion = useMemo(() => {
    if (!selected) return null
    const threadContext = touches
      .slice(-8)
      .map(touch => `${touch.direction || ''} ${touch.channel || ''}: ${touch.notes || ''}`)
      .join('\n')
    return parseConversationAppointmentSuggestion(selected, threadContext)
  }, [selected, touches])

  const loadReplyContacts = useCallback(() => {
    let cancelled = false
    setReplyLoading(true)
    fetch('/api/marketing/sms/replies?limit=500&include_suggestions=1', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { responses: [] })
      .then((data: { responses?: ReplyItem[] }) => {
        if (cancelled) return
        setReplyContacts((data.responses || []).map(item => ({ ...item.contact, playbook: item.playbook ?? null })))
      })
      .finally(() => { if (!cancelled) setReplyLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => loadReplyContacts(), [loadReplyContacts])

  useEffect(() => {
    void dialer.ensureReady()
    // Register the partnership browser dialer once when the inbox mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedFromQuery && inboxContacts.some(c => c.id === selectedFromQuery)) {
      setSelectedId(curr => curr === selectedFromQuery ? curr : selectedFromQuery)
    } else if (!selectedId && sorted[0]) {
      setSelectedId(sorted[0].id)
    }
  }, [inboxContacts, selectedFromQuery, selectedId, sorted])

  const reloadTouches = useCallback((contactId: string) => {
    const requestId = ++touchRequestRef.current
    fetch(`/api/marketing/touches?contact_id=${contactId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        if (touchRequestRef.current !== requestId) return
        setTouches(Array.isArray(d) ? d : [])
      })
      .catch(() => {})
      .finally(() => {
        if (touchRequestRef.current === requestId) setTouchLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!selectedId) return
    const requestId = ++touchRequestRef.current
    setTouches([])
    setTouchLoading(true)
    fetch(`/api/marketing/touches?contact_id=${selectedId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        if (touchRequestRef.current !== requestId) return
        setTouches(Array.isArray(d) ? d : [])
      })
      .catch(() => {
        if (touchRequestRef.current === requestId) setTouches([])
      })
      .finally(() => {
        if (touchRequestRef.current === requestId) setTouchLoading(false)
      })
  }, [selectedId])

  useEffect(() => {
    if (!selected?.id || !selected.latest_inbound_at) return
    reloadTouches(selected.id)
  }, [selected?.id, selected?.latest_inbound_at, reloadTouches])

  useEffect(() => {
    if (!selected) return
    speechRecognitionRef.current?.abort()
    speechRecognitionRef.current = null
    setVoiceListening(false)
    setVoiceError(null)
    setSmsBody('')
    setEmailSubject('')
    setEmailBody('')
    setMediaUrls([])
    setScheduleMode(false)
    setActionPanelOpen(false)
    setAiSuggestion(null)
    setScheduledAt(defaultScheduledReplyTime())
  }, [selected?.id])

  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight }, [touches])
  useEffect(() => { writeLocalStorageFlag('ss_partner_inbox_info_collapsed', partnerInfoCollapsed) }, [partnerInfoCollapsed])
  useEffect(() => () => speechRecognitionRef.current?.abort(), [])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  function appendDictation(text: string) {
    const cleaned = text.replace(/\s+/g, ' ').trim()
    if (!cleaned) return
    if (composeChannel === 'email') {
      setEmailBody(current => current.trim() ? `${current.trim()} ${cleaned}` : cleaned)
    } else {
      setSmsBody(current => current.trim() ? `${current.trim()} ${cleaned}` : cleaned)
    }
  }

  function toggleVoiceDictation() {
    if (voiceListening) {
      speechRecognitionRef.current?.stop()
      setVoiceListening(false)
      return
    }
    const SpeechRecognitionCtor = (window as unknown as {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
    }).SpeechRecognition || (window as unknown as {
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
    }).webkitSpeechRecognition

    if (!SpeechRecognitionCtor) {
      setVoiceError('Voice typing works best in Chrome desktop.')
      showToast('Voice typing is not supported in this browser')
      return
    }

    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'en-CA'
    recognition.onresult = event => {
      let finalText = ''
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result?.isFinal) finalText += ` ${result[0]?.transcript || ''}`
      }
      appendDictation(finalText)
    }
    recognition.onerror = event => {
      const message = event.error === 'not-allowed' ? 'Microphone permission blocked.' : 'Voice typing stopped.'
      setVoiceError(message)
      showToast(message)
      setVoiceListening(false)
    }
    recognition.onend = () => {
      setVoiceListening(false)
      speechRecognitionRef.current = null
    }

    setVoiceError(null)
    speechRecognitionRef.current = recognition
    setVoiceListening(true)
    try {
      recognition.start()
    } catch {
      setVoiceListening(false)
      speechRecognitionRef.current = null
      showToast('Could not start voice typing')
    }
  }

  function applySuggestion(suggestion: PartnershipAiSuggestion) {
    if (suggestion.draft_sms) {
      setComposeChannel('sms')
      setSmsBody(suggestion.draft_sms)
    }
    if (suggestion.draft_email_subject) setEmailSubject(suggestion.draft_email_subject)
    if (suggestion.draft_email_body) setEmailBody(suggestion.draft_email_body)
    if (suggestion.suggested_media_urls?.length) {
      setMediaUrls(current => Array.from(new Set([...current, ...suggestion.suggested_media_urls!])).slice(0, 10))
    }
    setScheduledAt(defaultScheduledReplyTime(suggestion))
    setAiSuggestion(suggestion)
  }

  function handleSelect(id: string) {
    setSelectedId(id)
    setMobileListOpen(false)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/marketing/partners?tab=phone&contact=${id}`)
    }
  }

  function openSheetUpdate(contact: Contact) {
    setSheetInstruction('')
    setSheetForm(defaultSheetUpdateForm(contact))
    setSheetUpdateOpen(true)
  }

  function insertPartnerLink() {
    if (!selected) return
    const line = partnerPackageMessage(selected)
    if (composeChannel === 'email') {
      setEmailBody(current => current.trim() ? `${current.trim()}\n\n${line}` : line)
      if (!emailSubject.trim()) setEmailSubject('Saturn Star Movers partner package')
    } else {
      setSmsBody(current => current.trim() ? `${current.trim()}\n\n${line}` : line)
    }
    showToast('Partner link added')
  }

  async function copyPartnerLink() {
    if (!selected) return
    const link = partnerPackageUrl(selected)
    try {
      await navigator.clipboard.writeText(link)
      showToast('Partner link copied')
    } catch {
      showToast(link)
    }
  }

  async function uploadMedia(file: File): Promise<string | null> {
    try {
      const preparedFile = await prepareUploadFile(file)
      const fd = new FormData()
      fd.append('file', preparedFile)
      const res = await fetch('/api/sales/operations/upload-media', { method: 'POST', body: fd, credentials: 'include' })
      if (!res.ok) return null
      const data = await res.json() as { url?: string }
      return data.url || null
    } catch {
      return null
    }
  }

  async function handleMediaFiles(files: FileList | null) {
    const selectedFiles = Array.from(files || []).slice(0, 10)
    if (selectedFiles.length === 0) return
    setComposeChannel('sms')
    setMediaUploading(true)
    try {
      const uploaded: string[] = []
      for (const file of selectedFiles) {
        const url = await uploadMedia(file)
        if (url) uploaded.push(url)
      }
      if (uploaded.length > 0) {
        setMediaUrls(current => [...current, ...uploaded].slice(0, 10))
        showToast(uploaded.length === 1 ? 'Attachment added' : `${uploaded.length} attachments added`)
      } else {
        showToast('Upload failed')
      }
    } finally {
      setMediaUploading(false)
      if (mediaInputRef.current) mediaInputRef.current.value = ''
    }
  }

  async function handleSend() {
    if (!selected) return
    setSending(true)
    const replyFromNumber = selectedThreadFromNumber
    try {
      if (composeChannel === 'sms' && scheduleMode) {
        const res = await fetch(`/api/marketing/contacts/${selected.id}/schedule-reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            body: smsBody,
            scheduled_at: new Date(scheduledAt).toISOString(),
            from_number: replyFromNumber,
            media_urls: mediaUrls,
          }),
        })
        const data = await res.json().catch(() => null) as { error?: string; scheduled_at?: string } | null
        if (!res.ok) {
          showToast(data?.error || 'Could not schedule SMS')
          return
        }
        showToast('SMS scheduled')
        setSmsBody('')
        setMediaUrls([])
        setScheduleMode(false)
        setScheduledAt(defaultScheduledReplyTime())
        reloadTouches(selected.id)
        loadReplyContacts()
        return
      }

      if (composeChannel === 'sms') {
        const res = await fetch(`/api/marketing/contacts/${selected.id}/send-reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            body: smsBody,
            from_number: replyFromNumber,
            media_urls: mediaUrls,
          }),
        })
        const data = await res.json().catch(() => null) as { error?: string } | null
        if (!res.ok) throw new Error(data?.error || 'Could not send SMS')
      } else {
        await sendSalesMessage({ channel: 'email', to: selected.email!, subject: emailSubject, body: emailBody })
        await fetch('/api/marketing/touches', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({
            contact_id: selected.id, channel: composeChannel, direction: 'outbound',
            notes: `Subject: ${emailSubject}\n\n${emailBody}`,
            metadata: {},
            schedule_follow_up_days: 3,
          }),
        })
      }
      showToast(composeChannel === 'sms' ? '💬 SMS sent' : '✉️ Email sent')
      const outboundAt = new Date().toISOString()
      const updatedAfterSend = {
        ...selected,
        latest_touch_direction: 'outbound',
        latest_touch_channel: composeChannel,
        latest_touch_note: composeChannel === 'sms' ? smsBody : emailBody,
        last_touch_at: outboundAt,
        sequence_paused: false,
        needs_follow_up: true,
      }
      setReplyContacts(curr => curr.some(c => c.id === selected.id)
        ? curr.map(c => c.id === selected.id ? { ...c, ...updatedAfterSend } : c)
        : [updatedAfterSend, ...curr]
      )
      onContactUpdated(updatedAfterSend)
      setSmsBody('')
      setEmailSubject('')
      setEmailBody('')
      setMediaUrls([])
      reloadTouches(selected.id)
      loadReplyContacts()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Send failed')
    }
    finally { setSending(false) }
  }

  async function handleAiReply() {
    if (!selected || aiReplyLoading) return
    setAiReplyLoading(true)
    try {
      const res = await fetch(`/api/marketing/contacts/${selected.id}/ai-reply`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => null) as { suggestion?: PartnershipAiSuggestion; error?: string } | null
      if (!res.ok || !data?.suggestion) {
        showToast(data?.error || 'Could not draft reply')
        return
      }
      const suggestion = data.suggestion
      applySuggestion(suggestion)
      showToast('Smart draft ready')
    } catch {
      showToast('Could not draft reply')
    } finally {
      setAiReplyLoading(false)
    }
  }

  async function handleQuickAction(action: InboxQuickAction) {
    if (!selected || quickActionSaving) return
    const config = INBOX_QUICK_ACTIONS.find(item => item.key === action)
    setQuickActionSaving(action)
    try {
      const res = await fetch(`/api/marketing/contacts/${selected.id}/quick-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => null) as { contact?: Contact; label?: string; error?: string } | null
      if (!res.ok || !data?.contact) {
        showToast(data?.error || 'Could not save action')
        return
      }
      const updated = {
        ...selected,
        ...data.contact,
        normalized_stage: String(data.contact.stage || data.contact.normalized_stage || selected.normalized_stage),
      }
      setReplyContacts(curr => {
        const seen = curr.some(c => c.id === updated.id)
        return seen ? curr.map(c => c.id === updated.id ? { ...c, ...updated } : c) : [updated, ...curr]
      })
      onContactUpdated(updated)
      reloadTouches(updated.id)
      showToast(`${data.label || config?.label || 'Action'} saved`)
    } catch {
      showToast('Could not save action')
    } finally {
      setQuickActionSaving(null)
    }
  }

  async function handleStageChange(stage: string) {
    if (!selected || stageSaving || selected.normalized_stage === stage) return
    const previous = selected
    const nextDecision = stage === 'partnership_active'
      ? 'agreed'
      : stage === 'closed_lost'
        ? 'rejected'
        : previous.decision === 'agreed' || previous.decision === 'rejected'
          ? null
          : previous.decision
    const optimistic = {
      ...previous,
      stage,
      normalized_stage: stage,
      decision: nextDecision,
      last_touch_at: new Date().toISOString(),
    }
    setStageSaving(stage)
    setReplyContacts(curr => curr.some(c => c.id === optimistic.id)
      ? curr.map(c => c.id === optimistic.id ? { ...c, ...optimistic } : c)
      : [optimistic, ...curr]
    )
    onContactUpdated(optimistic)
    try {
      const res = await fetch('/api/marketing/contacts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: selected.id, stage, decision: nextDecision }),
      })
      const data = await res.json().catch(() => null) as { contact?: Contact; error?: string } | null
      if (!res.ok || !data?.contact) {
        setReplyContacts(curr => curr.map(c => c.id === previous.id ? previous : c))
        onContactUpdated(previous)
        showToast(data?.error || 'Could not update stage')
        return
      }
      const updated = {
        ...optimistic,
        ...data.contact,
        normalized_stage: String(data.contact.stage || data.contact.normalized_stage || stage),
      }
      setReplyContacts(curr => curr.map(c => c.id === updated.id ? { ...c, ...updated } : c))
      onContactUpdated(updated)
      showToast(stage === 'partnership_active' ? 'Moved to Partners' : 'Stage updated')
    } catch {
      setReplyContacts(curr => curr.map(c => c.id === previous.id ? previous : c))
      onContactUpdated(previous)
      showToast('Could not update stage')
    } finally {
      setStageSaving(null)
    }
  }

  async function handleCreateAppointmentFromSuggestion() {
    if (!selected || !appointmentSuggestion || appointmentSaving) return
    setAppointmentSaving(true)
    try {
      const res = await fetch('/api/marketing/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          contact_id: selected.id,
          title: appointmentSuggestion.title,
          scheduled_at: new Date(appointmentSuggestion.scheduledAtLocal).toISOString(),
          duration_minutes: appointmentSuggestion.channel === 'phone' ? 20 : 30,
          channel: appointmentSuggestion.channel,
          notes: appointmentSuggestion.notes,
        }),
      })
      const data = await res.json().catch(() => null) as { appointment?: Appointment; error?: string } | null
      if (!res.ok) {
        showToast(data?.error || 'Could not create reminder')
        return
      }
      const updated = {
        ...selected,
        stage: 'qualified',
        normalized_stage: 'qualified',
        pipeline_phase: 'field_visit',
        sequence_paused: true,
        sequence_paused_reason: appointmentSuggestion.channel === 'in_person' ? 'quick_action:drop_cards' : 'quick_action:meeting_requested',
        latest_touch_direction: 'outbound',
        latest_touch_channel: appointmentSuggestion.channel,
        latest_touch_note: `Appointment booked: ${appointmentSuggestion.title}`,
        last_touch_at: new Date().toISOString(),
        needs_follow_up: false,
      }
      setReplyContacts(curr => curr.some(c => c.id === updated.id) ? curr.map(c => c.id === updated.id ? { ...c, ...updated } : c) : [updated, ...curr])
      onContactUpdated(updated)
      reloadTouches(selected.id)
      loadReplyContacts()
      showToast(`${appointmentSuggestion.title} reminder saved`)
    } catch {
      showToast('Could not create reminder')
    } finally {
      setAppointmentSaving(false)
    }
  }

  async function handleSheetUpdate() {
    if (!selected || sheetUpdating || (!sheetInstruction.trim() && !sheetUpdateFormHasChanges(sheetForm, selected))) return
    setSheetUpdating(true)
    try {
      const res = await fetch(`/api/marketing/contacts/${selected.id}/sheet-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          instruction: sheetInstruction.trim(),
          action: sheetForm?.action || undefined,
          sheet_note: sheetForm?.sheetNote.trim() || undefined,
          sheet_target: sheetForm?.sheetTarget.trim() || undefined,
          contact_updates: sheetForm ? {
            name: sheetForm.name.trim(),
            company: sheetForm.company.trim(),
            title: sheetForm.title.trim(),
            email: sheetForm.email.trim(),
            phone: sheetForm.phone.trim(),
            address: sheetForm.address.trim(),
            city: sheetForm.city.trim(),
            industry: sheetForm.industry.trim(),
            next_follow_up: sheetForm.nextFollowUp,
          } : undefined,
        }),
      })
      const data = await res.json().catch(() => null) as { error?: string; summary?: string; label?: string; sheetSyncOk?: boolean; contact?: Contact } | null
      if (!res.ok) {
        showToast(data?.error || 'Could not update sheet')
        return
      }
      if (data?.contact) {
        const updated = {
          ...selected,
          ...data.contact,
          normalized_stage: String(data.contact.stage || data.contact.normalized_stage || selected.normalized_stage),
        }
        setReplyContacts(curr => curr.some(c => c.id === updated.id) ? curr.map(c => c.id === updated.id ? { ...c, ...updated } : c) : [updated, ...curr])
        onContactUpdated(updated)
      }
      setSheetUpdateOpen(false)
      setSheetInstruction('')
      setSheetForm(null)
      reloadTouches(selected.id)
      showToast(data?.sheetSyncOk === false ? 'CRM updated; sheet sync not configured' : `Sheet updated for ${selected.name}`)
    } catch {
      showToast('Could not update sheet')
    } finally {
      setSheetUpdating(false)
    }
  }

  async function handleCall() {
    if (!selected?.phone) return
    await dialer.call(selected.phone)
    await fetch('/api/marketing/touches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_id: selected.id, channel: 'phone', direction: 'outbound', notes: 'Outbound call via partnership dialer', schedule_follow_up_days: 2 }),
    })
  }

  async function handleDeleteContact() {
    if (!selected || deletingContact) return
    const confirmed = window.confirm(`Delete ${selected.name}? This removes the contact from the partnership inbox and clears related touches, tasks, appointments, and scheduled SMS jobs.`)
    if (!confirmed) return

    const currentId = selected.id
    const nextContact = sorted.find(contact => contact.id !== currentId) ?? null
    setDeletingContact(true)
    try {
      const res = await fetch(`/api/marketing/contacts?id=${encodeURIComponent(currentId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) {
        showToast(data?.error || 'Could not delete contact')
        return
      }

      setReplyContacts(curr => curr.filter(contact => contact.id !== currentId))
      onContactDeleted(currentId)
      setTouches([])
      setSelectedId(nextContact?.id ?? null)
      if (nextContact) {
        router.replace(`/marketing/partners?tab=phone&contact=${nextContact.id}`, { scroll: false })
      } else {
        router.replace('/marketing/partners?tab=phone', { scroll: false })
        setMobileListOpen(true)
      }
      showToast('Contact deleted')
    } catch {
      showToast('Could not delete contact')
    } finally {
      setDeletingContact(false)
    }
  }

  return (
    <div className="flex h-[calc(100dvh-5.5rem)] min-h-0 overflow-hidden bg-white md:h-[calc(100dvh-7rem)] md:min-h-[680px] md:rounded-[16px] md:border md:border-slate-200 lg:h-[calc(100vh-7rem)]">
      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[14px] bg-[#1a2744] px-5 py-3 text-sm font-medium text-white shadow-xl">{toast}</div>}
      {dialer.status === 'ringing' && (
        <div className="fixed left-1/2 top-6 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-[16px] border border-emerald-200 bg-white p-4 shadow-2xl">
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Incoming partnership call</div>
          <div className="mt-1 truncate text-sm font-semibold text-[#1a2744]">{dialer.incomingFrom || 'Unknown caller'}</div>
          <div className="mt-3 flex gap-2">
            <button onClick={dialer.acceptIncoming} className="min-h-10 flex-1 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white">Accept</button>
            <button onClick={dialer.rejectIncoming} className="min-h-10 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600">Decline</button>
          </div>
        </div>
      )}
      {sheetUpdateOpen && selected && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-[20px] border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#1a2744]">Update partner record</h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  {selected.name}{selected.company ? ` · ${selected.company}` : ''}
                </p>
              </div>
              <button
                onClick={() => { if (!sheetUpdating) setSheetUpdateOpen(false) }}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100"
              >
                x
              </button>
            </div>
            {sheetForm && (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Status / action</span>
                    <select
                      value={sheetForm.action}
                      onChange={e => setSheetForm(form => form ? { ...form, action: e.target.value as SheetUpdateForm['action'] } : form)}
                      className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-[#1a2744] outline-none focus:border-[#1a2744]"
                    >
                      <option value="">No status change</option>
                      {INBOX_QUICK_ACTIONS.map(action => (
                        <option key={action.key} value={action.key}>{action.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">List / sheet target</span>
                    <input
                      value={sheetForm.sheetTarget}
                      onChange={e => setSheetForm(form => form ? { ...form, sheetTarget: e.target.value } : form)}
                      placeholder="Active partners, Field work, Windsor realtors..."
                      className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Remarks / next step</span>
                  <textarea
                    value={sheetForm.sheetNote}
                    onChange={e => setSheetForm(form => form ? { ...form, sheetNote: e.target.value } : form)}
                    rows={3}
                    placeholder="Example: Send digital package, then drop cards at front desk next week. Prefers text."
                    className="mt-1 w-full resize-none rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-6 text-[#1a2744] outline-none focus:border-[#1a2744]"
                  />
                </label>

                <div className="rounded-[16px] border border-slate-200 bg-white p-3">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Partner context</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ['name', 'Name', sheetForm.name],
                      ['company', 'Company / brokerage', sheetForm.company],
                      ['title', 'Title', sheetForm.title],
                      ['phone', 'Phone', sheetForm.phone],
                      ['email', 'Email', sheetForm.email],
                      ['city', 'City', sheetForm.city],
                      ['industry', 'Industry', sheetForm.industry],
                      ['nextFollowUp', 'Next follow-up', sheetForm.nextFollowUp],
                    ].map(([field, label, value]) => (
                      <label key={field} className="block">
                        <span className="text-[11px] font-semibold text-slate-500">{label}</span>
                        <input
                          value={value}
                          onChange={e => setSheetForm(form => form ? { ...form, [field]: e.target.value } as SheetUpdateForm : form)}
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]"
                        />
                      </label>
                    ))}
                    <label className="block sm:col-span-2">
                      <span className="text-[11px] font-semibold text-slate-500">Address</span>
                      <input
                        value={sheetForm.address}
                        onChange={e => setSheetForm(form => form ? { ...form, address: e.target.value } : form)}
                        className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]"
                      />
                    </label>
                  </div>
                </div>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Extra instruction</span>
                  <textarea
                    value={sheetInstruction}
                    onChange={e => setSheetInstruction(e.target.value)}
                    rows={3}
                    placeholder="Optional: explain where this should go if the list/status is not obvious."
                    className="mt-1 w-full resize-none rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-6 text-[#1a2744] outline-none focus:border-[#1a2744]"
                  />
                </label>
              </div>
            )}
            <div className="mt-3 rounded-[14px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
              Saves the CRM record first, then sends the same tagged update to the partnership sheet when sheet sync is configured.
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setSheetUpdateOpen(false); setSheetForm(null) }}
                disabled={sheetUpdating}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSheetUpdate()}
                disabled={sheetUpdating || (!sheetInstruction.trim() && !sheetUpdateFormHasChanges(sheetForm, selected))}
                className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {sheetUpdating ? 'Updating...' : 'Save update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contact list */}
      <div className={`${selected && !mobileListOpen ? 'hidden lg:flex' : 'flex'} w-full shrink-0 flex-col border-r-0 border-slate-200 bg-white lg:w-[340px] lg:border-r xl:w-[360px]`}>
        <div className="shrink-0 border-b border-slate-100 px-4 py-4">
          <div className="mb-3 flex items-center justify-between lg:mb-2">
            <div>
              <div className="text-[22px] font-semibold tracking-tight text-[#111827] lg:text-xl">Partnership replies</div>
              <div className="text-xs font-medium text-slate-500">
                {filterCounts.sales_line} sales line · {filterCounts.context} context · {filterCounts.needs_reply} need reply · {filterCounts.responded} responded · {filterCounts.no_response} no response · {filterCounts.postcard} postcards · {filterCounts.appointment} appointments
              </div>
            </div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{filterCounts.all}</span>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts…"
            className="h-12 w-full rounded-full border border-slate-200 bg-slate-50 px-4 text-base leading-6 text-[#1a2744] outline-none focus:border-[#1a2744] lg:h-10 lg:text-sm" />
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              value={areaFilter}
              onChange={e => setAreaFilter(e.target.value)}
              className="h-10 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 outline-none focus:border-[#1a2744] lg:h-9 lg:text-[12px]"
            >
              <option value="">All areas</option>
              {PARTNERSHIP_AREA_GROUPS.map(area => (
                <option key={area.id} value={area.id}>{area.label}</option>
              ))}
            </select>
            <select
              value={cityFilter}
              onChange={e => setCityFilter(e.target.value)}
              className="h-10 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 outline-none focus:border-[#1a2744] lg:h-9 lg:text-[12px]"
            >
              <option value="">All cities</option>
              {cityOptions.map(city => (
                <option key={city.key} value={city.key}>{city.label}</option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="h-10 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 outline-none focus:border-[#1a2744] lg:h-9 lg:text-[12px]"
            >
              <option value="">All categories</option>
              {categoryOptions.map(category => (
                <option key={category} value={category}>{inboxCategoryLabel(category)}</option>
              ))}
            </select>
            <select
              value={batchFilter}
              onChange={e => setBatchFilter(e.target.value)}
              className="h-10 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 outline-none focus:border-[#1a2744] lg:h-9 lg:text-[12px]"
            >
              <option value="">All batches</option>
              {batchOptions.map(batch => (
                <option key={batch.id} value={batch.id}>{batch.label} · {batch.name}</option>
              ))}
            </select>
          </div>
          {hasSegmentFilter && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-[12px] bg-slate-50 px-3 py-2">
              <span className="min-w-0 truncate text-[11px] font-semibold text-slate-500">
                Showing {segmentContacts.length} of {inboxContacts.length} in this segment
              </span>
              <button
                onClick={() => { setAreaFilter(''); setCityFilter(''); setCategoryFilter(''); setBatchFilter('') }}
                className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:text-[#1a2744]"
              >
                Clear
              </button>
            </div>
          )}
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
            {INBOX_FILTERS.map(filter => (
              <button
                key={filter.key}
                onClick={() => setInboxFilter(filter.key)}
                className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold transition lg:min-h-8 lg:px-3 lg:text-[11px] ${inboxFilter === filter.key ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {replyLoading && <div className="mt-2 text-[11px] text-slate-400">Loading replies...</div>}
        </div>
        <div className="flex-1 overflow-y-auto">
          {sorted.map(c => {
            const status = getInboxStatus(c)
            const unread = status === 'context' || status === 'needs_reply'
            const p = getContactPreview(c)
            return (
              <button key={c.id} onClick={() => handleSelect(c.id)}
                className={`w-full border-b border-slate-100 px-4 py-4 text-left transition hover:bg-slate-50 lg:py-3.5 ${selectedId === c.id ? 'bg-slate-100 shadow-[inset_3px_0_0_#111827]' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${selectedId === c.id ? 'bg-[#111827] text-white' : 'bg-slate-100 text-slate-700'}`}>{c.name.charAt(0)}</span>
                    <div className="min-w-0">
                      <div className={`truncate text-[15px] font-semibold ${selectedId === c.id ? 'text-[#111827]' : 'text-[#1a2744]'}`}>{c.name}</div>
                      <div className={`mt-0.5 truncate text-xs ${selectedId === c.id ? 'text-slate-600' : 'text-slate-400'}`}>{c.company ?? c.industry ?? c.city ?? 'Partner contact'}</div>
                    </div>
                    <TierBadge tier={c.outreach_tier} />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {unread && selectedId !== c.id && <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />}
                    <span className={`text-[11px] ${selectedId === c.id ? 'text-slate-500' : 'text-slate-400'}`}>{timeAgo(c.latest_inbound_at || c.last_touch_at)}</span>
                  </div>
                </div>
                {p?.body && <div className={`mt-2 line-clamp-2 text-sm leading-[1.5] lg:text-[13px] ${selectedId === c.id ? 'text-slate-700' : 'text-slate-600'}`}>{truncateText(p.body, 150)}</div>}
                <div className="mt-2 flex items-center gap-1.5 overflow-hidden pl-12">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${inboxStatusClass(status)}`}>{inboxStatusLabel(status)}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${selectedId === c.id ? 'bg-white text-slate-600' : 'bg-slate-100 text-slate-500'}`}>{sourceBadge(c)}</span>
                  <StageBadge stage={c.normalized_stage} />
                  {isSalesLineThread(c) && (
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                      sales line
                    </span>
                  )}
                  {c.instantly_status && <InstantlyBadge status={c.instantly_status} />}
                  {c.playbook?.intent && (
                    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {c.playbook.intent.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Detail panel */}
      {!selected ? (
        <div className="flex flex-1 items-center justify-center text-slate-400">
          <div className="text-center"><div className="text-4xl">📱</div><div className="mt-3 text-sm font-medium">Select a contact</div></div>
        </div>
      ) : (
        <>
        <div className={`${mobileListOpen ? 'hidden lg:flex' : 'flex'} min-w-0 flex-1 flex-col bg-white`}>
          {/* Header */}
          <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
            <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <button onClick={() => setMobileListOpen(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-[#1a2744] lg:hidden">
                ‹
              </button>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1a2744] text-sm font-bold text-white">{selected.name.charAt(0)}</div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate font-semibold text-[#1a2744]">{selected.name}</div>
                  <StageBadge stage={selected.normalized_stage} />
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-400">{selected.phone || selected.company || selected.city || 'Partner contact'} · Hunter</div>
                <div className="mt-2 hidden max-w-[62vw] items-center gap-1.5 overflow-x-auto md:flex">
                  {REPLY_DESK_STAGE_ACTIONS.slice(0, 4).map(stage => (
                    <button
                      key={stage.key}
                      onClick={() => void handleStageChange(stage.key)}
                      disabled={stageSaving !== null}
                      title={stage.helper}
                      className={`min-h-8 shrink-0 rounded-full border px-3 text-[11px] font-semibold transition disabled:opacity-50 ${selected.normalized_stage === stage.key ? quickActionClass(stage.tone, true) : quickActionClass(stage.tone, stageSaving === stage.key)}`}
                    >
                      {stageSaving === stage.key ? 'Saving...' : stage.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {selected.phone && (
                dialer.status === 'connected' ? (
                  <button onClick={dialer.hangup} className="min-h-11 rounded-full bg-rose-500 px-5 text-sm font-semibold text-white lg:min-h-10">End</button>
                ) : (
                  <button onClick={handleCall} disabled={dialer.status === 'connecting' || dialer.status === 'loading'}
                    className="min-h-11 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-[#1a2744] transition hover:bg-slate-50 disabled:opacity-50 lg:min-h-10">
                    {dialer.status === 'connecting' || dialer.status === 'loading' ? 'Calling' : 'Call'}
                  </button>
                )
              )}
              <button onClick={() => onSelectContact(selected)} className="min-h-11 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600 hover:bg-slate-50 xl:hidden">Info</button>
            </div>
            </div>
          </div>

          {/* Thread */}
          <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto bg-white px-3 py-6 sm:px-6">
            {touchLoading && <div className="text-center text-xs text-slate-400 py-8">Loading…</div>}
            {!touchLoading && touches.length === 0 && <div className="text-center text-xs text-slate-400 py-8">No history yet.</div>}
            {(() => {
              const threadTouches = [...touches].reverse()
              return threadTouches.map((touch, touchIndex) => {
              const previousTouch = threadTouches[touchIndex - 1]
              const nextTouch = threadTouches[touchIndex + 1]
              const groupedWithPrevious = sameMessageGroup(touch, previousTouch)
              const groupedWithNext = sameMessageGroup(touch, nextTouch)
              const s = summarizeTouch(touch.channel, touch.direction, touch.notes)
              const touchMedia = getTouchMediaUrls(touch)
              const rawBubbleText = (s.body || '').replace(/\n?\[MMS:\s*[^\]]+\]/ig, '').trim()
              const reaction = detectSmsReaction(touch, threadTouches.slice(0, touchIndex))
              const bubbleText = reaction ? '' : hasRichSmsArtifact(rawBubbleText) ? cleanRichSmsFallback(rawBubbleText) : rawBubbleText
              if (reaction) {
                return (
                  <div key={touch.id} className={`flex justify-end ${touchIndex === 0 ? '' : groupedWithPrevious ? 'mt-1' : 'mt-6'}`}>
                    <div className="mr-10 flex max-w-[min(78%,640px)] items-center gap-2 rounded-full border border-rose-100 bg-white px-3 py-2 text-xs font-semibold text-[#1a2744] shadow-sm">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-50 text-sm text-rose-600">{reactionSymbol(reaction.kind)}</span>
                      <span className="truncate">{reaction.kind === 'loved' ? 'Loved' : reaction.kind} your SMS</span>
                    </div>
                  </div>
                )
              }
              if (touch.channel === 'note' || touch.channel === 'appointment') {
                return (
                  <div key={touch.id} className={`flex justify-center ${touchIndex === 0 ? '' : 'mt-6'}`}>
                    <div className="max-w-[min(82%,640px)] rounded-full bg-white/80 px-3 py-2 text-center text-xs font-medium leading-[1.5] text-slate-500 shadow-sm ring-1 ring-slate-200">
                      {s.label}: {truncateText(bubbleText || 'Updated', 120)}
                    </div>
                  </div>
                )
              }
              return (
                <div key={touch.id} className={`flex gap-3 ${touch.direction === 'outbound' ? 'flex-row-reverse' : ''} ${touchIndex === 0 ? '' : groupedWithPrevious ? 'mt-1' : 'mt-6'}`}>
                  <div className={`hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm sm:flex ${groupedWithPrevious ? 'invisible' : ''} ${touch.direction === 'outbound' ? 'bg-[#1a2744]' : 'bg-white border border-slate-200'}`}>
                    <ChannelIcon channel={touch.channel} direction={touch.direction} />
                  </div>
                  <div className={`max-w-[min(78%,620px)] px-4 py-3 text-base leading-[1.5] lg:text-[15px] ${touch.direction === 'outbound' ? 'bg-[#0f6a53] text-white' : 'bg-[#f1f3f5] text-[#111827]'} ${touch.direction === 'outbound' ? `${groupedWithPrevious ? 'rounded-tr-md' : 'rounded-tr-[18px]'} ${groupedWithNext ? 'rounded-br-md' : 'rounded-br-[18px]'} rounded-l-[18px]` : `${groupedWithPrevious ? 'rounded-tl-md' : 'rounded-tl-[18px]'} ${groupedWithNext ? 'rounded-bl-md' : 'rounded-bl-[18px]'} rounded-r-[18px]`}`}>
                    <div className={`mb-1 flex items-center gap-2 text-[10px] font-semibold ${touch.direction === 'outbound' ? 'text-white/70' : 'text-slate-400'}`}>
                      {s.label}
                      {s.auto && <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${touch.direction === 'outbound' ? 'bg-white/15 text-white/90' : 'bg-slate-100 text-slate-500'}`}>Auto</span>}
                    </div>
                    {bubbleText && <div className="whitespace-pre-wrap break-words leading-relaxed">{bubbleText}</div>}
                    {touchMedia.length > 0 && (
                      <div className="mt-2 grid gap-2">
                        {touchMedia.map(url => (
                          isVideoUrl(url) ? (
                            <video key={url} src={mediaPlaybackUrl(url)} controls className="max-h-64 rounded-[12px] bg-black" />
                          ) : (
                            <a key={url} href={mediaPlaybackUrl(url)} target="_blank" rel="noreferrer">
                              <img src={mediaPlaybackUrl(url)} alt="" className="max-h-64 rounded-[12px] object-cover" />
                            </a>
                          )
                        ))}
                      </div>
                    )}
                    <div className={`mt-1 text-[10px] ${touch.direction === 'outbound' ? 'text-white/50' : 'text-slate-400'}`}>{fmtDate(touch.created_at)} {fmtTime(touch.created_at)}</div>
                  </div>
                </div>
              )
              })
            })()}
          </div>

          {/* Compose */}
          <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.75rem))] sm:px-5">
            {appointmentSuggestion && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[16px] border border-indigo-100 bg-indigo-50 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-indigo-900">{appointmentSuggestion.title} detected</div>
                  <div className="truncate text-xs font-medium text-indigo-700">
                    {new Date(appointmentSuggestion.scheduledAtLocal).toLocaleString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
                <button
                  onClick={() => void handleCreateAppointmentFromSuggestion()}
                  disabled={appointmentSaving}
                  className="min-h-9 shrink-0 rounded-full bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {appointmentSaving ? 'Saving...' : 'Save reminder'}
                </button>
              </div>
            )}
            {actionPanelOpen && (
              <div className="mb-2 rounded-[18px] border border-slate-200 bg-slate-50 p-2 xl:hidden">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <button
                    onClick={() => openSheetUpdate(selected)}
                    disabled={sheetUpdating}
                    className="min-h-11 rounded-full border border-[#1a2744] bg-[#1a2744] px-4 text-sm font-semibold text-white transition hover:bg-[#243560] disabled:opacity-50"
                  >
                    Update sheet
                  </button>
                  {INBOX_QUICK_ACTIONS.map(action => (
                    <button
                      key={action.key}
                      onClick={() => handleQuickAction(action.key)}
                      disabled={quickActionSaving !== null}
                      className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition disabled:opacity-50 ${quickActionClass(action.tone, quickActionSaving === action.key)}`}
                    >
                      {quickActionSaving === action.key ? 'Saving...' : action.label}
                    </button>
                  ))}
                  <button
                    onClick={handleDeleteContact}
                    disabled={deletingContact}
                    className="min-h-11 rounded-full border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                  >
                    {deletingContact ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            )}
            <div className="mb-2 flex items-center gap-2 overflow-x-auto">
              <button
                onClick={() => void handleAiReply()}
                disabled={aiReplyLoading}
                className="min-h-11 shrink-0 rounded-full bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50 lg:min-h-8 lg:text-xs"
              >
                {aiReplyLoading ? 'Drafting...' : 'Smart draft'}
              </button>
              <button onClick={() => setComposeChannel('sms')} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold transition lg:min-h-8 lg:text-xs ${composeChannel === 'sms' ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                SMS {!selected.phone && <span className="ml-1 text-red-400">no #</span>}
              </button>
              <button onClick={() => setComposeChannel('email')} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold transition lg:min-h-8 lg:text-xs ${composeChannel === 'email' ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                Email {!selected.email && <span className="ml-1 text-red-400">no email</span>}
              </button>
              {composeChannel === 'sms' && (
                <span
                  className={`flex min-h-11 shrink-0 items-center rounded-full border px-3 text-sm font-semibold lg:min-h-8 lg:text-xs ${
                    selectedUsingSalesLine
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  }`}
                  title={selectedUsingSalesLine
                    ? 'Temporary recovery lane: replies in this thread go from the sales number.'
                    : 'Replies in this thread go from the partnership number.'}
                >
                  From {selectedUsingSalesLine ? 'Sales line' : 'Partner line'} · {displayReplyNumber(selectedThreadFromNumber)}
                </span>
              )}
              <button
                onClick={insertPartnerLink}
                className="min-h-11 shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 lg:min-h-8 lg:text-xs"
                title="Add partner package link to the draft"
              >
                Add link
              </button>
              <button
                onClick={() => void copyPartnerLink()}
                className="min-h-11 shrink-0 rounded-full bg-slate-100 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-200 lg:min-h-8 lg:text-xs"
                title="Copy partner package link"
              >
                Copy link
              </button>
              <label className="flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white pl-3 pr-2 text-sm font-semibold text-slate-500 lg:min-h-8 lg:text-xs">
                Stage
                <select
                  value={selected.normalized_stage || 'target'}
                  onChange={e => void handleStageChange(e.target.value)}
                  disabled={stageSaving !== null}
                  className="max-w-[150px] bg-transparent text-sm font-semibold text-[#1a2744] outline-none disabled:opacity-50 lg:text-xs"
                >
                  <option value="target">Target</option>
                  <option value="connected">Connected</option>
                  <option value="qualified">Qualified</option>
                  <option value="partnership_active">Active partner</option>
                  <option value="follow_up_due">Follow-up</option>
                  <option value="dormant">Nurture</option>
                  <option value="closed_lost">Closed</option>
                </select>
              </label>
              <button
                onClick={() => setActionPanelOpen(open => !open)}
                className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold transition xl:hidden ${actionPanelOpen ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                Log
              </button>
              <button onClick={() => onSelectContact(selected)} className="min-h-11 shrink-0 rounded-full bg-slate-100 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200 xl:hidden">
                Details
              </button>
            </div>
            {mediaUrls.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto">
                {mediaUrls.map(url => (
                  <div key={url} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[12px] border border-slate-200 bg-slate-50">
                    {isVideoUrl(url) ? (
                      <div className="flex h-full items-center justify-center text-xs font-semibold text-slate-500">Video</div>
                    ) : isImageUrl(url) ? (
                      <img src={mediaPlaybackUrl(url)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <a href={mediaPlaybackUrl(url)} target="_blank" rel="noreferrer" className="flex h-full flex-col items-center justify-center px-1 text-center">
                        <span className="text-lg">📎</span>
                        <span className="mt-0.5 line-clamp-2 text-[9px] font-semibold leading-3 text-slate-500">{mediaFileName(url)}</span>
                      </a>
                    )}
                    <button onClick={() => setMediaUrls(current => current.filter(item => item !== url))} className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] text-white">x</button>
                  </div>
                ))}
              </div>
            )}
            {composeChannel === 'sms' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => setScheduleMode(current => !current)}
                    className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition lg:min-h-8 lg:text-xs ${scheduleMode ? 'border-[#1a2744] bg-[#1a2744] text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    {scheduleMode ? 'Scheduled' : 'Schedule'}
                  </button>
                  <button
                    onClick={() => {
                      setScheduleMode(true)
                      setScheduledAt(defaultScheduledReplyTime(aiSuggestion || selected.playbook))
                    }}
                    className="min-h-11 rounded-full border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 lg:min-h-8 lg:text-xs"
                  >
                    Human timing
                  </button>
                  {scheduleMode && (
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={e => setScheduledAt(e.target.value)}
                      className="min-h-11 min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-[#1a2744] outline-none focus:border-[#1a2744] lg:min-h-8 lg:text-xs"
                    />
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <input
                    ref={mediaInputRef}
                    type="file"
                    multiple
                    accept="image/*,video/*,.pdf,.doc,.docx,.txt"
                    onChange={e => void handleMediaFiles(e.target.files)}
                    className="hidden"
                  />
                  <button
                    onClick={() => mediaInputRef.current?.click()}
                    disabled={mediaUploading}
                    className="mb-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-xl text-slate-500 disabled:opacity-50 lg:h-11 lg:w-11"
                    title="Attach file"
                  >
                    {mediaUploading ? '…' : '+'}
                  </button>
                  <button
                    onClick={toggleVoiceDictation}
                    type="button"
                    className={`mb-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border text-lg font-semibold transition lg:h-11 lg:w-11 ${voiceListening ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                    title={voiceListening ? 'Stop voice typing' : 'Voice type'}
                  >
                    {voiceListening ? '■' : '🎙'}
                  </button>
                  <textarea value={smsBody} onChange={e => setSmsBody(e.target.value)} rows={3} placeholder={selected.phone ? 'Type SMS…' : 'No phone'} disabled={!selected.phone}
                    className="max-h-36 min-h-[88px] flex-1 resize-y rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-base leading-[1.5] text-[#1a2744] outline-none focus:border-[#1a2744] disabled:opacity-40 lg:text-sm" />
                  <button onClick={handleSend} disabled={sending || mediaUploading || !selected.phone || (!smsBody.trim() && mediaUrls.length === 0) || (scheduleMode && !scheduledAt)}
                    className="mb-0.5 min-h-12 rounded-full bg-[#1a2744] px-5 text-sm font-semibold text-white disabled:opacity-40 lg:min-h-11">{sending ? '…' : scheduleMode ? 'Schedule' : 'Send'}</button>
                </div>
                {(voiceListening || voiceError) && (
                  <div className={`pl-14 text-xs font-medium ${voiceError ? 'text-rose-600' : 'text-slate-500'}`}>
                    {voiceError || 'Listening... speak your reply, then tap stop.'}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Subject"
                  className="min-h-12 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-4 text-base leading-[1.5] text-[#1a2744] outline-none focus:border-[#1a2744] lg:min-h-10 lg:text-sm" />
                <div className="flex gap-2">
                  <button
                    onClick={toggleVoiceDictation}
                    type="button"
                    className={`mt-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full border text-lg font-semibold transition lg:h-11 lg:w-11 ${voiceListening ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                    title={voiceListening ? 'Stop voice typing' : 'Voice type'}
                  >
                    {voiceListening ? '■' : '🎙'}
                  </button>
                  <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={3} placeholder={selected.email ? 'Type email…' : 'No email'} disabled={!selected.email}
                    className="min-h-[88px] flex-1 resize-none rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-base leading-[1.5] text-[#1a2744] outline-none focus:border-[#1a2744] disabled:opacity-40 lg:text-sm" />
                  <button onClick={handleSend} disabled={sending || !selected.email || !emailBody.trim()}
                    className="min-h-12 self-end rounded-full bg-[#1a2744] px-5 text-sm font-semibold text-white disabled:opacity-40 lg:min-h-11">{sending ? '…' : 'Send'}</button>
                </div>
                {(voiceListening || voiceError) && (
                  <div className={`pl-14 text-xs font-medium ${voiceError ? 'text-rose-600' : 'text-slate-500'}`}>
                    {voiceError || 'Listening... speak your email, then tap stop.'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {partnerInfoCollapsed ? (
          <aside className="hidden w-14 shrink-0 flex-col items-center border-l border-slate-200 bg-white py-3 xl:flex">
            <button
              onClick={() => setPartnerInfoCollapsed(false)}
              title="Expand partner info"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg font-semibold text-[#1a2744] transition hover:bg-slate-50"
            >
              ‹
            </button>
            <div className="mt-4 flex h-9 w-9 items-center justify-center rounded-full bg-[#1a2744] text-sm font-bold text-white" title={selected.name}>
              {selected.name.charAt(0)}
            </div>
            <div className="mt-4 h-px w-8 bg-slate-100" />
            <button
              onClick={() => onSelectContact(selected)}
              title="Open full contact details"
              className="mt-4 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              i
            </button>
          </aside>
        ) : (
        <aside className="hidden w-[300px] shrink-0 flex-col border-l border-slate-200 bg-white xl:flex">
          <div className="border-b border-slate-100 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1a2744] text-base font-bold text-white">{selected.name.charAt(0)}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-[#1a2744]">{selected.name}</div>
                <div className="truncate text-xs text-slate-400">{selected.company || selected.industry || 'Partner contact'}</div>
              </div>
              <button
                onClick={() => setPartnerInfoCollapsed(true)}
                title="Collapse partner info"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-base font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-[#1a2744]"
              >
                ›
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <StageBadge stage={selected.normalized_stage} />
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600">{sourceBadge(selected)}</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleCall} disabled={!selected.phone} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#1a2744] disabled:opacity-40">Call</button>
              <button onClick={() => setComposeChannel('sms')} disabled={!selected.phone} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#1a2744] disabled:opacity-40">Text</button>
              <button onClick={() => setComposeChannel('email')} disabled={!selected.email} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#1a2744] disabled:opacity-40">Email</button>
              <button onClick={() => onSelectContact(selected)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#1a2744]">Details</button>
            </div>
            <button
              onClick={() => openSheetUpdate(selected)}
              disabled={sheetUpdating}
              className="mt-2 w-full rounded-xl bg-[#1a2744] px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Update sheet
            </button>
            <button
              onClick={handleDeleteContact}
              disabled={deletingContact}
              className="mt-2 w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
            >
              {deletingContact ? 'Deleting contact...' : 'Delete contact'}
            </button>

            <div className="mt-5 space-y-3">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Stage</div>
                  {stageSaving && <span className="text-[10px] font-semibold text-slate-400">Saving...</span>}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {REPLY_DESK_STAGE_ACTIONS.map(stage => (
                    <button
                      key={stage.key}
                      onClick={() => void handleStageChange(stage.key)}
                      disabled={stageSaving !== null}
                      className={`min-h-11 rounded-xl border px-2 py-2 text-left transition disabled:opacity-50 ${selected.normalized_stage === stage.key ? quickActionClass(stage.tone, true) : quickActionClass(stage.tone, stageSaving === stage.key)}`}
                    >
                      <span className="block text-[11px] font-semibold leading-4">{stage.label}</span>
                      <span className={`mt-0.5 block text-[10px] font-medium leading-4 ${selected.normalized_stage === stage.key || stageSaving === stage.key ? 'text-white/75' : 'text-slate-400'}`}>{stage.helper}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Partner links</div>
                <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                  <div className="break-all text-xs font-semibold leading-5 text-emerald-900">{partnerPackageUrl(selected)}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => void copyPartnerLink()}
                      className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50"
                    >
                      Copy
                    </button>
                    <button
                      onClick={insertPartnerLink}
                      className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800"
                    >
                      Add to draft
                    </button>
                  </div>
                  <a href={partnerPackageUrl(selected)} target="_blank" rel="noreferrer" className="mt-2 block text-xs font-semibold text-emerald-800 underline">
                    Open package
                  </a>
                </div>
                <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase text-slate-400">Client quote link</div>
                  <div className="mt-0.5 break-all text-xs font-medium text-slate-600">{partnerQuoteUrl(selected)}</div>
                </div>
              </div>

              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Partner details</div>
              {[
                ['Name', selected.name],
                ['Phone', selected.phone || '—'],
                ['Email', selected.email || '—'],
                ['City', selected.city || '—'],
                ['Company', selected.company || '—'],
                ['Service type', selected.industry || 'Realtor'],
                ['Lead stage', PARTNERSHIP_STAGE_META[selected.normalized_stage as keyof typeof PARTNERSHIP_STAGE_META]?.label || selected.normalized_stage || '—'],
                ['Assigned rep', 'Hunter'],
                ['Next follow-up', selected.next_follow_up ? fmtDate(selected.next_follow_up) : '—'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase text-slate-400">{label}</div>
                  <div className="mt-0.5 break-words text-sm font-medium text-[#1a2744]">{value}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Log action</div>
              <div className="grid grid-cols-2 gap-2">
                {INBOX_QUICK_ACTIONS.map(action => (
                  <button
                    key={action.key}
                    onClick={() => handleQuickAction(action.key)}
                    disabled={quickActionSaving !== null}
                    className={`min-h-9 rounded-xl border px-2 text-[11px] font-semibold transition disabled:opacity-50 ${quickActionClass(action.tone, quickActionSaving === action.key)}`}
                  >
                    {quickActionSaving === action.key ? 'Saving...' : action.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 rounded-xl bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Notes</div>
              <div className="mt-2 text-sm leading-5 text-slate-600">
                {selected.latest_inbound_note ? truncateText(selected.latest_inbound_note, 180) : 'No partner notes yet.'}
              </div>
            </div>
          </div>
        </aside>
        )}
        </>
      )}
    </div>
  )
}

// ─── Tab: Active Partners ─────────────────────────────────────────────────────

function PartnersTab({ contacts, onSelect }: { contacts: Contact[]; onSelect: (c: Contact) => void }) {
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'active' | 'warm' | 'field_visit' | 'all'>('active')
  const partners = contacts.filter(c => c.decision === 'agreed' || c.normalized_stage === 'partnership_active')
  const warmPartners = contacts.filter(c => ['promising', 'postcard', 'follow_up', 'active'].includes(getInboxStatus(c)))
  const fieldVisit = contacts.filter(c => getInboxStatus(c) === 'postcard')
  const visible = (view === 'active' ? partners : view === 'warm' ? warmPartners : view === 'field_visit' ? fieldVisit : contacts)
    .filter(c => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return [c.name, c.company, c.city, c.industry, c.phone, c.email, c.normalized_stage, c.decision]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
    .sort((a, b) => {
      const statusRank = inboxUrgencyRank(a) - inboxUrgencyRank(b)
      if (statusRank !== 0) return statusRank
      return (b.last_touch_at || b.latest_inbound_at || '').localeCompare(a.last_touch_at || a.latest_inbound_at || '')
    })

  if (partners.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white p-16 text-center">
        <div className="text-4xl">🤝</div>
        <div className="mt-4 text-base font-semibold text-[#1a2744]">No active partners yet</div>
        <div className="mt-2 text-sm text-slate-500">Once a relationship becomes referral-ready, it appears here.</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#1a2744]">Partner Directory</h2>
          <p className="text-sm text-slate-500">{partners.length} active · {warmPartners.length} warm · {fieldVisit.length} meeting or visit work</p>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search partners..."
          className="crm-input h-10 w-full text-sm sm:w-64"
        />
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {[
          { key: 'active', label: 'Active', count: partners.length },
          { key: 'warm', label: 'Warm', count: warmPartners.length },
          { key: 'field_visit', label: 'Field work', count: fieldVisit.length },
          { key: 'all', label: 'All contacts', count: contacts.length },
        ].map(item => (
          <button
            key={item.key}
            onClick={() => setView(item.key as typeof view)}
            className={`min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold transition ${view === item.key ? 'bg-[#1a2744] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {item.label} <span className="ml-1 opacity-70">{item.count}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(c => {
          const daysSince = c.last_touch_at ? Math.floor((Date.now() - new Date(c.last_touch_at).getTime()) / 86400000) : null
          const warm = daysSince !== null && daysSince <= 30
          const status = getInboxStatus(c)
          const nextAction = getNextPartnerAction(c)
          const referralCode = getPartnerReferralCode(c)
          return (
            <button key={c.id} onClick={() => onSelect(c)}
              className={`rounded-[22px] border bg-white p-5 text-left hover:shadow-md transition ${!warm ? 'border-amber-300' : 'border-slate-200'}`}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">{c.name.charAt(0)}</div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-[#1a2744] truncate">{c.name}</span>
                    <TierBadge tier={c.outreach_tier} />
                  </div>
                  <div className="text-xs text-slate-500 truncate">{c.company ?? c.industry ?? ''}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${inboxStatusClass(status)}`}>{inboxStatusLabel(status)}</span>
                <StageBadge stage={c.normalized_stage} />
                {c.city && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{c.city}</span>}
              </div>
              {c.affiliate_partner_id && (
                <div className="mt-2 flex items-center gap-1.5 rounded-[8px] border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
                  <span className="text-[10px] font-semibold text-emerald-700">🔗 Has affiliate portal</span>
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-[10px] bg-slate-50 p-2">
                  <div className="text-[9px] font-semibold uppercase text-slate-400">Next Action</div>
                  <div className={`mt-0.5 truncate font-medium ${nextAction?.overdue ? 'text-amber-600' : 'text-[#1a2744]'}`}>{nextAction ? `${nextAction.label} · ${fmtDate(nextAction.due)}` : '—'}</div>
                </div>
                <div className="rounded-[10px] bg-slate-50 p-2">
                  <div className="text-[9px] font-semibold uppercase text-slate-400">Referral Code</div>
                  <div className="mt-0.5 truncate font-medium text-emerald-700">{referralCode || '—'}</div>
                </div>
                <div className="rounded-[10px] bg-slate-50 p-2">
                  <div className="text-[9px] font-semibold uppercase text-slate-400">Referrals</div>
                  <div className="mt-0.5 font-medium text-[#1a2744]">{c.referred_lead_count ?? 0}</div>
                </div>
                {c.phone && <div className="rounded-[10px] bg-slate-50 p-2"><div className="text-[9px] font-semibold uppercase text-slate-400">Phone</div><div className="mt-0.5 font-medium text-[#1a2744]">{c.phone}</div></div>}
                {c.email && <div className="rounded-[10px] bg-slate-50 p-2 col-span-2 truncate"><div className="text-[9px] font-semibold uppercase text-slate-400">Email</div><div className="mt-0.5 font-medium text-[#1a2744] truncate">{c.email}</div></div>}
                <div className="rounded-[10px] bg-slate-50 p-2">
                  <div className="text-[9px] font-semibold uppercase text-slate-400">Last Touch</div>
                  <div className={`mt-0.5 font-medium ${!warm ? 'text-amber-600' : 'text-[#1a2744]'}`}>{daysSince !== null ? `${daysSince}d ago` : '—'}{!warm && ' ⚠️'}</div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
      {visible.length === 0 && (
        <div className="rounded-[16px] border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          No partners match this view.
        </div>
      )}
    </div>
  )
}

// ─── Bulk SMS Modal ───────────────────────────────────────────────────────────

function BulkSmsModal({ contacts, onClose }: { contacts: Contact[]; onClose: () => void }) {
  const [template, setTemplate] = useState([
    'Hey {{firstName}}, my name is John. I own Saturn Star Movers, a local moving company serving {{city}}.',
    '',
    'I know your clients probably ask for moving referrals from time to time, so I wanted to personally introduce myself instead of just sending a random email.',
    '',
    'We are licensed and insured, and I would love to be a reliable local option if any of your buyers or sellers ever need help after closing.',
    '',
    'Would it be okay if I stopped by your office next week to drop off a few cards?',
  ].join('\n'))
  const [fromNumber, setFromNumber] = useState('+12268870667')
  const [preview, setPreview] = useState<Array<{ name: string; phone: string; message: string }> | null>(null)
  const [invalidPhoneSamples, setInvalidPhoneSamples] = useState<Array<{ name: string; phone: string; issue: string }>>([])
  const [skippedPriorSmsSamples, setSkippedPriorSmsSamples] = useState<Array<{ name: string; phone: string; last_touch_at: string | null }>>([])
  const [previewStats, setPreviewStats] = useState<{ will_send: number; skipped_prior_sms: number; no_phone: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; no_phone: number; skipped_prior_sms?: number } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(contacts.map(c => c.id)))

  const withPhone = contacts.filter(c => c.phone)
  const selected = contacts.filter(c => selectedIds.has(c.id))

  async function loadPreview() {
    setLoading(true)
    const res = await fetch('/api/marketing/contacts/bulk-sms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_ids: Array.from(selectedIds), template, from_number: fromNumber, preview_only: true }),
    })
    const data = await res.json() as {
      preview?: Array<{ name: string; phone: string; message: string }>
      will_send?: number
      no_phone?: number
      skipped_prior_sms?: number
      skipped_prior_sms_samples?: Array<{ name: string; phone: string; last_touch_at: string | null }>
      invalid_phone_samples?: Array<{ name: string; phone: string; issue: string }>
    }
    setPreview(data.preview || [])
    setInvalidPhoneSamples(data.invalid_phone_samples || [])
    setSkippedPriorSmsSamples(data.skipped_prior_sms_samples || [])
    setPreviewStats({
      will_send: data.will_send ?? 0,
      skipped_prior_sms: data.skipped_prior_sms ?? 0,
      no_phone: data.no_phone ?? 0,
    })
    setLoading(false)
  }

  async function send() {
    const sendCount = previewStats?.will_send ?? selected.filter(c => c.phone).length
    if (!confirm(`Send SMS to ${sendCount} contacts? Already-texted contacts will be skipped.`)) return
    setSending(true)
    const res = await fetch('/api/marketing/contacts/bulk-sms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_ids: Array.from(selectedIds), template, from_number: fromNumber }),
    })
    const data = await res.json() as { sent: number; failed: number; no_phone: number }
    setResult(data)
    setSending(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-[16px] bg-white shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-[var(--app-line)] px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-[var(--app-ink)]">Bulk SMS</div>
            <div className="text-[11px] text-[var(--app-muted)] mt-0.5">{selected.filter(c => c.phone).length} contacts with phone · from {fromNumber}</div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[var(--app-muted)] hover:bg-[var(--app-bg)]">✕</button>
        </div>

        {result ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="text-4xl">✅</div>
            <div className="text-lg font-semibold text-[var(--app-ink)]">{result.sent} messages sent</div>
            <div className="text-sm text-[var(--app-muted)]">
              {result.failed > 0 && `${result.failed} failed · `}
              {result.skipped_prior_sms ? `${result.skipped_prior_sms} already texted skipped · ` : ''}
              {result.no_phone > 0 && `${result.no_phone} had no phone`}
            </div>
            <div className="max-w-sm text-xs leading-5 text-[var(--app-muted)]">
              This send is logged. Do not run this same recipient list again; use a new filtered batch or contacts with no prior outbound SMS.
            </div>
            <button onClick={onClose} className="crm-button-dark px-6">Done</button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Template */}
            <div>
              <label className="crm-label">Message template</label>
              <textarea value={template} onChange={e => { setTemplate(e.target.value); setPreview(null); setPreviewStats(null); setInvalidPhoneSamples([]); setSkippedPriorSmsSamples([]) }} rows={9}
                className="crm-input mt-1 resize-none text-sm" />
              <div className="mt-1 text-[11px] text-[var(--app-muted)]">
                Preview first. Contacts already texted from this system are skipped automatically so this cannot casually resend the same outreach.
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {['{{firstName}}', '{{name}}', '{{company}}', '{{brokerage}}', '{{city}}', '{{zone}}', '{{industry}}'].map(tag => (
                  <button key={tag} onClick={() => setTemplate(t => t + tag)}
                    className="rounded-full border border-[var(--app-line)] px-2 py-0.5 text-[10px] font-mono text-[var(--app-muted)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)]">
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* From number */}
            <div>
              <label className="crm-label">Send from</label>
              <select value={fromNumber} onChange={e => setFromNumber(e.target.value)} className="crm-input mt-1 text-sm">
                <option value="+12268870667">+1 (226) 887-0667 — Windsor Partnership</option>
                <option value="+12266055008">+1 (226) 605-5008 — Partnership 2</option>
              </select>
              <div className="mt-1 text-[11px] text-[var(--app-muted)]">Sales and operations numbers are intentionally hidden here.</div>
            </div>

            {/* Preview */}
            {preview && (
              <div>
                <div className="crm-label mb-2">Preview</div>
                {previewStats && (
                  <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 p-2">
                      <div className="text-lg font-semibold text-emerald-800">{previewStats.will_send}</div>
                      <div className="text-[10px] font-semibold uppercase text-emerald-700">Will send</div>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-2">
                      <div className="text-lg font-semibold text-slate-700">{previewStats.skipped_prior_sms}</div>
                      <div className="text-[10px] font-semibold uppercase text-slate-500">Already texted</div>
                    </div>
                    <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-2">
                      <div className="text-lg font-semibold text-amber-800">{previewStats.no_phone}</div>
                      <div className="text-[10px] font-semibold uppercase text-amber-700">No phone</div>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {preview.map((p, i) => (
                    <div key={i} className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3">
                      <div className="text-[10px] font-semibold text-[var(--app-muted)]">{p.name} · {p.phone}</div>
                      <div className="mt-1 text-sm text-[var(--app-ink)] whitespace-pre-wrap">{p.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {skippedPriorSmsSamples.length > 0 && (
              <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-700">Skipped because they already have an outbound SMS</div>
                <div className="mt-2 space-y-1">
                  {skippedPriorSmsSamples.map((sample, index) => (
                    <div key={`${sample.phone}-${index}`} className="text-[11px] text-slate-600">
                      {sample.name}: {sample.phone}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {invalidPhoneSamples.length > 0 && (
              <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-3">
                <div className="text-xs font-semibold text-amber-800">Skipped invalid numbers before sending</div>
                <div className="mt-2 space-y-1">
                  {invalidPhoneSamples.map((sample, index) => (
                    <div key={`${sample.phone}-${index}`} className="text-[11px] text-amber-700">
                      {sample.name}: {sample.phone} — {sample.issue}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Segment selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="crm-label">Recipients ({selected.filter(c => c.phone).length} with phone)</label>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedIds(new Set(withPhone.map(c => c.id)))} className="text-[10px] text-[var(--app-accent)] hover:underline">All with phone</button>
                  <button onClick={() => setSelectedIds(new Set())} className="text-[10px] text-[var(--app-muted)] hover:underline">None</button>
                </div>
              </div>
              <div className="max-h-32 overflow-y-auto rounded-[8px] border border-[var(--app-line)] divide-y divide-[var(--app-line)]">
                {withPhone.slice(0, 20).map(c => (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--app-bg)]">
                    <input type="checkbox" checked={selectedIds.has(c.id)}
                      onChange={e => { const next = new Set(selectedIds); e.target.checked ? next.add(c.id) : next.delete(c.id); setSelectedIds(next) }}
                      className="rounded" />
                    <span className="text-sm text-[var(--app-ink)] truncate">{c.name}</span>
                    <span className="text-[10px] text-[var(--app-muted)] ml-auto">{c.company || c.city || ''}</span>
                  </label>
                ))}
                {withPhone.length > 20 && <div className="px-3 py-1.5 text-[10px] text-[var(--app-muted)]">+ {withPhone.length - 20} more</div>}
              </div>
            </div>
          </div>
        )}

        {!result && (
          <div className="border-t border-[var(--app-line)] p-4 flex gap-2">
            <button onClick={onClose} className="crm-button flex-1">Cancel</button>
            {!preview ? (
              <button onClick={loadPreview} disabled={loading || !template.trim() || selectedIds.size === 0} className="crm-button-dark flex-1 disabled:opacity-50">
                {loading ? 'Previewing…' : 'Preview Merged Texts'}
              </button>
            ) : (
              <button onClick={send} disabled={sending} className="crm-button-dark flex-1 disabled:opacity-50">
                {sending ? 'Sending…' : `Approve & Send to ${previewStats?.will_send ?? selected.filter(c => c.phone).length}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Scheduled Partnership SMS Modal ─────────────────────────────────────────

const PARTNERSHIP_SMS_TEMPLATE = [
  'Hey {{firstName}}, my name is John. I run a local moving company serving the {{city}} area....It\'s called SSM | Saturn Star Movers.',
  '',
  'I know your clients probably ask for moving referrals from time to time, so I wanted to personally introduce myself instead of just sending a random email.',
  '',
  'We are licensed and insured, and I would love to be a reliable local option if any of your buyers or sellers ever need help after closing.',
  '',
  'Would it be okay if I stopped by your office next week to drop off a few cards?',
].join('\n')

function mapCsvRealtor(row: Record<string, string>) {
  return {
    name: row.name || '',
    company: row.brokerage || row.company || '',
    title: row.position || row.title || 'Realtor',
    email: row.email || '',
    phone: row.phone || '',
    phone2: row.phone2 || '',
    phone3: row.phone3 || '',
    address: row.brokerage_address || row.address || '',
    city: row.city_scraped || row.city || row.zone || '',
    zone: row.zone || row.city_scraped || row.city || '',
    industry: 'real estate',
    website: row.website || '',
    category: 'realtor',
    external_id: row.individual_id || '',
    profile_url: row.profile_url || '',
    photo_url: row.photo_url || '',
    notes: [
      row.facebook ? `Facebook: ${row.facebook}` : '',
      row.instagram ? `Instagram: ${row.instagram}` : '',
      row.linkedin ? `LinkedIn: ${row.linkedin}` : '',
    ].filter(Boolean).join('\n'),
  }
}

function labelFromZone(zone: string) {
  return zone
    .replace(/^zone\d+_/, '')
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function ScheduledSmsCampaignModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [segmentMode, setSegmentMode] = useState<'zone' | 'city'>('zone')
  const [segment, setSegment] = useState('zone1_windsor_essex')
  const [name, setName] = useState('Windsor Essex Realtor Partnership SMS')
  const [template, setTemplate] = useState(PARTNERSHIP_SMS_TEMPLATE)
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [dailyCap, setDailyCap] = useState(400)
  const [startHour, setStartHour] = useState(10)
  const [endHour, setEndHour] = useState(13)
  const [preview, setPreview] = useState<PartnershipSmsPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [result, setResult] = useState<{ campaign_id?: string; scheduled?: number; days_to_finish?: number } | null>(null)
  const [error, setError] = useState('')

  const availableZones = Array.from(new Set(rows.map(row => row.zone).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  const availableCities = Array.from(new Set(rows.map(row => row.city_scraped || row.city).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  const selectedRows = rows.filter(row => {
    if (!segment) return true
    const value = segmentMode === 'zone' ? row.zone : (row.city_scraped || row.city)
    return (value || '').toLowerCase() === segment.toLowerCase()
  })
  const contacts = selectedRows.map(mapCsvRealtor)
  const selectedCities = Array.from(new Set(selectedRows.map(row => row.city_scraped || row.city).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  const segmentLabel = segmentMode === 'zone' ? labelFromZone(segment) : segment

  async function handleFile(file: File | null) {
    if (!file) return
    const text = await file.text()
    const parsed = parseCSV(text)
    setRows(parsed)
    setFileName(file.name)
    const firstZone = parsed.find(row => row.zone)?.zone
    const nextSegment = firstZone || parsed.find(row => row.city_scraped || row.city)?.city_scraped || parsed.find(row => row.city)?.city || segment
    const nextMode = firstZone ? 'zone' : 'city'
    setSegmentMode(nextMode)
    setSegment(nextSegment)
    setName(`${nextMode === 'zone' ? labelFromZone(nextSegment) : nextSegment} Realtor Partnership SMS`)
    setPreview(null)
    setResult(null)
    setError('')
  }

  async function submit(dryRun: boolean) {
    if (!contacts.length) {
      setError('Upload a CSV and choose a city first.')
      return
    }
    setError('')
    dryRun ? setLoading(true) : setScheduling(true)
    const res = await fetch('/api/marketing/sms/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name,
        city: segmentMode === 'city' ? segment : undefined,
        zone: segmentMode === 'zone' ? segment : undefined,
        contacts,
        template,
        sender_numbers: ['+12268870667', '+12266055008'],
        daily_cap: dailyCap,
        start_date: startDate,
        start_hour: startHour,
        end_hour: endHour,
        timezone: 'America/Toronto',
        dry_run: dryRun,
      }),
    })
    const data = await res.json().catch(() => ({})) as PartnershipSmsPreview & { campaign_id?: string; scheduled?: number; days_to_finish?: number }
    if (!res.ok) {
      setError(data.error || 'Campaign request failed.')
    } else if (dryRun) {
      setPreview(data)
    } else {
      setResult({ campaign_id: data.campaign_id, scheduled: data.scheduled, days_to_finish: data.days_to_finish })
      onDone()
    }
    setLoading(false)
    setScheduling(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[96vh] w-full max-w-5xl flex-col rounded-t-[18px] bg-white shadow-2xl sm:rounded-[18px]">
        <div className="flex items-center justify-between border-b border-[var(--app-line)] px-4 py-3 sm:px-5">
          <div>
            <div className="text-sm font-semibold text-[var(--app-ink)]">Schedule partnership SMS</div>
            <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">Preview first. Nothing sends until you approve scheduling.</div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[var(--app-muted)] hover:bg-[var(--app-bg)]">x</button>
        </div>

        {result ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="text-3xl">Scheduled</div>
            <div className="text-base font-semibold text-[var(--app-ink)]">{result.scheduled ?? 0} SMS jobs created</div>
            <div className="text-sm text-[var(--app-muted)]">Estimated {result.days_to_finish ?? 0} business day{result.days_to_finish === 1 ? '' : 's'} at {dailyCap}/day.</div>
            <button onClick={onClose} className="crm-button-dark px-6">Done</button>
          </div>
        ) : (
          <>
            <div className="grid flex-1 gap-0 overflow-y-auto md:grid-cols-[360px_1fr]">
              <div className="space-y-4 border-b border-[var(--app-line)] p-4 md:border-b-0 md:border-r sm:p-5">
                <div>
                  <label className="crm-label">CSV file</label>
                  <input type="file" accept=".csv,text/csv" onChange={e => { void handleFile(e.target.files?.[0] || null) }}
                    className="mt-1 block w-full text-sm text-[var(--app-muted)] file:mr-3 file:rounded-[10px] file:border-0 file:bg-[var(--app-ink)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white" />
                  <div className="mt-1 text-[11px] text-[var(--app-muted)]">{fileName || 'Upload the realtor CSV.'}</div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="crm-label">Group by</label>
                    <select value={segmentMode} onChange={e => {
                      const nextMode = e.target.value as 'zone' | 'city'
                      const nextSegment = nextMode === 'zone' ? (availableZones[0] || segment) : (availableCities[0] || segment)
                      setSegmentMode(nextMode)
                      setSegment(nextSegment)
                      setName(`${nextMode === 'zone' ? labelFromZone(nextSegment) : nextSegment} Realtor Partnership SMS`)
                      setPreview(null)
                    }} className="crm-input mt-1 text-sm">
                      <option value="zone">Area / zone</option>
                      <option value="city">Exact city</option>
                    </select>
                  </div>
                  <div>
                    <label className="crm-label">{segmentMode === 'zone' ? 'Area' : 'City'}</label>
                    <select value={segment} onChange={e => {
                      const next = e.target.value
                      setSegment(next)
                      setName(`${segmentMode === 'zone' ? labelFromZone(next) : next} Realtor Partnership SMS`)
                      setPreview(null)
                    }} className="crm-input mt-1 text-sm">
                      {segmentMode === 'zone' ? (
                        <>
                          {availableZones.length === 0 && <option value={segment}>{labelFromZone(segment)}</option>}
                          {availableZones.map(z => <option key={z} value={z}>{labelFromZone(z)} ({z})</option>)}
                        </>
                      ) : (
                        <>
                          {availableCities.length === 0 && <option value={segment}>{segment}</option>}
                          {availableCities.map(c => <option key={c} value={c}>{c}</option>)}
                        </>
                      )}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="crm-label">Daily cap</label>
                  <input type="number" min={1} max={500} value={dailyCap} onChange={e => { setDailyCap(Number(e.target.value)); setPreview(null) }} className="crm-input mt-1 text-sm" />
                </div>

                <div>
                  <label className="crm-label">Campaign name</label>
                  <input value={name} onChange={e => setName(e.target.value)} className="crm-input mt-1 text-sm" />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="crm-label">Start date</label>
                    <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPreview(null) }} className="crm-input mt-1 text-sm" />
                  </div>
                  <div>
                    <label className="crm-label">From</label>
                    <input type="number" min={7} max={20} value={startHour} onChange={e => { setStartHour(Number(e.target.value)); setPreview(null) }} className="crm-input mt-1 text-sm" />
                  </div>
                  <div>
                    <label className="crm-label">To</label>
                    <input type="number" min={8} max={21} value={endHour} onChange={e => { setEndHour(Number(e.target.value)); setPreview(null) }} className="crm-input mt-1 text-sm" />
                  </div>
                </div>

                <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3 text-xs leading-5 text-[var(--app-muted)]">
                  Uses both partnership numbers, primary phone only, exact-name/phone duplicate checks, and Toronto/Windsor working hours.
                </div>

                {selectedCities.length > 0 && (
                  <div className="rounded-[10px] border border-[var(--app-line)] bg-white p-3">
                    <div className="text-xs font-semibold text-[var(--app-ink)]">{segmentLabel || 'Selected segment'} includes {selectedCities.length} cit{selectedCities.length === 1 ? 'y' : 'ies'}</div>
                    <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                      {selectedCities.slice(0, 24).map(c => (
                        <span key={c} className="rounded-full border border-[var(--app-line)] bg-[var(--app-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--app-muted)]">{c}</span>
                      ))}
                      {selectedCities.length > 24 && <span className="px-1 py-0.5 text-[10px] text-[var(--app-muted)]">+{selectedCities.length - 24}</span>}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                <div>
                  <label className="crm-label">Message</label>
                  <textarea value={template} onChange={e => { setTemplate(e.target.value); setPreview(null) }} rows={9}
                    className="crm-input mt-1 resize-none text-sm leading-5" />
                  <div className="mt-1 text-[11px] text-[var(--app-muted)]">City comes from each CSV row, even when scheduling a whole area. Tecumseh rows say Tecumseh; Windsor rows say Windsor.</div>
                </div>

                {error && <div className="rounded-[10px] border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

                {preview && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 p-3 text-center">
                        <div className="text-xl font-semibold text-emerald-800">{preview.would_schedule}</div>
                        <div className="text-[10px] font-bold uppercase text-emerald-700">Will schedule</div>
                      </div>
                      <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-3 text-center">
                        <div className="text-xl font-semibold text-slate-800">{preview.existing_skipped_no_repeat}</div>
                        <div className="text-[10px] font-bold uppercase text-slate-500">Existing skipped</div>
                      </div>
                      <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-3 text-center">
                        <div className="text-xl font-semibold text-amber-800">{preview.no_primary_phone + preview.invalid_phone}</div>
                        <div className="text-[10px] font-bold uppercase text-amber-700">No usable primary</div>
                      </div>
                      <div className="rounded-[10px] border border-sky-200 bg-sky-50 p-3 text-center">
                        <div className="text-xl font-semibold text-sky-800">{preview.days_to_finish}</div>
                        <div className="text-[10px] font-bold uppercase text-sky-700">Business days</div>
                      </div>
                    </div>

                    <div className="rounded-[10px] border border-[var(--app-line)] bg-white p-3">
                      <div className="text-xs font-semibold text-[var(--app-ink)]">Dry-run details</div>
                      <div className="mt-2 grid gap-1 text-xs text-[var(--app-muted)] sm:grid-cols-2">
                        <div>Total selected rows: {preview.total_input}</div>
                        <div>Primary phones: {preview.usable_with_phone}</div>
                        <div>Phone matches: {preview.existing_phone_matches}</div>
                        <div>Exact name matches: {preview.existing_exact_name_matches}</div>
                        <div>Duplicate primary phones in file: {preview.duplicate_in_file}</div>
                        <div>Window: {preview.start_hour}:00-{preview.end_hour}:00 {preview.timezone}</div>
                      </div>
                    </div>

                    <div>
                      <div className="crm-label mb-2">Sample scheduled messages</div>
                      <div className="space-y-2">
                        {(preview.preview || []).map((item, index) => (
                          <div key={`${item.phone}-${index}`} className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3">
                            <div className="flex flex-wrap justify-between gap-2 text-[11px] font-semibold text-[var(--app-muted)]">
                              <span>{item.name} · {item.city || segmentLabel} · {item.phone}</span>
                              <span>{item.from_number} · {fmtDateTime(item.scheduled_at)}</span>
                            </div>
                            <div className="mt-2 whitespace-pre-wrap text-sm leading-5 text-[var(--app-ink)]">{item.message}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 border-t border-[var(--app-line)] p-4">
              <button onClick={onClose} className="crm-button flex-1">Cancel</button>
              <button onClick={() => void submit(true)} disabled={loading || contacts.length === 0 || !template.trim()} className="crm-button flex-1 disabled:opacity-50">
                {loading ? 'Previewing...' : `Preview ${contacts.length || ''}`}
              </button>
              <button onClick={() => { if (preview && confirm(`Schedule ${preview.would_schedule} SMS jobs?`)) void submit(false) }} disabled={scheduling || !preview || preview.would_schedule === 0}
                className="crm-button-dark flex-1 disabled:opacity-50">
                {scheduling ? 'Scheduling...' : 'Approve schedule'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Queue Tab — mirrors sales Follow-Up Wall ─────────────────────────────────

function urgencyBar(contact: Contact): string {
  const daysSince = contact.last_touch_at
    ? Math.floor((Date.now() - new Date(contact.last_touch_at).getTime()) / 86400000)
    : 999
  if (contact.sequence_paused && !contact.decision) return 'bg-[var(--app-accent)]'   // responded — act now
  if (daysSince >= 7) return 'bg-[#c9754e]'                                             // overdue
  if (daysSince >= 3) return 'bg-[#d0a24d]'                                             // due soon
  return 'bg-[var(--app-line)]'                                                          // fresh
}

function urgencyCardBorder(contact: Contact): string {
  const daysSince = contact.last_touch_at
    ? Math.floor((Date.now() - new Date(contact.last_touch_at).getTime()) / 86400000)
    : 999
  if (contact.sequence_paused && !contact.decision) return 'border-[rgba(15,106,83,0.25)] bg-[linear-gradient(180deg,#ffffff_0%,#f7fbf9_100%)]'
  if (daysSince >= 7) return 'border-[#e6d1ca] bg-[linear-gradient(180deg,#ffffff_0%,#fff8f6_100%)]'
  if (daysSince >= 3) return 'border-[#eadfcb] bg-[linear-gradient(180deg,#ffffff_0%,#fffcf6_100%)]'
  return 'border-[var(--app-line)] bg-white'
}

function QueueContactCard({ contact, onSelect, onCall, batchLabel }: {
  contact: Contact
  onSelect: (c: Contact) => void
  onCall: (c: Contact) => void
  batchLabel?: string
}) {
  const daysSince = contact.last_touch_at
    ? Math.floor((Date.now() - new Date(contact.last_touch_at).getTime()) / 86400000)
    : null

  return (
    <div className={`rounded-[14px] border p-4 shadow-sm transition hover:shadow-md ${urgencyCardBorder(contact)}`}>
      <div className={`mb-3 h-1 rounded-full ${urgencyBar(contact)}`} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => onSelect(contact)} className="text-sm font-semibold text-[var(--app-ink)] hover:text-[var(--app-accent)] transition truncate max-w-[160px]">
              {contact.name}
            </button>
            {batchLabel && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                {batchLabel}
              </span>
            )}
            {contact.category && <CategoryBadge categoryId={contact.category} />}
            {!contact.category && contact.outreach_tier && (
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${contact.outreach_tier === 1 ? 'border border-amber-200 bg-amber-50 text-amber-700' : contact.outreach_tier === 2 ? 'border border-sky-200 bg-sky-50 text-sky-700' : 'border border-[var(--app-line)] bg-[var(--app-wash)] text-[var(--app-muted)]'}`}>
                T{contact.outreach_tier}
              </span>
            )}
            {contact.instantly_status && (
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${contact.instantly_status === 'replied' ? 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]' : contact.instantly_status === 'opened' ? 'border border-sky-200 bg-sky-50 text-sky-700' : 'border border-[var(--app-line)] bg-[var(--app-wash)] text-[var(--app-muted)]'}`}>
                ✉ {contact.instantly_status}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-[11px] text-[var(--app-muted)]">
            {contact.company && <span>{contact.company}</span>}
            {contact.city && <span>· {contact.city}</span>}
            {contact.industry && <span>· {contact.industry}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          {daysSince !== null && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${daysSince === 0 ? 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]' : daysSince <= 3 ? 'border border-amber-200 bg-amber-50 text-amber-700' : 'border border-[var(--app-line)] bg-[var(--app-wash)] text-[var(--app-muted)]'}`}>
              {daysSince === 0 ? 'Today' : `${daysSince}d ago`}
            </span>
          )}
        </div>
      </div>

      {contact.latest_touch_note && (
        <div className="mt-2 rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-[11px] text-[var(--app-muted)] line-clamp-2">
          {contact.latest_touch_note.slice(0, 120)}
        </div>
      )}

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {contact.phone && (
          <button onClick={() => onCall(contact)}
            className="flex-1 rounded-[8px] border border-[var(--app-line)] py-1.5 text-xs font-semibold text-[var(--app-ink)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] transition">
            📞 Call
          </button>
        )}
        {contact.phone && (
          <button onClick={() => window.open(`sms:${contact.phone}`)}
            className="flex-1 rounded-[8px] border border-[var(--app-line)] py-1.5 text-xs font-semibold text-[var(--app-ink)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] transition">
            💬 SMS
          </button>
        )}
        <button onClick={() => onSelect(contact)}
          className={`${contact.phone ? '' : 'col-span-2'} flex-1 rounded-[8px] border border-[var(--app-line)] py-1.5 text-xs font-semibold text-[var(--app-ink)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] transition`}>
          Open
        </button>
        <button onClick={() => onSelect(contact)}
          className="flex-1 rounded-[8px] bg-[var(--app-accent)] py-1.5 text-xs font-semibold text-white hover:opacity-90 transition">
          Log
        </button>
      </div>
    </div>
  )
}

function QueueTab({ contacts, batches, onSelect, onScheduleCampaign }: {
  contacts: Contact[]
  batches: Batch[]
  onSelect: (c: Contact) => void
  onScheduleCampaign: () => void
}) {
  const dialer = useDialer()
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterCity, setFilterCity] = useState('')
  const [filterBatch, setFilterBatch] = useState('')

  function handleCall(c: Contact) {
    if (!c.phone) return
    void dialer.call(c.phone)
  }

  useEffect(() => {
    void dialer.ensureReady()
    // Register the partnership browser dialer once when the queue mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const batchMeta = useMemo(() => {
    const sortedBatches = [...batches].sort((a, b) => a.created_at.localeCompare(b.created_at))
    return new Map(sortedBatches.map((batch, index) => [
      batch.id,
      {
        label: `Batch ${index + 1}`,
        name: batch.name,
        contacts: batch.total_contacts || contacts.filter(contact => contact.batch_id === batch.id).length,
      },
    ]))
  }, [batches, contacts])

  const batchOptions = useMemo(() => Array.from(batchMeta.entries()).map(([id, meta]) => ({ id, ...meta })), [batchMeta])

  const filtered = contacts.filter(c => {
    if (search && !`${c.name} ${c.company} ${c.city} ${c.industry} ${c.category}`.toLowerCase().includes(search.toLowerCase())) return false
    if (filterCategory && c.category !== filterCategory) return false
    if (filterCity && (c.city || '').toLowerCase() !== filterCity.toLowerCase()) return false
    if (filterBatch && c.batch_id !== filterBatch) return false
    return true
  })

  // Available categories and cities in the current contact list
  const availableCategories = Array.from(new Set(contacts.map(c => c.category).filter(Boolean))) as string[]
  const availableCities = Array.from(new Set(contacts.map(c => c.city).filter(Boolean))) as string[]

  // Three buckets
  const responded = filtered.filter(c => c.sequence_paused && !c.decision)
  const overdue = filtered.filter(c => !c.sequence_paused && c.last_touch_at &&
    Math.floor((Date.now() - new Date(c.last_touch_at).getTime()) / 86400000) >= 5)
  const callFirst = filtered.filter(c => !c.sequence_paused && c.phone &&
    (!c.last_touch_at || Math.floor((Date.now() - new Date(c.last_touch_at).getTime()) / 86400000) < 5) &&
    (c.normalized_stage === 'target' || c.normalized_stage === 'mail_sent' || c.normalized_stage === 'attempting_contact'))
    .sort((a, b) => (b.outreach_tier ?? 3) < (a.outreach_tier ?? 3) ? 1 : -1)

  const urgentCount = responded.length + overdue.length

  return (
    <div className="space-y-6">
      {dialer.status === 'ringing' && (
        <div className="rounded-[16px] border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Incoming partnership call</div>
              <div className="mt-1 text-sm font-semibold text-[#1a2744]">{dialer.incomingFrom || 'Unknown caller'}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={dialer.acceptIncoming} className="min-h-10 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white">Accept</button>
              <button onClick={dialer.rejectIncoming} className="min-h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600">Decline</button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-[var(--app-ink)]">Outbound Queue</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${urgentCount > 0 ? 'border border-[rgba(201,117,78,0.12)] bg-[#f6ece7] text-[#955941]' : 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'}`}>
              <span className={`h-2 w-2 rounded-full ${urgentCount > 0 ? 'bg-[#c9754e]' : 'bg-[var(--app-accent)]'}`} />
              {urgentCount > 0 ? `${urgentCount} need attention` : 'Queue clear'}
            </span>
            {filtered.length !== contacts.length && (
              <span className="text-xs text-[var(--app-muted)]">Showing {filtered.length} of {contacts.length}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={onScheduleCampaign} className="crm-button-dark text-sm">Schedule campaign</button>
          <select value={filterBatch} onChange={e => setFilterBatch(e.target.value)} className="crm-input w-52 text-sm">
            <option value="">All batches</option>
            {batchOptions.map(batch => (
              <option key={batch.id} value={batch.id}>{batch.label} · {batch.name}</option>
            ))}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="crm-input w-36 text-sm" />
        </div>
      </div>

      {/* Category + city filters */}
      <div className="flex flex-wrap gap-2">
        {batchOptions.length > 0 && (
          <>
            <button onClick={() => setFilterBatch('')}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${!filterBatch ? 'bg-[var(--app-ink)] text-white' : 'border border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
              All batches
            </button>
            {batchOptions.map(batch => (
              <button key={batch.id} onClick={() => setFilterBatch(filterBatch === batch.id ? '' : batch.id)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${filterBatch === batch.id ? 'bg-[var(--app-ink)] text-white' : 'border border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
                {batch.label} <span className="font-medium opacity-70">{batch.contacts}</span>
              </button>
            ))}
          </>
        )}
        <button onClick={() => { setFilterCategory(''); setFilterCity('') }}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${!filterCategory && !filterCity ? 'bg-[var(--app-ink)] text-white' : 'border border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
          All
        </button>
        {SERVICE_AREAS.filter(a => availableCities.some(c => c.toLowerCase() === a.id)).map(a => (
          <button key={a.id} onClick={() => setFilterCity(filterCity === a.id ? '' : a.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${filterCity === a.id ? 'bg-[var(--app-ink)] text-white' : 'border border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
            📍 {a.label}
          </button>
        ))}
        {availableCategories.map(catId => {
          const meta = getCategoryMeta(catId)
          if (!meta) return null
          return (
            <button key={catId} onClick={() => setFilterCategory(filterCategory === catId ? '' : catId)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${filterCategory === catId ? `${meta.color} ring-1 ring-current` : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
              {meta.icon} {meta.label}
            </button>
          )
        })}
      </div>

      {/* Responded — act now */}
      {responded.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--app-accent)]" />
            <span className="text-sm font-semibold text-[var(--app-ink)]">Responded — Act Now</span>
            <span className="rounded-full border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--app-accent)]">{responded.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {responded.map(c => <QueueContactCard key={c.id} contact={c} batchLabel={c.batch_id ? batchMeta.get(c.batch_id)?.label : undefined} onSelect={onSelect} onCall={handleCall} />)}
          </div>
        </div>
      )}

      {/* Overdue — gone silent */}
      {overdue.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#c9754e]" />
            <span className="text-sm font-semibold text-[var(--app-ink)]">Gone Silent 5d+</span>
            <span className="rounded-full border border-[rgba(201,117,78,0.12)] bg-[#f5ece7] px-2 py-0.5 text-[10px] font-bold text-[#955941]">{overdue.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {overdue.slice(0, 10).map(c => <QueueContactCard key={c.id} contact={c} batchLabel={c.batch_id ? batchMeta.get(c.batch_id)?.label : undefined} onSelect={onSelect} onCall={handleCall} />)}
          </div>
        </div>
      )}

      {/* Call first — fresh targets */}
      {callFirst.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            <span className="text-sm font-semibold text-[var(--app-ink)]">Call First — Tier 1 Priority</span>
            <span className="rounded-full border border-[var(--app-line)] bg-[var(--app-wash)] px-2 py-0.5 text-[10px] font-bold text-[var(--app-muted)]">{callFirst.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {callFirst.slice(0, 20).map(c => <QueueContactCard key={c.id} contact={c} batchLabel={c.batch_id ? batchMeta.get(c.batch_id)?.label : undefined} onSelect={onSelect} onCall={handleCall} />)}
          </div>
        </div>
      )}

      {responded.length === 0 && overdue.length === 0 && callFirst.length === 0 && (
        <div className="rounded-[16px] border border-dashed border-[var(--app-line)] bg-white p-16 text-center">
          <div className="text-3xl">✅</div>
          <div className="mt-4 text-sm font-semibold text-[var(--app-ink)]">Queue is clear</div>
          <div className="mt-1 text-xs text-[var(--app-muted)]">Import a batch to start working contacts</div>
        </div>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = 'queue' | 'replies' | 'overview' | 'lists' | 'pipeline' | 'phone' | 'partners'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'queue',    label: 'Queue',    icon: '⚡' },
  { key: 'phone',    label: 'Inbox',    icon: '💬' },
  { key: 'overview', label: 'Overview', icon: '📊' },
  { key: 'lists',    label: 'Lists',    icon: '📋' },
  { key: 'pipeline', label: 'Pipeline', icon: '🎯' },
  { key: 'partners', label: 'Partners', icon: '🤝' },
]

function PartnershipEngineInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialTab = (searchParams.get('tab') as Tab) || 'phone'
  const [tab, setTab] = useState<Tab>(initialTab === 'replies' ? 'phone' : initialTab)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [lists, setLists] = useState<List[]>([])
  const [contactsLoading, setContactsLoading] = useState(true)
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)

  const loadContacts = useCallback(async () => {
    setContactsLoading(true)
    const r = await fetch('/api/marketing/contacts?limit=2000&offset=0', { credentials: 'include' })
    if (r.ok) { const d = await r.json() as { contacts?: Contact[] }; setContacts(d.contacts ?? []) }
    setContactsLoading(false)
  }, [])

  const loadBatches = useCallback(async () => {
    setBatchesLoading(true)
    const r = await fetch('/api/marketing/batches', { credentials: 'include' })
    if (r.ok) setBatches(await r.json() as Batch[])
    setBatchesLoading(false)
  }, [])

  const loadLists = useCallback(async () => {
    const r = await fetch('/api/marketing/lists', { credentials: 'include' })
    if (r.ok) setLists(await r.json() as List[])
  }, [])

  useEffect(() => { void loadContacts() }, [loadContacts])
  useEffect(() => { void loadBatches() }, [loadBatches])
  useEffect(() => { void loadLists() }, [loadLists])

  function handleTabChange(t: Tab) {
    setTab(t)
    router.replace(`/marketing/partners?tab=${t}`, { scroll: false })
  }

  function handleOpenThread(contact: Contact) {
    setTab('phone')
    router.replace(`/marketing/partners?tab=phone&contact=${contact.id}`, { scroll: false })
  }

  function handleContactUpdated(contact: Contact) {
    const normalized = {
      ...contact,
      normalized_stage: String(contact.stage || contact.normalized_stage || ''),
    }
    setContacts(curr => {
      const seen = curr.some(c => c.id === normalized.id)
      return seen ? curr.map(c => c.id === normalized.id ? { ...c, ...normalized } : c) : [normalized, ...curr]
    })
    setSelectedContact(curr => curr?.id === normalized.id ? { ...curr, ...normalized } : curr)
  }

  function handleContactDeleted(contactId: string) {
    setContacts(curr => curr.filter(contact => contact.id !== contactId))
    setSelectedContact(curr => curr?.id === contactId ? null : curr)
  }

  async function handlePipelineStageChange(contactId: string, stage: string) {
    const prev = contacts
    setContacts(curr => curr.map(c => c.id === contactId ? { ...c, stage, normalized_stage: stage, last_touch_at: new Date().toISOString() } : c))
    const res = await fetch('/api/marketing/contacts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ id: contactId, stage }),
    })
    if (!res.ok) { setContacts(prev); return }
    const data = await res.json().catch(() => null) as { contact?: Partial<Contact> } | null
    if (data?.contact) {
      setContacts(curr => curr.map(c => c.id === contactId ? { ...c, ...data.contact, normalized_stage: String(data.contact!.stage || stage) } : c))
    }
  }

  const [bulkSmsContacts, setBulkSmsContacts] = useState<Contact[] | null>(null)
  const [scheduledSmsOpen, setScheduledSmsOpen] = useState(false)
  const needsReplyCount = contacts.filter(c => getInboxStatus(c) === 'needs_reply').length
  const queueCount = needsReplyCount + contacts.filter(c =>
    c.last_touch_at && Math.floor((Date.now() - new Date(c.last_touch_at).getTime()) / 86400000) >= 5
  ).length
  const inboxActive = tab === 'phone' || tab === 'replies'

  return (
    <div className={inboxActive ? 'min-h-screen bg-white md:bg-[var(--app-bg,#f0f2f5)]' : 'min-h-screen bg-[var(--app-bg,#f0f2f5)]'}>
      <div className={inboxActive ? 'mx-0 max-w-none px-0 py-0 md:mx-auto md:max-w-[1280px] md:px-4 md:py-2' : 'mx-auto max-w-6xl px-4 py-8 sm:px-6'}>
        <div className={`${inboxActive ? 'hidden' : 'flex'} mb-6 items-center justify-between`}>
          <div>
            <h1 className="text-2xl font-semibold text-[var(--app-ink)]">Partnership Engine</h1>
            <p className="mt-0.5 text-sm text-[var(--app-muted)]">
              {batchesLoading ? '—' : batches.length} batch{batches.length !== 1 ? 'es' : ''} · {contactsLoading ? '—' : contacts.length} contacts
              {needsReplyCount > 0 && <span className="ml-2 rounded-full bg-[var(--app-accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--app-accent)]">{needsReplyCount} responded</span>}
            </p>
          </div>
        </div>

        <div className={`${inboxActive ? 'hidden' : 'flex'} ${inboxActive ? 'mb-2 gap-1 rounded-[14px] p-1' : 'mb-6 gap-1 rounded-[16px] p-1.5'} border border-[var(--app-line)] bg-[var(--app-panel,white)]`}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => handleTabChange(t.key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-[11px] ${inboxActive ? 'py-1.5 text-xs' : 'py-2.5 text-sm'} font-semibold transition ${tab === t.key ? 'bg-[var(--app-ink)] text-white shadow-sm' : 'text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
              <span>{t.icon}</span>
              <span className="hidden sm:inline">{t.label}</span>
              {t.key === 'queue' && queueCount > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === t.key ? 'bg-white/20 text-white' : 'border border-[rgba(201,117,78,0.12)] bg-[#f5ece7] text-[#955941]'}`}>{queueCount}</span>
              )}
              {t.key === 'phone' && needsReplyCount > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === t.key ? 'bg-white/20 text-white' : 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'}`}>{needsReplyCount}</span>
              )}
            </button>
          ))}
        </div>

        {tab === 'queue' && (
          <QueueTab contacts={contacts} batches={batches} onSelect={setSelectedContact}
            onScheduleCampaign={() => setScheduledSmsOpen(true)} />
        )}
        {tab === 'overview' && (
          <OverviewTab batches={batches} contacts={contacts} loading={batchesLoading || contactsLoading}
            onRefresh={() => { void loadBatches(); void loadContacts() }} onTabChange={handleTabChange} />
        )}
        {tab === 'lists' && (
          <ListsTab contacts={contacts} onSelectContact={setSelectedContact} />
        )}
        {tab === 'pipeline' && (
          <PipelineTab contacts={contacts} onSelect={setSelectedContact} onStageChange={handlePipelineStageChange} />
        )}
        {(tab === 'phone' || tab === 'replies') && (
          <PhoneTab contacts={contacts} batches={batches} lists={lists} onSelectContact={setSelectedContact} onContactUpdated={handleContactUpdated} onContactDeleted={handleContactDeleted} />
        )}
        {tab === 'partners' && (
          <PartnersTab contacts={contacts} onSelect={setSelectedContact} />
        )}

        {selectedContact && (
          <ContactDrawer
            contact={selectedContact}
            lists={lists}
            onClose={() => setSelectedContact(null)}
            onRefresh={() => { void loadContacts(); void loadBatches() }}
          />
        )}

        {bulkSmsContacts && (
          <BulkSmsModal contacts={bulkSmsContacts} onClose={() => setBulkSmsContacts(null)} />
        )}
        {scheduledSmsOpen && (
          <ScheduledSmsCampaignModal
            onClose={() => setScheduledSmsOpen(false)}
            onDone={() => { void loadBatches(); void loadContacts() }}
          />
        )}
      </div>
    </div>
  )
}

export default function PartnershipEngine() {
  return (
    <Suspense>
      <PartnershipEngineInner />
    </Suspense>
  )
}
