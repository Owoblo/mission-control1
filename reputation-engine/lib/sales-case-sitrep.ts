import type { CRMEmail, CRMLead, CRMQuote, FollowUpLog } from './types'

export interface SalesCaseMessage {
  id?: string
  direction: 'inbound' | 'outbound'
  body: string
  createdAt: string
  channel?: 'sms' | 'whatsapp' | string
}

export interface SalesCasePartnershipTouch {
  id: string
  direction?: string
  channel?: string
  notes?: string | null
  createdAt: string
}

export interface SalesCaseSitrepInput {
  lead: CRMLead
  messages?: SalesCaseMessage[]
  partnershipTouches?: SalesCasePartnershipTouch[]
  contextNotes?: string[]
  emails?: CRMEmail[]
  followUps?: FollowUpLog[]
  quotes?: CRMQuote[]
  asOf?: Date
  timeZone?: string
}

interface TimelineEvent {
  at: string
  label: string
  text: string
  source: string
}

const DEFAULT_TIME_ZONE = 'America/Toronto'
const MAX_EVENT_TEXT = 520

function clean(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function existingLossContext(value?: string) {
  return clean(value).split(/CASE SITREP v\d+ — /)[0].trim()
}

function clipped(value: unknown, limit = MAX_EVENT_TEXT) {
  const text = clean(value)
  if (!text) return ''
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function instant(value?: string | null) {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function formatTime(value: string, timeZone: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    const noonUtc = new Date(Date.UTC(year, month - 1, day, 12))
    return `${new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit' }).format(noonUtc)} (date only; time not recorded)`
  }
  const timestamp = instant(value)
  if (timestamp === null) return value
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(timestamp)
}

function isImportantFollowUp(log: FollowUpLog) {
  const notes = clean(log.notes)
  return log.type === 'status_change' || /follow-up scheduled|quote.{0,30}(created|updated|sent)|customer reply needs human response|voicemail captured|deposit|booking|lost feedback|partner handoff/i.test(notes)
}

function messageEvents(messages: SalesCaseMessage[], timeZone: string): TimelineEvent[] {
  return messages.map(message => ({
    at: message.createdAt,
    label: `${message.direction === 'inbound' ? 'Customer' : 'Sales'} ${message.channel || 'message'}`,
    text: clipped(message.body.replace(/\[MMS: https?:\/\/[^\]]+\]/gi, '[MMS attachment]')),
    source: message.id ? `sms_messages ${message.id}` : 'sms_messages',
  })).filter(event => event.text && instant(event.at) !== null)
}

function buildTimeline(input: SalesCaseSitrepInput, timeZone: string): TimelineEvent[] {
  const { lead } = input
  const events: TimelineEvent[] = []

  for (const call of lead.callLogs || []) {
    const details = [
      call.repName ? `rep ${call.repName}` : '',
      call.duration ? `duration ${call.duration}` : '',
      call.callOutcome ? `outcome ${call.callOutcome}` : '',
      call.answeredBy ? `answered by ${call.answeredBy}` : '',
      typeof call.audioConnected === 'boolean' ? `audio ${call.audioConnected ? 'connected' : 'not connected'}` : '',
      call.failureReason ? `failure reason ${call.failureReason}` : '',
      call.recordingUnavailableReason ? `recording unavailable: ${call.recordingUnavailableReason}` : '',
      call.isVoicemail ? 'voicemail/no live conversation' : '',
      call.aiSummary?.summary ? clipped(call.aiSummary.summary, 360) : '',
      !call.aiSummary?.summary && call.transcript ? `Transcript: ${clipped(call.transcript, 360)}` : '',
      !call.transcript && !call.aiSummary?.summary ? 'No transcript or call summary stored.' : '',
    ].filter(Boolean)
    events.push({
      at: call.date,
      label: `Call ${call.direction || 'direction unknown'}`,
      text: details.join(' · '),
      source: `crm_leads.callLogs ${call.id}`,
    })
  }

  events.push(...messageEvents(input.messages || [], timeZone))

  for (const touch of input.partnershipTouches || []) {
    events.push({
      at: touch.createdAt,
      label: `Partnership ${touch.direction || 'activity'}${touch.channel ? ` ${touch.channel}` : ''}`,
      text: clipped(touch.notes, 360) || 'No message text stored.',
      source: `market_touches ${touch.id}`,
    })
  }

  for (const email of input.emails || []) {
    const text = clipped(email.body, 360)
    events.push({
      at: email.sentAt,
      label: `${email.direction === 'inbound' ? 'Customer' : 'Sales'} email${email.subject ? ` — ${clipped(email.subject, 100)}` : ''}`,
      text: text || `Email status: ${email.status}.`,
      source: `crm_emails ${email.id}`,
    })
  }

  for (const log of input.followUps || []) {
    if (!isImportantFollowUp(log) || !log.notes || /CASE SITREP v\d+/.test(log.notes)) continue
    events.push({
      at: log.date || log.createdAt,
      label: `CRM ${log.type}`,
      text: clipped(log.notes, 320),
      source: `crm_followup_logs ${log.id}`,
    })
  }

  for (const quote of input.quotes || []) {
    if (quote.createdAt) {
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(quote.createdAt)
      events.push({ at: quote.createdAt, label: `Quote prepared — ${quote.number}`, text: `${quote.status}; pre-tax ${quote.subtotal}, HST ${quote.hst}, total ${quote.total}.${dateOnly ? ' Timestamp unavailable; exact order relative to other activity on this date is unknown.' : ''}`, source: `crm_quotes ${quote.id}` })
    }
    if (quote.sentAt) {
      events.push({
        at: quote.sentAt,
        label: `Quote sent — ${quote.number}`,
        text: `${quote.status}; ${quote.billingModel || 'billing model not recorded'}; pre-tax ${quote.subtotal}; HST ${quote.hst}; total ${quote.total}${quote.moveDate ? `; move date ${quote.moveDate}` : ''}.`,
        source: `crm_quotes ${quote.id}`,
      })
    }
    if (quote.acceptedAt) {
      events.push({ at: quote.acceptedAt, label: `Quote accepted — ${quote.number}`, text: `Accepted total ${quote.total}; deposit recorded ${quote.depositPaidAmount ?? 'unknown'}.`, source: `crm_quotes ${quote.id}` })
    }
  }

  if (lead.bookedAt) {
    events.push({ at: lead.bookedAt, label: 'CRM booking recorded', text: `Current stage ${lead.stage}; move date ${lead.moveDate || 'not recorded'}.`, source: `crm_leads ${lead.id}.bookedAt` })
  }
  if (lead.lostAt) {
    const recordedLossContext = existingLossContext(lead.lostNotes)
    events.push({ at: lead.lostAt, label: 'CRM marked lost', text: `${lead.lostReason || 'No coded reason'}${recordedLossContext ? `; recorded note: ${clipped(recordedLossContext, 280)}` : ''}.`.replace(/\.+$/, '.'), source: `crm_leads ${lead.id}.lostAt` })
  }

  return events
    .filter(event => instant(event.at) !== null)
    .sort((left, right) => (instant(left.at) || 0) - (instant(right.at) || 0))
}

function elapsedLabel(start: number, end: number) {
  // The report displays event times to the minute, so truncate rather than
  // rounding hidden seconds up and making visible clock times appear inconsistent.
  const minutes = Math.max(end > start ? 1 : 0, Math.floor((end - start) / 60_000))
  if (minutes < 60) return `${minutes} minutes`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function getInitialContactEvents(input: SalesCaseSitrepInput) {
  const events = [
    ...(input.lead.callLogs || []).map(call => ({
      at: call.date,
      direction: call.direction,
      kind: 'call',
      callStatus: call.callOutcome === 'missed' || call.callOutcome === 'no_answer'
        ? 'missed'
        : call.callOutcome === 'answered' && call.audioConnected !== false && !call.isVoicemail
          ? 'answered'
          : call.callOutcome === 'completed' && Number(call.durationSeconds || 0) > 0 && call.audioConnected !== false && !call.isVoicemail
          ? 'answered'
          : undefined,
      answeredAt: call.answeredAt,
      answerLatencySeconds: call.answerLatencySeconds,
    })),
    ...(input.messages || []).map(message => ({ at: message.createdAt, direction: message.direction, kind: message.channel || 'message', callStatus: undefined as string | undefined, answeredAt: undefined as string | undefined, answerLatencySeconds: undefined as number | undefined })),
    ...(input.emails || []).map(email => ({ at: email.sentAt, direction: email.direction, kind: 'email', callStatus: undefined as string | undefined, answeredAt: undefined as string | undefined, answerLatencySeconds: undefined as number | undefined })),
    ...(input.partnershipTouches || []).map(touch => ({ at: touch.createdAt, direction: touch.direction, kind: `Partnership ${touch.channel || 'message'}`, callStatus: undefined as string | undefined, answeredAt: undefined as string | undefined, answerLatencySeconds: undefined as number | undefined })),
  ].filter(event => instant(event.at) !== null)
  const inbound = events.filter(event => event.direction === 'inbound').sort((a, b) => (instant(a.at) || 0) - (instant(b.at) || 0))[0]
  const outbound = inbound
    ? events.filter(event => event.direction === 'outbound' && (instant(event.at) || 0) >= (instant(inbound.at) || 0)).sort((a, b) => (instant(a.at) || 0) - (instant(b.at) || 0))[0]
    : undefined
  const priorOutbound = inbound
    ? events.filter(event => event.direction === 'outbound' && (instant(event.at) || 0) < (instant(inbound.at) || 0)).sort((a, b) => (instant(a.at) || 0) - (instant(b.at) || 0))[0]
    : undefined
  return { inbound, outbound, priorOutbound }
}

function contactTiming(input: SalesCaseSitrepInput, timeZone: string, asOf: Date) {
  const { inbound, outbound, priorOutbound } = getInitialContactEvents(input)
  if (!inbound) return 'First-touch response time: not measurable; no inbound call, SMS, or email timestamp is linked.'
  if (/call|phone/i.test(inbound.kind)) {
    if (inbound.callStatus === 'answered') {
      const exactAnswer = Number.isFinite(inbound.answerLatencySeconds) && inbound.answerLatencySeconds != null
        ? `Provider-stamped answer: ${inbound.answeredAt ? formatTime(inbound.answeredAt, timeZone) : 'timestamp recorded'}; TwiML-routing-start-to-answer ${inbound.answerLatencySeconds}s. The call was answered live; use the measured latency for the immediate-pickup benchmark, with no invented numeric call cutoff.`
        : 'Exact ring-to-answer latency is not stored, so the immediate-pickup SLA is unmeasurable from this record.'
      return `First recorded inbound touch: ${formatTime(inbound.at, timeZone)} (${inbound.kind}); the linked call record shows a live connected call. ${exactAnswer} ${outbound ? `First later outbound follow-up: ${formatTime(outbound.at, timeZone)} (${outbound.kind}).` : 'No later outbound follow-up is linked.'}`
    }
    if (inbound.callStatus === 'missed') {
      if (!outbound) return `First recorded inbound touch: ${formatTime(inbound.at, timeZone)} (${inbound.kind}); the linked call record shows a miss. No callback or other outbound recovery is linked. Immediate-pickup SLA: missed; callback latency: unavailable.`
      const recoverySeconds = (instant(outbound.at) || 0) - (instant(inbound.at) || 0)
      return `First recorded inbound touch: ${formatTime(inbound.at, timeZone)} (${inbound.kind}); the linked call record shows a miss. First outbound recovery: ${formatTime(outbound.at, timeZone)} (${outbound.kind}), about ${elapsedLabel(instant(inbound.at)!, instant(outbound.at)!)} later. Immediate-pickup SLA: missed; callback within two minutes: ${recoverySeconds <= 120_000 ? 'met' : 'missed'}.`
    }
    return `First recorded inbound touch: ${formatTime(inbound.at, timeZone)} (${inbound.kind}). No linked call outcome establishes whether it was answered or missed; live-pickup SLA: unmeasurable. ${outbound ? `First later outbound follow-up: ${formatTime(outbound.at, timeZone)} (${outbound.kind}), about ${elapsedLabel(instant(inbound.at)!, instant(outbound.at)!)} later.` : 'No later outbound follow-up is linked.'}`
  }
  if (!outbound) {
    const elapsed = asOf.getTime() - instant(inbound.at)!
    const target = elapsed < 120_000 ? 'pending; less than two minutes have elapsed' : 'overdue; no outbound event is linked in the checked channels'
    return `First recorded inbound touch: ${formatTime(inbound.at, timeZone)} (${inbound.kind}). ${priorOutbound ? `The earliest outbound record (${formatTime(priorOutbound.at, timeZone)}, ${priorOutbound.kind}) predates it; ` : ''}no outbound event after that first inbound is linked in the channels checked. CRM-recorded two-minute response-attempt target: ${target}.`
  }
  const start = instant(inbound.at)!
  const end = instant(outbound.at)!
  if (end < start) {
    return `First recorded inbound touch: ${formatTime(inbound.at, timeZone)} (${inbound.kind}). The earliest outbound record (${formatTime(outbound.at, timeZone)}, ${outbound.kind}) predates it; response latency cannot be calculated until channel/source records are reconciled.`
  }
  const target = end - start <= 120_000 ? 'met' : 'missed'
  return `First recorded inbound touch: ${formatTime(inbound.at, timeZone)} (${inbound.kind}). First recorded outbound: ${formatTime(outbound.at, timeZone)} (${outbound.kind}), about ${elapsedLabel(start, end)} later. CRM-recorded two-minute response-attempt target: ${target}. This is a first outbound timestamp, not proof of a live conversation or a reliably human-authored response.`
}

function localDate(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function formatOperationalStatus(lead: CRMLead, now: Date, timeZone: string) {
  const today = localDate(now, timeZone)
  const phase = lead.stage === 'lost'
    ? 'No active Saturn Star booking is currently recorded; fulfillment and aftercare require review.'
    : lead.moveDate
      ? lead.moveDate < today ? 'Scheduled move date has passed' : 'Move is still upcoming'
      : 'Move date is not recorded'
  const executionEntries = lead.moveExecutionLog?.entries || []
  const issues = lead.moveExecutionLog?.issues || []
  const crew = lead.assignedCrew?.length ? `${lead.assignedCrew.length} crew member(s) assigned` : 'No crew assignment recorded'
  const dispatch = (lead.crewPayouts || []).map(payout => `${payout.workerName}: dispatch ${payout.dispatchStatus || 'not recorded'}${payout.dispatchConfirmedAt ? ` (${payout.dispatchConfirmedAt})` : ''}`).join('; ') || 'No subcontractor dispatch acknowledgement recorded'
  const review = lead.reviewSentAt
    ? `review request sent ${lead.reviewSentAt}${lead.reviewCompletedAt ? `; completed ${lead.reviewCompletedAt}, rating ${lead.reviewRating ?? 'not recorded'}` : '; no completed review recorded'}`
    : 'No review request timestamp recorded'
  return [
    `${phase} Current CRM stage: ${lead.stage}.`,
    `Crew: ${crew}. ${dispatch}.`,
    `Move execution log: ${executionEntries.length} milestone(s), ${issues.length} issue(s).`,
    `Customer payment status: ${lead.paymentStatus || 'not recorded'}${lead.depositDate ? `; deposit date ${lead.depositDate}, amount ${lead.depositAmount ?? 'not recorded'}` : ''}.`,
    `Post-move review: ${review}.`,
    `Operational outcome: ${lead.operationalOutcome ? 'recorded' : 'not recorded'}.`,
  ].join(' ')
}

export function buildSalesCaseSitrep(input: SalesCaseSitrepInput) {
  const { lead } = input
  const timeZone = input.timeZone || DEFAULT_TIME_ZONE
  const now = input.asOf || new Date()
  const timeline = buildTimeline(input, timeZone)
  const evidenceFollowUps = (input.followUps || []).filter(log => !/CASE SITREP v\d+/.test(log.notes || ''))
  const quoteRows = (input.quotes || []).map(quote =>
    `${quote.number}: ${quote.status}; move ${quote.moveDate || 'not recorded'}; ${quote.billingModel || 'billing model unknown'}; pre-tax ${quote.subtotal}, HST ${quote.hst}, total ${quote.total}; deposit status ${quote.depositPaidAt ? `paid ${quote.depositPaidAt}` : 'not recorded'}, balance status ${quote.balancePaidAt ? `paid ${quote.balancePaidAt}` : 'not recorded'}.`
  )
  const inventoryCount = lead.inventory?.length || 0
  const inventoryLine = inventoryCount
    ? `${lead.totalItems ?? inventoryCount} counted item(s) across ${inventoryCount} CRM inventory row(s); estimated volume ${lead.totalCubicFeet ?? 'not recorded'} cu ft, weight ${lead.totalWeightLbs ?? 'not recorded'} lb.`
    : 'No structured inventory list is attached.'
  const routeLine = `${lead.originCity || 'origin city unknown'} → ${lead.destCity || 'destination city unknown'}; move date ${lead.moveDate || 'not recorded'}; move type ${lead.moveType || 'not recorded'}.`
  const accessLine = `Origin access ${lead.originAccess || 'not recorded'}; destination access ${lead.destAccess || 'not recorded'}; parking ${lead.parkingNotes || 'not recorded'}.`
  const lossContext = existingLossContext(lead.lostNotes)
  const stageLine = lead.stage === 'lost'
    ? `Disposition: lost${lead.lostReason ? ` (${lead.lostReason})` : ' (reason not coded)'}. ${lossContext ? `Existing loss context: ${clipped(lossContext, 620)}` : lead.lostReason ? 'No additional customer-stated loss narrative is recorded.' : 'No customer-stated loss reason is recorded.'}`
    : `Disposition: current stage ${lead.stage}; booked ${lead.bookedAt || 'booking timestamp not recorded'}; owner ${lead.assignedRepName || lead.assignedRep || 'not recorded'}.`
  const coverage = `Evidence inventory: ${(lead.callLogs || []).length} call log(s), ${(input.messages || []).length} Sales SMS/WhatsApp message(s), ${(input.partnershipTouches || []).length} Partnerships touch(es), ${(input.emails || []).length} email record(s), ${evidenceFollowUps.length} CRM follow-up/event log(s), ${(input.quotes || []).length} quote record(s).`
  const gaps = [
    !lead.moveDate ? 'move date' : '',
    !lead.originCity ? 'origin city' : '',
    !lead.destCity ? 'destination city' : '',
    !lead.originAccess ? 'origin access' : '',
    !lead.destAccess ? 'destination access' : '',
    !lead.parkingNotes ? 'parking/truck access' : '',
    !inventoryCount ? 'structured inventory' : '',
    !lead.email ? 'email address' : '',
    !lead.phone ? 'phone number' : '',
  ].filter(Boolean)

  const lines = [
    `CASE SITREP v1 — ${lead.name || 'Unnamed lead'} (${lead.id})`,
    `Prepared ${formatTime(now.toISOString(), timeZone)} from CRM records. This report separates recorded facts from missing information; it is a snapshot and should be refreshed when new activity is recorded.`,
    '',
    'CASE SUMMARY',
    stageLine,
    `CRM source/workstream label: ${lead.source || 'not recorded'}. Linked partner referral: ${lead.partnerReferralName || 'none recorded'}${lead.partnerReferralCompany ? ` (${lead.partnerReferralCompany.replace(/[.\s]+$/, '')})` : ''}. Linked relationship contact: ${lead.relationshipContactName || 'none recorded'}${lead.relationshipContactCompany ? ` (${lead.relationshipContactCompany.replace(/[.\s]+$/, '')})` : ''}.`,
    `Route and scope: ${routeLine}`,
    accessLine,
    ...(input.contextNotes || []).map(note => `Additional owner-supplied context (timestamp not independently verified): ${clipped(note, 360)}`),
    inventoryLine,
    contactTiming(input, timeZone, now),
    coverage,
    quoteRows.length ? `Quotes: ${quoteRows.join(' ')}` : 'Quotes: none linked.',
    '',
    'CHRONOLOGICAL RECORD',
    ...(timeline.length
      ? timeline.map(event => `• ${formatTime(event.at, timeZone)} — ${event.label}: ${event.text} [${event.source}]`)
      : ['• No timestamped call, SMS, email, quote, or follow-up event is linked to this lead.']),
    '',
    'FULFILLMENT / AFTERCARE',
    formatOperationalStatus(lead, now, timeZone),
    '',
    'DATA GAPS / FOLLOW-UP',
    gaps.length ? `Not captured: ${gaps.join(', ')}.` : 'Core intake fields are populated; confirm whether scope/access values were customer-verified.',
    lead.stage === 'lost' && !lead.lostReason ? 'Loss reason needs a human-coded disposition; do not infer it from silence.' : '',
    lead.stage === 'lost' && (lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' || Number(lead.depositAmount || 0) > 0)
      ? `Reconciliation flag: this lead is marked lost but CRM records payment status ${lead.paymentStatus || 'not recorded'} and/or deposit ${lead.depositAmount ?? 'amount not recorded'}. Verify whether the job was cancelled, completed, refunded, or incorrectly marked lost.`
      : '',
    lead.stage !== 'lost' && lead.paymentStatus === 'paid_in_full' && lead.moveDate && lead.moveDate > localDate(now, timeZone)
      ? 'Payment flag: the CRM says paid in full before the scheduled future move; verify whether this is intentional and whether balance/payment detail is current.'
      : '',
    lead.stage !== 'lost' && lead.moveDate && lead.moveDate < localDate(now, timeZone) && lead.stage === 'booked'
      ? 'Move date is past while CRM stage remains booked. Confirm completion/cancellation and record customer outcome, final payment, subcontractor communication, and review request.'
      : '',
    'Source labels describe the CRM intake/routing channel; they do not by themselves establish a Partnerships referral. Keep workstream, first-touch channel, and later message channels distinct.',
  ].filter(line => line !== undefined)

  return lines.join('\n')
}
