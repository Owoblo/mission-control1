import { emailAddress, emailHash, emailStorage } from './email-delivery'

type Json = Record<string,any>
export function sesReceiptEvents(message: Json) {
  const mail=message.mail || {}, type=String(message.eventType || '').toLowerCase()
  const names:Record<string,string>={send:'email_provider_accepted',delivery:'email_delivered',bounce:'email_bounced',complaint:'email_complained',reject:'email_rejected',deliverydelay:'email_delivery_delayed',open:'email_opened',click:'email_clicked',subscription:'email_unsubscribed',renderingfailure:'email_rendering_failed'}
  if (!mail.messageId || !names[type]) return []
  const recipients = type==='bounce' ? (message.bounce?.bouncedRecipients || []).map((r:Json)=>r.emailAddress)
    : type==='complaint' ? (message.complaint?.complainedRecipients || []).map((r:Json)=>r.emailAddress)
    : type==='deliverydelay' ? (message.deliveryDelay?.delayedRecipients || []).map((r:Json)=>r.emailAddress)
    : message.delivery?.recipients || mail.destination || []
  const from=emailAddress(mail.source || mail.commonHeaders?.from?.[0] || '')
  const at=message.open?.timestamp || message.click?.timestamp || message.delivery?.timestamp || message.bounce?.timestamp || message.complaint?.timestamp || message.deliveryDelay?.timestamp || mail.timestamp
  if (!Number.isFinite(Date.parse(mail.timestamp)) || !Number.isFinite(Date.parse(at))) throw Error('SES receipt timestamps are required')
  return [...new Set<string>((recipients.length ? recipients : mail.destination || []).filter(Boolean).map((r:string)=>emailAddress(r)))].map(recipient=>{
    const bounced=message.bounce?.bouncedRecipients?.find((r:Json)=>emailAddress(r.emailAddress)===recipient)
    return {eventKey:emailHash(JSON.stringify([mail.messageId,names[type],at,recipient])),messageId:mail.messageId,recipient,eventType:names[type],
      from,domain:from.split('@')[1],subject:mail.commonHeaders?.subject || '',sentAt:mail.timestamp,occurredAt:at,
      attemptId:mail.tags?.crm_send_id?.[0] || null,diagnostic:{bounceType:message.bounce?.bounceType || null,bounceSubType:message.bounce?.bounceSubType || null,
        status:bounced?.status || null,diagnosticCode:bounced?.diagnosticCode || null,complaintType:message.complaint?.complaintFeedbackType || null,delayType:message.deliveryDelay?.delayType || null}}
  })
}
export async function recordSesReceipts(message:Json) {
  const events=sesReceiptEvents(message)
  for(const event of events) await emailStorage('rpc/record_crm_email_receipt',{p_event:event})
  return events
}
