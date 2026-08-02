"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const inventory_copy_1 = require("../../lib/inventory-copy");
(0, node_test_1.default)('copied inventory is a clean customer-safe scope with consolidated handling', () => {
    const copy = (0, inventory_copy_1.buildInventorySnapshotCopyText)([
        { room: 'Living Room', name: 'End Table', qty: 2, cubicFeet: 3, notes: 'Dimensions matched from Saturn Star inventory presets; confirm size if atypical.' },
        { room: 'Living Room', name: 'Lazy Boy Recliner Couch', qty: 1, cubicFeet: 30, notes: 'Automatically parsed from customer SMS; rep review required.' },
        { room: 'Basement', name: 'Pinball Machine', qty: 2, cubicFeet: 25, notes: 'Very heavy — dolly required. which I might move myself' },
        { room: 'Packing scope', name: 'Recliner Chair', qty: 1, cubicFeet: 30, size: 'Lay flat for transport', notes: 'Captured from customer SMS; dimensions still need enrichment.' },
    ]);
    strict_1.default.match(copy, /## Living Room/);
    strict_1.default.match(copy, /\* 2 End Tables/);
    strict_1.default.match(copy, /\* 1 La-Z-Boy Reclining Sofa/);
    strict_1.default.match(copy, /## Additional Item/);
    strict_1.default.match(copy, /\*Customer may move these separately\.\*/);
    strict_1.default.match(copy, /## Estimated Total[\s\S]*\*\*6 items · 116 cu\. ft\.\*\*/);
    strict_1.default.match(copy, /### Special Handling/);
    strict_1.default.doesNotMatch(copy, /Automatically parsed|Saturn Star inventory presets|rep review required|dimensions still need enrichment/i);
});
