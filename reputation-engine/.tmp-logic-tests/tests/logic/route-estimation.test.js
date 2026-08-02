"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const route_address_1 = require("../../lib/route-address");
const route_estimation_1 = require("../../lib/server/route-estimation");
(0, node_test_1.default)('route estimate infers Waterloo/KW branch from Waterloo to Kitchener addresses', () => {
    const branch = (0, route_estimation_1.resolveRouteBranchForEstimate)({
        origin: '55 Erb Street East, Waterloo, ON, Canada',
        destination: '10 King Street West, Kitchener, ON, Canada',
    });
    strict_1.default.equal(branch, 'waterloo');
});
(0, node_test_1.default)('route estimate infers Waterloo/KW branch from Cambridge addresses when branch is omitted', () => {
    const branch = (0, route_estimation_1.resolveRouteBranchForEstimate)({
        origin: '70 Peachtree Crescent, Cambridge, ON, Canada',
        destination: '106 Highland Park, Cambridge, ON, Canada',
    });
    strict_1.default.equal(branch, 'waterloo');
});
(0, node_test_1.default)('route estimate infers Waterloo/KW branch for an Elora to Wilmot move', () => {
    const branch = (0, route_estimation_1.resolveRouteBranchForEstimate)({
        origin: '1 Cutting Drive, Elora, ON, Canada',
        destination: '1349 Queen Street, Wilmot, ON, Canada',
    });
    strict_1.default.equal(branch, 'waterloo');
});
(0, node_test_1.default)('map fallback chooses the nearest yard for an unfamiliar geocoded area', () => {
    strict_1.default.equal((0, route_estimation_1.findNearestRouteBranch)({ lat: 43.6837, lng: -79.7663 }), 'waterloo');
    strict_1.default.equal((0, route_estimation_1.findNearestRouteBranch)({ lat: 42.8865, lng: -81.0188 }), 'london');
    strict_1.default.equal((0, route_estimation_1.findNearestRouteBranch)({ lat: 45.2692, lng: -75.7478 }), 'ottawa');
});
(0, node_test_1.default)('route estimate preserves non-zero short local routes', () => {
    const route = (0, route_estimation_1.normalizeDrivingRoute)(2100, 270);
    strict_1.default.equal(route.distanceKm, 2);
    strict_1.default.equal(route.driveHours, 0.25);
});
(0, node_test_1.default)('route estimate still allows true same-address routes to be zero', () => {
    const route = (0, route_estimation_1.normalizeDrivingRoute)(0, 0);
    strict_1.default.equal(route.distanceKm, 0);
    strict_1.default.equal(route.driveHours, 0);
});
(0, node_test_1.default)('cross-border Michigan destinations are not coerced into Ontario', () => {
    strict_1.default.equal((0, route_address_1.qualifyMoveAddress)('43175 Londonderry Court, Canton, Michigan, USA', 'Michigan'), '43175 Londonderry Court, Canton, Michigan, USA');
    strict_1.default.equal((0, route_address_1.inferAddressCountryContext)('Canton Township, Michigan'), 'us');
});
(0, node_test_1.default)('unqualified local addresses retain the Ontario default', () => {
    strict_1.default.equal((0, route_address_1.qualifyMoveAddress)('666 Chippawa Street', 'Windsor'), '666 Chippawa Street, Windsor, Ontario, Canada');
});
(0, node_test_1.default)('route sanity guard rejects a wrong-country distance mismatch', () => {
    const windsor = { lat: 42.3149, lng: -83.0364 };
    const cantonMichigan = { lat: 42.3086, lng: -83.4822 };
    strict_1.default.equal((0, route_estimation_1.isDrivingRoutePlausible)(windsor, cantonMichigan, 65), true);
    strict_1.default.equal((0, route_estimation_1.isDrivingRoutePlausible)(windsor, cantonMichigan, 400), false);
});
