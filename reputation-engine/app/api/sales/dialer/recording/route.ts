export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { getTwilioCredentials } from '@/lib/server/runtime'
import {
  buildTwilioRecordingMediaUrl,
  downloadTwilioRecording,
  normalizeTwilioRecordingMediaUrl,
  normalizeTwilioRecordingSid,
} from '@/lib/server/twilio-recordings'
import { getStorageService } from '@/lib/server/storage-service'
import { getCallRecordingByObjectKey } from '@/lib/server/call-recordings'

// Proxy Twilio recording audio — prevents browser from showing Basic Auth dialog
export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const objectKey = (searchParams.get('key') || '').trim()
  const recordingUrl = searchParams.get('url')
  const recordingSid = normalizeTwilioRecordingSid(searchParams.get('sid'))

  if (objectKey) {
    if (objectKey.includes('..') || objectKey.startsWith('/') || objectKey.includes('\\')) {
      return NextResponse.json({ error: 'Invalid recording reference' }, { status: 400 })
    }
    const record = await getCallRecordingByObjectKey(objectKey).catch(() => null)
    if (!record && !objectKey.startsWith('recordings/')) {
      return NextResponse.json({ error: 'Invalid recording reference' }, { status: 400 })
    }
    try {
      const signedUrl = await getStorageService().getSignedReadUrl(objectKey, 900)
      return NextResponse.redirect(signedUrl, { status: 302 })
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Failed to create recording playback URL',
      }, { status: 502 })
    }
  }

  const { accountSid, authToken } = getTwilioCredentials()
  const normalizedUrl = recordingSid
    ? normalizeTwilioRecordingMediaUrl(recordingUrl) || buildTwilioRecordingMediaUrl(accountSid, recordingSid)
    : normalizeTwilioRecordingMediaUrl(recordingUrl)

  if (!normalizedUrl) {
    return NextResponse.json({ error: 'Invalid recording reference' }, { status: 400 })
  }

  try {
    const recording = await downloadTwilioRecording({
      accountSid,
      authToken,
      recordingUrl: normalizedUrl,
      recordingSid,
    })

    return new NextResponse(recording.buffer, {
      headers: {
        'Content-Type': recording.contentType || 'audio/mpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch recording from Twilio'
    const notFound = message.includes('404')
    return NextResponse.json({
      error: notFound
        ? 'Recording was not found in Twilio. It may have been deleted from Twilio storage.'
        : message,
    }, { status: notFound ? 404 : 502 })
  }
}
