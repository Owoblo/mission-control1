import { verifyTwilioSignature } from '@/lib/server/security'
import { logDialerAnalyticsEvent } from '@/lib/server/telephony-monitoring'

export async function POST(request: Request) {
  const rawBody = await request.text()
  if (!(await verifyTwilioSignature(request, rawBody))) {
    return new Response('Forbidden', { status: 403 })
  }

  const form = new URLSearchParams(rawBody)
  const event = form.get('StatusCallbackEvent') || form.get('CallStatus') || 'unknown'
  const callSid = form.get('CallSid') || undefined
  const conferenceSid = form.get('ConferenceSid')
  const conferenceName = form.get('FriendlyName')

  await logDialerAnalyticsEvent({
    userId: null,
    userName: 'Twilio',
    userRole: 'system',
    payload: {
      event: 'conference_lifecycle',
      callSid,
      extra: {
        event,
        conferenceSid,
        conferenceName,
        participantCallSid: form.get('CallSid'),
        muted: form.get('Muted'),
        hold: form.get('Hold'),
        sequenceNumber: form.get('SequenceNumber'),
      },
    },
  }).catch(() => undefined)

  return new Response(null, { status: 204 })
}
