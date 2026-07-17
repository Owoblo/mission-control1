"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOVE_EXECUTION_PHASES = void 0;
exports.buildDefaultMoveExecutionEntries = buildDefaultMoveExecutionEntries;
exports.deriveActualHoursFromExecutionLog = deriveActualHoursFromExecutionLog;
exports.normalizeMoveExecutionLog = normalizeMoveExecutionLog;
exports.MOVE_EXECUTION_PHASES = [
    { phase: 'crew_depart_yard', label: 'Crew departed yard' },
    { phase: 'arrive_origin', label: 'Arrived at origin' },
    { phase: 'load_complete', label: 'Loading complete' },
    { phase: 'depart_origin', label: 'Departed origin' },
    { phase: 'arrive_destination', label: 'Arrived at destination' },
    { phase: 'unload_complete', label: 'Unloading complete' },
    { phase: 'return_yard', label: 'Returned to yard' },
];
function roundQuarterHour(hours) {
    return Math.round(Number(hours || 0) * 4) / 4;
}
function normalizeOptionalText(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function buildDefaultMoveExecutionEntries(existing) {
    const byPhase = new Map((existing || []).map(entry => [entry.phase, entry]));
    return exports.MOVE_EXECUTION_PHASES.map(({ phase, label }) => {
        const current = byPhase.get(phase);
        return {
            id: current?.id || `move_${phase}`,
            phase,
            label: current?.label || label,
            timestamp: normalizeOptionalText(current?.timestamp),
            note: normalizeOptionalText(current?.note),
            loggedAt: normalizeOptionalText(current?.loggedAt),
            loggedBy: normalizeOptionalText(current?.loggedBy),
        };
    });
}
function deriveActualHoursFromExecutionLog(entries) {
    const normalized = buildDefaultMoveExecutionEntries(entries);
    const first = normalized.find(entry => entry.timestamp)?.timestamp;
    const last = [...normalized].reverse().find(entry => entry.timestamp)?.timestamp;
    if (!first || !last)
        return undefined;
    const start = new Date(first).getTime();
    const end = new Date(last).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        return undefined;
    return roundQuarterHour((end - start) / (1000 * 60 * 60));
}
function normalizeMoveExecutionLog(log, options = {}) {
    if (!log)
        return undefined;
    const entries = buildDefaultMoveExecutionEntries(log.entries);
    const actualHours = roundQuarterHour(Number(log.actualHours || deriveActualHoursFromExecutionLog(entries) || 0));
    const predictedHours = roundQuarterHour(Number(log.predictedHours || options.predictedHours || 0));
    const varianceHours = actualHours > 0 && predictedHours > 0
        ? roundQuarterHour(actualHours - predictedHours)
        : undefined;
    return {
        predictedHours: predictedHours || undefined,
        actualHours: actualHours || undefined,
        varianceHours,
        varianceReason: normalizeOptionalText(log.varianceReason),
        entries: entries.some(entry => entry.timestamp || entry.note) ? entries : undefined,
        issues: log.issues?.filter(issue => issue.note?.trim()),
        receiptsNote: normalizeOptionalText(log.receiptsNote),
        customerFeedbackNote: normalizeOptionalText(log.customerFeedbackNote),
        updatedAt: new Date().toISOString(),
        updatedBy: normalizeOptionalText(options.actorName) || normalizeOptionalText(log.updatedBy),
    };
}
