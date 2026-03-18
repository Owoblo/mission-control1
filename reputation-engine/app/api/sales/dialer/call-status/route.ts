/**
 * POST /api/sales/dialer/call-status
 * Twilio status callback — fires when a call ends.
 * If the call was missed (no-answer/busy/failed), auto-SMS the caller.
 */
import { NextResponse } from 'next/server'
import { getTwilioCredentials } from '@/lib/server/runtime'
import { listSalesLeads } from '@/lib/server/sales-repository'

const SATURN_PHONE = '+12267732993'

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const callStatus = (form.get('CallStatus') as string || '').toLowerCase()
    const from = (form.get('From') as string || '').trim()
    const callDuration = Number(form.get('CallDuration') || 0)

    // Only auto-SMS on missed/short calls
    const isMissed = ['no-answer', 'busy', 'failed'].includes(callStatus)
      || (callStatus === 'completed' && callDuration < 10)

    if (!isMissed || !from || from === 'anonymous' || from.toLowerCase().startsWith('client:')) {
      return new Response('', { status: 204 })
    }

    // Try to find lead name for personalization
    const leads = await listSalesLeads().catch(() => [])
    const matchedLead = leads.find(l => {
      const leadDigits = (l.phone || '').replace(/\D/g, '')
      const fromDigits = from.replace(/\D/g, '')
      return leadDigits && fromDigits && (leadDigits === fromDigits || fromDigits.endsWith(leadDigits) || leadDigits.endsWith(fromDigits))
    })
    const firstName = matchedLead?.name?.split(' ')[0] || null

    const { accountSid, authToken } = getTwilioCredentials()
    const greeting = firstName ? `Hi ${firstName}!` : 'Hi there!'

    const body = `${greeting} This is Saturn Star Moving — sorry we missed your call! 🚛 We'd love to help with your move. Reply here or call us back at 226-773-2993 and we'll get you sorted right away.`

    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: SATURN_PHONE,
        To: from,
        Body: body,
      }).toString(),
    })

    return new Response('', { status: 204 })
  } catch {
    return new Response('', { status: 204 })
  }
}
