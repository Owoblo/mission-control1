"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
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
