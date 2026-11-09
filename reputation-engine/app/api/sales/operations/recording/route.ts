import { operationsSession, operationsDb } from '@/lib/server/operations-phone'
import { getTwilioCredentials } from '@/lib/server/runtime'
import { downloadTwilioRecording } from '@/lib/server/twilio-recordings'
import { getStorageService } from '@/lib/server/storage-service'
export async function GET(request:Request) {
  if (!await operationsSession(request)) return Response.json({error:'Forbidden'},{status:403})
  const id = new URL(request.url).searchParams.get('id') || ''
  const rows = await operationsDb(`operations_phone_events?id=eq.${encodeURIComponent(id)}&kind=eq.call&limit=1`)
  const payload = rows?.[0]?.payload
  if (!payload?.recordingSid) return Response.json({error:'Recording not found'},{status:404})
  try {
    if (payload.objectKey) return Response.redirect(await getStorageService().getSignedReadUrl(payload.objectKey,300))
    const recording = await downloadTwilioRecording({...getTwilioCredentials(),recordingSid:payload.recordingSid})
    return new Response(new Uint8Array(recording.buffer),{headers:{'Content-Type':recording.contentType || 'audio/mpeg','Cache-Control':'private, max-age=300'}})
  } catch { return Response.json({error:'Recording unavailable. Please retry.'},{status:502}) }
}
