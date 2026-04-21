import { NextResponse } from 'next/server'
import { listFollowUpLogs } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { parseSalesAlertNote } from '@/lib/server/sales-alerts'

type HealthProbe = {
  name: string
  status: 'ok' | 'idle'
  lastSeenAt: string | null
}

async function fetchLatestTimestamp(endpoint: string) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${endpoint}`, { headers, cache: 'no-store' })
  if (!response.ok) return null
  const rows = (await response.json()) as Array<{ created_at?: string }>
  return rows[0]?.created_at || null
}

function probe(name: string, lastSeenAt: string | null): HealthProbe {
  return {
    name,
    status: lastSeenAt ? 'ok' : 'idle',
    lastSeenAt,
  }
}

export async function GET() {
  const [lastInboundCallAt, lastInboundSmsAt, lastRecordingCallbackAt, lastTranscriptionAt, followUpLogs] = await Promise.all([
    fetchLatestTimestamp('inbound_leads?source=eq.twilio_call&select=created_at&order=created_at.desc&limit=1'),
    fetchLatestTimestamp('sms_messages?direction=eq.inbound&select=created_at&order=created_at.desc&limit=1'),
    fetchLatestTimestamp('inbound_leads?source=eq.twilio_call&raw_data->>recordingUrl=not.is.null&select=created_at&order=created_at.desc&limit=1'),
    fetchLatestTimestamp('inbound_leads?source=eq.twilio_call&raw_data->>transcript=not.is.null&select=created_at&order=created_at.desc&limit=1'),
    listFollowUpLogs().catch(() => []),
  ])

  const alertCutoff = Date.now() - 24 * 60 * 60 * 1000
  const recentAlerts = followUpLogs
    .filter(log => new Date(log.date || log.createdAt || 0).getTime() >= alertCutoff)
    .map(log => parseSalesAlertNote(log.notes))
    .filter(Boolean)

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    probes: [
      probe('voiceWebhook', lastInboundCallAt),
      probe('smsWebhook', lastInboundSmsAt),
      probe('recordingCallback', lastRecordingCallbackAt),
      probe('transcriptionCallback', lastTranscriptionAt),
    ],
    recentAlertCount: recentAlerts.length,
    recentAlerts: recentAlerts.slice(0, 10),
  })
}
