"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const listing_inventory_discovery_1 = require("../../lib/listing-inventory-discovery");
strict_1.default.equal((0, listing_inventory_discovery_1.listingInventoryScanDedupeKey)('lead_1', 'listing_9'), 'listing_inventory_scan:lead_1:listing_9');
strict_1.default.equal((0, listing_inventory_discovery_1.listingInventoryScanInProgress)({
    qualificationState: { inventoryDiscovery: { status: 'queued' } },
}), true);
strict_1.default.equal((0, listing_inventory_discovery_1.listingInventoryScanInProgress)({
    qualificationState: { inventoryDiscovery: { status: 'scanning' } },
}), true);
strict_1.default.equal((0, listing_inventory_discovery_1.listingInventoryScanInProgress)({
    qualificationState: { inventoryDiscovery: { status: 'completed' } },
}), false);
strict_1.default.equal((0, listing_inventory_discovery_1.listingInventoryFallbackAllowed)({
    qualificationState: { inventoryDiscovery: { status: 'queued' } },
}), false, 'fallback must not fire while a scan is queued');
strict_1.default.equal((0, listing_inventory_discovery_1.listingInventoryFallbackAllowed)({
    qualificationState: { inventoryDiscovery: { status: 'scanning' } },
}), false, 'fallback must not fire while a scan is running');
strict_1.default.equal((0, listing_inventory_discovery_1.listingInventoryFallbackAllowed)({
    qualificationState: { inventoryDiscovery: { status: 'unavailable' } },
}), true, 'fallback becomes available after a definitive unavailable result');
strict_1.default.equal((0, listing_inventory_discovery_1.listingInventoryFallbackAllowed)({
    qualificationState: { inventoryDiscovery: { status: 'failed' } },
}), true, 'fallback becomes available after a definitive failure');
strict_1.default.equal((0, listing_inventory_discovery_1.listingInventoryFallbackAllowed)({
    inventory: [{ name: 'Sofa', room: 'Living Room', qty: 1 }],
}), false, 'fallback must not replace inventory already found');
strict_1.default.equal((0, listing_inventory_discovery_1.listingInventoryFallbackAllowed)({
    surveyRequestedAt: '2026-07-24T12:00:00.000Z',
}), false, 'fallback must not send the survey twice');
console.log('listing inventory discovery lifecycle tests passed');
