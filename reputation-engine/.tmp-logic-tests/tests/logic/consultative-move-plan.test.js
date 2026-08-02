"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const consultative_move_plan_1 = require("../../lib/consultative-move-plan");
(0, node_test_1.default)('unknown closing gap becomes a revisable storage journey', () => {
    const plan = (0, consultative_move_plan_1.buildConsultativeMovePlan)({
        factors: {
            destinationTiming: 'unknown',
            temporaryStorageNeeded: true,
            storageDurationKnown: false,
            storageEstimatedMonths: 2,
            packingPreference: 'self',
            cleaningPreference: 'none',
            protectionPreference: 'standard',
        },
        destinationKnown: false,
    });
    strict_1.default.deepEqual(plan.phases.map(phase => phase.id), ['prepare', 'move_out', 'hold', 'move_in', 'settle']);
    strict_1.default.match(plan.phases.find(phase => phase.id === 'hold')?.summary || '', /2 months/i);
    strict_1.default.ok(plan.assumptions.some(item => /actual duration adjusts/i.test(item)));
    strict_1.default.equal(plan.canBeBinding, false);
});
(0, node_test_1.default)('consultation asks only unresolved questions and recognizes included services', () => {
    const plan = (0, consultative_move_plan_1.buildConsultativeMovePlan)({
        factors: {
            destinationTiming: 'same_day',
            packingPreference: 'full_service',
            cleaningPreference: 'move_out',
            protectionPreference: 'enhanced',
        },
        lineItems: [
            { description: 'Professional Packing Service', amount: 900 },
            { description: 'Move-out Cleaning', amount: 350 },
            { description: 'Enhanced Valuation Protection', amount: 125 },
        ],
    });
    strict_1.default.deepEqual(plan.questions, []);
    strict_1.default.deepEqual(plan.assumptions, []);
    strict_1.default.equal(plan.canBeBinding, true);
});
(0, node_test_1.default)('a customer targeting the first week of August can receive a locked-scope estimate now', () => {
    const plan = (0, consultative_move_plan_1.buildConsultativeMovePlan)({
        lead: {
            moveDateFlexible: true,
            moveDateFlexibleReason: 'First week of August',
            originAddress: '27 Conroy Crescent, Guelph, ON',
            destCity: 'Ottawa',
            propertyType: 'apartment',
            followUpDate: '2026-08-01',
        },
        factors: {
            destinationTiming: 'same_day',
            packingPreference: 'self',
            cleaningPreference: 'none',
            protectionPreference: 'standard',
        },
        destinationKnown: false,
    });
    strict_1.default.equal(plan.estimateMode, 'locked_scope');
    strict_1.default.match(plan.estimateMessage, /price the known white-glove scope now/i);
    strict_1.default.ok(plan.knownNow.some(item => /first week of august/i.test(item)));
    strict_1.default.ok(plan.finalizeLater.includes('Exact move date and crew availability'));
    strict_1.default.ok(plan.nudges.some(item => item.key === 'confirm_exact_date' && /2026-08-01/.test(item.trigger)));
});
(0, node_test_1.default)('waiting for a home sale produces a sale milestone without withholding the estimate', () => {
    const plan = (0, consultative_move_plan_1.buildConsultativeMovePlan)({
        lead: {
            moveDateFlexible: true,
            moveDateFlexibleReason: 'Waiting for the house to sell',
            originAddress: '100 Riverside Drive, Windsor, ON',
            destCity: 'London',
            tentativeReason: 'waiting_for_sale',
            followUpDate: '2026-08-15',
        },
        factors: {
            destinationTiming: 'unknown',
            temporaryStorageNeeded: true,
            storageDurationKnown: false,
            storageEstimatedMonths: 2,
            packingPreference: 'full_service',
            cleaningPreference: 'move_out',
            protectionPreference: 'enhanced',
        },
        destinationKnown: false,
    });
    strict_1.default.equal(plan.estimateMode, 'locked_scope');
    strict_1.default.ok(plan.nudges.some(item => item.key === 'review_home_sale'));
    strict_1.default.ok(plan.nudges.some(item => item.key === 'confirm_storage_end'));
    strict_1.default.ok(plan.recommendedServices.includes('packing'));
    strict_1.default.ok(plan.recommendedServices.includes('storage'));
    strict_1.default.ok(plan.recommendedServices.includes('cleaning'));
    strict_1.default.ok(plan.recommendedServices.includes('protection'));
});
(0, node_test_1.default)('city-only destination asks one property question and preserves route assumptions', () => {
    const plan = (0, consultative_move_plan_1.buildConsultativeMovePlan)({
        lead: {
            moveDate: '2026-09-10',
            originAddress: '55 King Street, Waterloo, ON',
            destCity: 'Toronto',
        },
        factors: {
            destinationTiming: 'same_day',
            packingPreference: 'self',
            cleaningPreference: 'none',
            protectionPreference: 'standard',
        },
        destinationKnown: false,
    });
    strict_1.default.equal(plan.estimateMode, 'locked_scope');
    strict_1.default.ok(plan.questions.some(question => /house, apartment, condo, or storage/i.test(question)));
    strict_1.default.ok(plan.assumptions.some(item => /travel is modeled to toronto/i.test(item)));
    strict_1.default.ok(plan.nudges.some(item => item.key === 'confirm_destination_property'));
});
(0, node_test_1.default)('journey simulations cover common white-glove uncertainty without restarting the plan', () => {
    const simulations = [
        { name: 'exact local move', lead: { moveDate: '2026-08-20', originAddress: '1 A St', destAddress: '2 B St', propertyType: 'detached_house' }, destinationKnown: true, expected: 'firm' },
        { name: 'date TBD', lead: { moveDateFlexible: true, moveDateFlexibleReason: 'Mid-August', originAddress: '1 A St', destAddress: '2 B St' }, destinationKnown: true, expected: 'locked_scope' },
        { name: 'city known', lead: { moveDate: '2026-08-20', originAddress: '1 A St', destCity: 'Ottawa', propertyType: 'condo' }, destinationKnown: false, expected: 'locked_scope' },
        { name: 'sale pending', lead: { moveDateFlexible: true, moveDateFlexibleReason: 'Waiting for buyer', originAddress: '1 A St', destCity: 'London', tentativeReason: 'waiting_for_sale' }, destinationKnown: false, expected: 'locked_scope' },
        { name: 'planning inquiry', lead: { destCity: 'Windsor' }, destinationKnown: false, expected: 'provisional' },
    ];
    for (const simulation of simulations) {
        const plan = (0, consultative_move_plan_1.buildConsultativeMovePlan)({
            lead: simulation.lead,
            factors: {
                destinationTiming: 'same_day',
                packingPreference: 'self',
                cleaningPreference: 'none',
                protectionPreference: 'standard',
            },
            destinationKnown: simulation.destinationKnown,
        });
        strict_1.default.equal(plan.estimateMode, simulation.expected, simulation.name);
        strict_1.default.ok(plan.estimateMessage.length > 40, simulation.name);
    }
});
