"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const access_intelligence_1 = require("../../lib/access-intelligence");
(0, node_test_1.default)('access intelligence auto-clears simple house-style access', () => {
    const assessment = (0, access_intelligence_1.deriveAccessComplexityAssessment)({
        jobFactors: {
            originFloors: 1,
            originHasElevator: false,
            originParkingOk: true,
            destFloors: 1,
            destHasElevator: false,
            destParkingOk: true,
        },
    });
    strict_1.default.equal(assessment.status, 'clear');
    strict_1.default.equal(assessment.extraMinutes, 0);
    strict_1.default.equal(assessment.accessAutoClear, true);
    strict_1.default.equal(assessment.parkingAutoClear, true);
});
(0, node_test_1.default)('access intelligence flags elevator and truck access as operational setup time', () => {
    const assessment = (0, access_intelligence_1.deriveAccessComplexityAssessment)({
        jobFactors: {
            originFloors: 8,
            originHasElevator: true,
            originElevatorReserved: false,
            originParkingOk: false,
            destFloors: 1,
            destHasElevator: false,
            destParkingOk: true,
        },
    });
    strict_1.default.equal(assessment.status, 'high_risk');
    strict_1.default.equal(assessment.extraMinutes, 90);
    strict_1.default.match(assessment.summary, /elevator likely needs reservation/);
    strict_1.default.match(assessment.summary, /no direct truck access/);
});
(0, node_test_1.default)('access intelligence includes conjoint second pickup apartment setup time', () => {
    const assessment = (0, access_intelligence_1.deriveAccessComplexityAssessment)({
        jobFactors: {
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
        },
    });
    strict_1.default.equal(assessment.status, 'high_risk');
    strict_1.default.equal(assessment.extraMinutes, 90);
    strict_1.default.match(assessment.summary, /Second pickup: elevator likely needs reservation/);
    strict_1.default.match(assessment.summary, /Second pickup: no direct truck access/);
    strict_1.default.equal(assessment.parkingAutoClear, false);
});
(0, node_test_1.default)('access intelligence keeps unknown access from being treated as ready', () => {
    const assessment = (0, access_intelligence_1.deriveAccessComplexityAssessment)({});
    strict_1.default.equal(assessment.status, 'unknown');
    strict_1.default.equal(assessment.accessAutoClear, false);
    strict_1.default.equal(assessment.parkingAutoClear, false);
});
