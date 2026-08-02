"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sales_automation_context_1 = require("../../lib/sales-automation-context");
const sales_automation_qualification_1 = require("../../lib/sales-automation-qualification");
function lead(overrides = {}) {
    return {
        id: 'lead_context_test',
        name: 'Siddarth Kumar',
        stage: 'pricing',
        createdAt: '2026-07-05',
        moveDate: '2026-07-11',
        moveType: 'packing',
        originCity: 'Windsor',
        destCity: 'Windsor',
        originAddress: 'Ontario Street',
        inventory: [],
        mediaAssets: [],
        callLogs: [],
        ...overrides,
    };
}
(0, node_test_1.default)('inbound context resolver splits two customer addresses and overwrites stale partial pickup', () => {
    const updated = (0, sales_automation_context_1.resolveInboundSalesContext)(lead(), '225 Wyandotte Street West, Windsor, N9A5X1 to 4755 Walker Road');
    strict_1.default.equal(updated.originAddress, '225 Wyandotte Street West, Windsor, N9A5X1');
    strict_1.default.equal(updated.destAddress, '4755 Walker Road');
    const missing = (0, sales_automation_qualification_1.getAutomationMissingFields)(updated);
    strict_1.default.equal(missing.includes('origin_address'), false);
    strict_1.default.equal(missing.includes('destination_address'), false);
});
(0, node_test_1.default)('inbound context resolver accepts postal-code-complete address without street suffix', () => {
    const updated = (0, sales_automation_context_1.resolveInboundSalesContext)(lead({ originAddress: '29 Alderton', originCity: 'Leamington' }), 'It is a HOUSE at 29 Alderton, Leamington, N8H 4L6');
    strict_1.default.equal(updated.originAddress, '29 Alderton, Leamington, N8H 4L6');
    strict_1.default.equal((0, sales_automation_qualification_1.getAutomationMissingFields)(updated).includes('origin_address'), false);
});
(0, node_test_1.default)('inbound context resolver captures packing inventory list from SMS', () => {
    const updated = (0, sales_automation_context_1.resolveInboundSalesContext)(lead({ originAddress: '225 Wyandotte Street West', destAddress: '4755 Walker Road' }), 'Recliner sofa, recliner, chair, coffee, table, side table, tables, television, computer, study table, dishwasher, microwave, study, chair, bicycle, there are some items in the closet also');
    const names = (updated.inventory || []).map(item => item.name);
    strict_1.default.ok(names.includes('Recliner Sofa'));
    strict_1.default.ok(names.includes('Coffee Table'));
    strict_1.default.ok(names.includes('Television'));
    strict_1.default.ok(names.includes('Closet Items'));
    strict_1.default.ok((updated.inventory || []).length >= 10);
    strict_1.default.ok((updated.totalItems || 0) >= 10);
    strict_1.default.match(updated.notes || '', /Customer listed packing\/moving items by SMS/);
});
(0, node_test_1.default)('inventory extractor ignores address-only messages', () => {
    const items = (0, sales_automation_context_1.extractCustomerInventoryItems)('225 Wyandotte Street West, Windsor to 4755 Walker Road');
    strict_1.default.equal(items.length, 0);
});
