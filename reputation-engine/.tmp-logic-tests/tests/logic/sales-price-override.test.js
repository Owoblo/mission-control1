"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sales_permissions_1 = require("../../lib/server/sales-permissions");
const rep = {
    exp: Date.now() + 60000,
    userId: 'rep',
    name: 'Sales Rep',
    role: 'sales_rep',
    branch: 'windsor',
};
const quote = {
    id: 'quote',
    number: 'QT-TEST',
    clientId: 'client',
    status: 'draft',
    lineItems: [{ description: 'Moving Services', amount: 1000 }],
    subtotal: 1000,
    hst: 130,
    total: 1130,
    deposit: 226,
    balance: 904,
    createdAt: '2026-07-24',
};
(0, node_test_1.default)('sales rep can revise a base estimate upward without a discount approval code', () => {
    const error = (0, sales_permissions_1.validateQuotePricingPermissions)(rep, quote, {
        lineItems: [{
                description: 'Moving Services — Agreed Rate',
                details: 'Scope increase after inventory review. Projected margin: unknown.',
                amount: 1250,
            }],
    });
    strict_1.default.equal(error, null);
});
(0, node_test_1.default)('sales rep still needs approval for a low-margin downward override', () => {
    const error = (0, sales_permissions_1.validateQuotePricingPermissions)(rep, quote, {
        lineItems: [{
                description: 'Moving Services — Agreed Rate',
                details: 'Customer requested a lower rate. Projected margin: 40%.',
                amount: 800,
            }],
    });
    strict_1.default.match(String(error), /approval code/i);
});
