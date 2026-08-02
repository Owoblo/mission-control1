"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const subcontractors_1 = require("../../lib/subcontractors");
(0, node_test_1.default)('subcontractor scope exposes cities and operations without customer identity or exact addresses', () => {
    const lead = {
        id: 'lead-1',
        name: 'Private Customer',
        phone: '5195550101',
        email: 'private@example.com',
        originAddress: '123 King Street, London',
        originCity: 'London, ON',
        destAddress: '88 Queen Road, Kitchener',
        destCity: 'Kitchener, ON',
        originAccess: 'Unit 1204, elevator reserved',
        destAccess: 'Walk from 88 Queen Road',
        parkingNotes: 'Park behind 123 King Street',
        inventory: [{ id: 'i1', name: 'Sofa', qty: 1, included: true }],
    };
    const quote = {
        id: 'quote-1', number: 'Q1', clientId: 'c1', status: 'accepted', createdAt: '2026-07-28',
        lineItems: [], subtotal: 1000, hst: 130, total: 1130, deposit: 100, balance: 1030,
        estimatedHours: 5, minimumBillableHours: 4, maximumEstimatedHours: 7,
    };
    const scope = (0, subcontractors_1.buildSanitizedSubcontractorScope)(lead, quote);
    const serialized = JSON.stringify(scope);
    strict_1.default.equal(scope.origin_city, 'London');
    strict_1.default.equal(scope.destination_city, 'Kitchener');
    strict_1.default.equal(scope.estimated_hours_min, 4);
    strict_1.default.equal(scope.estimated_hours_max, 7);
    strict_1.default.equal(serialized.includes('Private Customer'), false);
    strict_1.default.equal(serialized.includes('private@example.com'), false);
    strict_1.default.equal(serialized.includes('123 King'), false);
    strict_1.default.equal(serialized.includes('88 Queen'), false);
    strict_1.default.equal(serialized.includes('1204'), false);
});
