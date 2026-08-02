"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const move_relationship_1 = require("../../lib/move-relationship");
(0, node_test_1.default)('opportunity health requires an owned, dated next step', () => {
    strict_1.default.equal((0, move_relationship_1.opportunityHealthLabel)(), 'Needs context');
    strict_1.default.equal((0, move_relationship_1.opportunityHealthLabel)({
        position: 'reviewing_estimate',
        bookingConfidence: 70,
        updatedAt: '2026-07-28T00:00:00.000Z',
    }), 'Needs next step');
});
(0, node_test_1.default)('lifecycle completion requires context, acquisition evidence and an explicit relationship review', () => {
    const context = {
        position: 'ready_to_book',
        bookingConfidence: 90,
        summary: 'Customer approved the scope.',
        nextAction: 'Collect deposit',
        nextActionDueAt: '2026-07-29T14:00:00.000Z',
        updatedAt: '2026-07-28T14:00:00.000Z',
    };
    strict_1.default.deepEqual((0, move_relationship_1.moveRelationshipLifecycleGaps)({ context, signals: [] }), ['acquisition evidence', 'relationship review']);
    strict_1.default.equal((0, move_relationship_1.isMoveRelationshipLifecycleComplete)({
        context: { ...context, relationshipReviewStatus: 'complete' },
        signals: [{ id: '1', channel: 'Google search', influence: 'first_touch', confidence: 'confirmed', observedAt: '2026-07-28' }],
    }), true);
});
(0, node_test_1.default)('the lead form source satisfies acquisition evidence without duplicate attribution', () => {
    const context = {
        position: 'discovery',
        bookingConfidence: 40,
        summary: 'Customer is collecting inventory.',
        nextAction: 'Follow up',
        nextActionDueAt: '2026-07-30T14:00:00.000Z',
        relationshipReviewStatus: 'complete',
        updatedAt: '2026-07-29T14:00:00.000Z',
    };
    strict_1.default.deepEqual((0, move_relationship_1.moveRelationshipLifecycleGaps)({
        context,
        signals: [],
        primarySource: 'direct_mail',
    }), []);
});
(0, node_test_1.default)('multi-touch attribution deduplicates exact evidence without collapsing distinct influence', () => {
    const signals = (0, move_relationship_1.normalizeAttributionSignals)([
        { id: '1', channel: 'Direct mail', influence: 'first_touch', confidence: 'confirmed', observedAt: '2026-07-28' },
        { id: '2', channel: ' direct mail ', influence: 'first_touch', confidence: 'likely', observedAt: '2026-07-28' },
        { id: '3', channel: 'Direct mail', influence: 'assisted', confidence: 'confirmed', observedAt: '2026-07-28' },
    ]);
    strict_1.default.equal(signals.length, 2);
});
(0, node_test_1.default)('a contact can hold multiple roles but duplicate role links are removed', () => {
    const base = { name: 'Jane Smith', confidence: 'confirmed', createdAt: '2026-07-28' };
    const relationships = (0, move_relationship_1.normalizeMoveRelationships)([
        { ...base, id: '1', contactId: 'contact-1', role: 'listing_realtor' },
        { ...base, id: '2', contactId: 'contact-1', role: 'listing_realtor' },
        { ...base, id: '3', contactId: 'contact-1', role: 'referring_realtor' },
    ]);
    strict_1.default.equal(relationships.length, 2);
});
(0, node_test_1.default)('the same contact can be connected to distinct sides of a move', () => {
    const base = { name: 'Mackie Jones', contactId: 'contact-2', role: 'building_manager', confidence: 'confirmed', createdAt: '2026-07-29' };
    const relationships = (0, move_relationship_1.normalizeMoveRelationships)([
        { ...base, id: '1', addressConnection: 'origin' },
        { ...base, id: '2', addressConnection: 'destination' },
    ]);
    strict_1.default.equal(relationships.length, 2);
    strict_1.default.equal(move_relationship_1.MOVE_RELATIONSHIP_CATEGORY_BY_ROLE.building_manager, 'maintenance_manager');
});
