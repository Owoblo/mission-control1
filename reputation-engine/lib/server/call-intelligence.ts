import { dateStamp, detectSalesBranchFromLocation, normalizeLead } from '@/lib/sales'
import type { AISummary, CRMLead, LeadIntelligence, LeadIntelligenceFollowUp, LeadPersonaBadge } from '@/lib/types'
import { SATURN_STAR_SALES_PROCESS } from '@/lib/server/sales-training'
import { readEnv } from '@/lib/server/runtime'
import { downloadTwilioRecording } from '@/lib/server/twilio-recordings'
import { extractRecordingObjectKey } from '@/lib/server/recording-archive'
import { getStorageService } from '@/lib/server/storage-service'
import { sanitizeAutomatedStageSuggestion } from '@/lib/lead-stage-safety'

function getOpenAIKey() {
  return readEnv('OPENAI_API_KEY')
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRetryableOpenAiFetchError(error: unknown) {
  if (!(error instanceof Error)) return false
  const name = error.name.toLowerCase()
  const message = error.message.toLowerCase()
  return (
    name.includes('abort') ||
    name.includes('timeout') ||
    message.includes('fetch failed') ||
    message.includes('other side closed') ||
    message.includes('socket') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('connection reset')
  )
}

async function fetchWithRetry(
  factory: () => Promise<Response>,
  options?: { attempts?: number; baseDelayMs?: number }
) {
  const attempts = options?.attempts ?? 3
  const baseDelayMs = options?.baseDelayMs ?? 400
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await factory()
    } catch (error) {
      lastError = error
      if (attempt >= attempts || !isRetryableOpenAiFetchError(error)) {
        throw error
      }
      await sleep(baseDelayMs * attempt)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed')
}

function buildAudioTranscriptionForm(bytes: Buffer, filename: string, mimeType: string) {
  const blobBytes = new Uint8Array(bytes)
  const form = new FormData()
  form.append('file', new File([blobBytes], filename, { type: mimeType }))
  form.append('model', 'whisper-1')
  form.append('language', 'en')
  return form
}

function parseAudioDataUrl(dataUrl: string) {
  // Handle MIME types with codec params e.g. "audio/webm;codecs=opus;base64,..."
  const match = dataUrl.match(/^data:(audio\/[a-zA-Z0-9.+-]+)(?:;[^,]*)?;base64,(.+)$/)
  if (!match) {
    throw new Error('Invalid audio recording payload')
  }

  const [, mimeType, encoded] = match
  const bytes = Buffer.from(encoded, 'base64')
  const ext =
    mimeType.includes('webm') ? 'webm' :
    mimeType.includes('mp4') ? 'mp4' :
    mimeType.includes('mpeg') ? 'mp3' :
    mimeType.includes('wav') ? 'wav' :
    'webm'

  return { mimeType, bytes, ext }
}

export async function transcribeConsultationRecording(recordingDataUrl: string) {
  const apiKey = getOpenAIKey()
  if (!apiKey || !recordingDataUrl.startsWith('data:audio/')) return null

  const { mimeType, bytes, ext } = parseAudioDataUrl(recordingDataUrl)
  const response = await fetchWithRetry(() =>
    fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: buildAudioTranscriptionForm(bytes, `consultation.${ext}`, mimeType),
      signal: AbortSignal.timeout(45_000),
    })
  )

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Consultation transcription failed: ${response.status}${detail ? ` ${detail}` : ''}`)
  }

  const payload = (await response.json()) as { text?: string }
  return payload.text?.trim() || null
}

export async function transcribeAudioBuffer(buffer: Buffer, contentType: string, filenamePrefix = 'call') {
  const apiKey = getOpenAIKey()
  if (!apiKey) return null

  const normalizedContentType = contentType.toLowerCase()
  const ext =
    normalizedContentType.includes('wav') ? 'wav' :
    normalizedContentType.includes('mpeg') || normalizedContentType.includes('mp3') ? 'mp3' :
    normalizedContentType.includes('webm') ? 'webm' :
    'mp3'
  const response = await fetchWithRetry(() =>
    fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: buildAudioTranscriptionForm(buffer, `${filenamePrefix}.${ext}`, contentType),
      signal: AbortSignal.timeout(45_000),
    })
  )

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 429) {
      const err = new Error(`Transcription quota exceeded — add OpenAI credits to re-enable.`) as Error & { isQuotaError: boolean }
      err.isQuotaError = true
      throw err
    }
    throw new Error(`Phone call transcription failed: ${response.status}${detail ? ` ${detail}` : ''}`)
  }

  const payload = (await response.json()) as { text?: string }
  return payload.text?.trim() || null
}

export async function transcribeFromUrl(audioUrl: string, accountSid: string, authToken: string, recordingSid?: string | null) {
  const apiKey = getOpenAIKey()
  if (!apiKey) return null

  const objectKey = extractRecordingObjectKey(audioUrl)
  if (objectKey) {
    const recording = await getStorageService().getObject(objectKey)
    return transcribeAudioBuffer(recording.buffer, recording.contentType, 'call')
  }

  const recording = await downloadTwilioRecording({
    accountSid,
    authToken,
    recordingUrl: audioUrl,
    recordingSid,
  })
  return transcribeAudioBuffer(recording.buffer, recording.contentType, 'call')
}

function isMeaninglessTranscript(transcript: string): boolean {
  const words = transcript.trim().split(/\s+/).filter(Boolean)
  if (words.length < 5) return true
  // Check if it's all filler words / single words
  const fillers = new Set(['you', 'uh', 'um', 'hmm', 'yeah', 'yes', 'no', 'okay', 'ok', 'hi', 'hello', 'bye', 'thanks'])
  const meaningfulWords = words.filter(w => !fillers.has(w.toLowerCase().replace(/[^a-z]/g, '')))
  return meaningfulWords.length < 4
}

const NO_CONVERSATION = {
  summary: 'No conversation captured — recording was too short or contained no speech.',
  leadConcern: undefined,
  nextAction: 'Try recording again during the next call or consultation.',
  followUpDays: undefined,
  followUpReason: undefined,
  coachingTip: undefined,
  moveReadiness: undefined,
} as const

function parseMaybeNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const normalized = value.replace(/[^0-9.]/g, '')
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function normalizeMoveType(value: unknown): CRMLead['moveType'] | undefined {
  return value === 'residential' || value === 'commercial' || value === 'long-distance' || value === 'senior' || value === 'labor-only' || value === 'packing'
    ? value
    : undefined
}

function normalizePhoneCallSummary(raw: Record<string, unknown>): AISummary {
  const moveReadiness =
    raw.moveReadiness === 'hot' || raw.moveReadiness === 'warm' || raw.moveReadiness === 'cold'
      ? raw.moveReadiness
      : undefined

  return {
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : undefined,
    leadConcern: typeof raw.leadConcern === 'string' ? raw.leadConcern.trim() : undefined,
    nextAction: typeof raw.nextAction === 'string' ? raw.nextAction.trim() : undefined,
    followUpDays: typeof raw.followUpDays === 'number' ? raw.followUpDays : undefined,
    followUpReason: typeof raw.followUpReason === 'string' ? raw.followUpReason.trim() : undefined,
    coachingTip: typeof raw.coachingTip === 'string' ? raw.coachingTip.trim() : undefined,
    moveReadiness,
    capturedName: typeof raw.capturedName === 'string' ? raw.capturedName.trim() : undefined,
    moveDate: typeof raw.moveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.moveDate.trim()) ? raw.moveDate.trim() : undefined,
    moveDateFlexible: typeof raw.moveDateFlexible === 'boolean' ? raw.moveDateFlexible : undefined,
    moveDateFlexibleReason: typeof raw.moveDateFlexibleReason === 'string' ? raw.moveDateFlexibleReason.trim() : undefined,
    moveType: normalizeMoveType(raw.moveType),
    originAddress: typeof raw.originAddress === 'string' ? raw.originAddress.trim() : undefined,
    originCity: typeof raw.originCity === 'string' ? raw.originCity.trim() : undefined,
    destAddress: typeof raw.destAddress === 'string' ? raw.destAddress.trim() : undefined,
    destCity: typeof raw.destCity === 'string' ? raw.destCity.trim() : undefined,
    depositConfirmed: typeof raw.depositConfirmed === 'boolean' ? raw.depositConfirmed : undefined,
    depositAmount: parseMaybeNumber(raw.depositAmount),
    depositMethod: typeof raw.depositMethod === 'string' ? raw.depositMethod.trim() : undefined,
  }
}

function mergeLeadField<T>(current: T | undefined, incoming: T | undefined, allowOverwrite: boolean) {
  if (incoming === undefined || incoming === null || incoming === '') {
    return current
  }
  if (!current || allowOverwrite) {
    return incoming
  }
  return current
}

export function applyPhoneCallSummaryToLead(lead: CRMLead, summary: AISummary | null) {
  if (!summary) return lead

  const allowOverwriteMoveDetails = lead.stage !== 'booked'
  const next = normalizeLead({
    ...lead,
    name: mergeLeadField(lead.name, summary.capturedName, allowOverwriteMoveDetails) || lead.name,
    moveDate: mergeLeadField(lead.moveDate, summary.moveDate, allowOverwriteMoveDetails),
    moveDateFlexible:
      summary.moveDate
        ? false
        : summary.moveDateFlexible !== undefined
          ? summary.moveDateFlexible
          : lead.moveDateFlexible,
    moveDateFlexibleReason: mergeLeadField(lead.moveDateFlexibleReason, summary.moveDateFlexibleReason, allowOverwriteMoveDetails),
    moveType: mergeLeadField(lead.moveType, summary.moveType, allowOverwriteMoveDetails),
    originAddress: mergeLeadField(lead.originAddress, summary.originAddress, allowOverwriteMoveDetails),
    originCity: mergeLeadField(lead.originCity, summary.originCity, allowOverwriteMoveDetails),
    destAddress: mergeLeadField(lead.destAddress, summary.destAddress, allowOverwriteMoveDetails),
    destCity: mergeLeadField(lead.destCity, summary.destCity, allowOverwriteMoveDetails),
    depositAmount: summary.depositAmount ?? lead.depositAmount,
    depositMethod: lead.depositMethod || summary.depositMethod,
    depositDate: lead.depositDate || (summary.depositConfirmed ? dateStamp() : lead.depositDate),
    paymentStatus:
      summary.depositConfirmed
        ? (lead.paymentStatus === 'paid_in_full' ? lead.paymentStatus : 'deposit_received')
        : lead.paymentStatus,
    branch:
      lead.branch ||
      detectSalesBranchFromLocation(summary.originAddress, summary.originCity, summary.destAddress, summary.destCity),
  })

  return next
}

export async function summarizePhoneCall(lead: CRMLead, transcript: string, direction: 'inbound' | 'outbound' = 'outbound') {
  const apiKey = getOpenAIKey()
  if (!apiKey || !transcript.trim()) return null
  if (isMeaninglessTranscript(transcript)) return NO_CONVERSATION

  const systemPrompt = `You are an AI moving-sales assistant for Saturn Star Moving. Analyze this phone call transcript and return JSON only.

Today's date: ${new Date().toISOString().slice(0, 10)}. Use this to resolve relative dates like "next Tuesday" or "June 7" into YYYY-MM-DD format.

Return:
{
  "summary": "2-3 sentence call summary",
  "leadConcern": "main concern or objection raised",
  "nextAction": "specific next step for the sales rep",
  "followUpDays": 2,
  "followUpReason": "why that follow-up timing makes sense",
  "coachingTip": "one coaching note for the rep",
  "moveReadiness": "hot|warm|cold",
  "capturedName": "customer name if newly learned or corrected",
  "moveDate": "YYYY-MM-DD if explicit",
  "moveDateFlexible": true,
  "moveDateFlexibleReason": "only if stated",
  "moveType": "residential|commercial|long-distance|senior|labor-only|packing",
  "originAddress": "origin street address if explicit",
  "originCity": "origin city if explicit",
  "destAddress": "destination street address if explicit",
  "destCity": "destination city if explicit",
  "depositConfirmed": true,
  "depositAmount": 500,
  "depositMethod": "etransfer|cash|cheque|credit card|other"
}

Only set depositConfirmed when the caller explicitly says the deposit was paid, sent, received, or confirmed.

Focus on: move scope, objections, budget signals, timeline, route details, and commitment level.`

  const userPrompt = [
    `Lead: ${lead.name || 'Unknown'}`,
    `Phone: ${lead.phone || ''}`,
    `Move Type: ${lead.moveType || ''}`,
    `Direction: ${direction}`,
    lead.originAddress || lead.originCity ? `Origin: ${lead.originAddress || lead.originCity}` : '',
    lead.destAddress || lead.destCity ? `Destination: ${lead.destAddress || lead.destCity}` : '',
    lead.depositAmount ? `Deposit on file: ${lead.depositAmount}` : '',
    lead.paymentStatus ? `Payment status: ${lead.paymentStatus}` : '',
    `Transcript:\n${transcript}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const response = await fetchWithRetry(() =>
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(45_000),
    })
  )

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Phone call summary failed: ${response.status}${detail ? ` ${detail}` : ''}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const content = payload.choices?.[0]?.message?.content || ''
  if (!content) return null

  try {
    return normalizePhoneCallSummary(JSON.parse(content) as Record<string, unknown>)
  } catch {
    return { summary: content }
  }
}

export async function summarizeConsultation(lead: CRMLead, transcript: string, repNotes?: string) {
  const apiKey = getOpenAIKey()
  if (!apiKey || !transcript.trim()) return null
  if (isMeaninglessTranscript(transcript) && !repNotes?.trim()) return NO_CONVERSATION

  const systemPrompt = `You are an AI moving-sales assistant for Saturn Star Moving. Analyze this in-house consultation transcript and return JSON only.

Return:
{
  "summary": "2-4 sentence consultation summary",
  "leadConcern": "main concern or risk",
  "decisionMaker": "who makes the final move decision if known",
  "nextAction": "specific next action for the sales rep",
  "followUpDays": 2,
  "followUpReason": "why that follow-up timing makes sense",
  "coachingTip": "one useful rep coaching note",
  "moveReadiness": "hot|warm|cold"
}

Focus on:
- move scope clarity
- specialty items
- packing needs
- access issues like stairs, elevator, long carry
- quote readiness
- what the rep should do next`

  const userPrompt = [
    `Lead: ${lead.name || 'Unknown'}`,
    `Phone: ${lead.phone || ''}`,
    `Move Type: ${lead.moveType || ''}`,
    `Origin: ${lead.originAddress || ''} ${lead.originCity || ''}`.trim(),
    `Destination: ${lead.destCity || ''}`,
    repNotes?.trim() ? `Rep Notes:\n${repNotes.trim()}` : '',
    `Transcript:\n${transcript}`,
  ].filter(Boolean).join('\n\n')

  const response = await fetchWithRetry(() =>
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 700,
      }),
      signal: AbortSignal.timeout(45_000),
    })
  )

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Consultation summary failed: ${response.status}${detail ? ` ${detail}` : ''}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const content = payload.choices?.[0]?.message?.content || ''
  if (!content) return null

  try {
    return JSON.parse(content) as {
      summary?: string
      leadConcern?: string
      decisionMaker?: string
      nextAction?: string
      followUpDays?: number
      followUpReason?: string
      coachingTip?: string
      moveReadiness?: 'hot' | 'warm' | 'cold'
    }
  } catch {
    return { summary: content }
  }
}
export async function summarizeMessage(
  lead: CRMLead,
  message: string,
  channel: 'sms' | 'email',
  direction: 'inbound' | 'outbound',
  thread?: Array<{ direction: 'inbound' | 'outbound'; text: string; date: string }>
): Promise<AISummary | null> {
  const apiKey = getOpenAIKey()
  if (!apiKey || !message.trim()) return null

  const channelLabel = channel === 'sms' ? 'SMS' : 'Email'

  const systemPrompt = `You are an AI sales coach for Saturn Star Moving. Analyze this ${channelLabel} message in context of the conversation thread and return JSON only.

Return:
{
  "summary": "1-2 sentence plain-English summary of what this message is about and why it matters",
  "sentiment": "positive|neutral|negative",
  "intent": "what the sender is trying to accomplish (e.g. re-engage lead, answer objection, confirm booking)",
  "leadConcern": "any concern or objection detected — omit field entirely if none",
  "nextAction": "best next step for the rep based on this message",
  "coachingTip": "one coaching note for the rep",
  "moveReadiness": "hot|warm|cold"
}

Use the thread context to understand where this message fits in the relationship. Focus on tone, intent, buying signals, objections, urgency.`

  const threadLines = thread && thread.length > 0
    ? thread
        .slice(-10)
        .map(m => `[${m.direction === 'outbound' ? 'Rep' : 'Lead'} — ${new Date(m.date).toLocaleDateString()}]: ${m.text}`)
        .join('\n')
    : null

  const userPrompt = [
    `Lead: ${lead.name || 'Unknown'}`,
    `Channel: ${direction === 'outbound' ? 'Outbound' : 'Inbound'} ${channelLabel}`,
    lead.stage ? `Lead Stage: ${lead.stage}` : '',
    lead.moveType ? `Move Type: ${lead.moveType}` : '',
    lead.originCity ? `Origin: ${lead.originCity}` : '',
    lead.destCity ? `Destination: ${lead.destCity}` : '',
    threadLines ? `\nConversation Thread:\n${threadLines}` : '',
    `\nThis Message (${direction === 'outbound' ? 'Rep → Lead' : 'Lead → Rep'}):\n${message}`,
  ].filter(Boolean).join('\n')

  const response = await fetchWithRetry(() =>
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(45_000),
    })
  )

  if (!response.ok) return null

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content || ''
  if (!content) return null

  try {
    return JSON.parse(content) as AISummary
  } catch {
    return { summary: content }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead Intelligence Synthesis
// Reads ALL signals for a lead and produces a composite intelligence snapshot
// calibrated to Saturn Star's exact sales process and training manual.
// Uses gpt-4o for richer cross-timeline reasoning.
// ─────────────────────────────────────────────────────────────────────────────

export interface IntelligenceSignals {
  smsMessages?: Array<{ direction: 'inbound' | 'outbound'; body: string; created_at: string }>
  emailMessages?: Array<{ direction: 'inbound' | 'outbound'; subject?: string; body_preview?: string; created_at: string }>
  quoteSentAt?: string
  quoteAmount?: number
  quoteStatus?: string
}

export async function synthesizeLeadIntelligence(
  lead: CRMLead,
  signals: IntelligenceSignals = {}
): Promise<LeadIntelligence | null> {
  const apiKey = getOpenAIKey()
  if (!apiKey) return null

  const now = new Date().toISOString()
  const today = now.slice(0, 10)
  const callLogs = (lead.callLogs || []).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  const sms = (signals.smsMessages || []).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const emails = (signals.emailMessages || []).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  const signalCount = callLogs.length + sms.length + emails.length + (lead.inboundMessage ? 1 : 0)

  if (signalCount === 0) {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    return {
      temperature: 'cold',
      bookingProbability: 5,
      nextAction: 'Make first contact',
      nextActionDetail: 'No contact yet. Reach out now — follow the warm opener script. Get name, number, email before anything else.',
      keyInsights: ['No conversations captured yet — this lead has not been contacted'],
      detectedConcerns: [],
      winFactors: [],
      coachingNote: 'First contact is everything. Lead with the warm opener, get their info before you run the MLS scan.',
      processGaps: ['No contact made yet'],
      followUpSchedule: [{
        dueDate: tomorrow,
        channel: 'call',
        script: 'Thank you for calling Saturn Star Movers, this is [Name] speaking. How can I help you today?',
        isCloseAttempt: false,
      }],
      sentimentTrend: 'stable',
      signalSummary: 'No signals captured yet',
      personaBadges: [],
      suggestedSalesLanguage: 'Open warmly, capture the contact info fast, and move straight into scope-building so the customer does not have to drive the process.',
      lastAnalyzedAt: now,
      signalCount: 0,
    }
  }

  // Build the full context string
  const parts: string[] = []

  parts.push(`## Lead Profile (today: ${today})
Name: ${lead.name || 'Unknown'}
Stage: ${lead.stage}
Move type: ${lead.moveType || 'not specified'}
Origin: ${[lead.originAddress, lead.originCity].filter(Boolean).join(', ') || 'unknown'}
Destination: ${[lead.destAddress, lead.destCity].filter(Boolean).join(', ') || 'unknown'}
Move date: ${lead.moveDateFlexible ? 'Flexible / TBD' : lead.moveDate || 'not specified'}
Phone: ${lead.phone || 'not captured'}
Email: ${lead.email || 'NOT CAPTURED — critical gap'}
Assigned rep: ${lead.assignedRep || 'unassigned'}
Lead created: ${lead.createdAt}
Follow-up date on file: ${lead.followUpDate || 'none'}`)

  if (signals.quoteAmount || signals.quoteSentAt) {
    parts.push(`## Quote on File
Amount: $${signals.quoteAmount ?? 'unknown'}
Status: ${signals.quoteStatus || 'unknown'}
Sent: ${signals.quoteSentAt || 'not yet sent'}`)
  }

  if (lead.inboundMessage) {
    parts.push(`## Initial Inquiry (how they first reached us)\n${lead.inboundMessage}`)
  }

  if (callLogs.length > 0) {
    const callTotalSeconds = callLogs.reduce((sum, c) => sum + (c.durationSeconds || 0), 0)
    const callTotalMin = Math.round(callTotalSeconds / 60)
    const callSection = callLogs.map((c, i) => {
      const lines: string[] = [
        `### Call ${i + 1} — ${new Date(c.date).toLocaleDateString('en-CA')} (${c.direction || 'outbound'}, ${c.duration || 'unknown duration'}, source: ${c.source || 'unknown'})`,
      ]
      if (c.isVoicemail) lines.push('⚠ Voicemail — customer did not answer')
      if (c.transcript) lines.push(`Transcript:\n${c.transcript.slice(0, 1500)}${c.transcript.length > 1500 ? '…' : ''}`)
      if (c.aiSummary?.summary) lines.push(`Summary: ${c.aiSummary.summary}`)
      if (c.aiSummary?.leadConcern) lines.push(`Concern raised: ${c.aiSummary.leadConcern}`)
      if (c.aiSummary?.moveReadiness) lines.push(`Readiness signal: ${c.aiSummary.moveReadiness}`)
      if (c.aiSummary?.coachingTip) lines.push(`Coaching: ${c.aiSummary.coachingTip}`)
      return lines.join('\n')
    }).join('\n\n')
    parts.push(`## Call History (${callLogs.length} call${callLogs.length !== 1 ? 's' : ''}, ~${callTotalMin} min total)\n${callSection}`)
  }

  if (sms.length > 0) {
    const smsSection = sms.slice(-40).map(m =>
      `[${new Date(m.created_at).toLocaleDateString('en-CA')} ${m.direction === 'inbound' ? 'CUSTOMER' : 'REP'}]: ${m.body}`
    ).join('\n')
    parts.push(`## SMS Thread (${sms.length} messages — last ${Math.min(sms.length, 40)} shown)\n${smsSection}`)
  }

  if (emails.length > 0) {
    const emailSection = emails.slice(-10).map(m =>
      `[${new Date(m.created_at).toLocaleDateString('en-CA')} ${m.direction === 'inbound' ? 'CUSTOMER' : 'REP'}]${m.subject ? ` — "${m.subject}"` : ''}\n${m.body_preview || '(no preview)'}`
    ).join('\n\n')
    parts.push(`## Email Thread (${emails.length} emails — last ${Math.min(emails.length, 10)} shown)\n${emailSection}`)
  }

  const fullContext = parts.join('\n\n')

  const systemPrompt = `You are the AI sales intelligence system for Saturn Star Moving Company in Windsor, Ontario.

Your job: read every signal from a lead's complete timeline and produce a specific, actionable intelligence snapshot — calibrated to Saturn Star's exact sales process below.

${SATURN_STAR_SALES_PROCESS}

---

IMPORTANT RULES:
- Be specific. If the customer mentioned a piano, quote it. If they said "let me check with my wife," quote it.
- Never use generic placeholder text. Every field should reference actual details from this lead.
- processGaps: identify EXACTLY which steps of the 8-step call framework were missed or not evidenced in the transcripts/SMS. Be honest — missing steps are coaching opportunities.
- suggestedTactic: pick the single most relevant of the 5 closing tactics for right now.
- authorityTakeoverFlag: true ONLY if deal is $1,500+ AND rep is stuck on price and standard rebuttals haven't moved the customer.
- followUpSchedule: generate the next 2-3 specific touches following Saturn Star's cadence. Include the exact script or talking points for each. Mark isCloseAttempt true for any tentative reservation follow-up.
- If email is missing from the lead profile — that is ALWAYS a processGap ("Email not captured — no follow-up path if they go cold").
- Today's date is ${today}.
- LOST IS MANUAL ONLY: never return "lost" as stageSuggestion. If the customer
  appears to have declined, booked elsewhere, paused, or promised to reply
  later, preserve the active stage and recommend a human follow-up/review.

Return JSON only — no explanation outside the JSON:
{
  "temperature": "hot|warm|cold",
  "bookingProbability": <0-100>,
  "stageSuggestion": "<valid stage or null>",
  "stageSuggestionReason": "<specific reason referencing the conversation>",
  "followUpAt": "<ISO datetime if specific time mentioned, else null>",
  "followUpNote": "<exactly what to say/do, drawn from conversation context>",
  "nextAction": "<3-6 word action label>",
  "nextActionDetail": "<1-2 sentences of specific rep guidance — quote actual conversation details>",
  "keyInsights": ["<specific insight with real detail>", ...],
  "detectedConcerns": ["<verbatim or paraphrased concern from conversation>", ...],
  "winFactors": ["<specific positive buying signal>", ...],
  "coachingNote": "<one coaching observation tied to Saturn Star process — what did the rep do well or miss?>",
  "processGaps": ["<specific step missed from 8-step framework>", ...],
  "suggestedTactic": "<name of the most relevant closing tactic and why>",
  "authorityTakeoverFlag": <true|false>,
  "followUpSchedule": [
    {
      "dueDate": "<YYYY-MM-DD>",
      "channel": "call|sms|email",
      "script": "<exact message or talking points to use>",
      "isCloseAttempt": <true|false>
    },
    ...
  ],
  "sentimentTrend": "improving|stable|declining",
  "signalSummary": "<narrative: X calls (~Y min), Z SMS, W emails. Last contact: [date].>",
  "personaBadges": [
    {
      "label": "<one of: In-Person Preferred, Digital Skeptic, Price Sensitive, Fast Mover, Needs Reassurance, Senior / Low Tech, Comparing Quotes, Spouse Decision, Wants Callback, Not Ready Yet, Hot Buyer, Realtor Gatekeeper, Access Concern, Date Flexible, High Intent, Cold / Ghosting>",
      "confidence": <0-100>,
      "source": "<where this came from, like Call transcript or SMS thread>",
      "lastUpdated": "<ISO datetime>",
      "explanation": "<1 short sentence explaining the badge>"
    }
  ],
  "suggestedSalesLanguage": "<1-2 sentences telling the rep how to speak to this customer right now>"
}

Valid suggested stages: new, contacted, estimate_scheduled, estimate_completed, pricing, quoted, nurture, booked`

  const response = await fetchWithRetry(() =>
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fullContext },
        ],
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(60_000),
    })
  )

  if (!response.ok) return null

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = payload.choices?.[0]?.message?.content || ''
  if (!content) return null

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>

    const followUpSchedule: LeadIntelligenceFollowUp[] = Array.isArray(parsed.followUpSchedule)
      ? (parsed.followUpSchedule as Array<Record<string, unknown>>).map(f => ({
          dueDate: String(f.dueDate || today),
          channel: (['call', 'sms', 'email'].includes(String(f.channel)) ? f.channel : 'call') as LeadIntelligenceFollowUp['channel'],
          script: String(f.script || ''),
          isCloseAttempt: Boolean(f.isCloseAttempt),
        }))
      : []

    const personaBadges: LeadPersonaBadge[] = Array.isArray(parsed.personaBadges)
      ? (parsed.personaBadges as Array<Record<string, unknown>>)
        .map(item => ({
          label: String(item.label || '').trim(),
          confidence: Math.min(100, Math.max(0, Number(item.confidence || 0) || 0)),
          source: String(item.source || 'AI synthesis').trim() || 'AI synthesis',
          lastUpdated: String(item.lastUpdated || now),
          explanation: String(item.explanation || '').trim(),
        }))
        .filter(item => item.label && item.explanation)
        .slice(0, 3)
      : []

    return {
      temperature: (['hot', 'warm', 'cold'].includes(String(parsed.temperature)) ? parsed.temperature : 'cold') as LeadIntelligence['temperature'],
      bookingProbability: typeof parsed.bookingProbability === 'number' ? Math.min(100, Math.max(0, parsed.bookingProbability)) : 10,
      stageSuggestion: sanitizeAutomatedStageSuggestion(parsed.stageSuggestion),
      stageSuggestionReason: parsed.stageSuggestionReason ? String(parsed.stageSuggestionReason) : undefined,
      followUpAt: parsed.followUpAt ? String(parsed.followUpAt) : undefined,
      followUpNote: parsed.followUpNote ? String(parsed.followUpNote) : undefined,
      nextAction: parsed.nextAction ? String(parsed.nextAction) : 'Review lead',
      nextActionDetail: parsed.nextActionDetail ? String(parsed.nextActionDetail) : undefined,
      keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights.map(String) : [],
      detectedConcerns: Array.isArray(parsed.detectedConcerns) ? parsed.detectedConcerns.map(String) : [],
      winFactors: Array.isArray(parsed.winFactors) ? parsed.winFactors.map(String) : [],
      coachingNote: parsed.coachingNote ? String(parsed.coachingNote) : undefined,
      processGaps: Array.isArray(parsed.processGaps) ? parsed.processGaps.map(String) : [],
      suggestedTactic: parsed.suggestedTactic ? String(parsed.suggestedTactic) : undefined,
      authorityTakeoverFlag: Boolean(parsed.authorityTakeoverFlag),
      followUpSchedule,
      sentimentTrend: (['improving', 'stable', 'declining'].includes(String(parsed.sentimentTrend)) ? parsed.sentimentTrend : 'stable') as LeadIntelligence['sentimentTrend'],
      signalSummary: parsed.signalSummary ? String(parsed.signalSummary) : `${signalCount} signal${signalCount !== 1 ? 's' : ''} captured`,
      personaBadges,
      suggestedSalesLanguage: parsed.suggestedSalesLanguage ? String(parsed.suggestedSalesLanguage) : undefined,
      lastAnalyzedAt: now,
      signalCount,
    }
  } catch {
    return null
  }
}
