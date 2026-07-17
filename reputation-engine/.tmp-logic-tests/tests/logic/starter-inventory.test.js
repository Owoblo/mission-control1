"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const starter_inventory_1 = require("../../lib/starter-inventory");
const condoPlan = (0, starter_inventory_1.buildStarterInventoryPlan)({
    bedrooms: '2_bedrooms',
    propertyType: 'condo',
});
strict_1.default.ok(condoPlan);
strict_1.default.equal(condoPlan?.title.includes('Condo'), true);
strict_1.default.equal(condoPlan?.warnings.some(item => item.toLowerCase().includes('elevator')), true);
strict_1.default.equal((condoPlan?.items.length || 0) > 0, true);
const existing = [
    { room: 'Living Room', name: 'Sofa', qty: 1, included: true },
];
const merged = (0, starter_inventory_1.mergeStarterInventory)(existing, [
    { room: 'Living Room', name: 'Sofa', qty: 1, included: true },
    { room: 'Bedroom', name: 'Mattress · Queen', qty: 1, included: true },
]);
strict_1.default.equal(merged.length, 2);
strict_1.default.equal(merged.some(item => item.room === 'Bedroom'), true);
