"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sales_automation_qualification_1 = require("../../lib/sales-automation-qualification");
const sales_1 = require("../../lib/sales");
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
(0, node_test_1.default)('null access placeholders are not treated as confirmed access intelligence', () => {
    const candidate = lead({
        originAddress: '27 Conroy Crescent',
        destAddress: '335 Speedvale Avenue East',
        jobFactors: {
            originHasElevator: null,
            destHasElevator: null,
            hasPiano: null,
            hasSafe: null,
        },
    });
    strict_1.default.equal((0, sales_automation_qualification_1.hasAnyAccessDetails)(candidate), false);
});
(0, node_test_1.default)('ordinary house-to-house routes use normal access without forcing a generic questionnaire', () => {
    const candidate = lead({
        moveDate: '2026-09-18',
        originAddress: '317 Parkside Drive, McGregor, Ontario N0R 1J0',
        originCity: 'McGregor',
        destAddress: '88 King Street West, Windsor, Ontario',
        destCity: 'Windsor',
        propertyType: 'detached_house',
        inventory: [{ name: 'Sofa', qty: 1, source: 'customer_verification' }],
        email: 'customer@example.com',
    });
    strict_1.default.equal((0, sales_automation_qualification_1.hasRequiredAccessDetails)(candidate), true);
    strict_1.default.equal((0, sales_automation_qualification_1.getAutomationMissingFields)(candidate).includes('access'), false);
});
(0, node_test_1.default)('access is deferred until the destination is known', () => {
    const candidate = lead({
        moveDate: '2026-09-18',
        originAddress: '317 Parkside Drive, McGregor, Ontario N0R 1J0',
        originCity: 'McGregor',
        originAccess: 'Stairs reported on website form; flight count to confirm',
        inventory: [{ name: 'Sofa', qty: 1, source: 'customer_verification' }],
    });
    const missing = (0, sales_automation_qualification_1.getAutomationMissingFields)(candidate);
    strict_1.default.ok(missing.includes('destination'));
    strict_1.default.equal(missing.includes('access'), false);
});
(0, node_test_1.default)('origin access cannot clear unknown apartment destination logistics', () => {
    const candidate = lead({
        moveDate: '2026-09-18',
        originAddress: '317 Parkside Drive, McGregor, Ontario N0R 1J0',
        originCity: 'McGregor',
        originAccess: '2-car driveway — normal truck access',
        destAddress: 'Unit 1204, 88 King Street West, Windsor',
        destCity: 'Windsor',
        inventory: [{ name: 'Sofa', qty: 1, source: 'customer_verification' }],
        email: 'customer@example.com',
    });
    strict_1.default.equal((0, sales_automation_qualification_1.hasRequiredAccessDetails)(candidate), false);
    strict_1.default.ok((0, sales_automation_qualification_1.getAutomationMissingFields)(candidate).includes('access'));
    const ready = {
        ...candidate,
        destAccess: 'Floor 12 · elevator reserved · loading/back entrance confirmed',
        jobFactors: {
            destFloors: 12,
            destHasElevator: true,
            destElevatorReserved: true,
            destParkingOk: true,
        },
    };
    strict_1.default.equal((0, sales_automation_qualification_1.hasRequiredAccessDetails)(ready), true);
    strict_1.default.equal((0, sales_automation_qualification_1.getAutomationMissingFields)(ready).includes('access'), false);
});
(0, node_test_1.default)('human handoff metadata cannot erase factual quote blockers', () => {
    const candidate = lead({
        moveDate: '2026-09-18',
        originAddress: '317 Parkside Drive, McGregor, Ontario N0R 1J0',
        originCity: 'McGregor',
        originAccess: 'Stairs reported on website form; flight count to confirm',
        inventory: [{ name: 'Sofa', qty: 1, source: 'mls' }],
        listingScanSnapshot: {
            inventory: [{ name: 'Sofa', qty: 1 }],
            totalItems: 1,
            totalCubicFeet: 90,
            source: 'mls_photo_ai',
        },
        inventoryVerification: { startedAt: '2026-08-01T08:05:26.181Z', itemChoices: [], addedItems: [] },
    });
    const state = (0, sales_automation_qualification_1.buildLeadQualificationState)(candidate, {
        missingFields: [],
        nextBestAction: 'rep_reply_required',
        lastIntent: 'rep_owned_customer_reply',
    });
    strict_1.default.equal(state.quoteReady, false);
    strict_1.default.equal(state.routeKnown, false);
    strict_1.default.ok(state.missingFields?.includes('destination'));
    strict_1.default.ok(state.missingFields?.includes('inventory_confirmation'));
});
(0, node_test_1.default)('normalizing an existing lead heals stale quote-ready qualification', () => {
    const normalized = (0, sales_1.normalizeLead)(lead({
        moveDate: '2026-09-18',
        originAddress: '317 Parkside Drive, McGregor, Ontario N0R 1J0',
        originCity: 'McGregor',
        inventory: [{ name: 'Sofa', qty: 1, source: 'mls' }],
        listingScanSnapshot: {
            inventory: [{ name: 'Sofa', qty: 1 }],
            totalItems: 1,
            totalCubicFeet: 90,
            source: 'mls_photo_ai',
        },
        inventoryVerification: { startedAt: '2026-08-01T08:05:26.181Z', itemChoices: [], addedItems: [] },
        qualificationState: {
            quoteReady: true,
            routeKnown: false,
            accessKnown: true,
            missingFields: [],
            lastIntent: 'rep_owned_customer_reply',
            nextBestAction: 'rep_reply_required',
        },
    }));
    strict_1.default.equal(normalized.qualificationState?.quoteReady, false);
    strict_1.default.equal(normalized.qualificationState?.accessKnown, false);
    strict_1.default.ok(normalized.qualificationState?.missingFields?.includes('destination'));
    strict_1.default.ok(normalized.qualificationState?.missingFields?.includes('inventory_confirmation'));
    strict_1.default.equal(normalized.qualificationState?.lastIntent, 'rep_owned_customer_reply');
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
(0, node_test_1.default)('fast lane blocks malformed and incomplete intake even when a rep tries to send', () => {
    const issues = (0, sales_automation_qualification_1.getFastLaneReadinessIssues)(lead({
        moveDate: '2023-10-13',
        moveType: 'labor-only',
        originAddress: '2-12 high st',
        originCity: 'Waterloo',
        destAddress: '2-12 high st, Waterloo ontario n2l3x6 July 22',
        inventory: [],
    }), new Date('2026-07-21T12:00:00'));
    strict_1.default.equal(issues.includes('move_date'), true);
    strict_1.default.equal(issues.includes('destination_address'), true);
    strict_1.default.equal(issues.includes('destination_city'), true);
    strict_1.default.equal(issues.includes('inventory'), true);
    strict_1.default.equal(issues.includes('access'), true);
});
(0, node_test_1.default)('fast lane unlocks only for a current, fully scoped move', () => {
    const issues = (0, sales_automation_qualification_1.getFastLaneReadinessIssues)(lead({
        moveDate: '2026-07-24',
        moveType: 'labor-only',
        originAddress: '12 High St',
        originCity: 'Waterloo',
        destAddress: '88 King St W',
        destCity: 'Kitchener',
        inventory: [{ name: 'Sofa', qty: 1, source: 'customer_verification' }],
        originAccess: 'Ground floor; curb parking confirmed',
    }), new Date('2026-07-21T12:00:00'));
    strict_1.default.deepEqual(issues, []);
});
(0, node_test_1.default)('labour-only hourly booking can proceed with a date and work location', () => {
    const candidate = lead({
        moveDate: '2026-07-24',
        moveType: 'labor-only',
        originAddress: '12 High St',
        originCity: 'Waterloo',
        inventory: [],
    });
    const readiness = (0, sales_automation_qualification_1.getFastLaneReadinessIssues)(candidate, new Date('2026-07-21T12:00:00'));
    const blocking = (0, sales_automation_qualification_1.getFastLaneBlockingIssues)(candidate, 'labor', new Date('2026-07-21T12:00:00'));
    strict_1.default.equal(readiness.includes('inventory'), true);
    strict_1.default.equal(readiness.includes('access'), true);
    strict_1.default.deepEqual(blocking, []);
});
(0, node_test_1.default)('hourly truck booking also proceeds while remaining scope is confirmed before dispatch', () => {
    const candidate = lead({
        moveDate: '2026-07-24',
        originAddress: '12 High St',
        originCity: 'Waterloo',
        inventory: [],
    });
    const blocking = (0, sales_automation_qualification_1.getFastLaneBlockingIssues)(candidate, 'truck', new Date('2026-07-21T12:00:00'));
    strict_1.default.deepEqual(blocking, []);
});
(0, node_test_1.default)('fast lane truck size follows the selected crew size', () => {
    strict_1.default.equal((0, sales_automation_qualification_1.getFastLaneTruckSize)(2), '15ft');
    strict_1.default.equal((0, sales_automation_qualification_1.getFastLaneTruckSize)(3), '20ft');
    strict_1.default.equal((0, sales_automation_qualification_1.getFastLaneTruckSize)(4), '26ft');
});
(0, node_test_1.default)('automated pricing requires an explicit confirmed-scope threshold', () => {
    strict_1.default.equal((0, sales_automation_qualification_1.automatedEstimateSendingIsPaused)(), true);
    strict_1.default.equal((0, sales_automation_qualification_1.hasConfirmedAutomatedEstimateScope)(lead({ qualificationState: { lastIntent: 'awaiting_estimate_scope_confirmation' } })), false);
    strict_1.default.equal((0, sales_automation_qualification_1.hasConfirmedAutomatedEstimateScope)(lead({ qualificationState: { lastIntent: 'estimate_scope_confirmed' } })), true);
    strict_1.default.equal((0, sales_automation_qualification_1.isEstimateScopeConfirmation)('96 Scott Road to 456 Lorne Ave'), false);
    strict_1.default.equal((0, sales_automation_qualification_1.isEstimateScopeConfirmation)('Yes, those details are correct. Send the estimate.'), true);
    strict_1.default.equal((0, sales_automation_qualification_1.isEstimateScopeConfirmation)('The destination unit is 201'), false);
});
