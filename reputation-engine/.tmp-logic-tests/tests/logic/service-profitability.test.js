"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const service_profitability_1 = require("../../lib/service-profitability");
(0, node_test_1.default)('service lines are classified into operational categories', () => {
    strict_1.default.equal((0, service_profitability_1.classifyServiceLine)('Professional packing labour'), 'packing');
    strict_1.default.equal((0, service_profitability_1.classifyServiceLine)('Move-out cleaning'), 'cleaning');
    strict_1.default.equal((0, service_profitability_1.classifyServiceLine)('Storage container delivery'), 'storage');
    strict_1.default.equal((0, service_profitability_1.classifyServiceLine)('Junk removal and disposal'), 'junk');
});
(0, node_test_1.default)('service plan catches unpriced scope and missing storage protection', () => {
    const plan = (0, service_profitability_1.buildServiceProfitabilityPlan)({
        lineItems: [
            { description: 'Moving service', amount: 1800 },
            { description: 'Move-out cleaning', amount: 0 },
        ],
        legs: [{ id: 'storage', label: 'Storage day', type: 'storage' }],
        jobFactors: { packingStatus: 'not-started' },
        pricingBreakdown: null,
    });
    strict_1.default.equal(plan.status, 'blocked');
    strict_1.default.ok(plan.protections.some(item => /packing labour/i.test(item)));
    strict_1.default.ok(plan.protections.some(item => /storage handling/i.test(item)));
    strict_1.default.ok(plan.protections.some(item => /price or an explicit/i.test(item)));
});
(0, node_test_1.default)('service plan reports a healthy fully priced move', () => {
    const plan = (0, service_profitability_1.buildServiceProfitabilityPlan)({
        lineItems: [{ description: 'Full-service moving', amount: 2000 }],
        pricingBreakdown: {
            pricingStatus: 'ready',
            intelligenceFlags: { missingDestination: false },
            internalCostEstimate: { totalCost: 700 },
        },
    });
    strict_1.default.equal(plan.grossMarginPct, 65);
    strict_1.default.equal(plan.status, 'healthy');
    strict_1.default.deepEqual(plan.protections, []);
});
(0, node_test_1.default)('direct cost is allocated across service packages without changing the total', () => {
    const plan = (0, service_profitability_1.buildServiceProfitabilityPlan)({
        lineItems: [
            { description: 'Moving service', amount: 1500 },
            { description: 'Professional packing', amount: 500 },
        ],
        pricingBreakdown: {
            pricingStatus: 'ready',
            intelligenceFlags: { missingDestination: false },
            internalCostEstimate: { totalCost: 800 },
        },
    });
    const allocated = plan.packages.reduce((sum, item) => sum + item.allocatedDirectCost, 0);
    strict_1.default.ok(Math.abs(allocated - 800) <= 0.01);
    strict_1.default.ok(plan.packages.every(item => item.grossMarginPct > 0));
});
