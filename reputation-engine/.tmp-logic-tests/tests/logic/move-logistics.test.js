"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const move_logistics_1 = require("../../lib/move-logistics");
function item(name, cubicFeet, owner) {
    return { name, room: 'General', qty: 1, cubicFeet, weightLbs: cubicFeet * 4, included: true, source: 'manual', owner };
}
const conjointLegs = [
    {
        id: 'a_to_b',
        label: 'Person A pickup',
        type: 'move',
        originAddress: '1 First St',
        destAddress: '2 Second St',
        driveHours: 0.5,
        distanceKm: 18,
    },
    {
        id: 'b_to_dest',
        label: 'Person B pickup to destination',
        type: 'move',
        originAddress: '2 Second St',
        destAddress: '3 Final St',
        driveHours: 0.75,
        distanceKm: 22,
    },
];
(0, node_test_1.default)('move logistics recommends one-truck sequence when combined volume and hours fit', () => {
    const plan = (0, move_logistics_1.deriveMoveLogisticsPlan)({
        legs: conjointLegs,
        inventory: [item('Sofa', 200), item('Bedroom set', 250, 'person_b')],
        loadHours: 3,
        unloadHours: 2,
        totalHours: 6.5,
        startTime: '09:00',
    });
    strict_1.default.equal(plan.recommendation, 'one_truck_sequence');
    strict_1.default.equal(plan.truckCount, 1);
    strict_1.default.equal(plan.options.find(option => option.id === 'one_truck_sequence')?.crewCount, 2);
    strict_1.default.equal(plan.capacityUsedPct, 28);
    strict_1.default.equal(plan.finishTime, '3:30 PM');
});
(0, node_test_1.default)('move logistics keeps near-capacity conjoint moves available with a clear caution', () => {
    const plan = (0, move_logistics_1.deriveMoveLogisticsPlan)({
        legs: conjointLegs,
        inventory: [item('Sam load', 1102), item('Girlfriend load', 411, 'person_b')],
        loadHours: 6.5,
        unloadHours: 1.75,
        totalHours: 9.5,
        crewSize: 3,
        startTime: '08:00',
    });
    strict_1.default.equal(plan.recommendation, 'one_truck_sequence');
    strict_1.default.equal(plan.truckCount, 1);
    strict_1.default.equal(plan.capacityUsedPct, 95);
    strict_1.default.equal(plan.options.find(option => option.id === 'one_truck_sequence')?.viable, true);
    strict_1.default.equal(plan.options.find(option => option.id === 'one_truck_shuttle')?.viable, false);
    strict_1.default.match(plan.riskNotes.join(' '), /near capacity/);
    strict_1.default.match(plan.salesTalkingPoints.join(' '), /confirm boxes and hidden inventory/);
});
(0, node_test_1.default)('move logistics recommends split day for oversized long complex moves', () => {
    const plan = (0, move_logistics_1.deriveMoveLogisticsPlan)({
        legs: conjointLegs,
        inventory: [item('House A load', 1200), item('House B load', 900, 'person_b')],
        loadHours: 8,
        unloadHours: 5,
        totalHours: 14,
        startTime: '08:00',
    });
    strict_1.default.equal(plan.recommendation, 'split_day');
    strict_1.default.equal(plan.truckCount, 2);
    strict_1.default.match(plan.riskNotes.join(' '), /Projected 14h day/);
});
(0, node_test_1.default)('move logistics blocks final confidence until leg routes are calculated', () => {
    const plan = (0, move_logistics_1.deriveMoveLogisticsPlan)({
        legs: [{ ...conjointLegs[0], driveHours: undefined, distanceKm: undefined }],
        inventory: [item('Small load', 300)],
        loadHours: 2,
        unloadHours: 1.5,
        totalHours: 4,
    });
    strict_1.default.equal(plan.recommendation, 'needs_route_data');
    strict_1.default.equal(plan.missingRouteCount, 1);
});
(0, node_test_1.default)('move logistics recommends a later start when destination keys are late', () => {
    const plan = (0, move_logistics_1.deriveMoveLogisticsPlan)({
        legs: conjointLegs,
        inventory: [item('Sofa', 200), item('Bedroom set', 250, 'person_b')],
        loadHours: 3,
        unloadHours: 2,
        totalHours: 6.5,
        startTime: '09:00',
        destinationKeysTime: '16:00',
    });
    strict_1.default.equal(plan.constraintFit.status, 'adjust_start');
    strict_1.default.equal(plan.constraintFit.recommendedStartTime, '11:30');
    strict_1.default.match(plan.constraintFit.note, /Start around 11:30/);
});
(0, node_test_1.default)('move logistics escalates when timing constraints make the current plan late', () => {
    const plan = (0, move_logistics_1.deriveMoveLogisticsPlan)({
        legs: conjointLegs,
        inventory: [item('House A load', 700), item('House B load', 650, 'person_b')],
        loadHours: 4,
        unloadHours: 2.5,
        totalHours: 8,
        startTime: '09:00',
        latestFinishTime: '15:00',
    });
    strict_1.default.equal(plan.constraintFit.status, 'runs_late');
    strict_1.default.equal(plan.recommendation, 'two_truck_parallel');
    strict_1.default.equal(plan.options.find(option => option.id === 'two_truck_parallel')?.crewCount, 4);
    strict_1.default.match(plan.riskNotes.join(' '), /time constraint/);
});
