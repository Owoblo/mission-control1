import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildTelephonyHealthAlertsFromEvents,
  buildTelephonyOperationalMetricsFromEvents,
  type DialerAnalyticsEventRecord,
} from '../../lib/server/telephony-monitoring'

function eventRecord(input: {
  ts: string
  event: string
  errorCode?: number
  errorMessage?: string
  failureReason?: string
  identity?: string
  rerouted?: boolean
  target?: string
}) {
  return {
    id: `ev_${Math.random().toString(36).slice(2, 8)}`,
    eventType: 'telephony_dialer_event',
    ts: input.ts,
    repId: 'user_1',
    leadId: 'lead_1',
    properties: {
      event: input.event,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      failureReason: input.failureReason,
      extra: {
        identity: input.identity,
        rerouted: input.rerouted,
        targetLabel: input.target,
      },
    },
    createdAt: input.ts,
  } satisfies DialerAnalyticsEventRecord
}

test('telephony operational metrics summarize queue and warm-transfer events', () => {
  const rows: DialerAnalyticsEventRecord[] = [
    eventRecord({ ts: '2026-05-27T10:00:00.000Z', event: 'queue_call_accept_started', identity: 'rep_a' }),
    eventRecord({ ts: '2026-05-27T10:00:02.000Z', event: 'queue_call_connected', identity: 'rep_b', rerouted: true }),
    eventRecord({ ts: '2026-05-27T10:00:05.000Z', event: 'queue_call_requeued', identity: 'rep_a', failureReason: 'No browser rep available' }),
    eventRecord({ ts: '2026-05-27T10:02:00.000Z', event: 'warm_transfer_started', target: 'Manager John' }),
    eventRecord({ ts: '2026-05-27T10:02:05.000Z', event: 'warm_transfer_bridge_ready', target: 'Manager John' }),
    eventRecord({ ts: '2026-05-27T10:03:00.000Z', event: 'warm_transfer_completed', target: 'Manager John' }),
    eventRecord({ ts: '2026-05-27T10:04:00.000Z', event: 'warm_transfer_returned', target: 'Manager John' }),
  ]

  const metrics = buildTelephonyOperationalMetricsFromEvents(rows)

  assert.equal(metrics.queuePickupAttemptsToday, 1)
  assert.equal(metrics.queueConnectedToday, 1)
  assert.equal(metrics.queueRequeuedToday, 1)
  assert.equal(metrics.queueReroutedToday, 1)
  assert.equal(metrics.warmTransfersStartedToday, 1)
  assert.equal(metrics.warmTransferBridgeReadyToday, 1)
  assert.equal(metrics.warmTransfersCompletedToday, 1)
  assert.equal(metrics.warmTransfersReturnedToday, 1)
  assert.equal(metrics.recentQueueEvents[0]?.identity, 'rep_a')
  assert.equal(metrics.recentWarmTransferEvents[0]?.target, 'Manager John')
})

test('telephony alerts surface critical and warning dialer issues', () => {
  const rows: DialerAnalyticsEventRecord[] = [
    eventRecord({ ts: '2026-05-27T11:00:00.000Z', event: 'call_error', errorCode: 53405, errorMessage: 'ICE negotiation failed' }),
    eventRecord({ ts: '2026-05-27T11:02:00.000Z', event: 'token_refresh_failed', errorMessage: 'Token fetch returned 401' }),
    eventRecord({ ts: '2026-05-27T11:03:00.000Z', event: 'queue_call_requeued', failureReason: 'No browser rep available' }),
  ]

  const alerts = buildTelephonyHealthAlertsFromEvents(rows)

  assert.equal(alerts.length, 3)
  assert.equal(alerts[0]?.severity, 'critical')
  assert.equal(alerts[0]?.errorCode, '53405')
  assert.equal(alerts[1]?.errorCode, 'token_refresh_failed')
  assert.equal(alerts[2]?.severity, 'warning')
  assert.match(alerts[2]?.text || '', /browser rep available/i)
})
