export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { getSalesLead, getCrmCallSidMapping } from '@/lib/server/sales-repository'
import { getTwilioCredentials } from '@/lib/server/runtime'
import {
  buildTwilioRecordingMediaUrl,
  downloadTwilioRecording,
  normalizeTwilioRecordingMediaUrl,
  normalizeTwilioRecordingSid,
  extractTwilioRecordingSidFromUrl,
  getTwilioRecordingBySid,
} from '@/lib/server/twilio-recordings'
import { getStorageService } from '@/lib/server/storage-service'
import { getCallRecordingByObjectKey, getCallRecordingBySid } from '@/lib/server/call-recordings'
import { listInboundCallEvents } from '@/lib/server/inbound-call-history'
import { attachInboundCallHistory } from '@/lib/inbound-call-history'

// Proxy Twilio recording audio — prevents browser from showing Basic Auth dialog
export async function GET(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session || !['owner','manager','sales_rep'].includes(session.role || '')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const objectKey = (searchParams.get('key') || '').trim()
  const recordingUrl = searchParams.get('url')
  const recordingSid = normalizeTwilioRecordingSid(searchParams.get('sid'))

  async function canRead(leadId?: string | null) {
    if (session!.role === 'owner' || (session!.role === 'manager' && !session!.branch)) return true
    const lead = leadId ? await getSalesLead(leadId) : null
    return !!lead && canHandleLeadCommunications(session, lead)
  }
  if (objectKey) {
    if (objectKey.includes('..') || objectKey.startsWith('/') || objectKey.includes('\\')) {
      return NextResponse.json({ error: 'Invalid recording reference' }, { status: 400 })
    }
    const record = await getCallRecordingByObjectKey(objectKey).catch(() => null)
    if (!record && !objectKey.startsWith('recordings/')) {
      return NextResponse.json({ error: 'Invalid recording reference' }, { status: 400 })
    }
    if (!(await canRead(record?.lead_id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

  const resolvedSid = recordingSid || extractTwilioRecordingSidFromUrl(normalizedUrl)
  let recordLeadId = resolvedSid ? (await getCallRecordingBySid(resolvedSid))?.lead_id : null
  const hintedLeadId = searchParams.get('leadId')
  if (!recordLeadId && resolvedSid && hintedLeadId && await canRead(hintedLeadId)) {
    const hintedLead = await getSalesLead(hintedLeadId)
    if (hintedLead) {
      // A caller-supplied lead ID alone grants nothing. Require immutable ingress
      // evidence for this exact recording, including legacy calls lacking mappings.
      const events = await listInboundCallEvents(hintedLeadId)
      const evidence = attachInboundCallHistory({ ...hintedLead, callLogs: [] }, events)
      if (evidence.callLogs?.some(entry => entry.recordingSid === resolvedSid)) recordLeadId = hintedLeadId
    }
  }
  if (!recordLeadId && session.role !== 'owner' && !(session.role === 'manager' && !session.branch)) {
    const providerRecord = resolvedSid ? await getTwilioRecordingBySid({ accountSid, authToken, recordingSid: resolvedSid }) : null
    const mapping = providerRecord?.callSid ? await getCrmCallSidMapping(providerRecord.callSid) : null
    recordLeadId = mapping?.leadId
  }
  if (!(await canRead(recordLeadId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
