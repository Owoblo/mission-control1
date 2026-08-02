"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const payment_state_1 = require("../../lib/payment-state");
const lead = { id: 'lead-1', paymentStatus: 'deposit_received' };
const quote = { id: 'quote-1', total: 1000, deposit: 200, paymentRecords: [{ id: 'p1', amount: 200, status: 'captured' }] };
(0, node_test_1.default)('money state derives deposit truth from transaction records', () => {
    strict_1.default.equal((0, payment_state_1.deriveMoneyState)(quote, lead).status, 'deposit_received');
});
(0, node_test_1.default)('money state exposes stale lead flags as reconciliation work', () => {
    const result = (0, payment_state_1.deriveMoneyState)(quote, { ...lead, paymentStatus: 'paid_in_full' });
    strict_1.default.equal(result.status, 'reconciliation_required');
    strict_1.default.equal(result.requiresAttention, true);
});
(0, node_test_1.default)('money state distinguishes partial refunds', () => {
    const result = (0, payment_state_1.deriveMoneyState)({ ...quote, paymentRecords: [{ id: 'p1', amount: 200, status: 'partially_refunded', refundedAmount: 50 }] }, { ...lead, paymentStatus: 'deposit_received' });
    strict_1.default.equal(result.status, 'partially_refunded');
    strict_1.default.equal(result.netPaid, 150);
});
