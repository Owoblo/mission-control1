import { NextResponse } from 'next/server'
import { getCrmCallSidMapping, updateLeadCallLogEntry } from '@/lib/server/sales-repository'
import { providerAnswerLatencySeconds } from '@/lib/server/telephony-monitoring'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { authorizeTwilioWebhook } from '@/lib/server/security'

export const dynamic = 'force-dynamic'

function identityRepId(identity: string) {
  const prefix = 'saturn-rep-'
  return identity.startsWith(prefix) ? identity.slice(prefix.length) : null
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const rejection = await authorizeTwilioWebhook(request, rawBody)
  if (rejection) return rejection

  try {
    const params = new URLSearchParams(rawBody)
    const callbackUrl = new URL(request.url)
    const parentCallSid = callbackUrl.searchParams.get('parentCallSid') || params.get('ParentCallSid') || ''
    const childCallSid = params.get('CallSid') || ''
    const identity = callbackUrl.searchParams.get('identity') || ''
    const workspace = callbackUrl.searchParams.get('workspace') || ''
    const eventTimestamp = Date.parse(params.get('Timestamp') || '')
    const receivedAt = new Date().toISOString()
    const timestamp = Number.isFinite(eventTimestamp) ? new Date(eventTimestamp).toISOString() : receivedAt
    const callbackStatus = (params.get('CallStatus') || '').toLowerCase()
    const event = callbackStatus === 'in-progress' ? 'answered' : callbackStatus
    const allowedEvents = new Set(['initiated', 'ringing', 'answered', 'completed'])

    if (!parentCallSid || !childCallSid || !identity || !allowedEvents.has(event) || !['sales', 'partnership'].includes(workspace)) {
      return NextResponse.json({ error: 'Invalid call-leg status callback' }, { status: 400 })
    }

    const startedAt = Date.parse(callbackUrl.searchParams.get('startedAt') || '')
    const answerTimeSeconds = event === 'answered' && Number.isFinite(eventTimestamp)
      ? providerAnswerLatencySeconds(callbackUrl.searchParams.get('startedAt'), timestamp)
      : undefined
    const sequence = (params.get('SequenceNumber') || `${event}-${timestamp}`).replace(/[^A-Za-z0-9_-]/g, '_')
    const id = `ev_callleg_${childCallSid}_${sequence}`
    const mapping = await getCrmCallSidMapping(parentCallSid).catch(() => null)
    const repId = identityRepId(identity)
    let repName: string | undefined
    if (event === 'answered' && repId) {
      try {
        const { url: supabaseUrl, headers: supabaseHeaders } = requireSupabaseEnv()
        const userQuery = new URLSearchParams({ select: 'name', id: `eq.${repId}`, limit: '1' })
        const userResponse = await fetch(`${supabaseUrl}/rest/v1/app_users?${userQuery}`, { headers: supabaseHeaders, cache: 'no-store' })
        if (userResponse.ok) {
          const users = await userResponse.json() as Array<{ name?: string | null }>
          repName = users[0]?.name || undefined
        }
      } catch { /* The provider identity remains recorded if profile lookup fails. */ }
    }
    const properties = {
      event,
      direction: 'inbound',
      workspace,
      identity,
      parentCallSid,
      childCallSid,
      callStatus: callbackStatus,
      callDurationSeconds: Number(params.get('CallDuration') || 0) || undefined,
      errorCode: params.get('ErrorCode') || undefined,
      answerTimeSeconds,
      answerTimeMethod: answerTimeSeconds === undefined ? undefined : 'provider_leg_answer_timestamp',
      repName,
      startedAt: Number.isFinite(startedAt) ? new Date(startedAt).toISOString() : undefined,
      timestamp,
      sequenceNumber: params.get('SequenceNumber') || undefined,
      callbackSource: params.get('CallbackSource') || undefined,
    }
    const { url, headers } = requireSupabaseEnv()
    const response = await fetch(`${url}/rest/v1/analytics_events?on_conflict=id`, {
      method: 'POST',
      headers: {
        ...headers,
        Prefer: 'resolution=merge-duplicates,return=minimal',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id,
        event_type: 'telephony_call_leg_event',
        lead_id: mapping?.leadId || null,
        rep_id: identityRepId(identity),
        ts: timestamp,
        properties,
        created_at: receivedAt,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`Call-leg event persistence failed: ${response.status}`)

    if (event === 'answered' && mapping) {
      await updateLeadCallLogEntry(mapping.leadId, mapping.callLogId, {
        callOutcome: 'answered',
        answeredBy: identity.startsWith('sip:') ? 'sip' : 'browser',
        answeredAt: timestamp,
        answerLatencySeconds: answerTimeSeconds,
        answeredIdentity: identity,
        repId: repId || undefined,
        repName,
      } as any).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[dialer-leg-status] Failed to record provider call event', error)
    return NextResponse.json({ error: 'Failed to record call-leg event' }, { status: 503 })
  }
}
