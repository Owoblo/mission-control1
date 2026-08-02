"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const mobile_phone_access_1 = require("../../lib/server/mobile-phone-access");
const expires = Date.now() + 60000;
function session(role, branch) {
    return { exp: expires, userId: `${role}-${branch || 'central'}`, role, branch };
}
(0, node_test_1.default)('owner can switch among all configured mobile phone lines', () => {
    const owner = session('owner');
    const lines = (0, mobile_phone_access_1.listMobilePhoneLines)(owner);
    strict_1.default.equal((0, mobile_phone_access_1.canUseAllMobilePhoneLines)(owner), true);
    strict_1.default.ok(lines.length > 1);
    strict_1.default.ok(lines.some(line => line.workspace === 'sales'));
    strict_1.default.ok(lines.some(line => line.workspace === 'partnership'));
});
(0, node_test_1.default)('branch staff receive only the phone lines assigned to their branch', () => {
    const windsor = session('sales_rep', 'Windsor');
    const lines = (0, mobile_phone_access_1.listMobilePhoneLines)(windsor);
    strict_1.default.ok(lines.length > 0);
    strict_1.default.ok(lines.every(line => line.branch === 'windsor'));
    strict_1.default.ok(lines.every(line => line.workspace === 'sales'));
    strict_1.default.ok(lines.every(line => (0, mobile_phone_access_1.canUseMobilePhoneLine)(windsor, line.number)));
});
(0, node_test_1.default)('partnership managers receive only partnership lines for their market', () => {
    const manager = session('partnership_manager', 'Windsor');
    const lines = (0, mobile_phone_access_1.listMobilePhoneLines)(manager);
    strict_1.default.ok(lines.length > 0);
    strict_1.default.ok(lines.every(line => line.branch === 'windsor'));
    strict_1.default.ok(lines.every(line => line.workspace === 'partnership'));
});
(0, node_test_1.default)('a branch rep cannot select a different market caller ID', () => {
    const windsor = session('sales_rep', 'Windsor');
    const ottawaLine = (0, mobile_phone_access_1.listMobilePhoneLines)(session('owner'))
        .find(line => line.branch === 'ottawa');
    strict_1.default.ok(ottawaLine);
    strict_1.default.equal((0, mobile_phone_access_1.canUseMobilePhoneLine)(windsor, ottawaLine.number), false);
});
(0, node_test_1.default)('an unauthenticated device has no line access', () => {
    strict_1.default.deepEqual((0, mobile_phone_access_1.listMobilePhoneLines)(null), []);
    strict_1.default.equal((0, mobile_phone_access_1.canUseMobilePhoneLine)(null, '+15195550123'), false);
});
