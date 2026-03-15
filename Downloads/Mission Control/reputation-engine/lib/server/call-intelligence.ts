import type { CRMLead } from '@/lib/types'

function getOpenAIKey() {
  return process.env.OPENAI_API_KEY || ''
}

function parseAudioDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
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
  const form = new FormData()
  form.append('file', new File([bytes], `consultation.${ext}`, { type: mimeType }))
  form.append('model', 'whisper-1')
  form.append('language', 'en')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Consultation transcription failed: ${response.status}${detail ? ` ${detail}` : ''}`)
  }

  const payload = (await response.json()) as { text?: string }
  return payload.text?.trim() || null
}

export async function transcribeFromUrl(audioUrl: string, accountSid: string, authToken: string) {
  const apiKey = getOpenAIKey()
  if (!apiKey) return null

  const audioResponse = await fetch(audioUrl, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
    },
  })

  if (!audioResponse.ok) {
    throw new Error(`Failed to download recording: ${audioResponse.status}`)
  }

  const buffer = Buffer.from(await audioResponse.arrayBuffer())
  const form = new FormData()
  form.append('file', new File([buffer], 'call.mp3', { type: 'audio/mpeg' }))
  form.append('model', 'whisper-1')
  form.append('language', 'en')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Phone call transcription failed: ${response.status}${detail ? ` ${detail}` : ''}`)
  }

  const payload = (await response.json()) as { text?: string }
  return payload.text?.trim() || null
}

export async function summarizePhoneCall(lead: CRMLead, transcript: string, direction: 'inbound' | 'outbound' = 'outbound') {
  const apiKey = getOpenAIKey()
  if (!apiKey || !transcript.trim()) return null

  const systemPrompt = `You are an AI moving-sales assistant for Saturn Star Moving. Analyze this phone call transcript and return JSON only.

Return:
{
  "summary": "2-3 sentence call summary",
  "leadConcern": "main concern or objection raised",
  "nextAction": "specific next step for the sales rep",
  "followUpDays": 2,
  "followUpReason": "why that follow-up timing makes sense",
  "coachingTip": "one coaching note for the rep",
  "moveReadiness": "hot|warm|cold"
}

Focus on: move scope, objections, budget signals, timeline, and commitment level.`

  const userPrompt = [
    `Lead: ${lead.name || 'Unknown'}`,
    `Phone: ${lead.phone || ''}`,
    `Move Type: ${lead.moveType || ''}`,
    `Direction: ${direction}`,
    lead.originCity ? `Origin: ${lead.originCity}` : '',
    lead.destCity ? `Destination: ${lead.destCity}` : '',
    `Transcript:\n${transcript}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
  })

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
    return JSON.parse(content) as {
      summary?: string
      leadConcern?: string
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

export async function summarizeConsultation(lead: CRMLead, transcript: string, repNotes?: string) {
  const apiKey = getOpenAIKey()
  if (!apiKey || !transcript.trim()) return null

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

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
  })

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
