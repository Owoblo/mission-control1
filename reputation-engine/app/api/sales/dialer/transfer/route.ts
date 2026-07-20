import { getTwilioCredentials } from '@/lib/server/runtime'
import { twilioAuth } from '@/lib/server/twilio-recordings'
import { getSessionUser } from '@/lib/server/session'
import { pickSaturnBranchPhoneNumber } from '@/lib/sales-phones'
import { logDialerAnalyticsEvent } from '@/lib/server/telephony-monitoring'

function buildTransferTwiml(to: string, callerId?: string | null): string {
  const lower = to.toLowerCase()
  if (lower.startsWith('sip:')) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Sip>${to}</Sip></Dial></Response>`
  }
  if (lower.startsWith('client:') || !/^\+?[0-9]{7,15}$/.test(to.replace(/\s/g, ''))) {
    // Strip "client:" prefix if present — <Client> wraps the identity only
    const identity = lower.startsWith('client:') ? to.slice(7) : to
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Client>${identity}</Client></Dial></Response>`
  }
  // Phone number
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${pickSaturnBranchPhoneNumber(callerId)}"><Number>${to}</Number></Dial></Response>`
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return new Response('Unauthorized', { status: 401 })

  try {
    const { callSid, to, callerId, context } = await request.json() as {
      callSid?: string
      to?: string
      callerId?: string | null
      context?: {
        leadId?: string | null
        customerName?: string | null
        phone?: string | null
        reason?: string | null
        notes?: string | null
        stage?: string | null
        moveDate?: string | null
        route?: string | null
        owner?: string | null
      }
    }
    if (!callSid || !to) {
      return Response.json({ error: 'callSid and to are required' }, { status: 400 })
    }

    const { accountSid, authToken } = getTwilioCredentials()
    const twiml = buildTransferTwiml(to.trim(), callerId)

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}.json`,
      {
        method: 'POST',
        headers: {
          Authorization: twilioAuth(accountSid, authToken),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ Twiml: twiml }).toString(),
      }
    )

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string }
      return Response.json({ error: body.message || 'Twilio transfer failed' }, { status: 502 })
    }

    const targetIdentity = to.trim().toLowerCase().startsWith('client:') ? to.trim().slice(7) : null
    if (targetIdentity) {
      await logDialerAnalyticsEvent({
        userId: session.userId,
        userName: session.name,
        userRole: session.role,
        payload: {
          event: 'transfer_context_created',
          callSid,
          leadId: context?.leadId || null,
          phoneNumber: context?.phone || undefined,
          extra: {
            targetIdentity,
            transferredBy: session.name,
            customerName: context?.customerName || null,
            reason: context?.reason || null,
            notes: context?.notes || null,
            stage: context?.stage || null,
            moveDate: context?.moveDate || null,
            route: context?.route || null,
            owner: context?.owner || null,
          },
        },
      }).catch(() => undefined)
    }

    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}
