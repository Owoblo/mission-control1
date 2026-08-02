"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sales_automation_inventory_sms_1 = require("../../lib/sales-automation-inventory-sms");
function lead(overrides) {
    return {
        id: 'lead_sms_inventory',
        name: 'Salma Elasfar',
        stage: 'new',
        createdAt: '2026-06-30',
        inventory: [],
        mediaAssets: [],
        callLogs: [],
        ...overrides,
    };
}
(0, node_test_1.default)('MLS inventory SMS is grouped by room for customer confirmation', () => {
    const body = (0, sales_automation_inventory_sms_1.buildMlsInventoryConfirmationSms)(lead({
        inventory: [
            { room: 'Living Room', name: 'Sofa', qty: 1, included: true, source: 'mls' },
            { room: 'Bedroom 1', name: 'Queen Bed', qty: 1, included: true, source: 'mls' },
        ],
    }));
    strict_1.default.match(body, /Living Room: Sofa/);
    strict_1.default.match(body, /Bedroom 1: Queen Bed/);
    strict_1.default.match(body, /anything shown staying behind/i);
    strict_1.default.match(body, /don't have to list everything from scratch/i);
    strict_1.default.doesNotMatch(body, /reply yes/i);
});
(0, node_test_1.default)('MLS inventory SMS does not claim a scan when only customer inventory exists', () => {
    const body = (0, sales_automation_inventory_sms_1.buildMlsInventoryConfirmationSms)(lead({
        inventory: [
            { room: 'Packing scope', name: 'Recliner Sofa', qty: 1, included: true, source: 'customer_verification' },
        ],
    }));
    strict_1.default.match(body, /couldn't build a clear starter inventory from the property information in our system/i);
    strict_1.default.doesNotMatch(body, /pulled a starter inventory/i);
    strict_1.default.doesNotMatch(body, /reply yes/i);
});
(0, node_test_1.default)('SMS inventory updates can exclude scanned items and add hidden inventory', () => {
    const baseLead = lead({
        inventory: [
            { room: 'Living Room', name: 'Sofa', qty: 1, included: true },
            { room: 'Bedroom 1', name: 'Queen Bed', qty: 1, included: true },
        ],
    });
    const reference = (0, sales_automation_inventory_sms_1.buildInventorySmsReference)(baseLead);
    const sofaKey = reference.find(item => item.name === 'Sofa')?.itemKey || '';
    const updated = (0, sales_automation_inventory_sms_1.mergeInventorySmsUpdate)(baseLead, {
        itemChoices: [{ itemKey: sofaKey, decision: 'not_going', note: 'Staying behind' }],
        addedItems: [{ room: 'Garage', name: 'Tool chest', qty: 1 }],
        complete: true,
        summary: 'Sofa is staying and tool chest was added.',
    }, '2026-06-30T05:00:00.000Z');
    strict_1.default.equal(updated.inventoryVerification?.completedAt, '2026-06-30T05:00:00.000Z');
    strict_1.default.equal(updated.inventory.find(item => item.name === 'Sofa')?.included, false);
    strict_1.default.equal(updated.inventory.find(item => item.name === 'Tool chest')?.source, 'customer_verification');
    strict_1.default.equal(updated.totalItems, 2);
});
