import { readEnv } from './runtime'
import { getPartnershipAlertRecipients, partnershipInboundNotificationEmail } from './internal-notifications'

export async function sendPartnershipEmailAlert(input: {
  id: string; contactId: string; contactName?: string | null; company?: string | null;
  city?: string | null; email?: string | null; occurredAt: string; notes: string;
  label: string; subject?: string;
}) {
  const key = readEnv('RESEND_API_KEY')
  if (!key) throw new Error('Partnership notification provider is not configured')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `partner-event-${input.id}` },
    body: JSON.stringify({
      from: 'Saturn Star OS <notifications@starmovers.ca>',
      to: getPartnershipAlertRecipients(input.city),
      subject: `${input.label} — ${input.company || input.contactName || input.email}`,
      html: partnershipInboundNotificationEmail({ ...input, channel: 'email', eventLabel: input.label }),
    }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(`Partnership notification failed (${response.status}): ${error.message || 'Provider rejected the request'}`)
  }
}
