/**
 * POST /api/sales/operations/twiml
 * Handles voice calls on the operations number (+12267746581).
 * Inbound: rings the ops browser identity + SIP (Groundwire).
 * Outbound: dials out using 6581 as caller ID.
 * All calls are recorded.
 */
import { getAppBaseUrl } from '@/lib/server/runtime'

const OPS_NUMBER = '+12267746581'
const OPS_SIP_DOMAIN = 'saturn-ops.sip.twilio.com'
const OPS_IDENTITY = 'saturn-ops'
const OPS_SIP_USERS = ['opsmanager']
const RING_TIMEOUT = 28
const RECORDING_MODE = 'record-from-answer'
const RECORDING_TRIM = 'do-not-trim'

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

function xmlUrl(url: string) {
  return url.replace(/&/g, '&amp;')
}

function getRequestOrigin(request: Request) {
  try { return new URL(request.url).origin.replace(/\/$/, '') } catch { return '' }
}

export async function GET() {
  return Response.json({ ok: true, route: 'operations-twiml' })
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const to = (formData.get('To') as string | null)?.trim() || ''
    const from = (formData.get('From') as string | null)?.trim() || ''

    const fromBrowser = from.toLowerCase().startsWith('client:')
    const fromSip = from.toLowerCase().startsWith('sip:')
    const isInbound = !fromBrowser && !fromSip

    const appUrl = getRequestOrigin(request) || getAppBaseUrl()
    const recordingCallback = appUrl ? `${appUrl}/api/sales/dialer/recording-callback` : ''

    const dialAttrs = [
      `record="${RECORDING_MODE}"`,
      `trim="${RECORDING_TRIM}"`,
      `timeout="${RING_TIMEOUT}"`,
      recordingCallback ? `recordingStatusCallback="${xmlUrl(recordingCallback)}"` : '',
      recordingCallback ? `recordingStatusCallbackMethod="POST"` : '',
      recordingCallback ? `recordingStatusCallbackEvent="completed absent"` : '',
    ].filter(Boolean).join(' ')

    if (isInbound) {
      // Ring ops browser identity + Groundwire SIP
      const sipTargets = OPS_SIP_USERS
        .map(u => `<Sip>sip:${u}@${OPS_SIP_DOMAIN}</Sip>`)
        .join('')
      return xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response>` +
        `<Dial ${dialAttrs}>` +
        `<Client>${OPS_IDENTITY}</Client>` +
        sipTargets +
        `</Dial>` +
        `</Response>`
      )
    }

    // Outbound: ops manager dialing out — use 6581 as caller ID
    const digits = to.replace(/\D/g, '')
    const dialTarget = digits.length === 10 ? `+1${digits}` : digits.length === 11 ? `+${digits}` : to
    if (!dialTarget) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>`)
    }

    const outboundAttrs = [
      `callerId="${OPS_NUMBER}"`,
      `record="${RECORDING_MODE}"`,
      `trim="${RECORDING_TRIM}"`,
      recordingCallback ? `recordingStatusCallback="${xmlUrl(recordingCallback)}"` : '',
      recordingCallback ? `recordingStatusCallbackMethod="POST"` : '',
      recordingCallback ? `recordingStatusCallbackEvent="completed absent"` : '',
    ].filter(Boolean).join(' ')

    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response>` +
      `<Dial ${outboundAttrs}><Number>${dialTarget}</Number></Dial>` +
      `</Response>`
    )
  } catch {
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>`)
  }
}
