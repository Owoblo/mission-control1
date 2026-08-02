"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const learning_profile_1 = require("../../lib/learning-profile");
function lead(overrides = {}) {
    return {
        id: 'lead-learning',
        name: 'Learning Test',
        stage: 'new',
        createdAt: '2026-07-25',
        inventory: [],
        mediaAssets: [],
        callLogs: [],
        ...overrides,
    };
}
(0, node_test_1.default)('learning profile stores operational features without raw notes or addresses', () => {
    const profile = (0, learning_profile_1.buildLeadLearningProfile)(lead({
        originAddress: '123 Private Street',
        destAddress: '456 Private Avenue',
        notes: 'Private customer narrative',
        moveDate: '2026-08-10',
        propertyType: 'detached_house',
        source: 'customer_referral',
        referralCustomerName: 'Referrer',
        inventory: [{ name: 'Sofa', room: 'Living Room', qty: 1, cubicFeet: 70, weightLbs: 180, source: 'mls' }],
        totalCubicFeet: 70,
        totalWeightLbs: 180,
        jobFactors: { originParkingOk: true, destParkingOk: true },
    }));
    const serialized = JSON.stringify(profile);
    strict_1.default.equal(serialized.includes('123 Private Street'), false);
    strict_1.default.equal(serialized.includes('Private customer narrative'), false);
    strict_1.default.equal(profile.acquisition.referral_named, true);
    strict_1.default.equal(profile.confidence.ready_for_binding_price, true);
});
(0, node_test_1.default)('unknown dimensions lower binding-price confidence', () => {
    const profile = (0, learning_profile_1.buildLeadLearningProfile)(lead({
        moveDate: '2026-08-10',
        originAddress: 'Origin',
        destAddress: 'Destination',
        inventory: [{ name: 'Unusual sculpture', qty: 1, source: 'manual' }],
        originAccess: 'Driveway',
    }));
    strict_1.default.equal(profile.scope.unknown_dimension_count, 1);
    strict_1.default.equal(profile.confidence.ready_for_binding_price, false);
});
(0, node_test_1.default)('linked partnership referrals count as named acquisition attribution', () => {
    const profile = (0, learning_profile_1.buildLeadLearningProfile)(lead({
        source: 'partner_referral',
        partnerReferralContactId: 'contact_1',
        partnerReferralName: 'Avery Agent',
    }));
    strict_1.default.equal(profile.acquisition.referral_named, true);
});
