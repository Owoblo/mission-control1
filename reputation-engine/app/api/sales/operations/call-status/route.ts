import { authorizeTwilioWebhook } from '@/lib/server/security'
import { saveOperationsEvent } from '@/lib/server/operations-phone'
import { operationsPhone } from '@/lib/operations-phone'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { xml, voiceResponse, operationsCallbacks, recordingAttributes } from '@/lib/server/operations-twiml'
export async function POST(request:Request) {
  const raw = await request.text(), rejection = await authorizeTwilioWebhook(request,raw)
  if (rejection) return rejection
  const params = new URL(request.url).searchParams, form = new URLSearchParams(raw)
  const phone = operationsPhone(params.get('phone')), callSid = params.get('callSid') || ''
  const direction = params.get('direction') === 'outbound' ? 'outbound' : 'inbound'
  if (!phone || !/^CA[a-f0-9]{32}$/i.test(callSid) || form.get('CallSid') !== callSid) return new Response('Invalid call',{status:400})
  const stage = params.get('stage'), status = form.get('DialCallStatus') || 'no-answer'
  try {
    if (stage === 'voicemail') return voiceResponse('<Hangup/>')
    await saveOperationsEvent(`call:${callSid}`,phone,'call',direction,{status,duration:Number(form.get('DialCallDuration') || 0)})
    if (direction === 'outbound' || status === 'completed' || stage === 'voicemail') return voiceResponse('<Hangup/>')
    const urls = operationsCallbacks(getAppBaseUrl(new URL(request.url).origin),phone,direction,callSid)
    if (stage === 'browser') return voiceResponse(`<Dial timeout="20" action="${xml(urls.status+'&stage=mobile')}" method="POST" ${recordingAttributes(urls.recording)}><Number>+12267241730</Number></Dial>`)
    return voiceResponse(`<Say>You've reached Saturn Star Operations. Please leave your name, company and message after the tone.</Say><Record maxLength="120" playBeep="true" action="${xml(urls.status+'&stage=voicemail')}" recordingStatusCallback="${xml(urls.recording+'&voicemail=1')}" recordingStatusCallbackMethod="POST"/><Hangup/>`)
  } catch { return new Response('Unable to save call outcome',{status:503}) }
}
