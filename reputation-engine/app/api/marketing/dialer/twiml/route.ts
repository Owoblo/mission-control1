import { normalizePhone } from '@/lib/sales-phones'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { getAppBaseUrl, readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import {
  DEFAULT_PARTNERSHIP_FROM_NUMBER,
  PARTNERSHIP_LINES,
  getPartnershipPrimaryNumberForMarket,
  normalizePartnershipCityKey,
} from '@/lib/partnership-lines'

const PARTNERSHIP_NUMBERS = {
  windsor: getPartnershipPrimaryNumberForMarket('windsor'),
  waterloo: getPartnershipPrimaryNumberForMarket('waterloo'),
  london: getPartnershipPrimaryNumberForMarket('london'),
  ottawa: getPartnershipPrimaryNumberForMarket('ottawa'),
}
const DEFAULT_PARTNERSHIP_NUMBER = DEFAULT_PARTNERSHIP_FROM_NUMBER

function xmlAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function normalizeDialTarget(value: string) {
  const trimmed = value.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('+')) return trimmed
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return trimmed
}

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

function recordingCallbackUrl(baseUrl: string, customerNumber: string, partnershipNumber: string, direction: 'inbound' | 'outbound') {
  const url = new URL(`${baseUrl}/api/marketing/dialer/recording-callback`)
  url.searchParams.set('customer', normalizePhone(customerNumber) || customerNumber)
  url.searchParams.set('line', normalizePhone(partnershipNumber) || partnershipNumber)
  url.searchParams.set('direction', direction)
  return url.toString()
}

function dialDestinations(forwardPhone?: string | null, clientIdentities?: string[] | null) {
  const destinations: string[] = []
  for (const identity of Array.from(new Set(clientIdentities || []))) {
    if (identity.trim()) destinations.push(`<Client>${xmlAttr(identity.trim())}</Client>`)
  }
  if (forwardPhone?.trim()) {
    destinations.push(`<Number>${xmlAttr(forwardPhone.trim())}</Number>`)
  }
  return destinations.join('')
}

function partnershipLineForNumber(value?: string | null) {
  const normalized = normalizePhone(value || '')
  return PARTNERSHIP_LINES.find(line => line.number === normalized) || null
}

function envMarketSuffix(value?: string | null) {
  return normalizePartnershipCityKey(value)
    .replace(/-/g, '_')
    .toUpperCase()
}

function configuredForwardPhoneForLine(dialedNumber?: string | null) {
  const line = partnershipLineForNumber(dialedNumber)
  const suffix = envMarketSuffix(line?.market)
  const marketForwardPhone = suffix
    ? readEnv(`PARTNERSHIP_FORWARD_PHONE_${suffix}`) || readEnv(`PARTNERSHIP_${suffix}_FORWARD_PHONE`)
    : ''
  return normalizePhone(
    marketForwardPhone ||
    readEnv('PARTNERSHIP_FORWARD_PHONE') ||
    '+12267241730'
  )
}

async function clientIdentitiesForPartnershipLine(dialedNumber?: string | null) {
  const line = partnershipLineForNumber(dialedNumber)
  if (!line) return []
  try {
    const { url, headers } = requireSupabaseEnv()
    const keys = Array.from(new Set([line.market, ...line.cityKeys].map(normalizePartnershipCityKey).filter(Boolean)))
    const branchFilter = keys.map(key => `branch.ilike.*${encodeURIComponent(key)}*`).join(',')
    const res = await fetch(
      `${url}/rest/v1/app_users?role=eq.partnership_manager&select=id,branch&or=(${branchFilter})&order=created_at.asc&limit=1`,
      { headers, cache: 'no-store' }
    )
    const [user] = (res.ok ? await res.json() : []) as Array<{ id?: string }>
    return user?.id
      ? [`partnership-rep-${user.id}`, `saturn-rep-${user.id}`]
      : []
  } catch {
    return []
  }
}

export async function GET() {
  return Response.json({ ok: true, route: 'partnership-dialer-twiml', numbers: PARTNERSHIP_NUMBERS })
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const to = (formData.get('To') as string | null)?.trim() ?? ''
    const from = (formData.get('From') as string | null)?.trim() ?? ''
    const city = ((formData.get('City') as string | null) || '').toLowerCase()
    const fromBrowser = from.toLowerCase().startsWith('client:')

    const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')
    if (!fromBrowser) {
      const dialedNumber = normalizePhone(to) || DEFAULT_PARTNERSHIP_NUMBER
      const marketClientIdentities = await clientIdentitiesForPartnershipLine(dialedNumber)
      const fallbackClientIdentity = readEnv('PARTNERSHIP_FORWARD_CLIENT_IDENTITY')
      const clientIdentities = marketClientIdentities.length > 0
        ? marketClientIdentities
        : fallbackClientIdentity ? [fallbackClientIdentity] : []
      const forwardPhone = configuredForwardPhoneForLine(dialedNumber)
      const inboundPhone = normalizePhone(from) || from
      const recordingCallback = recordingCallbackUrl(appUrl, inboundPhone, dialedNumber, 'inbound')
      const callSid = (formData.get('CallSid') as string | null)?.trim() || null
      const statusCallback = `${appUrl}/api/marketing/dialer/call-status`

      void pausePartnershipSequenceForInbound({
        channel: 'phone',
        phone: inboundPhone,
        occurredAt: new Date().toISOString(),
        notes: `Inbound partnership call from ${inboundPhone}${dialedNumber ? ` to ${dialedNumber}` : ''}`,
        metadata: { callSid, from, to, dialedNumber },
      }).catch(() => null)

      return xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${xmlAttr(dialedNumber)}" timeout="25" record="record-from-answer" recordingStatusCallback="${xmlAttr(recordingCallback)}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" action="${xmlAttr(statusCallback)}" method="POST">${dialDestinations(forwardPhone, clientIdentities)}</Dial></Response>`
      )
    }

    if (!to) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>`)
    }

    const dialTarget = normalizeDialTarget(to)
    const callerId = getPartnershipPrimaryNumberForMarket(city) || DEFAULT_PARTNERSHIP_NUMBER
    const recordingCallback = recordingCallbackUrl(appUrl, dialTarget, callerId, 'outbound')

    const dialAttrs = [
      `callerId="${xmlAttr(callerId)}"`,
      `record="record-from-answer"`,
      `recordingStatusCallback="${xmlAttr(recordingCallback)}"`,
      `recordingStatusCallbackMethod="POST"`,
      `recordingStatusCallbackEvent="completed"`,
      `action="${xmlAttr(`${appUrl}/api/marketing/dialer/call-status`)}"`,
      `method="POST"`,
    ].join(' ')

    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}><Number>${xmlAttr(dialTarget)}</Number></Dial></Response>`
    )
  } catch {
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>`)
  }
}
