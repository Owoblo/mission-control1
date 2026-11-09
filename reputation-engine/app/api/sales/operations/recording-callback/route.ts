import { after } from 'next/server'
import { authorizeTwilioWebhook } from '@/lib/server/security'
import { operationsDb, saveOperationsEvent } from '@/lib/server/operations-phone'
import { operationsPhone } from '@/lib/operations-phone'
import { getTwilioCredentials } from '@/lib/server/runtime'
import { getStorageService, isObjectStorageConfigured } from '@/lib/server/storage-service'
import { downloadTwilioRecording } from '@/lib/server/twilio-recordings'
import { transcribeAudioBuffer } from '@/lib/server/call-intelligence'
export const maxDuration = 60
export async function POST(request:Request) {
  const raw = await request.text(), rejection = await authorizeTwilioWebhook(request,raw)
  if (rejection) return rejection
  const params = new URL(request.url).searchParams, form = new URLSearchParams(raw)
  const phone = operationsPhone(params.get('phone')), callSid = params.get('callSid') || ''
  const direction = params.get('direction') === 'outbound' ? 'outbound' : 'inbound'
  const recordingSid = form.get('RecordingSid') || ''
  if (!phone || !/^CA[a-f0-9]{32}$/i.test(callSid) || !/^RE[a-f0-9]{32}$/i.test(recordingSid)) return new Response('Invalid recording',{status:400})
  if (form.get('RecordingStatus') && form.get('RecordingStatus') !== 'completed') return new Response(null,{status:204})
  try {
    const existing = await operationsDb(`operations_phone_events?id=eq.call:${callSid}&limit=1`)
    if (!existing?.[0] || existing[0].phone !== phone) return new Response('Unknown Operations call',{status:404})
    const alreadyProcessed = existing[0].payload.recordingSid === recordingSid && existing[0].payload.transcriptionStatus === 'completed'
    await saveOperationsEvent(`call:${callSid}`,phone,'call',direction,{recordingSid,...(params.get('voicemail') === '1' ? {voicemail:true,status:'voicemail'} : {}),...(!alreadyProcessed ? {transcriptionStatus:'processing'} : {})})
    if (!alreadyProcessed) after(async () => {
      try {
        const credentials = getTwilioCredentials()
        const input = {...credentials,callSid,recordingSid,durationSeconds:Number(form.get('RecordingDuration') || 0),phoneNumber:phone,city:'operations'}
        const recording = await downloadTwilioRecording(input)
        if (isObjectStorageConfigured()) {
          const objectKey = `operations-recordings/${callSid}/${recordingSid}.mp3`
          try {
            await getStorageService().putObject({key:objectKey,body:recording.buffer,contentType:recording.contentType || 'audio/mpeg'})
            await saveOperationsEvent(`call:${callSid}`,phone,'call',direction,{objectKey})
          } catch { /* Provider recording remains available if archival storage is temporarily down. */ }
        }
        const transcript = await transcribeAudioBuffer(recording.buffer,recording.contentType || 'audio/mpeg','operations',{timeoutMs:35000,attempts:1})
        await saveOperationsEvent(`call:${callSid}`,phone,'call',direction,{...(transcript ? {transcript} : {}),transcriptionStatus:transcript ? 'completed' : 'unavailable'})
      } catch { await saveOperationsEvent(`call:${callSid}`,phone,'call',direction,{transcriptionStatus:'unavailable'}).catch(() => null) }
    })
    return new Response(null,{status:204})
  } catch { return new Response('Unable to persist recording',{status:503}) }
}
