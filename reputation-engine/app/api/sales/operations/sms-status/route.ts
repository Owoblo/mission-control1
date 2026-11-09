import { authorizeTwilioWebhook } from '@/lib/server/security'
import { saveOperationsEvent } from '@/lib/server/operations-phone'
import { OPERATIONS_NUMBER, operationsPhone } from '@/lib/operations-phone'
export async function POST(request:Request) {
  const raw = await request.text(), rejection = await authorizeTwilioWebhook(request,raw)
  if (rejection) return rejection
  const form = new URLSearchParams(raw), phone = operationsPhone(form.get('To')), sid = form.get('MessageSid') || ''
  if (operationsPhone(form.get('From')) !== OPERATIONS_NUMBER || !phone || !/^SM[a-f0-9]{32}$/i.test(sid)) return new Response('Invalid message',{status:400})
  try {
    await saveOperationsEvent(`sms:${sid}`,phone,'sms','outbound',{status:form.get('MessageStatus') || form.get('SmsStatus') || 'unknown',errorCode:form.get('ErrorCode') || null})
    return new Response(null,{status:204})
  } catch { return new Response('Unable to save status',{status:503}) }
}
