"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const partnership_access_1 = require("../../lib/server/partnership-access");
const courage = {
    exp: Date.now() + 60000,
    userId: 'courage-user',
    name: 'Dr Courage',
    role: 'manager',
    branch: 'ottawa',
};
(0, node_test_1.default)('branch manager sees their market rather than the company-wide partnership database', () => {
    strict_1.default.equal((0, partnership_access_1.canSeeAllPartnershipMarkets)(courage), false);
    strict_1.default.equal((0, partnership_access_1.isPartnershipManager)(courage), true);
    strict_1.default.ok((0, partnership_access_1.partnershipMarketKeysForSession)(courage).includes('ottawa'));
    strict_1.default.equal((0, partnership_access_1.partnershipRecordMatchesSession)(courage, { city: 'Ottawa' }), true);
    strict_1.default.equal((0, partnership_access_1.partnershipRecordMatchesSession)(courage, { city: 'Windsor' }), false);
});
(0, node_test_1.default)('branch manager retains records explicitly assigned to them outside the literal city list', () => {
    strict_1.default.equal((0, partnership_access_1.partnershipRecordMatchesSession)(courage, {
        city: 'Rockland',
        assigned_manager_user_id: 'courage-user',
    }), true);
    strict_1.default.equal((0, partnership_access_1.partnershipRecordMatchesSession)(courage, {
        city: 'Rockland',
        owner_name: 'Dr Courage',
    }), true);
});
(0, node_test_1.default)('owner and unscoped central manager retain company-wide partnership access', () => {
    strict_1.default.equal((0, partnership_access_1.canSeeAllPartnershipMarkets)({ exp: courage.exp, role: 'owner' }), true);
    strict_1.default.equal((0, partnership_access_1.canSeeAllPartnershipMarkets)({ exp: courage.exp, role: 'manager' }), true);
});
