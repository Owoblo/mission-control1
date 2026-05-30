import { getTwilioCredentials, getAppBaseUrl } from '@/lib/server/runtime'
import { twilioAuth } from '@/lib/server/twilio-recordings'
import { hasInternalSession } from '@/lib/server/session'
import { getDialerIdentityAvailability } from '@/lib/server/telephony-monitoring'

const QUEUE_NAME = 'saturn-main-queue'

type TwilioQueue = {
  sid: string
  friendly_name: string
  current_size: number
}

type TwilioQueuesResponse = {
  queues?: TwilioQueue[]
}

type TwilioQueueMember = {
  call_sid: string
}

async function findQueue(accountSid: string, auth: string): Promise<TwilioQueue | null> {
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Queues.json`,
      { headers: { Authorization: auth } }
    )
    if (!res.ok) return null
    const data = await res.json() as TwilioQueuesResponse
    return data.queues?.find(q => q.friendly_name === QUEUE_NAME) ?? null
  } catch {
    return null
  }
}

export async function GET() {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  try {
    const { accountSid, authToken } = getTwilioCredentials()
    const auth = twilioAuth(accountSid, authToken)
    const queue = await findQueue(accountSid, auth)

    return Response.json({
      size: queue?.current_size ?? 0,
      queueSid: queue?.sid ?? null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  try {
    const { identity } = await request.json() as { identity?: string }
    if (!identity) {
      return Response.json({ error: 'identity is required' }, { status: 400 })
    }

    const availability = await getDialerIdentityAvailability({ identity })
    if (!availability.selectedIdentity) {
      return Response.json({
        ok: false,
        message: 'No browser rep is currently available for queue pickup',
      })
    }

    const { accountSid, authToken } = getTwilioCredentials()
    const auth = twilioAuth(accountSid, authToken)
    const appUrl = getAppBaseUrl()

    const queue = await findQueue(accountSid, auth)
    if (!queue || queue.current_size === 0) {
      return Response.json({ ok: false, message: 'No callers in queue' })
    }

    // Get the front member
    const frontRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Queues/${queue.sid}/Members/Front.json`,
      { headers: { Authorization: auth } }
    )
    if (!frontRes.ok) {
      return Response.json({ ok: false, message: 'Could not retrieve front of queue' })
    }
    const front = await frontRes.json() as TwilioQueueMember
    if (!front.call_sid) {
      return Response.json({ ok: false, message: 'No caller at front of queue' })
    }

    // Dequeue: redirect the caller to connect to the rep's browser client
    const connectUrl = `${appUrl}/api/sales/dialer/queue/connect?identity=${encodeURIComponent(availability.selectedIdentity)}`
    const dequeueRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Queues/${queue.sid}/Members/${front.call_sid}.json`,
      {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ Url: connectUrl, Method: 'POST' }).toString(),
      }
    )

    if (!dequeueRes.ok) {
      const body = await dequeueRes.json().catch(() => ({})) as { message?: string }
      return Response.json({ ok: false, message: body.message || 'Dequeue failed' }, { status: 502 })
    }

    return Response.json({
      ok: true,
      identity: availability.selectedIdentity,
      rerouted: availability.selectedIdentity !== availability.requestedIdentity,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}
