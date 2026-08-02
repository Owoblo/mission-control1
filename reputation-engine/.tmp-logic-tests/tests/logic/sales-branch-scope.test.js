"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sales_permissions_1 = require("../../lib/server/sales-permissions");
const courage = {
    exp: Date.now() + 60000,
    userId: 'courage',
    name: 'Dr Courage',
    role: 'manager',
    branch: 'ottawa',
};
function lead(overrides) {
    return { id: 'lead', name: 'Customer', stage: 'new', createdAt: '2026-07-21', inventory: [], mediaAssets: [], callLogs: [], ...overrides };
}
(0, node_test_1.default)('Ottawa branch manager cannot read or edit another branch lead', () => {
    const windsorLead = lead({ branch: 'windsor', originCity: 'Windsor' });
    strict_1.default.equal((0, sales_permissions_1.leadMatchesSessionBranch)(windsorLead, courage), false);
    strict_1.default.equal((0, sales_permissions_1.canEditLead)(courage, windsorLead), false);
});
(0, node_test_1.default)('Ottawa branch manager can access explicit and legacy Ottawa records', () => {
    strict_1.default.equal((0, sales_permissions_1.leadMatchesSessionBranch)(lead({ branch: 'ottawa' }), courage), true);
    strict_1.default.equal((0, sales_permissions_1.leadMatchesSessionBranch)(lead({ originCity: 'Kanata' }), courage), true);
});
(0, node_test_1.default)('branch assignment wins over route geography for tenant isolation', () => {
    strict_1.default.equal((0, sales_permissions_1.leadMatchesSessionBranch)(lead({ branch: 'waterloo', destCity: 'Ottawa' }), courage), false);
});
(0, node_test_1.default)('owner remains company-wide', () => {
    strict_1.default.equal((0, sales_permissions_1.leadMatchesSessionBranch)(lead({ branch: 'windsor' }), { ...courage, role: 'owner', branch: undefined }), true);
});
