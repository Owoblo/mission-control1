"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const operations_1 = require("../../lib/operations");
const payouts = (0, operations_1.normalizeCrewPayouts)([
    {
        id: 'payout_1',
        workerName: 'Driver One',
        workerEmail: 'driver@example.com',
        workerPhone: '226-555-0100',
        role: 'driver',
        hourlyRate: 22,
        approvedHours: 6,
        laborPay: 132,
        paymentMethod: 'interac',
        payoutStatus: 'submitted',
        dispatchStatus: 'confirmed',
        dispatchToken: 'crew_token_123',
        dispatchSentAt: '2026-06-01T12:00:00.000Z',
        dispatchConfirmedAt: '2026-06-01T12:10:00.000Z',
    },
]);
strict_1.default.equal(payouts?.[0]?.dispatchStatus, 'confirmed');
strict_1.default.equal(payouts?.[0]?.dispatchToken, 'crew_token_123');
strict_1.default.equal(payouts?.[0]?.dispatchConfirmedAt, '2026-06-01T12:10:00.000Z');
const checklist = (0, operations_1.deriveOpsChecklist)({
    assignedCrew: [],
    crewPayouts: payouts,
    opsChecklist: {},
    truckReservationStatus: 'reserved',
});
strict_1.default.equal(checklist.crewAssigned, true);
strict_1.default.equal(checklist.truckReserved, true);
