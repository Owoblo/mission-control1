import { partnershipCallNeedsFallback } from '@/lib/partner-call-fallback'
import { partnershipSalesFallbackXml } from '@/lib/server/partner-call-fallback'
import { queueMissedPartnershipCall } from '@/lib/server/partner-sales-handoff'
import { carrierVoiceForm } from '@/lib/server/carrier-voice'
import { authorizeTwilioWebhook } from '@/lib/server/security'
import { captureTwilioInteraction } from '@/lib/server/interactions'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { PARTNERSHIP_LINES, isPartnershipSenderNumber, normalizePartnershipCityKey } from '@/lib/partnership-lines'

export const dynamic = 'force-dynamic'

function twimlCompleteResponse() {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

function partnershipLineForNumber(value?: string | null) {
  const normalized = String(value || '').replace(/\D/g, '')
  const e164 = normalized.length === 10 ? `+1${normalized}` : normalized.length === 11 && normalized.startsWith('1') ? `+${normalized}` : value || ''
  return PARTNERSHIP_LINES.find(line => line.number === e164) || null
}

function contactMatchesLine(contact: { city?: string | null }, dialedNumber?: string | null) {
  const line = partnershipLineForNumber(dialedNumber)
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

export async function POST(request: Request) {
  const rawBody = await request.text()
    const rejection = await authorizeTwilioWebhook(request, rawBody)
    if (rejection) return rejection
    await captureTwilioInteraction(rawBody, 'partnership_call_status', 'call')
    const formData = carrierVoiceForm(rawBody)
  const callStatus = (formData.get('DialCallStatus') || formData.get('CallStatus') || '')
  const from = (formData.get('From') as string | null) ?? ''
  const to = (formData.get('To') as string | null) ?? ''
  const callSid = (formData.get('CallSid') as string | null) ?? ''
  const callDuration = (formData.get('DialCallDuration') || formData.get('CallDuration') || '0')
  const direction = (formData.get('Direction') as string | null) ?? ''

  const now = new Date().toISOString()
  const isOutbound = direction === 'outbound-api' || direction === 'outbound-dial'
  const contactPhone = normalizePhone(isOutbound ? to : from)
  const partnershipNumber = normalizePhone(isOutbound ? from : to)

  if (!contactPhone || !isPartnershipSenderNumber(partnershipNumber) || callStatus === 'initiated' || callStatus === 'ringing') {
    return twimlCompleteResponse()
  }

  const shouldFallback = partnershipCallNeedsFallback({dialStatus:formData.get('DialCallStatus') || '',direction,alreadyFallback:new URL(request.url).searchParams.get('salesFallback')==='1'})
  async function completeResponse(contactId: string | null = null) {
    if(shouldFallback){
      try{const xml=await partnershipSalesFallbackXml(contactPhone,partnershipNumber);if(xml)return new Response(xml,{headers:{'Content-Type':'text/xml; charset=utf-8'}})}catch(error){console.error('Partnership Sales fallback unavailable',error)}
    }
    if(!isOutbound && ['no-answer','busy','failed','canceled'].includes(callStatus)) {
      await queueMissedPartnershipCall(contactId,callSid,contactPhone).catch(error=>console.error('Missed partnership callback task failed',error))
    }
    return twimlCompleteResponse()
  }
  const { url, headers } = requireSupabaseEnv()

  // Find the contact by phone
  const digits = contactPhone.replace(/\D/g, '').slice(-10)
  const contactRes = await fetch(
    `${url}/rest/v1/market_contacts?phone=ilike.*${digits}&select=id,name,phone,city,stage,sequence_paused&limit=20`,
    { headers, cache: 'no-store' }
  )
  const contacts = (contactRes.ok ? await contactRes.json() : []) as Array<{ id: string; name: string; phone: string | null; city: string | null; stage: string; sequence_paused: boolean }>
  const exactMatches = contacts.filter(item => normalizePhone(item.phone) === contactPhone && contactMatchesLine(item, partnershipNumber))
  const contact = exactMatches.length === 1 ? exactMatches[0] : null

  if (!contact) return completeResponse()

  const durationSec = parseInt(callDuration, 10)
  const connected = callStatus === 'completed' && durationSec > 5
  const noAnswer = ['no-answer', 'busy', 'failed', 'canceled'].includes(callStatus)

  const notes = connected
    ? `Partnership call — ${durationSec}s · ${isOutbound ? 'Outbound' : 'Inbound'} · ${callSid}`
    : `Partnership call attempt — ${callStatus} · ${isOutbound ? 'Outbound' : 'Inbound'}`

  await fetch(`${url}/rest/v1/market_touches`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      contact_id: contact.id,
      channel: 'phone',
      direction: isOutbound ? 'outbound' : 'inbound',
      notes,
      outcome_code: connected ? 'call_connected' : noAnswer ? 'no_answer' : null,
      created_by: 'System',
      created_at: now,
      metadata: { call_sid: callSid, call_status: callStatus, duration_seconds: durationSec },
    }),
  })

  await fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ last_touch_at: now }),
  })

  // If inbound call and connected, pause the sequence
  if (!isOutbound && connected) {
    void pausePartnershipSequenceForInbound({
      channel: 'phone',
      phone: from,
      occurredAt: now,
      notes,
    }).catch(() => {})
  }

  // This route is also the <Dial action>. Twilio expects valid TwiML here;
  // an empty 204 makes it announce "An application error has occurred"
  // after an otherwise successful call.
  return completeResponse(contact.id)
}
