"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const quote_pricing_safety_1 = require("../../lib/quote-pricing-safety");
const quote = {
    id: 'qt_safe',
    number: 'QT-INTERNAL',
    clientId: 'client_1',
    status: 'viewed',
    lineItems: [{ description: 'Moving', amount: 1080 }],
    subtotal: 1080,
    hst: 140.4,
    total: 1220.4,
    deposit: 244.08,
    balance: 976.32,
    createdAt: '2026-07-28',
};
(0, node_test_1.default)('deliverable quote pricing requires a positive total and priced line', () => {
    strict_1.default.equal((0, quote_pricing_safety_1.hasDeliverableQuotePricing)(quote), true);
    strict_1.default.equal((0, quote_pricing_safety_1.hasDeliverableQuotePricing)({ ...quote, total: 0 }), false);
    strict_1.default.equal((0, quote_pricing_safety_1.hasDeliverableQuotePricing)({ ...quote, lineItems: [] }), false);
});
(0, node_test_1.default)('metadata updates remain allowed but empty pricing cannot erase a snapshot', () => {
    strict_1.default.equal((0, quote_pricing_safety_1.quotePricingUpdateWouldEraseSnapshot)(quote, { internalNotes: 'Updated' }), false);
    strict_1.default.equal((0, quote_pricing_safety_1.quotePricingUpdateWouldEraseSnapshot)(quote, { total: 0, lineItems: [] }), true);
});
