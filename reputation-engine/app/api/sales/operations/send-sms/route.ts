import { sendSmsProviderRequest } from '@/lib/server/sms-provider'
import { operationsSession, saveOperationsEvent } from '@/lib/server/operations-phone'
import { OPERATIONS_NUMBER, operationsPhone } from '@/lib/operations-phone'
import { getTwilioCredentials, getAppBaseUrl, requireSupabaseEnv } from '@/lib/server/runtime'
export async function POST(request:Request) {
  const session = await operationsSession(request)
  if (!session) return Response.json({error:'Forbidden'},{status:403})
  try {
    const input = await request.json(), to = operationsPhone(input.to), body = String(input.body || '').trim()
    const mediaUrls = Array.isArray(input.mediaUrls) ? input.mediaUrls : []
    const {url} = requireSupabaseEnv()
    if (!to || to === OPERATIONS_NUMBER || (!body && !mediaUrls.length) || body.length > 1600 || mediaUrls.length > 10 || mediaUrls.some((u:unknown) => typeof u !== 'string' || !u.startsWith(`${url}/storage/v1/object/public/ops-media/`))) return Response.json({error:'Enter a valid recipient and message (up to 1,600 characters), or attach a file.'},{status:400})
    const {accountSid,authToken} = getTwilioCredentials()
    const params = new URLSearchParams({From:OPERATIONS_NUMBER,To:to,StatusCallback:`${getAppBaseUrl(new URL(request.url).origin)}/api/sales/operations/sms-status`})
    if (body) params.set('Body',body)
    mediaUrls.forEach((u:string) => params.append('MediaUrl',u))
    const result = await sendSmsProviderRequest(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:params.toString()})
    const message = await result.json()
    if (!result.ok || !message.sid) return Response.json({error:message.message || 'Message could not be sent.'},{status:502})
    try { await saveOperationsEvent(`sms:${message.sid}`,to,'sms','outbound',{body,mediaUrls,repName:session.name || 'Staff',status:message.status || 'queued'}) }
    catch { return Response.json({ok:true,sid:message.sid,warning:'Message accepted by carrier; history could not be saved. Do not resend.'}) }
    return Response.json({ok:true,sid:message.sid})
  } catch { return Response.json({error:'Unable to confirm sending. Check the conversation before retrying.'},{status:503}) }
}
