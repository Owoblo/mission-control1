"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const dynamic_pricing_1 = require("../../lib/dynamic-pricing");
(0, node_test_1.default)('dynamic pricing uses operational constraints and exposes its reasons', () => {
    const result = (0, dynamic_pricing_1.adviseDynamicPrice)({
        baseAmount: 1000,
        daysUntilMove: 1,
        branchCapacityPct: 94,
        scopeConfidence: 'high',
        routeRisk: 'medium',
        accessRisk: 'low',
        complexity: 'multi_stop',
    });
    strict_1.default.equal(result.adjustmentPct, 15);
    strict_1.default.equal(result.recommendedAmount, 1150);
    strict_1.default.equal(result.requiresReview, true);
    strict_1.default.ok(result.reasons.some(reason => /capacity/i.test(reason)));
});
(0, node_test_1.default)('low-confidence scope is presented as a range and requires review', () => {
    const result = (0, dynamic_pricing_1.adviseDynamicPrice)({
        baseAmount: 1000,
        branchCapacityPct: 20,
        scopeConfidence: 'low',
    });
    strict_1.default.equal(result.requiresReview, true);
    strict_1.default.ok(result.floorAmount < result.recommendedAmount);
    strict_1.default.ok(result.ceilingAmount > result.recommendedAmount);
});
(0, node_test_1.default)('referral discount is explicit and capped', () => {
    const result = (0, dynamic_pricing_1.adviseDynamicPrice)({
        baseAmount: 1000,
        scopeConfidence: 'high',
        referralDiscountPct: 0.5,
    });
    strict_1.default.equal(result.adjustmentPct, -15);
    strict_1.default.equal(result.recommendedAmount, 850);
    strict_1.default.ok(result.reasons.some(reason => /referral discount/i.test(reason)));
});
