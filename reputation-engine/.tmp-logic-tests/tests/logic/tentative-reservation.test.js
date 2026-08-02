"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const tentative_reservation_1 = require("../../lib/tentative-reservation");
(0, node_test_1.default)('tentative reservation creates a real follow-up and expiry', () => {
    const update = (0, tentative_reservation_1.buildTentativeReservationUpdate)({
        moveDate: '2026-08-20',
        decisionDate: '2026-08-05',
        reason: 'waiting_for_closing',
        now: new Date('2026-07-25T12:00:00Z'),
    });
    strict_1.default.equal(update.stage, 'tentative');
    strict_1.default.equal(update.followUpDate, '2026-08-05');
    strict_1.default.equal(update.tentativeReservationStatus, 'active');
    strict_1.default.match(update.tentativeExpiresAt || '', /^2026-08-05/);
});
(0, node_test_1.default)('customer message explains the courtesy hold without pretending it is booked', () => {
    const message = (0, tentative_reservation_1.buildTentativeReservationSms)({
        customerName: 'Lauren O’Brien',
        moveDate: '2026-08-20',
        decisionDate: '2026-08-05',
    });
    strict_1.default.match(message, /courtesy hold/i);
    strict_1.default.match(message, /not a confirmed booking or deposit/i);
    strict_1.default.match(message, /adjust the plan with you/i);
});
(0, node_test_1.default)('past decision dates are rejected', () => {
    strict_1.default.throws(() => (0, tentative_reservation_1.buildTentativeReservationUpdate)({
        decisionDate: '2026-07-20',
        reason: 'other',
        now: new Date('2026-07-25T12:00:00Z'),
    }));
});
(0, node_test_1.default)('expired holds move to nurture and require human review without messaging the customer', () => {
    const result = (0, tentative_reservation_1.reconcileTentativeReservation)({
        id: 'lead-1',
        name: 'Customer',
        stage: 'tentative',
        tentativeReservationStatus: 'active',
        tentativeExpiresAt: '2026-07-24T23:59:59.999Z',
        createdAt: '2026-07-01T00:00:00Z',
    }, new Date('2026-07-25T12:00:00Z'));
    strict_1.default.equal(result.outcome, 'expired');
    strict_1.default.equal(result.lead.stage, 'nurture');
    strict_1.default.match(result.lead.followUpNote || '', /before promising the date again/i);
    strict_1.default.equal(result.lead.tentativeCustomerNotifiedAt, undefined);
});
(0, node_test_1.default)('booked tentative reservations reconcile as converted', () => {
    const result = (0, tentative_reservation_1.reconcileTentativeReservation)({
        id: 'lead-2',
        name: 'Customer',
        stage: 'booked',
        tentativeReservationStatus: 'active',
        createdAt: '2026-07-01T00:00:00Z',
    });
    strict_1.default.equal(result.outcome, 'converted');
    strict_1.default.equal(result.lead.tentativeReservationStatus, 'converted');
});
