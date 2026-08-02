"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const property_intelligence_1 = require("../../lib/server/property-intelligence");
function property(overrides) {
    return {
        propertyType: 'unknown',
        propertyTypeLabel: 'Unknown',
        estimatedFloors: 2,
        unitFloor: null,
        hasElevator: null,
        elevatorReservationLikely: false,
        parkingType: 'unknown',
        carryDistanceEstimate: 'unknown',
        stairsEstimate: 0,
        notes: [],
        confidence: 'low',
        source: [],
        ...overrides,
    };
}
(0, node_test_1.default)('property intelligence does not turn estimated building height into a customer floor', () => {
    const factors = (0, property_intelligence_1.propertyAccessToJobFactors)(property({
        propertyType: 'condo_highrise',
        estimatedFloors: 15,
        unitFloor: null,
        hasElevator: null,
        elevatorReservationLikely: true,
    }), 'dest');
    strict_1.default.equal(factors.destFloors, undefined);
    strict_1.default.equal(factors.destHasElevator, undefined);
    strict_1.default.equal(factors.destElevatorReserved, undefined);
});
(0, node_test_1.default)('normal residential driveway can become a safe parking default without invented stairs', () => {
    const access = property({
        propertyType: 'house_detached',
        propertyTypeLabel: 'Detached House',
        estimatedFloors: 1,
        unitFloor: 1,
        hasElevator: false,
        parkingType: 'driveway',
        carryDistanceEstimate: 'short',
        stairsEstimate: 0,
    });
    const factors = (0, property_intelligence_1.propertyAccessToJobFactors)(access, 'origin');
    strict_1.default.equal(factors.originFloors, 1);
    strict_1.default.equal(factors.originHasElevator, false);
    strict_1.default.equal(factors.originParkingOk, true);
    strict_1.default.equal(access.stairsEstimate, 0);
});
