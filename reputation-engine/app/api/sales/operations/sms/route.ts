/**
 * POST /api/sales/operations/sms
 * Handles inbound SMS to the operations number (+12267746581).
 * Logs to sms_messages table (shows in ops SMS view) but does NOT
 * trigger lead automation — this is internal ops communication.
 */
import { readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import { twilioAuth } from '@/lib/server/twilio-recordings'

const OPS_NUMBER = '+12267746581'

async function verifyTwilioSignature(request: Request, rawBody: string): Promise<boolean> {
  const authToken = readEnv('TWILIO_AUTH_TOKEN')
  if (!authToken) return true

  const signature = request.headers.get('x-twilio-signature') || ''
  if (!signature) return false

  const params: Record<string, string> = {}
  new URLSearchParams(rawBody).forEach((value, key) => { params[key] = value })
  const sortedKeys = Object.keys(params).sort()
  const valueString = sortedKeys.reduce((acc, key) => acc + key + params[key], request.url)

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(valueString))
  const expected = btoa(Array.from(new Uint8Array(signatureBuffer)).map(byte => String.fromCharCode(byte)).join(''))
  return signature === expected
}

type TwilioMessageLookup = {
  sid?: string
  from?: string
  to?: string
  body?: string
  direction?: string
  account_sid?: string
}

function toE164(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

function normalizeTwilioBody(value: string | null) {
  return (value || '').replace(/\r\n/g, '\n').trim()
}

async function fetchTwilioMessageBySid(messageSid: string) {
  const accountSid = readEnv('TWILIO_ACCOUNT_SID')
  const authToken = readEnv('TWILIO_AUTH_TOKEN')
  if (!accountSid) return null

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${encodeURIComponent(messageSid)}.json`,
      {
        headers: {
          Authorization: twilioAuth(accountSid, authToken),
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      }
    )
    if (!response.ok) return null
    return response.json() as Promise<TwilioMessageLookup>
  } catch {
    return null
  }
}

async function verifyTwilioMessageSidFallback(formData: URLSearchParams): Promise<boolean> {
  const accountSid = readEnv('TWILIO_ACCOUNT_SID')
  const inboundAccountSid = (formData.get('AccountSid') ?? '').trim()
  const messageSid = (formData.get('MessageSid') ?? formData.get('SmsSid') ?? '').trim()
  const from = toE164((formData.get('From') ?? '').trim())
  const to = toE164((formData.get('To') ?? '').trim())
  const body = normalizeTwilioBody(formData.get('Body'))

  if (!accountSid || !messageSid || !from || !to) return false
  if (inboundAccountSid && inboundAccountSid !== accountSid) return false

  const twilioMessage = await fetchTwilioMessageBySid(messageSid)
  if (!twilioMessage?.sid || twilioMessage.sid !== messageSid) return false
  if (twilioMessage.account_sid && twilioMessage.account_sid !== accountSid) return false
  if (!twilioMessage.direction?.startsWith('inbound')) return false

  return (
    toE164(twilioMessage.from || '') === from &&
    toE164(twilioMessage.to || '') === to &&
    normalizeTwilioBody(twilioMessage.body ?? '') === body
  )
}

function extractMedia(formData: URLSearchParams) {
  const count = Number(formData.get('NumMedia') || 0)
  const media: Array<{ url: string; contentType?: string }> = []
  for (let i = 0; i < count; i++) {
    const url = (formData.get(`MediaUrl${i}`) || '').trim()
    const ct = (formData.get(`MediaContentType${i}`) || '').trim()
    if (url) media.push({ url, ...(ct ? { contentType: ct } : {}) })
  }
  return media
}

async function writeSmsMessage(from: string, body: string, messageSid: string, media: Array<{ url: string; contentType?: string }>) {
  try {
    const { url, headers } = requireSupabaseEnv()
    if (messageSid) {
      const existing = await fetch(
        `${url}/rest/v1/sms_messages?select=id&twilio_sid=eq.${encodeURIComponent(messageSid)}&limit=1`,
        { headers, cache: 'no-store' }
      )
      if (existing.ok) {
        const rows = (await existing.json()) as Array<{ id: string }>
        if (rows.length > 0) return
      }
    }
    // Append media URLs to body for display
    const mediaText = media.length > 0 ? `\n[MMS: ${media.map(m => m.url).join(', ')}]` : ''
    await fetch(`${url}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        from_number: from,
        to_number: OPS_NUMBER,
        body: body + mediaText,
        direction: 'inbound',
        lead_id: null,
        twilio_sid: messageSid || null,
        created_at: new Date().toISOString(),
      }),
    })
  } catch {
    // non-fatal
  }
}

export async function GET() {
  return Response.json({ ok: true, route: 'operations-sms' })
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const formData = new URLSearchParams(rawBody)
    const signatureValid = await verifyTwilioSignature(request, rawBody)
    const sidFallbackValid = signatureValid ? false : await verifyTwilioMessageSidFallback(formData)
    if (!signatureValid && !sidFallbackValid) {
      return new Response('Forbidden', { status: 403 })
    }

    const from = toE164((formData.get('From') ?? '').trim())
    const body = (formData.get('Body') ?? '').trim()
    const messageSid = (formData.get('MessageSid') ?? formData.get('SmsSid') ?? '').trim()
    const media = extractMedia(formData)
    const messageText = body || (media.length > 0 ? `(${media.length} attachment${media.length > 1 ? 's' : ''})` : '(no body)')

    if (from) {
      await writeSmsMessage(from, messageText, messageSid, media)
    }
  } catch {
    // always return 200 to Twilio
  }

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}
