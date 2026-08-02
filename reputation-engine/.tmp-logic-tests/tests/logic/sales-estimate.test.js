"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sales_1 = require("../../lib/sales");
function makeLead(overrides = {}) {
    return {
        id: 'lead_estimate_1',
        name: 'Multi Leg Customer',
        stage: 'new',
        createdAt: '2026-05-14',
        moveType: 'residential',
        inventory: [
            { name: 'Sectional Sofa', room: 'Living Room', qty: 1, cubicFeet: 90, weightLbs: 240, included: true, source: 'manual' },
            { name: 'King Bed Frame', room: 'Primary Bedroom', qty: 1, cubicFeet: 55, weightLbs: 180, included: true, source: 'manual' },
            { name: 'Mattress', room: 'Primary Bedroom', qty: 1, cubicFeet: 35, weightLbs: 110, included: true, source: 'manual' },
            { name: 'Wardrobe Boxes', room: 'Bedroom 2', qty: 12, cubicFeet: 72, weightLbs: 180, included: true, source: 'manual' },
            { name: 'Dining Table', room: 'Dining Room', qty: 1, cubicFeet: 45, weightLbs: 120, included: true, source: 'manual' },
        ],
        totalItems: 16,
        totalCubicFeet: 297,
        totalWeightLbs: 830,
        callLogs: [],
        roomBreakdown: {
            'Living Room': 1,
            'Primary Bedroom': 2,
            'Bedroom 2': 12,
            'Dining Room': 1,
        },
        ...overrides,
    };
}
(0, node_test_1.default)('estimateLeadQuote prices storage, storage delivery, and secondary stop legs distinctly', () => {
    const lead = makeLead();
    const factors = {
        estimatedBoxes: 40,
        packingStatus: 'not-started',
        disassemblyItemCount: 2,
    };
    const legs = [
        {
            id: 'leg_storage',
            label: 'House to Storage',
            type: 'storage',
            originAddress: '123 Main St',
            originCity: 'Ottawa',
            destAddress: '77 Storage Way',
            destCity: 'Ottawa',
            routeCategory: 'local',
            pricingStatus: 'ready',
            billableDistanceKm: 14,
            operationalDistanceKm: 14,
            billableDriveHours: 0.5,
            operationalDriveHours: 0.5,
            yardToOriginHours: 0.25,
            returnTripHours: 0.25,
            inventorySharePct: 100,
            scheduledDate: '2026-06-10',
        },
        {
            id: 'leg_delivery',
            label: 'Storage to New Home',
            type: 'storage_delivery',
            originAddress: '77 Storage Way',
            originCity: 'Ottawa',
            destAddress: '999 River Rd',
            destCity: 'Ottawa',
            routeCategory: 'local',
            pricingStatus: 'ready',
            billableDistanceKm: 18,
            operationalDistanceKm: 18,
            billableDriveHours: 0.75,
            operationalDriveHours: 0.75,
            yardToOriginHours: 0.25,
            returnTripHours: 0.25,
            inventorySharePct: 70,
            scheduledDate: '2026-06-12',
        },
        {
            id: 'leg_extra_stop',
            label: 'Boyfriend Drop',
            type: 'delivery',
            originAddress: '999 River Rd',
            originCity: 'Ottawa',
            destAddress: '25 Pine Ave',
            destCity: 'Ottawa',
            routeCategory: 'local',
            pricingStatus: 'ready',
            billableDistanceKm: 6,
            operationalDistanceKm: 6,
            billableDriveHours: 0.25,
            operationalDriveHours: 0.25,
            yardToOriginHours: 0,
            returnTripHours: 0,
            inventorySharePct: 30,
            scheduledDate: '2026-06-12',
        },
    ];
    const estimate = (0, sales_1.estimateLeadQuote)(lead, {
        quoteType: 'standard',
        routeContext: {
            routeCategory: 'local',
            pricingStatus: 'ready',
            originToDestinationHours: 0.5,
            yardToOriginHours: 0.25,
            returnTripHours: 0.25,
            billableDriveHours: 0.75,
            operationalDriveHours: 0.75,
            originToDestinationDistanceKm: 14,
            yardToOriginDistanceKm: 8,
            returnTripDistanceKm: 14,
            billableDistanceKm: 22,
            operationalDistanceKm: 36,
        },
        legs,
    }, factors);
    strict_1.default.equal(estimate.lineItems.length, 3);
    strict_1.default.ok((estimate.pricingBreakdown.intelligenceFlags.packingDayEstimate?.crewSize || 0) >= 2);
    strict_1.default.ok((estimate.pricingBreakdown.intelligenceFlags.packingDayEstimate?.hours || 0) >= 4);
    strict_1.default.ok(estimate.pricingBreakdown.adjustmentBreakdown.some(item => item.category === 'packing'));
    strict_1.default.ok(estimate.pricingBreakdown.adjustmentBreakdown.some(item => item.category === 'disassembly'));
    strict_1.default.match(estimate.lineItems[0].description, /\[Leg 1\] House to Storage/);
    strict_1.default.match(estimate.lineItems[0].details || '', /disassembly only at pickup/i);
    strict_1.default.match(estimate.lineItems[1].description, /\[Leg 2\] Storage to New Home/);
    strict_1.default.match(estimate.lineItems[1].details || '', /reassemble at destination/i);
    strict_1.default.match(estimate.lineItems[2].description, /\[Leg 3\] Boyfriend Drop/);
    strict_1.default.match(estimate.lineItems[2].details || '', /same load, extra stop on route/i);
    strict_1.default.match(estimate.lineItems[2].details || '', /30% of the overall shipment/i);
});
(0, node_test_1.default)('estimateLeadQuote keeps standard moving jobs at a two-mover minimum', () => {
    const lead = makeLead({
        inventory: [],
        totalItems: 0,
        totalCubicFeet: 0,
        totalWeightLbs: 0,
    });
    const estimate = (0, sales_1.estimateLeadQuote)(lead, {
        quoteType: 'standard',
        routeContext: {
            routeCategory: 'local',
            pricingStatus: 'ready',
            originToDestinationHours: 0.25,
            yardToOriginHours: 0.25,
            returnTripHours: 0.25,
            billableDriveHours: 0.25,
            operationalDriveHours: 0.75,
            originToDestinationDistanceKm: 4,
            yardToOriginDistanceKm: 3,
            returnTripDistanceKm: 5,
            billableDistanceKm: 7,
            operationalDistanceKm: 12,
        },
    });
    strict_1.default.equal(estimate.crewSize, 2);
    strict_1.default.match(estimate.lineItems[0].details || '', /2 professional movers/);
});
(0, node_test_1.default)('estimateLeadQuote includes return-to-yard travel when local route context omits a billable total', () => {
    const estimate = (0, sales_1.estimateLeadQuote)(makeLead({ totalCubicFeet: 80, totalWeightLbs: 410 }), {
        quoteType: 'standard',
        routeContext: {
            routeCategory: 'medium',
            pricingStatus: 'ready',
            yardToOriginHours: 0.25,
            originToDestinationHours: 1.5,
            returnTripHours: 1.5,
            yardToOriginDistanceKm: 4,
            originToDestinationDistanceKm: 119,
            returnTripDistanceKm: 103,
        },
    });
    strict_1.default.equal(estimate.pricingBreakdown.driveHours, 3.25);
});
(0, node_test_1.default)('estimateLeadQuote applies commercial direct costs and markup to margin math', () => {
    const estimate = (0, sales_1.estimateLeadQuote)(makeLead({
        moveType: 'commercial',
        totalCubicFeet: 900,
        totalWeightLbs: 2600,
    }), {
        quoteType: 'standard',
        routeContext: {
            routeCategory: 'local',
            pricingStatus: 'ready',
            originToDestinationHours: 0.5,
            yardToOriginHours: 0.25,
            returnTripHours: 0.25,
            billableDriveHours: 0.75,
            operationalDriveHours: 1,
            billableDistanceKm: 18,
            operationalDistanceKm: 28,
        },
    }, {
        commercialProtectionCost: 120,
        commercialLiabilityCost: 80,
        commercialAdminCost: 50,
        commercialOtherDirectCost: 25,
        commercialMarkupRate: 10,
    });
    const cost = estimate.pricingBreakdown.internalCostEstimate;
    strict_1.default.equal(cost.commercialDirectCost, 275);
    strict_1.default.ok((cost.commercialMarkupAmount || 0) > 0);
    strict_1.default.ok(estimate.lineItems.some(item => item.description === 'Commercial logistics markup'));
    strict_1.default.equal(estimate.deposit, 0);
    strict_1.default.equal(estimate.balance, estimate.total);
    strict_1.default.equal(cost.totalCost, cost.laborCost + cost.truckOpsCost + (cost.commissionCost || 0) + (cost.suppliesCost || 0) + 275);
    strict_1.default.equal(cost.computedRevenue, estimate.subtotal);
});
(0, node_test_1.default)('estimateLeadQuote clears stale parking penalties for obvious house-to-house moves', () => {
    const estimate = (0, sales_1.estimateLeadQuote)(makeLead({
        originAddress: '70 Peachtree Crescent, Cambridge, ON, Canada',
        destAddress: '106 Highland Park, Cambridge, ON, Canada',
        propertyType: 'detached_house',
        jobFactors: {
            originFloors: 1,
            originHasElevator: false,
            originParkingOk: false,
            destFloors: 1,
            destHasElevator: false,
            destParkingOk: false,
        },
    }), {
        quoteType: 'standard',
        routeContext: {
            routeCategory: 'local',
            pricingStatus: 'ready',
            originToDestinationHours: 0.25,
            yardToOriginHours: 0.5,
            returnTripHours: 0.25,
            billableDriveHours: 0.75,
            operationalDriveHours: 1,
            billableDistanceKm: 33,
            operationalDistanceKm: 40,
        },
    });
    strict_1.default.equal(estimate.pricingBreakdown.adjustmentBreakdown.find(item => item.category === 'access')?.hours || 0, 0);
    strict_1.default.ok(!estimate.pricingBreakdown.penalties.some(item => /limited truck access/i.test(item.label)));
});
(0, node_test_1.default)('estimateLeadQuote clears stale elevator flags for obvious house-to-house moves', () => {
    const estimate = (0, sales_1.estimateLeadQuote)(makeLead({
        originAddress: '70 Peachtree Crescent, Cambridge, ON, Canada',
        destAddress: '106 Highland Park, Cambridge, ON, Canada',
        propertyType: 'detached_house',
        jobFactors: {
            originFloors: 1,
            originHasElevator: true,
            originElevatorReserved: false,
            originParkingOk: true,
            destFloors: 1,
            destHasElevator: true,
            destElevatorReserved: false,
            destParkingOk: true,
        },
    }), {
        quoteType: 'standard',
        routeContext: {
            routeCategory: 'local',
            pricingStatus: 'ready',
            originToDestinationHours: 0.25,
            yardToOriginHours: 0.5,
            returnTripHours: 0.25,
            billableDriveHours: 0.75,
            operationalDriveHours: 1,
            billableDistanceKm: 33,
            operationalDistanceKm: 40,
        },
    });
    strict_1.default.equal(estimate.pricingBreakdown.adjustmentBreakdown.find(item => item.category === 'access')?.hours || 0, 0);
    strict_1.default.ok(!estimate.pricingBreakdown.penalties.some(item => /elevator not reserved/i.test(item.label)));
});
(0, node_test_1.default)('estimateLeadQuote treats storage quote type as trucked storage service, not labor-only', () => {
    const estimate = (0, sales_1.estimateLeadQuote)(makeLead({
        quoteType: 'storage',
        originAddress: '123 Main St, Ottawa, ON, Canada',
        destAddress: '77 Storage Way, Ottawa, ON, Canada',
    }), {
        quoteType: 'storage',
        routeContext: {
            routeCategory: 'local',
            pricingStatus: 'ready',
            originToDestinationHours: 0.25,
            yardToOriginHours: 0.5,
            returnTripHours: 0.25,
            billableDriveHours: 0.75,
            operationalDriveHours: 1,
            billableDistanceKm: 22,
            operationalDistanceKm: 36,
        },
    });
    strict_1.default.equal(estimate.lineItems[0].description, 'Storage Load/Unload Service');
    strict_1.default.match(estimate.lineItems[0].details || '', /furniture wrapping & padding/);
    strict_1.default.match(estimate.lineItems[0].details || '', /yard-to-home travel covered/);
    strict_1.default.equal(estimate.pricingBreakdown.driveHours, 0.75);
});
(0, node_test_1.default)('computeJobPenalties prices conjoint second pickup apartment access', () => {
    const result = (0, sales_1.computeJobPenalties)({
        conjointMove: true,
        originFloors: 6,
        originHasElevator: true,
        originElevatorReserved: true,
        originParkingOk: true,
        personBOriginFloors: 15,
        personBOriginHasElevator: true,
        personBOriginElevatorReserved: false,
        personBOriginParkingOk: false,
        destFloors: 1,
        destHasElevator: false,
        destParkingOk: true,
    });
    strict_1.default.equal(result.extraHours, 1.5);
    strict_1.default.ok(result.penalties.some(item => item.label === 'Second pickup – elevator not reserved (shared, wait time)' && item.hours === 0.75));
    strict_1.default.ok(result.penalties.some(item => item.label === 'Second pickup – limited truck access' && item.hours === 0.75));
});
(0, node_test_1.default)('estimateLeadQuote prices conjoint second pickup as incremental load plus final unload', () => {
    const lead = makeLead({
        inventory: [
            { name: 'Person A furniture', room: 'Living Room', qty: 1, cubicFeet: 1023, weightLbs: 5238, included: true, source: 'manual' },
            { name: 'Person B furniture', room: 'Bedroom', qty: 1, cubicFeet: 115, weightLbs: 590, included: true, source: 'manual', owner: 'person_b' },
        ],
        totalItems: 2,
        totalCubicFeet: 1138,
        totalWeightLbs: 5828,
        jobFactors: { conjointMove: true, personALabel: 'A', personBLabel: 'Person B' },
    });
    const estimate = (0, sales_1.estimateLeadQuote)(lead, {
        quoteType: 'standard',
        legs: [
            {
                id: 'leg_a',
                label: 'Leg 1 — Person A pickup',
                type: 'move',
                originAddress: '136 Marcy Crescent',
                destAddress: '1245 Franklin Boulevard',
                billableDistanceKm: 6,
                operationalDistanceKm: 6,
                billableDriveHours: 0.25,
                operationalDriveHours: 0.25,
                routeCategory: 'local',
                pricingStatus: 'ready',
                inventorySharePct: 90,
            },
            {
                id: 'leg_b',
                label: 'Leg 2 — Person B pickup + delivery',
                type: 'move',
                originAddress: '1245 Franklin Boulevard',
                destAddress: '55 McFarlane Drive',
                billableDistanceKm: 4,
                operationalDistanceKm: 4,
                billableDriveHours: 0.25,
                operationalDriveHours: 0.25,
                routeCategory: 'local',
                pricingStatus: 'ready',
                inventorySharePct: 100,
            },
        ],
    }, lead.jobFactors);
    strict_1.default.match(estimate.lineItems[0].details || '', /loads ~90%/);
    strict_1.default.match(estimate.lineItems[1].details || '', /loads remaining ~10%/);
    strict_1.default.equal(estimate.pricingBreakdown.bufferHours, 0);
    strict_1.default.ok(estimate.pricingBreakdown.loadHours < 23, `load hours should not double count: ${estimate.pricingBreakdown.loadHours}`);
    strict_1.default.ok(estimate.estimatedHours < 31, `conjoint estimate should stay under duplicated 40h quote: ${estimate.estimatedHours}`);
});
