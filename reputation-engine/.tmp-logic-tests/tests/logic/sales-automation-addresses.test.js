"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sales_automation_qualification_1 = require("../../lib/sales-automation-qualification");
function lead(overrides) {
    return {
        id: 'lead_address_test',
        name: 'Address Test',
        stage: 'new',
        createdAt: '2026-06-30',
        inventory: [],
        mediaAssets: [],
        callLogs: [],
        ...overrides,
    };
}
(0, node_test_1.default)('automation treats city-only route details as missing exact addresses', () => {
    const missing = (0, sales_automation_qualification_1.getAutomationMissingFields)(lead({
        moveDate: '2026-08-22',
        originCity: 'Waterloo',
        destCity: 'Windsor',
    }));
    strict_1.default.deepEqual(missing.slice(0, 2), ['origin_address', 'destination_address']);
    strict_1.default.equal(missing.includes('origin'), false);
    strict_1.default.equal(missing.includes('destination'), false);
});
(0, node_test_1.default)('automation accepts street-level pickup and dropoff addresses', () => {
    strict_1.default.equal((0, sales_automation_qualification_1.hasCompleteMoveAddress)('123 King St N, Waterloo, ON'), true);
    strict_1.default.equal((0, sales_automation_qualification_1.hasCompleteMoveAddress)('Waterloo'), false);
    strict_1.default.equal((0, sales_automation_qualification_1.hasCompleteMoveAddress)('29 Alderton, Leamington, N8H 4L6'), true);
    strict_1.default.equal((0, sales_automation_qualification_1.hasCompleteMoveAddress)('29 Alderton, Leamington'), false);
    strict_1.default.equal((0, sales_automation_qualification_1.hasCompleteMoveAddress)('unit 901'), false);
    strict_1.default.equal((0, sales_automation_qualification_1.hasCompleteMoveAddress)('unit 901, 962 Smyth Rd'), true);
    strict_1.default.equal((0, sales_automation_qualification_1.hasCompleteMoveAddress)('601-203 Catherine St, Ottawa'), true);
    const missing = (0, sales_automation_qualification_1.getAutomationMissingFields)(lead({
        moveDate: '2026-08-22',
        originAddress: '123 King St N',
        originCity: 'Waterloo',
        destAddress: '456 Ouellette Ave',
        destCity: 'Windsor',
        inventory: [{ name: 'Couch', qty: 1 }],
        originAccess: 'Elevator',
    }));
    strict_1.default.equal(missing.includes('origin_address'), false);
    strict_1.default.equal(missing.includes('destination_address'), false);
});
(0, node_test_1.default)('automation blocks auto-quote for apartment-style addresses until access is known', () => {
    const base = lead({
        moveDate: '2026-08-22',
        originAddress: '601-203 Catherine St, Ottawa',
        originCity: 'Ottawa',
        destAddress: '456 Ouellette Ave, Windsor',
        destCity: 'Windsor',
        inventory: [{ name: 'Couch', qty: 1 }],
        email: 'customer@example.com',
    });
    strict_1.default.equal((0, sales_automation_qualification_1.leadNeedsAccessBeforeAutomatedQuote)(base), true);
    strict_1.default.equal((0, sales_automation_qualification_1.leadNeedsAccessBeforeAutomatedQuote)({ ...base, originAccess: 'Apartment elevator, loading zone in front' }), false);
    strict_1.default.equal((0, sales_automation_qualification_1.leadNeedsAccessBeforeAutomatedQuote)({
        ...base,
        originAddress: '29 Alderton St, Leamington, N8H 4L6',
        propertyType: 'detached_house',
    }), false);
});
(0, node_test_1.default)('automation requires confirmation before treating MLS inventory as ready', () => {
    const missing = (0, sales_automation_qualification_1.getAutomationMissingFields)(lead({
        moveDate: '2026-08-22',
        originAddress: '123 King St N',
        originCity: 'Waterloo',
        destAddress: '456 Ouellette Ave',
        destCity: 'Windsor',
        listingScanSnapshot: {
            inventory: [{ name: 'Sofa', qty: 1 }],
            totalItems: 1,
            totalCubicFeet: 80,
            source: 'mls_photo_ai',
        },
        lastAutoEnrichmentAt: '2026-06-30T04:00:00.000Z',
        inventory: [{ name: 'Sofa', qty: 1, source: 'mls' }],
    }));
    strict_1.default.equal(missing.includes('inventory_confirmation'), true);
    strict_1.default.equal(missing.includes('inventory'), false);
});
(0, node_test_1.default)('automation does not call customer-provided inventory an MLS scan', () => {
    const missing = (0, sales_automation_qualification_1.getAutomationMissingFields)(lead({
        moveDate: '2026-08-22',
        originAddress: '123 King St N',
        originCity: 'Waterloo',
        destAddress: '456 Ouellette Ave',
        destCity: 'Windsor',
        lastAutoEnrichmentAt: '2026-06-30T04:00:00.000Z',
        inventory: [{ name: 'Sofa', qty: 1, source: 'customer_verification' }],
    }));
    strict_1.default.equal(missing.includes('inventory_confirmation'), false);
    strict_1.default.equal(missing.includes('inventory'), false);
});
