"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logDialerAnalyticsEvent = logDialerAnalyticsEvent;
exports.logDialerPresence = logDialerPresence;
exports.logTelephonyCallOutcome = logTelephonyCallOutcome;
exports.listRecentDialerEvents = listRecentDialerEvents;
exports.listRecentDialerPresence = listRecentDialerPresence;
exports.getHealthyBrowserPresence = getHealthyBrowserPresence;
exports.getDialerIdentityAvailability = getDialerIdentityAvailability;
exports.buildTelephonyOperationalMetricsFromEvents = buildTelephonyOperationalMetricsFromEvents;
exports.buildTelephonyHealthAlertsFromEvents = buildTelephonyHealthAlertsFromEvents;
exports.buildTelephonyDashboardMetrics = buildTelephonyDashboardMetrics;
exports.listTelephonyCallOutcomes = listTelephonyCallOutcomes;
const sales_1 = require("../sales");
const runtime_1 = require("./runtime");
const DIALER_EVENT_TYPE = 'telephony_dialer_event';
const DIALER_PRESENCE_TYPE = 'telephony_presence';
const CALL_OUTCOME_EVENT_TYPE = 'telephony_call_outcome';
function normalizeProperties(properties) {
    return properties && typeof properties === 'object' ? properties : {};
}
function toQueryString(params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === '')
            return;
        query.set(key, String(value));
    });
    return query.toString();
}
async function insertAnalyticsRow(row) {
    const { url, headers } = (0, runtime_1.requireSupabaseEnv)();
    await fetch(`${url}/rest/v1/analytics_events`, {
        method: 'POST',
        headers: {
            ...headers,
            Prefer: 'return=minimal',
        },
        body: JSON.stringify(row),
        cache: 'no-store',
    });
}
async function queryAnalyticsRows(params) {
    const { url, headers } = (0, runtime_1.requireSupabaseEnv)();
    const query = toQueryString(params);
    const response = await fetch(`${url}/rest/v1/analytics_events?${query}`, {
        headers,
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error(`Failed analytics query: ${response.status}`);
    }
    return response.json();
}
function mapAnalyticsRow(row) {
    return {
        id: row.id,
        eventType: row.event_type,
        ts: row.ts,
        repId: row.rep_id ?? null,
        leadId: row.lead_id ?? null,
        properties: normalizeProperties(row.properties),
        createdAt: row.created_at,
    };
}
async function logDialerAnalyticsEvent(options) {
    const now = options.payload.timestamp || new Date().toISOString();
    const properties = {
        ...options.payload,
        timestamp: now,
        userId: options.userId || null,
        userName: options.userName || null,
        userRole: options.userRole || null,
    };
    await insertAnalyticsRow({
        id: (0, sales_1.uid)('ev'),
        event_type: DIALER_EVENT_TYPE,
        lead_id: options.payload.leadId || null,
        rep_id: options.userId || null,
        ts: now,
        properties,
        created_at: now,
    });
}
async function logDialerPresence(options) {
    const now = options.payload.timestamp || new Date().toISOString();
    const properties = {
        ...options.payload,
        timestamp: now,
        userId: options.userId || null,
        userName: options.userName || null,
        userRole: options.userRole || null,
    };
    await insertAnalyticsRow({
        id: (0, sales_1.uid)('ev'),
        event_type: DIALER_PRESENCE_TYPE,
        rep_id: options.userId || null,
        ts: now,
        properties,
        created_at: now,
    });
}
async function logTelephonyCallOutcome(options) {
    const now = options.timestamp || new Date().toISOString();
    await insertAnalyticsRow({
        id: (0, sales_1.uid)('ev'),
        event_type: CALL_OUTCOME_EVENT_TYPE,
        lead_id: options.leadId || null,
        rep_id: options.repId || null,
        ts: now,
        properties: {
            ...options.properties,
            timestamp: now,
        },
        created_at: now,
    });
}
async function listRecentDialerEvents(options = {}) {
    const sinceMinutes = options.sinceMinutes ?? 24 * 60;
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const cutoffIso = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();
    const rows = await queryAnalyticsRows({
        select: 'id,event_type,lead_id,rep_id,ts,properties,created_at',
        event_type: `eq.${DIALER_EVENT_TYPE}`,
        ts: `gte.${cutoffIso}`,
        order: 'ts.desc',
        limit: Math.max(limit * 3, 100),
    });
    const filtered = rows
        .map(mapAnalyticsRow)
        .filter(row => !options.userId || row.repId === options.userId)
        .filter(row => !options.sessionId || row.properties.sessionId === options.sessionId)
        .slice(0, limit);
    return filtered;
}
async function listRecentDialerPresence(options = {}) {
    const sinceMinutes = options.sinceMinutes ?? 10;
    const limit = Math.max(1, Math.min(options.limit ?? 100, 300));
    const cutoffIso = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();
    const rows = await queryAnalyticsRows({
        select: 'id,event_type,lead_id,rep_id,ts,properties,created_at',
        event_type: `eq.${DIALER_PRESENCE_TYPE}`,
        ts: `gte.${cutoffIso}`,
        order: 'ts.desc',
        limit,
    });
    return rows
        .map(mapAnalyticsRow)
        .filter(row => !options.userId || row.repId === options.userId)
        .filter(row => !options.identity || row.properties.identity === options.identity);
}
async function getHealthyBrowserPresence(options = {}) {
    const maxAgeSeconds = options.maxAgeSeconds ?? 90;
    const rows = await listRecentDialerPresence({
        sinceMinutes: Math.max(2, Math.ceil(maxAgeSeconds / 60) + 2),
        limit: 200,
    });
    const cutoff = Date.now() - maxAgeSeconds * 1000;
    const latestBySession = new Map();
    for (const row of rows) {
        const sessionId = String(row.properties.sessionId || '');
        if (!sessionId || latestBySession.has(sessionId))
            continue;
        latestBySession.set(sessionId, row);
    }
    const healthyStates = new Set(['ready', 'busy', 'incoming']);
    const availableStates = new Set(['ready', 'incoming']);
    const healthySessions = Array.from(latestBySession.values()).filter(row => {
        const ts = new Date(row.ts).getTime();
        const state = String(row.properties.state || '');
        const online = row.properties.online !== false;
        return ts >= cutoff && healthyStates.has(state) && online;
    });
    const availableSessions = healthySessions.filter(row => availableStates.has(String(row.properties.state || '')));
    return {
        active: healthySessions.length > 0,
        sessionCount: healthySessions.length,
        sessions: healthySessions.map(row => String(row.properties.sessionId || '')),
        identities: Array.from(new Set(healthySessions.map(row => String(row.properties.identity || '')).filter(Boolean))),
        availableIdentities: Array.from(new Set(availableSessions.map(row => String(row.properties.identity || '')).filter(Boolean))),
        userIds: healthySessions
            .map(row => String(row.properties.userId || ''))
            .filter(Boolean),
    };
}
function normalizeDialerIdentity(identity) {
    const trimmed = (identity || '').trim();
    if (!trimmed)
        return '';
    return trimmed.toLowerCase().startsWith('client:') ? trimmed.slice(7) : trimmed;
}
async function getDialerIdentityAvailability(options = {}) {
    const presence = await getHealthyBrowserPresence({
        maxAgeSeconds: options.maxAgeSeconds ?? 90,
    });
    const requestedIdentity = normalizeDialerIdentity(options.identity);
    const healthySet = new Set(presence.identities.map(normalizeDialerIdentity).filter(Boolean));
    const availableSet = new Set(presence.availableIdentities.map(normalizeDialerIdentity).filter(Boolean));
    const selectedIdentity = (requestedIdentity && availableSet.has(requestedIdentity) ? requestedIdentity : '') ||
        presence.availableIdentities.map(normalizeDialerIdentity).find(Boolean) ||
        null;
    return {
        requestedIdentity: requestedIdentity || null,
        requestedHealthy: requestedIdentity ? healthySet.has(requestedIdentity) : false,
        requestedAvailable: requestedIdentity ? availableSet.has(requestedIdentity) : false,
        selectedIdentity,
        presence,
    };
}
function summarizeCountMap(input) {
    return Array.from(input.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count);
}
function mapOperationalEvent(row) {
    const extra = (row.properties.extra && typeof row.properties.extra === 'object'
        ? row.properties.extra
        : {});
    return {
        ts: row.ts,
        event: String(row.properties.event || ''),
        callSid: String(row.properties.callSid || '') || undefined,
        identity: String(extra.identity || row.properties.identity || '') || undefined,
        target: String(extra.targetLabel || extra.target || '') || undefined,
        rerouted: extra.rerouted === true,
        message: String(row.properties.errorMessage ||
            row.properties.failureReason ||
            extra.reason ||
            '') || undefined,
    };
}
function buildTelephonyOperationalMetricsFromEvents(dialerEvents) {
    const queueEvents = dialerEvents
        .filter(row => [
        'queue_call_accept_started',
        'queue_call_connected',
        'queue_call_requeued',
    ].includes(String(row.properties.event || '')))
        .map(mapOperationalEvent);
    const warmTransferEvents = dialerEvents
        .filter(row => [
        'warm_transfer_started',
        'warm_transfer_bridge_ready',
        'warm_transfer_completed',
        'warm_transfer_returned',
        'warm_transfer_cancelled',
    ].includes(String(row.properties.event || '')))
        .map(mapOperationalEvent);
    return {
        queuePickupAttemptsToday: queueEvents.filter(event => event.event === 'queue_call_accept_started').length,
        queueConnectedToday: queueEvents.filter(event => event.event === 'queue_call_connected').length,
        queueRequeuedToday: queueEvents.filter(event => event.event === 'queue_call_requeued').length,
        queueReroutedToday: queueEvents.filter(event => event.event === 'queue_call_connected' && event.rerouted === true).length,
        warmTransfersStartedToday: warmTransferEvents.filter(event => event.event === 'warm_transfer_started').length,
        warmTransferBridgeReadyToday: warmTransferEvents.filter(event => event.event === 'warm_transfer_bridge_ready').length,
        warmTransfersCompletedToday: warmTransferEvents.filter(event => event.event === 'warm_transfer_completed').length,
        warmTransfersReturnedToday: warmTransferEvents.filter(event => event.event === 'warm_transfer_returned').length,
        warmTransfersCancelledToday: warmTransferEvents.filter(event => event.event === 'warm_transfer_cancelled').length,
        recentQueueEvents: queueEvents.slice(0, 8),
        recentWarmTransferEvents: warmTransferEvents.slice(0, 8),
    };
}
function buildTelephonyHealthAlertsFromEvents(dialerEvents) {
    const alerts = dialerEvents.flatMap(row => {
        const event = String(row.properties.event || '');
        const errorCode = row.properties.errorCode;
        const errorMessage = String(row.properties.errorMessage || row.properties.failureReason || '');
        if (errorCode || event === 'call_error') {
            return [{
                    ts: row.ts,
                    errorCode: String(errorCode || 'call_error'),
                    text: errorMessage || 'Dialer reported a call error.',
                    severity: 'critical',
                }];
        }
        if (event === 'token_refresh_failed') {
            return [{
                    ts: row.ts,
                    errorCode: 'token_refresh_failed',
                    text: errorMessage || 'Browser token refresh failed.',
                    severity: 'critical',
                }];
        }
        if (event === 'preflight_failed' || event === 'call_stuck_connecting') {
            return [{
                    ts: row.ts,
                    errorCode: event,
                    text: errorMessage || 'Dialer media negotiation failed.',
                    severity: 'warning',
                }];
        }
        if (event === 'queue_call_requeued') {
            return [{
                    ts: row.ts,
                    errorCode: 'queue_requeued',
                    text: errorMessage || 'Inbound queue pickup was requeued because no browser rep was available.',
                    severity: 'warning',
                }];
        }
        if (event === 'warm_transfer_cancelled') {
            return [{
                    ts: row.ts,
                    errorCode: 'warm_transfer_cancelled',
                    text: errorMessage || 'Warm transfer was cancelled before handoff completed.',
                    severity: 'warning',
                }];
        }
        return [];
    });
    const seen = new Set();
    return alerts.filter(alert => {
        const key = `${alert.ts}:${alert.errorCode}:${alert.text}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    }).slice(0, 20);
}
async function buildTelephonyDashboardMetrics() {
    const today = (0, sales_1.dateStamp)();
    const sinceIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const [callOutcomeRows, dialerEventRows] = await Promise.all([
        queryAnalyticsRows({
            select: 'id,event_type,lead_id,rep_id,ts,properties,created_at',
            event_type: `eq.${CALL_OUTCOME_EVENT_TYPE}`,
            ts: `gte.${sinceIso}`,
            order: 'ts.desc',
            limit: 600,
        }).catch(() => []),
        queryAnalyticsRows({
            select: 'id,event_type,lead_id,rep_id,ts,properties,created_at',
            event_type: `eq.${DIALER_EVENT_TYPE}`,
            ts: `gte.${sinceIso}`,
            order: 'ts.desc',
            limit: 600,
        }).catch(() => []),
    ]);
    // Filter out spam calls (impossible phone numbers > 15 digits) from all metrics and display
    const isSpamPhone = (phone) => typeof phone === 'string' && phone.replace(/\D/g, '').length > 15;
    const isSalesToday = (value) => {
        if (!value)
            return false;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime()))
            return false;
        return (0, sales_1.dateStamp)(parsed) === today;
    };
    const outcomes = callOutcomeRows
        .map(mapAnalyticsRow)
        .filter(row => isSalesToday(row.ts))
        .filter(row => !isSpamPhone(row.properties.phoneNumber));
    const dialerEvents = dialerEventRows
        .map(mapAnalyticsRow)
        .filter(row => isSalesToday(row.ts));
    const operationalMetrics = buildTelephonyOperationalMetricsFromEvents(dialerEvents);
    const alerts = buildTelephonyHealthAlertsFromEvents(dialerEvents);
    const answerTimes = outcomes
        .map(row => Number(row.properties.answerTimeSeconds))
        .filter(value => Number.isFinite(value) && value >= 0);
    const callsByRep = new Map();
    const callsBySource = new Map();
    outcomes.forEach(row => {
        const rep = String(row.properties.repName || row.properties.repId || row.repId || 'Unassigned');
        callsByRep.set(rep, (callsByRep.get(rep) || 0) + 1);
        const source = String(row.properties.branchNumber || row.properties.sourceNumber || 'Unknown');
        callsBySource.set(source, (callsBySource.get(source) || 0) + 1);
    });
    const browserAcceptedByCallSid = new Set(dialerEvents
        .filter(row => row.properties.event === 'call_accepted' && row.properties.callSid)
        .map(row => String(row.properties.callSid)));
    const totalCallsToday = outcomes.length;
    const missedCallsToday = outcomes.filter(row => row.properties.missed === true).length;
    const failedCallsToday = outcomes.filter(row => row.properties.failed === true).length;
    const mediaConnectionFailuresToday = dialerEvents.filter(row => Number(row.properties.errorCode) === 53405).length;
    const callsWithNoAudioToday = outcomes.filter(row => row.properties.audioConnected === false).length;
    const abandonedBeforeAnswerToday = outcomes.filter(row => row.properties.abandonedBeforeAnswer === true).length;
    const browserCallsToday = outcomes.filter(row => browserAcceptedByCallSid.has(String(row.properties.callSid || ''))).length;
    const mobileCallsToday = Math.max(totalCallsToday - browserCallsToday, 0);
    return {
        totalCallsToday,
        missedCallsToday,
        failedCallsToday,
        mediaConnectionFailuresToday,
        avgAnswerTimeSeconds: answerTimes.length
            ? Math.round(answerTimes.reduce((sum, value) => sum + value, 0) / answerTimes.length)
            : null,
        callsByRep: summarizeCountMap(callsByRep).slice(0, 6).map(item => ({ rep: item.key, count: item.count })),
        callsBySourceNumber: summarizeCountMap(callsBySource).slice(0, 6).map(item => ({ source: item.key, count: item.count })),
        browserCallsToday,
        mobileCallsToday,
        callsWithNoAudioToday,
        abandonedBeforeAnswerToday,
        queuePickupAttemptsToday: operationalMetrics.queuePickupAttemptsToday,
        queueConnectedToday: operationalMetrics.queueConnectedToday,
        queueRequeuedToday: operationalMetrics.queueRequeuedToday,
        queueReroutedToday: operationalMetrics.queueReroutedToday,
        warmTransfersStartedToday: operationalMetrics.warmTransfersStartedToday,
        warmTransferBridgeReadyToday: operationalMetrics.warmTransferBridgeReadyToday,
        warmTransfersCompletedToday: operationalMetrics.warmTransfersCompletedToday,
        warmTransfersReturnedToday: operationalMetrics.warmTransfersReturnedToday,
        warmTransfersCancelledToday: operationalMetrics.warmTransfersCancelledToday,
        recentQueueEvents: operationalMetrics.recentQueueEvents,
        recentWarmTransferEvents: operationalMetrics.recentWarmTransferEvents,
        alerts,
        // Raw outcomes for the calls drawer — last 30 calls today
        recentOutcomes: outcomes.slice(0, 30).map(row => ({
            ts: row.ts,
            leadId: row.leadId,
            direction: row.properties.direction,
            phone: row.properties.phoneNumber,
            answered: row.properties.answered,
            missed: row.properties.missed,
            durationSeconds: row.properties.durationSeconds,
            answerChannel: row.properties.answerChannel,
            repName: row.properties.repName,
        })),
    };
}
async function listTelephonyCallOutcomes(options = {}) {
    const sinceHours = options.sinceHours ?? 48;
    const date = options.date || (0, sales_1.dateStamp)();
    const limit = Math.max(1, Math.min(options.limit ?? 500, 1000));
    const sinceIso = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
    const rows = await queryAnalyticsRows({
        select: 'id,event_type,lead_id,rep_id,ts,properties,created_at',
        event_type: `eq.${CALL_OUTCOME_EVENT_TYPE}`,
        ts: `gte.${sinceIso}`,
        order: 'ts.desc',
        limit,
    }).catch(() => []);
    return rows
        .map(mapAnalyticsRow)
        .filter(row => (0, sales_1.dateStamp)(new Date(row.ts)) === date)
        .filter(row => !options.direction || row.properties.direction === options.direction)
        .filter(row => !options.missedOnly || row.properties.missed === true)
        .filter(row => !options.failedOnly || row.properties.failed === true)
        .map(row => ({
        ts: row.ts,
        leadId: row.leadId,
        repId: row.repId,
        repName: row.properties.repName,
        direction: row.properties.direction,
        phone: row.properties.phoneNumber,
        answered: row.properties.answered,
        missed: row.properties.missed,
        failed: row.properties.failed,
        durationSeconds: row.properties.durationSeconds,
        answerChannel: row.properties.answerChannel,
        branchNumber: row.properties.branchNumber,
        sourceNumber: row.properties.sourceNumber,
        callSid: row.properties.callSid,
    }));
}
