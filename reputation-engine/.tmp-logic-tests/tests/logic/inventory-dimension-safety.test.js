"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const inventory_dimension_safety_1 = require("../../lib/inventory-dimension-safety");
const item_presets_1 = require("../../lib/item-presets");
(0, node_test_1.default)('grouped box totals are converted to per-item values before multiplication', () => {
    const result = (0, inventory_dimension_safety_1.normalizeDetectedInventoryDimensions)({
        name: 'Stack of Moving Boxes',
        qty: 15,
        cubicFeet: 90,
        weightLbs: 600,
    });
    strict_1.default.equal(result.cubicFeet, 6);
    strict_1.default.equal(result.weightLbs, 40);
    strict_1.default.equal(result.adjusted, true);
});
(0, node_test_1.default)('grouped dining-chair totals are converted using catalog expectations', () => {
    const result = (0, inventory_dimension_safety_1.normalizeDetectedInventoryDimensions)({
        name: 'Upholstered Dining Chairs',
        qty: 4,
        cubicFeet: 20,
        weightLbs: 80,
    });
    strict_1.default.equal(result.cubicFeet, 5);
    strict_1.default.equal(result.weightLbs, 20);
    strict_1.default.equal(result.adjusted, true);
});
(0, node_test_1.default)('normal single-item survey dimensions remain unchanged', () => {
    const result = (0, inventory_dimension_safety_1.normalizeDetectedInventoryDimensions)({
        name: '3-seat tufted sofa',
        qty: 1,
        cubicFeet: 90,
        weightLbs: 220,
    });
    strict_1.default.equal(result.cubicFeet, 90);
    strict_1.default.equal(result.weightLbs, 220);
    strict_1.default.equal(result.adjusted, false);
});
(0, node_test_1.default)('piano accessories do not match a full piano preset', () => {
    strict_1.default.equal((0, item_presets_1.matchInventoryPreset)('Collapsible piano stand'), null);
    strict_1.default.equal((0, item_presets_1.matchInventoryPreset)('Keyboard stand'), null);
    strict_1.default.ok((0, item_presets_1.matchInventoryPreset)('Upright piano'));
    strict_1.default.ok((0, item_presets_1.matchInventoryPreset)('Piano bench'));
});
(0, node_test_1.default)('common customer furniture language matches the existing catalog', () => {
    strict_1.default.equal((0, item_presets_1.matchInventoryPreset)('End Tables')?.id, 'end-table-sm');
    strict_1.default.equal((0, item_presets_1.matchInventoryPreset)('Lazy Boy Couch')?.id, 'recliner');
    strict_1.default.equal((0, item_presets_1.matchInventoryPreset)('lazyboy recliner couch')?.id, 'recliner');
    strict_1.default.equal((0, item_presets_1.matchInventoryPreset)('Lay-Z-Boy recliner')?.id, 'recliner');
    strict_1.default.equal((0, item_presets_1.matchInventoryPreset)('Chest Of Drawers')?.id, 'dresser-sm');
    strict_1.default.equal((0, item_presets_1.matchInventoryPreset)('Single Bed')?.id, 'single-bed');
    strict_1.default.equal((0, item_presets_1.matchInventoryPreset)('Chairs')?.id, 'dining-chair');
    strict_1.default.equal((0, item_presets_1.matchInventoryPreset)('56 Inch Plasma Television')?.id, 'tv-flat-med');
    strict_1.default.equal((0, item_presets_1.matchInventoryPreset)('2× Pinball Machines (Which I Might Move Myself)')?.id, 'pinball-machine');
});
