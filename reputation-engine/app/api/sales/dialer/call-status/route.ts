/**
 * POST /api/sales/dialer/call-status
 * Twilio status callback — fires when a call ends.
 * If the call was missed (no-answer/busy/failed), auto-SMS the caller.
 */
import {
  getSaturnBranchLabel,
  normalizePhone,
  pickSaturnBranchPhoneNumber,
} from '@/lib/sales-phones'
import { createSalesSystemAlert } from '@/lib/server/sales-alerts'
import { getTwilioCredentials } from '@/lib/server/runtime'
import { listSalesLeads } from '@/lib/server/sales-repository'

export async function GET() {
  return Response.json({
    ok: true,
    route: 'sales-dialer-call-status',
    checks: ['missed-call-sms', 'branch-aware-from-number'],
  })
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const form = await request.formData()
    const callStatus = (form.get('CallStatus') as string || '').toLowerCase()
    const from = (form.get('From') as string || '').trim()
    const callDuration = Number(form.get('CallDuration') || 0)
    const branchNumber = pickSaturnBranchPhoneNumber(
      searchParams.get('branchNumber'),
      normalizePhone(form.get('To') as string | null)
    )

    // Only auto-SMS on missed/short calls
    const isMissed = ['no-answer', 'busy', 'failed'].includes(callStatus)
      || (callStatus === 'completed' && callDuration < 10)

    if (!isMissed || !from || from === 'anonymous' || from.toLowerCase().startsWith('client:')) {
      return new Response(null, { status: 204 })
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
    const branchLabel = getSaturnBranchLabel(branchNumber)
    const body = `${greeting} This is Saturn Star Moving${branchLabel ? ` on the ${branchLabel} line` : ''} — sorry we missed your call! Reply here or call us back here and we'll get you sorted right away.`

    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: branchNumber,
        To: from,
        Body: body,
      }).toString(),
    })

    void createSalesSystemAlert({
      title: 'Missed inbound call',
      leadId: matchedLead?.id,
      branchNumber,
      details: `Caller ${from} was sent an automatic missed-call SMS from ${branchNumber}.`,
      occurredAt: new Date().toISOString(),
    })

    return new Response(null, { status: 204 })
  } catch {
    return new Response(null, { status: 204 })
  }
}
