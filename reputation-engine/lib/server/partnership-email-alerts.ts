import { enqueueInternalAlert } from './alert-outbox'
import { getPartnershipAlertRecipients, partnershipInboundNotificationEmail } from './internal-notifications'

export async function sendPartnershipEmailAlert(input: {
  id: string; contactId: string; contactName?: string | null; company?: string | null;
  city?: string | null; email?: string | null; occurredAt: string; notes: string;
  label: string; subject?: string;
}) {
  await enqueueInternalAlert(`partner-event:${input.id}`, {
    recipients: getPartnershipAlertRecipients(input.city),
    subject: `${input.label} — ${input.company || input.contactName || input.email}`,
    html: partnershipInboundNotificationEmail({ ...input, channel: 'email', eventLabel: input.label }),
  })
}
