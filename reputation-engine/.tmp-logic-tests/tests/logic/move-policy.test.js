"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const move_policy_1 = require("../../lib/move-policy");
(0, node_test_1.default)('move policy keeps safes included as priced specialty handling', () => {
    const item = {
        name: 'Small Fireproof Safe',
        room: 'Bedroom',
        qty: 1,
        cubicFeet: 4,
        weightLbs: 85,
        included: true,
        source: 'manual',
    };
    const finding = (0, move_policy_1.getMovePolicyFinding)(item);
    const [pricedItem] = (0, move_policy_1.applyMovePolicyToInventory)([item]);
    strict_1.default.equal(finding?.category, 'specialty_fee');
    strict_1.default.equal(finding?.forceExclude, false);
    strict_1.default.equal(pricedItem.included, true);
    strict_1.default.notEqual(pricedItem.status, 'excluded');
    strict_1.default.match(pricedItem.notes || '', /safe handling/i);
});
(0, node_test_1.default)('move policy still blocks hot tubs from normal moving scope', () => {
    const item = {
        name: 'Hot Tub',
        room: 'Backyard',
        qty: 1,
        cubicFeet: 200,
        weightLbs: 900,
        included: true,
        source: 'manual',
    };
    const [pricedItem] = (0, move_policy_1.applyMovePolicyToInventory)([item]);
    strict_1.default.equal(pricedItem.included, false);
    strict_1.default.equal(pricedItem.exclusionReason, 'Hot tubs are not included. A separate specialty mover is required.');
});
