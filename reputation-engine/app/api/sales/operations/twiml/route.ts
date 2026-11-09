import { authorizeTwilioWebhook } from '@/lib/server/security'
import { operationsDb, operationsUser, saveOperationsEvent } from '@/lib/server/operations-phone'
import { OPERATIONS_NUMBER, OPERATIONS_IDENTITY_PREFIX, OPERATIONS_ROLES, operationsPhone } from '@/lib/operations-phone'
import { getAppBaseUrl } from '@/lib/server/runtime'

import { xml, voiceResponse, operationsCallbacks, recordingAttributes } from '@/lib/server/operations-twiml'
export async function POST(request:Request) {
  const raw = await request.text()
  const rejection = await authorizeTwilioWebhook(request,raw)
  if (rejection) return rejection
  try {
    const form = new URLSearchParams(raw), from = form.get('From') || ''
    const callSid = form.get('CallSid') || ''
    if (!/^CA[a-f0-9]{32}$/i.test(callSid)) return new Response('Invalid call',{status:400})
    const browser = from.startsWith(`client:${OPERATIONS_IDENTITY_PREFIX}`)
    const sip = /^sip:opsmanager@saturn-ops\.sip\.twilio\.com(?:[;:]|$)/i.test(from)
    const inbound = !from.startsWith('client:') && !from.startsWith('sip:') && operationsPhone(form.get('To')) === OPERATIONS_NUMBER
    const user = browser ? await operationsUser(from.slice(7)) : null
    if ((!inbound && !sip && !user) || (browser && !user)) return new Response('Forbidden',{status:403})
    const phone = operationsPhone(inbound ? from : form.get('To'))
    if (!phone || phone === OPERATIONS_NUMBER) return voiceResponse('<Say>Please enter a valid Canadian or US phone number.</Say><Hangup/>')
    const direction = inbound ? 'inbound' : 'outbound'
    const origin = getAppBaseUrl(new URL(request.url).origin)
    const urls = operationsCallbacks(origin,phone,direction,callSid)
    await saveOperationsEvent(`call:${callSid}`,phone,'call',direction,{status:'ringing',...(user ? {repName:user.name,repId:user.id} : {})})
    if (inbound) {
      const users = await operationsDb(`app_users?select=id&role=in.(${OPERATIONS_ROLES.join(',')})&order=name.asc&limit=10`)
      const targets = users.map((row:{id:string}) => `<Client><Identity>${xml(OPERATIONS_IDENTITY_PREFIX+row.id)}</Identity><Parameter name="OperationsPhone" value="${phone}"/></Client>`).join('')
      if (!targets) return voiceResponse(`<Redirect method="POST">${xml(urls.status+'&stage=browser')}</Redirect>`)
      return voiceResponse(`<Dial timeout="20" action="${xml(urls.status+'&stage=browser')}" method="POST" ${recordingAttributes(urls.recording)}>${targets}</Dial>`)
    }
    // The caller ID and callbacks are owned by this workspace, never browser parameters.
    return voiceResponse(`<Dial callerId="${OPERATIONS_NUMBER}" timeout="45" action="${xml(urls.status+'&stage=outbound')}" method="POST" ${recordingAttributes(urls.recording)}><Number>${phone}</Number></Dial>`)
  } catch (error) {
    console.error('Operations voice routing failed',error instanceof Error ? error.message : 'unknown')
    return new Response('Operations routing unavailable',{status:503})
  }
}
