import { operationsSession } from '@/lib/server/operations-phone'
import { buildVoiceToken } from '@/lib/server/voice-token'
import { requireEnv } from '@/lib/server/runtime'
import { OPERATIONS_IDENTITY_PREFIX } from '@/lib/operations-phone'
export async function GET(request:Request) {
  const session = await operationsSession(request)
  if (!session) return Response.json({error:'Forbidden'},{status:403})
  if (!session.userId) return Response.json({error:'Sign out and back in to enable Operations calling.'},{status:409})
  const identity = OPERATIONS_IDENTITY_PREFIX + session.userId
  const token = await buildVoiceToken(requireEnv('TWILIO_ACCOUNT_SID'),requireEnv('TWILIO_API_KEY_SID'),requireEnv('TWILIO_API_KEY_SECRET'),requireEnv('TWILIO_TWIML_APP_SID'),identity)
  return Response.json({...token,identity,repName:session.name},{headers:{'Cache-Control':'no-store'}})
}
