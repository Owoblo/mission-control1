"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const telephony_monitoring_1 = require("../../lib/server/telephony-monitoring");
function eventRecord(input) {
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
    };
}
(0, node_test_1.default)('telephony operational metrics summarize queue and warm-transfer events', () => {
    const rows = [
        eventRecord({ ts: '2026-05-27T10:00:00.000Z', event: 'queue_call_accept_started', identity: 'rep_a' }),
        eventRecord({ ts: '2026-05-27T10:00:02.000Z', event: 'queue_call_connected', identity: 'rep_b', rerouted: true }),
        eventRecord({ ts: '2026-05-27T10:00:05.000Z', event: 'queue_call_requeued', identity: 'rep_a', failureReason: 'No browser rep available' }),
        eventRecord({ ts: '2026-05-27T10:02:00.000Z', event: 'warm_transfer_started', target: 'Manager John' }),
        eventRecord({ ts: '2026-05-27T10:02:05.000Z', event: 'warm_transfer_bridge_ready', target: 'Manager John' }),
        eventRecord({ ts: '2026-05-27T10:03:00.000Z', event: 'warm_transfer_completed', target: 'Manager John' }),
        eventRecord({ ts: '2026-05-27T10:04:00.000Z', event: 'warm_transfer_returned', target: 'Manager John' }),
    ];
    const metrics = (0, telephony_monitoring_1.buildTelephonyOperationalMetricsFromEvents)(rows);
    strict_1.default.equal(metrics.queuePickupAttemptsToday, 1);
    strict_1.default.equal(metrics.queueConnectedToday, 1);
    strict_1.default.equal(metrics.queueRequeuedToday, 1);
    strict_1.default.equal(metrics.queueReroutedToday, 1);
    strict_1.default.equal(metrics.warmTransfersStartedToday, 1);
    strict_1.default.equal(metrics.warmTransferBridgeReadyToday, 1);
    strict_1.default.equal(metrics.warmTransfersCompletedToday, 1);
    strict_1.default.equal(metrics.warmTransfersReturnedToday, 1);
    strict_1.default.equal(metrics.recentQueueEvents[0]?.identity, 'rep_a');
    strict_1.default.equal(metrics.recentWarmTransferEvents[0]?.target, 'Manager John');
});
(0, node_test_1.default)('telephony alerts surface critical and warning dialer issues', () => {
    const rows = [
        eventRecord({ ts: '2026-05-27T11:00:00.000Z', event: 'call_error', errorCode: 53405, errorMessage: 'ICE negotiation failed' }),
        eventRecord({ ts: '2026-05-27T11:02:00.000Z', event: 'token_refresh_failed', errorMessage: 'Token fetch returned 401' }),
        eventRecord({ ts: '2026-05-27T11:03:00.000Z', event: 'queue_call_requeued', failureReason: 'No browser rep available' }),
    ];
    const alerts = (0, telephony_monitoring_1.buildTelephonyHealthAlertsFromEvents)(rows);
    strict_1.default.equal(alerts.length, 3);
    strict_1.default.equal(alerts[0]?.severity, 'critical');
    strict_1.default.equal(alerts[0]?.errorCode, '53405');
    strict_1.default.equal(alerts[1]?.errorCode, 'token_refresh_failed');
    strict_1.default.equal(alerts[2]?.severity, 'warning');
    strict_1.default.match(alerts[2]?.text || '', /browser rep available/i);
});
