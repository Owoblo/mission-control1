import { carrierVoiceForm } from '@/lib/server/carrier-voice'
import { captureTwilioInteraction } from '@/lib/server/interactions'
import { authorizeTwilioWebhook } from '@/lib/server/security'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { PARTNERSHIP_LINES, isPartnershipSenderNumber } from '@/lib/partnership-lines'
import {
  getPartnershipAlertRecipients,
  partnershipInboundCallNotificationEmail,
  sendRepAlertEmail,
} from '@/lib/server/internal-notifications'

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
  const callStatus = (formData.get('CallStatus') as string | null) ?? ''
  const from = (formData.get('From') as string | null) ?? ''
  const to = (formData.get('To') as string | null) ?? ''
  const callSid = (formData.get('CallSid') as string | null) ?? ''
  const callDuration = (formData.get('CallDuration') as string | null) ?? '0'
  const direction = (formData.get('Direction') as string | null) ?? ''
  const dialCallStatus = (formData.get('DialCallStatus') as string | null) ?? ''
  const dialDurationRaw = (formData.get('DialCallDuration') as string | null) ?? callDuration
  const dialBridged = (formData.get('DialBridged') as string | null) === 'true'

  const now = new Date().toISOString()
  const isOutbound = direction === 'outbound-api' || direction === 'outbound-dial'
  const contactPhone = normalizePhone(isOutbound ? to : from)
  const partnershipNumber = normalizePhone(isOutbound ? from : to)

  const outcomeStatus = dialCallStatus || callStatus
  const terminalStatuses = new Set(['completed', 'no-answer', 'busy', 'failed', 'canceled'])
  if (!contactPhone || !isPartnershipSenderNumber(partnershipNumber) || !terminalStatuses.has(outcomeStatus)) {
    return twimlCompleteResponse()
  }

  const partnershipLine = partnershipLineForNumber(partnershipNumber)
  const durationSec = Number.parseInt(dialDurationRaw, 10) || 0
  const connected = outcomeStatus === 'completed' && (dialBridged || durationSec > 5)
  const noAnswer = ['no-answer', 'busy', 'failed', 'canceled'].includes(outcomeStatus)

  const { url, headers } = requireSupabaseEnv()

  // Find the contact by phone
  const digits = contactPhone.replace(/\D/g, '').slice(-10)
  const contactRes = await fetch(
    `${url}/rest/v1/market_contacts?phone=ilike.*${digits}&select=id,name,phone,city,stage,sequence_paused&limit=20`,
    { headers, cache: 'no-store' }
  )
  const contacts = (contactRes.ok ? await contactRes.json() : []) as Array<{ id: string; name: string; phone: string | null; city: string | null; stage: string; sequence_paused?: boolean }>
  // A contact's home city can differ from the market line they called. Match
  // by the verified caller number, not by the branch the phone number reached.
  const exactMatches = contacts.filter(item => normalizePhone(item.phone) === contactPhone)
  let contact = exactMatches.length === 1 ? exactMatches[0] : null

  // Keep a callback-ready CRM identity for callers who are not yet in the
  // partner directory. These records are paused from outreach and named as
  // unknown; they never inherit a guessed person or company.
  if (!contact && !isOutbound && contacts.length === 0 && contactRes.ok) {
    const rawCity = String(formData.get('CallerCity') || '').trim()
    const city = rawCity ? rawCity.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()) : partnershipLine?.market.replace(/[-_]/g, ' ') || 'Unknown'
    const created = await fetch(`${url}/rest/v1/market_contacts`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        name: `Unknown inbound caller ${contactPhone}`,
        phone: contactPhone,
        city,
        category: 'unknown_inbound_caller',
        industry: 'unknown inbound caller',
        stage: 'attempting_contact',
        preferred_channel: 'phone',
        relationship_temperature: 'neutral',
        sequence_paused: true,
        sequence_paused_reason: 'unknown_inbound_call_requires_human_review',
        tags: ['unknown_inbound_call'],
        notes: `Unidentified caller reached the ${partnershipLine?.label || 'partnership'} line on ${now}. Confirm identity and service need before any outreach. Call SID: ${callSid || 'not recorded'}.`,
        created_at: now,
      }),
    })
    if (created.ok) {
      const rows = await created.json() as Array<{ id: string; name: string; phone: string; city: string; stage: string }>
      if (rows[0]) contact = rows[0]
    }
  }

  const notes = connected
    ? `Partnership call — ${durationSec}s · ${isOutbound ? 'Outbound' : 'Inbound'} · ${callSid}`
    : `Partnership call attempt — ${callStatus} · ${isOutbound ? 'Outbound' : 'Inbound'}`

  if (contact) {
    await fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: contact.id,
        channel: 'phone',
        direction: isOutbound ? 'outbound' : 'inbound',
        notes: noAnswer ? `Partnership call attempt — ${outcomeStatus} · ${isOutbound ? 'Outbound' : 'Inbound'}${callSid ? ` · ${callSid}` : ''}` : notes,
        outcome_code: connected ? 'call_connected' : noAnswer ? 'no_answer' : null,
        created_by: 'System',
        created_at: now,
        metadata: { call_sid: callSid, call_status: outcomeStatus, outer_call_status: callStatus, dial_bridged: dialBridged, duration_seconds: durationSec, unknown_inbound_caller: contact.name.startsWith('Unknown inbound caller ') },
      }),
    })

    await fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ last_touch_at: now }),
    })
  }

  // If inbound call and connected, pause the sequence
  if (contact && !isOutbound && connected) {
    void pausePartnershipSequenceForInbound({
      channel: 'phone',
      phone: from,
      occurredAt: now,
      notes,
    }).catch(() => {})
  }

  // Notify only after Twilio's Dial leg has a terminal result. In particular,
  // CallStatus=in-progress can coexist with DialCallStatus=no-answer and must
  // never be shown as the call outcome.
  if (!isOutbound && partnershipLine) {
    await sendRepAlertEmail(
      `${connected ? 'Partner inbound call' : 'Missed partner call'} — ${partnershipLine.label}`,
      partnershipInboundCallNotificationEmail({
        caller: contactPhone,
        lineLabel: partnershipLine.label,
        market: partnershipLine.market,
        callStatus: outcomeStatus,
        durationSeconds: durationSec,
        contactId: contact?.id,
      }),
      getPartnershipAlertRecipients(partnershipLine.market),
    )
  }

  // This route is also the <Dial action>. Twilio expects valid TwiML here;
  // an empty 204 makes it announce "An application error has occurred"
  // after an otherwise successful call.
  return twimlCompleteResponse()
}
