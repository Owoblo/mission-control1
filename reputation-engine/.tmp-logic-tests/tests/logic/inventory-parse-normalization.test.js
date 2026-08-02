"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const inventory_parse_normalization_1 = require("../../lib/inventory-parse-normalization");
(0, node_test_1.default)('a television and stand are separate inventory objects', () => {
    strict_1.default.deepEqual((0, inventory_parse_normalization_1.expandCompoundInventoryPhrases)([
        { name: '56 Inch Plasma Television + Stand', qty: 1, room: 'Living Room' },
    ]), [
        { name: '56" TV', qty: 1, room: 'Living Room' },
        { name: 'TV Stand', qty: 1, room: 'Living Room' },
    ]);
});
(0, node_test_1.default)('ordinary single items remain unchanged', () => {
    const input = [{ name: 'Coffee Table', qty: 1, room: 'Living Room' }];
    strict_1.default.deepEqual((0, inventory_parse_normalization_1.expandCompoundInventoryPhrases)(input), input);
});
