"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const job_spine_1 = require("../../lib/job-spine");
function lead(overrides = {}) {
    return { id: 'lead-1', name: 'Alex Morgan', stage: 'new', createdAt: '2026-07-19T10:00:00Z', ...overrides };
}
function quote(overrides = {}) {
    return { id: 'quote-1', number: 'Q-1', clientId: 'client-1', status: 'draft', lineItems: [], subtotal: 1000, hst: 130, total: 1130, deposit: 250, balance: 880, createdAt: '2026-07-19T10:00:00Z', ...overrides };
}
(0, node_test_1.default)('job spine follows the operational truth rather than the sales label alone', () => {
    const current = lead({ stage: 'booked', paymentStatus: 'deposit_received', assignedCrew: ['crew-1'], crewPayouts: [{ id: 'p-1', workerName: 'Sam', role: 'driver', hourlyRate: 22, approvedHours: 0, laborPay: 0, dispatchStatus: 'confirmed' }] });
    strict_1.default.equal((0, job_spine_1.deriveOperatingStage)(current, quote({ acceptedAt: '2026-07-19T12:00:00Z', depositPaidAt: '2026-07-19T12:01:00Z' })), 'dispatched');
});
(0, node_test_1.default)('readiness exposes missing operational requirements transparently', () => {
    const readiness = (0, job_spine_1.deriveJobReadiness)(lead({ stage: 'booked', moveDate: '2026-07-20' }), quote());
    strict_1.default.notEqual(readiness.status, 'fully_ready');
    strict_1.default.ok(readiness.dimensions.flatMap(item => item.missing).includes('Crew not assigned'));
    strict_1.default.ok(readiness.dimensions.flatMap(item => item.missing).includes('Deposit unpaid'));
});
(0, node_test_1.default)('exceptions surface ownership and customer response risks', () => {
    const exceptions = (0, job_spine_1.deriveOperatingExceptions)(lead({ lastInboundAt: '2026-07-19T12:00:00Z' }), null);
    strict_1.default.ok(exceptions.some(item => item.title === 'No owner assigned'));
    strict_1.default.ok(exceptions.some(item => item.title === 'Customer is waiting'));
});
(0, node_test_1.default)('completion exception exposes unpaid balance and missing care follow-up', () => {
    const exceptions = (0, job_spine_1.deriveOperatingExceptions)(lead({ stage: 'completed', paymentStatus: 'deposit_received' }), quote({ balance: 800 }));
    strict_1.default.ok(exceptions.some(item => item.title === 'Completed but unpaid'));
    strict_1.default.ok(exceptions.some(item => item.title === 'Care follow-up not sent'));
    strict_1.default.ok(exceptions.some(item => item.title === 'Relationship context unfinished'));
});
