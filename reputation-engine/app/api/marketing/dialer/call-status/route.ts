import { partnershipCallNeedsFallback } from '@/lib/partner-call-fallback'
import { partnershipSalesFallbackXml } from '@/lib/server/partner-call-fallback'
import { queueMissedPartnershipCall } from '@/lib/server/partner-sales-handoff'
import { queuePartnershipCallAlert, type PartnershipCallContact, type PartnershipCallContractor } from '@/lib/server/partnership-call-alert'
import { normalizePhone as normalizeAddress } from '@/lib/sales-phones'
import { createHash } from 'node:crypto'
import { carrierVoiceForm } from '@/lib/server/carrier-voice'
import { authorizeTwilioWebhook } from '@/lib/server/security'
import { captureTwilioInteraction } from '@/lib/server/interactions'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { PARTNERSHIP_LINES, isPartnershipSenderNumber } from '@/lib/partnership-lines'

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

function normalizePhone(value?: string | null) {
  try { const phone = normalizeAddress(value); return /^\+1\d{10}$/.test(phone) ? phone : '' } catch { return '' }
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
  const isOutbound = direction.startsWith('outbound')
  const contactPhone = normalizePhone(isOutbound ? to : from)
  const partnershipNumber = normalizePhone(isOutbound ? from : to)

  if (!callSid || !contactPhone || !isPartnershipSenderNumber(partnershipNumber) || !['completed', 'no-answer', 'busy', 'failed', 'canceled'].includes(callStatus)) {
    return twimlCompleteResponse()
  }

  const shouldFallback = partnershipCallNeedsFallback({dialStatus:formData.get('DialCallStatus') || '',direction,alreadyFallback:new URL(request.url).searchParams.get('salesFallback')==='1'})
  const line = partnershipLineForNumber(partnershipNumber)
  if (!line) return twimlCompleteResponse()
  const { label: lineLabel, market } = line
  const rawDuration = Number.parseInt(callDuration, 10)
  const durationSec = Number.isFinite(rawDuration) ? Math.max(0, rawDuration) : 0
  async function completeResponse(contact: PartnershipCallContact | null = null, identity: 'matched' | 'unknown' | 'ambiguous' | 'lookup_failed' = 'unknown', contractor: PartnershipCallContractor | null = null) {
    if(shouldFallback){
      try{const xml=await partnershipSalesFallbackXml(contactPhone,partnershipNumber);if(xml)return new Response(xml,{headers:{'Content-Type':'text/xml; charset=utf-8'}})}catch(error){console.error('Partnership Sales fallback unavailable',error)}
    }
    if (!isOutbound) {
      await queuePartnershipCallAlert({ callSid, caller: contactPhone, line: partnershipNumber, lineLabel, market,
        status: callStatus, durationSeconds: durationSec, occurredAt: now, contact, contractor, identity })
    }
    if(!isOutbound && ['no-answer','busy','failed','canceled'].includes(callStatus)) {
      await queueMissedPartnershipCall(contact?.id || null,callSid,contactPhone).catch(error=>console.error('Missed partnership callback task failed',error))
    }
    return twimlCompleteResponse()
  }
  const { url, headers } = requireSupabaseEnv()

  // Find the contact by phone
  const digits = contactPhone.replace(/\D/g, '').slice(-10)
  let contacts: PartnershipCallContact[] = [], lookupFailed = false
  try {
    const contactRes = await fetch(
      `${url}/rest/v1/market_contacts?phone=ilike.*${digits.slice(-4)}*&select=id,name,company,phone,city,stage,sequence_paused&limit=101`,
      { headers, cache: 'no-store' }
    )
    if (!contactRes.ok) throw Error('Contact lookup failed')
    const result = await contactRes.json()
    if (!Array.isArray(result)) throw Error('Invalid contact lookup response')
    contacts = result
  } catch { lookupFailed = true }
  // The caller can live in another market. Only a unique normalized phone match
  // establishes contact identity; neither line geography nor first result does.
  const exactMatches = contacts.filter(item => normalizePhone(item.phone) === contactPhone)
  const contact = !lookupFailed && contacts.length < 101 && exactMatches.length === 1 ? exactMatches[0] : null
  if (!contact) {
    if (lookupFailed) return completeResponse(null, 'lookup_failed')
    if (exactMatches.length > 1 || contacts.length >= 101) return completeResponse(null, 'ambiguous')
    // Subcontractors have their own saved identity and workspace. Recognize
    // those callers without creating a duplicate relationship contact or lead.
    try {
      const response = await fetch(`${url}/rest/v1/subcontractors?phone=ilike.*${digits.slice(-4)}*&select=id,company_name,contact_name,phone&limit=101`, { headers, cache: 'no-store' })
      if (!response.ok) throw Error('Subcontractor lookup failed')
      const rows = await response.json() as PartnershipCallContractor[]
      if (!Array.isArray(rows)) throw Error('Invalid subcontractor lookup response')
      const matches = rows.filter(item => normalizePhone(item.phone) === contactPhone)
      if (rows.length >= 101 || matches.length > 1) return completeResponse(null, 'ambiguous')
      if (matches.length === 1) return completeResponse(null, 'matched', matches[0])
    } catch { return completeResponse(null, 'lookup_failed') }
    return completeResponse(null, 'unknown')
  }

  const connected = callStatus === 'completed' && (formData.get('DialBridged') === 'true' || durationSec > 0)
  const noAnswer = ['no-answer', 'busy', 'failed', 'canceled'].includes(callStatus)

  const notes = connected
    ? `Partnership call — ${durationSec}s · ${isOutbound ? 'Outbound' : 'Inbound'} · ${callSid}`
    : `Partnership call attempt — ${callStatus} · ${isOutbound ? 'Outbound' : 'Inbound'}`

  const touchKey = createHash('sha256').update(`${callSid}:${formData.get('DialCallSid') || 'root'}:${callStatus}`).digest('hex')
  const touchId = `${touchKey.slice(0,8)}-${touchKey.slice(8,12)}-4${touchKey.slice(13,16)}-a${touchKey.slice(17,20)}-${touchKey.slice(20,32)}`
  await fetch(`${url}/rest/v1/market_touches?on_conflict=id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      id: touchId, contact_id: contact.id,
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
      phone: contactPhone,
      occurredAt: now,
      notes,
    }).catch(() => {})
  }

  // This route is also the <Dial action>. Twilio expects valid TwiML here;
  // an empty 204 makes it announce "An application error has occurred"
  // after an otherwise successful call.
  return completeResponse(contact, 'matched')
}
