export const maxDuration = 120

import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { getSessionUser } from '@/lib/server/session'
import { getTwilioCredentials } from '@/lib/server/runtime'
import { listTwilioRecordingsReadyForDeletion, markTwilioRecordingDeleted } from '@/lib/server/call-recordings'
import { getStorageService } from '@/lib/server/storage-service'
import { normalizeTwilioRecordingSid, twilioAuth } from '@/lib/server/twilio-recordings'

async function deleteTwilioRecording(accountSid: string, authToken: string, recordingSid: string) {
  const sid = normalizeTwilioRecordingSid(recordingSid)
  if (!sid) throw new Error('Invalid Twilio recording SID')
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${sid}.json`, {
    method: 'DELETE',
    headers: { Authorization: twilioAuth(accountSid, authToken) },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok && response.status !== 404) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Twilio delete failed for ${sid}: ${response.status}${detail ? ` ${detail}` : ''}`)
  }
}

async function isAuthorized(request: Request) {
  if (isAuthorizedCronRequest(request)) return true
  const session = await getSessionUser()
  return session?.role === 'owner' || session?.role === 'manager'
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'
  const { accountSid, authToken } = getTwilioCredentials()
  const storage = getStorageService()
  const candidates = await listTwilioRecordingsReadyForDeletion(50)
  const results: Array<{ recordingSid?: string | null; objectKey?: string | null; status: string; error?: string }> = []

  for (const record of candidates) {
    try {
      if (!record.recording_sid || !record.cloudflare_object_key) {
        results.push({ recordingSid: record.recording_sid, objectKey: record.cloudflare_object_key, status: 'skipped_missing_reference' })
        continue
      }

      const head = await storage.headObject(record.cloudflare_object_key)
      if (!head || head.size <= 0) {
        results.push({ recordingSid: record.recording_sid, objectKey: record.cloudflare_object_key, status: 'skipped_r2_not_verified' })
        continue
      }

      if (!dryRun) {
        await deleteTwilioRecording(accountSid, authToken, record.recording_sid)
        await markTwilioRecordingDeleted(record.recording_sid)
      }

      results.push({
        recordingSid: record.recording_sid,
        objectKey: record.cloudflare_object_key,
        status: dryRun ? 'would_delete' : 'deleted',
      })
    } catch (error) {
      results.push({
        recordingSid: record.recording_sid,
        objectKey: record.cloudflare_object_key,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    checked: candidates.length,
    deleted: results.filter(item => item.status === 'deleted').length,
    results,
  })
}

export async function GET(request: Request) {
  return POST(new Request(`${request.url}${new URL(request.url).search ? '&' : '?'}dryRun=1`, request))
}
