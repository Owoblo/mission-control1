"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const move_execution_1 = require("../../lib/move-execution");
(0, node_test_1.default)('move execution log derives actual hours from first and last timestamps', () => {
    const entries = (0, move_execution_1.buildDefaultMoveExecutionEntries)().map(entry => {
        if (entry.phase === 'crew_depart_yard')
            return { ...entry, timestamp: '2026-06-05T09:00:00.000Z' };
        if (entry.phase === 'return_yard')
            return { ...entry, timestamp: '2026-06-05T15:45:00.000Z' };
        return entry;
    });
    strict_1.default.equal((0, move_execution_1.deriveActualHoursFromExecutionLog)(entries), 6.75);
});
(0, node_test_1.default)('move execution log normalizes predicted variance and learning fields', () => {
    const entries = (0, move_execution_1.buildDefaultMoveExecutionEntries)().map(entry => {
        if (entry.phase === 'crew_depart_yard')
            return { ...entry, timestamp: '2026-06-05T09:00:00.000Z' };
        if (entry.phase === 'return_yard')
            return { ...entry, timestamp: '2026-06-05T16:00:00.000Z', note: 'Back at yard' };
        return entry;
    });
    const log = (0, move_execution_1.normalizeMoveExecutionLog)({
        predictedHours: 6,
        varianceReason: 'Long carry at destination',
        entries,
        issues: [{
                id: 'issue_1',
                category: 'access',
                severity: 'medium',
                note: 'Elevator was slow',
                createdAt: '2026-06-05T16:00:00.000Z',
            }],
    });
    strict_1.default.equal(log?.actualHours, 7);
    strict_1.default.equal(log?.varianceHours, 1);
    strict_1.default.equal(log?.varianceReason, 'Long carry at destination');
    strict_1.default.equal(log?.issues?.length, 1);
});
