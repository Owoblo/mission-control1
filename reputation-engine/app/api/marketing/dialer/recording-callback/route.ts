/**
 * POST /api/marketing/dialer/recording-callback
 * Twilio calls this when a partnership call recording is ready.
 * Downloads the recording → transcribes via OpenAI Whisper → AI summary → saves to contact timeline.
 */
import { requireSupabaseEnv, readEnv } from '@/lib/server/runtime'
import { verifyTwilioSignature } from '@/lib/server/security'
import { PARTNERSHIP_LINES, isPartnershipSenderNumber, normalizePartnershipCityKey } from '@/lib/partnership-lines'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function partnershipLineForNumber(value?: string | null) {
  const normalized = String(value || '').replace(/\D/g, '')
  const e164 = normalized.length === 10 ? `+1${normalized}` : normalized.length === 11 && normalized.startsWith('1') ? `+${normalized}` : value || ''
  return PARTNERSHIP_LINES.find(line => line.number === e164) || null
}

function contactMatchesLine(contact: { city?: string | null }, partnershipNumber?: string | null) {
  const line = partnershipLineForNumber(partnershipNumber)
  if (!line) return true
  const cityKey = normalizePartnershipCityKey(contact.city)
  return line.cityKeys.some(city => normalizePartnershipCityKey(city) === cityKey)
}

function normalizePhone(value?: string | null) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return ''
}

async function transcribeRecording(recordingUrl: string, authHeader: string): Promise<string | null> {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) return null

  try {
    // Download the recording from Twilio
    const audioRes = await fetch(`${recordingUrl}.mp3`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(30000),
    })
    if (!audioRes.ok) return null

    const audioBuffer = await audioRes.arrayBuffer()
    const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' })

    const formData = new FormData()
    formData.append('file', audioBlob, 'recording.mp3')
    formData.append('model', 'whisper-1')
    formData.append('language', 'en')

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(30000),
    })

    if (!whisperRes.ok) return null
    const data = await whisperRes.json() as { text?: string }
    return data.text || null
  } catch {
    return null
  }
}

async function summarizeTranscript(transcript: string, contactName: string): Promise<string | null> {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) return null

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `You are summarizing a partnership outreach call from Saturn Star Movers to ${contactName || 'a prospect'}.

Transcript:
${transcript.slice(0, 3000)}

Provide a 3-bullet summary:
• Outcome: (e.g. "Interested — wants more info", "Voicemail left", "Not interested", "Appointment booked")
• Key details: (what they said, objections, interest level)
• Next step: (what should happen next)

Keep each bullet to one sentence. Be direct.`,
        }],
        max_tokens: 200,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) return null
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content || null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    if (!(await verifyTwilioSignature(request, rawBody))) {
      return new Response('Forbidden', { status: 403 })
    }

    const formData = new URLSearchParams(rawBody)
    const callSid = formData.get('CallSid') || ''
    const recordingSid = formData.get('RecordingSid') || ''
    const recordingUrl = formData.get('RecordingUrl') || ''
    const recordingDuration = parseInt(formData.get('RecordingDuration') || '0', 10)
    const callbackUrl = new URL(request.url)
    const from = formData.get('From') || ''
    const to = formData.get('To') || ''

    if (!recordingUrl || recordingDuration < 5) {
      return new Response(null, { status: 204 })
    }

    const { url, headers } = requireSupabaseEnv()
    const accountSid = readEnv('TWILIO_ACCOUNT_SID')
    const authToken = readEnv('TWILIO_AUTH_TOKEN')
    const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`

    const signedCustomerNumber = normalizePhone(callbackUrl.searchParams.get('customer'))
    const signedPartnershipNumber = normalizePhone(callbackUrl.searchParams.get('line'))
    const signedDirection = callbackUrl.searchParams.get('direction')
    const fromIsPartnership = isPartnershipSenderNumber(from)
    const toIsPartnership = isPartnershipSenderNumber(to)
    const partnershipNumber = signedPartnershipNumber || (fromIsPartnership ? normalizePhone(from) : toIsPartnership ? normalizePhone(to) : '')
    const customerNumber = signedCustomerNumber || normalizePhone(fromIsPartnership ? to : from)
    const isOutbound = signedDirection === 'outbound' || (!signedDirection && fromIsPartnership)

    // Twilio may omit From/To on a child recording callback. Never allow an
    // empty phone search to select the first partnership contact in the table.
    if (!customerNumber || !partnershipNumber || !isPartnershipSenderNumber(partnershipNumber)) {
      return new Response(null, { status: 204 })
    }

    const contactPhone = customerNumber.replace(/\D/g, '').slice(-10)
    const contactRes = await fetch(
      `${url}/rest/v1/market_contacts?phone=ilike.*${contactPhone}&select=id,name,company,city,phone&limit=20`,
      { headers, cache: 'no-store' }
    )
    const contacts = contactRes.ok ? await contactRes.json() as Array<{ id: string; name: string; company: string; city: string | null; phone?: string | null }> : []
    const exactMatches = contacts.filter(item => normalizePhone(item.phone) === customerNumber && contactMatchesLine(item, partnershipNumber))
    const contact = exactMatches.length === 1 ? exactMatches[0] : null

    if (!contact) return new Response(null, { status: 204 })

    const now = new Date().toISOString()

    // Transcribe + summarize
    const [transcript, summary] = await Promise.all([
      transcribeRecording(recordingUrl, authHeader),
      Promise.resolve(null), // summary depends on transcript
    ])

    const aiSummary = transcript ? await summarizeTranscript(transcript, contact.name) : null

    const notes = [
      `Call recorded — ${Math.floor(recordingDuration / 60)}m ${recordingDuration % 60}s`,
      aiSummary ? `\n\n${aiSummary}` : '',
      transcript ? `\n\nTranscript:\n${transcript.slice(0, 1000)}${transcript.length > 1000 ? '…' : ''}` : '',
    ].join('')

    await fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: contact.id,
        channel: 'phone',
        direction: isOutbound ? 'outbound' : 'inbound',
        notes,
        outcome_code: aiSummary?.toLowerCase().includes('voicemail') ? 'voicemail' :
          aiSummary?.toLowerCase().includes('not interested') ? 'not_interested' :
          aiSummary?.toLowerCase().includes('appointment') ? 'meeting_booked' :
          aiSummary?.toLowerCase().includes('interested') ? 'replied_positive' : 'call_connected',
        created_by: 'System',
        created_at: now,
        metadata: {
          call_sid: callSid,
          recording_sid: recordingSid,
          recording_url: recordingUrl,
          duration_seconds: recordingDuration,
          from: from || (isOutbound ? partnershipNumber : customerNumber),
          to: to || (isOutbound ? customerNumber : partnershipNumber),
        },
      }),
    })

    await fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ last_touch_at: now }),
    })

    return new Response(null, { status: 204 })
  } catch {
    return new Response(null, { status: 204 })
  }
}
