"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const payment_records_1 = require("../../lib/payment-records");
function quote(overrides = {}) {
    return { id: 'q1', number: 'Q-1042', clientId: 'c1', status: 'accepted', lineItems: [], subtotal: 1000, hst: 130, total: 1130, deposit: 200, balance: 930, createdAt: '2026-07-17T00:00:00.000Z', ...overrides };
}
(0, node_test_1.default)('payment records preserve paid-to-date and remaining balance', () => {
    const first = (0, payment_records_1.buildPaymentRecord)({ quote: quote(), amount: 200, kind: 'deposit', method: 'etransfer' });
    strict_1.default.equal(first.paidBeforePayment, 0);
    strict_1.default.equal(first.paidAfterPayment, 200);
    strict_1.default.equal(first.balanceAfterPayment, 930);
    const second = (0, payment_records_1.buildPaymentRecord)({ quote: quote({ paymentRecords: [first] }), amount: 500, kind: 'partial', method: 'cash' });
    strict_1.default.equal(second.paidBeforePayment, 200);
    strict_1.default.equal(second.paidAfterPayment, 700);
    strict_1.default.equal(second.balanceAfterPayment, 430);
});
