/**
 * POST /api/marketing/dialer/recording-callback
 * Twilio calls this when a partnership call recording is ready.
 * Downloads the recording → transcribes via OpenAI Whisper → AI summary → saves to contact timeline.
 */
import { NextResponse } from 'next/server'
import { requireSupabaseEnv, readEnv } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
    const formData = await request.formData()
    const callSid = (formData.get('CallSid') as string | null) || ''
    const recordingSid = (formData.get('RecordingSid') as string | null) || ''
    const recordingUrl = (formData.get('RecordingUrl') as string | null) || ''
    const recordingDuration = parseInt((formData.get('RecordingDuration') as string | null) || '0', 10)
    const from = (formData.get('From') as string | null) || ''
    const to = (formData.get('To') as string | null) || ''

    if (!recordingUrl || recordingDuration < 5) {
      return new Response('', { status: 204 })
    }

    const { url, headers } = requireSupabaseEnv()
    const accountSid = readEnv('TWILIO_ACCOUNT_SID')
    const authToken = readEnv('TWILIO_AUTH_TOKEN')
    const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`

    // Find the contact by phone number (to = partnership number, from = contact)
    const contactPhone = from.replace(/\D/g, '').replace(/^1/, '')
    const contactRes = await fetch(
      `${url}/rest/v1/market_contacts?phone=ilike.*${contactPhone}&select=id,name,company&limit=1`,
      { headers, cache: 'no-store' }
    )
    const [contact] = contactRes.ok ? await contactRes.json() as Array<{ id: string; name: string; company: string }> : []

    if (!contact) return new Response('', { status: 204 })

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
        direction: 'outbound',
        notes,
        outcome_code: aiSummary?.toLowerCase().includes('voicemail') ? 'voicemail' :
          aiSummary?.toLowerCase().includes('not interested') ? 'not_interested' :
          aiSummary?.toLowerCase().includes('appointment') ? 'meeting_booked' :
          aiSummary?.toLowerCase().includes('interested') ? 'replied_positive' : 'call_connected',
        created_by: 'System',
        created_at: now,
        metadata: { call_sid: callSid, recording_sid: recordingSid, recording_url: recordingUrl, duration_seconds: recordingDuration },
      }),
    })

    await fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ last_touch_at: now }),
    })

    return new Response('', { status: 204 })
  } catch {
    return new Response('', { status: 204 })
  }
}
