"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const inventory_sanitizer_1 = require("../../lib/inventory-sanitizer");
(0, node_test_1.default)('inventory sanitizer excludes apartment amenity common-area scan noise', () => {
    const inventory = [
        {
            name: 'Treadmill',
            room: 'Building Gym',
            qty: 1,
            cubicFeet: 65,
            weightLbs: 250,
            included: true,
            source: 'mls',
        },
        {
            name: 'Lobby Sofa',
            room: 'Lobby Lounge',
            qty: 1,
            cubicFeet: 90,
            weightLbs: 220,
            included: true,
            source: 'mls',
        },
    ];
    const sanitized = (0, inventory_sanitizer_1.sanitizeInventoryRooms)(inventory);
    strict_1.default.equal(sanitized[0].included, false);
    strict_1.default.equal(sanitized[0].status, 'excluded');
    strict_1.default.match(sanitized[0].exclusionReason || '', /amenity\/common area/i);
    strict_1.default.equal(sanitized[1].included, false);
    strict_1.default.equal(sanitized[1].status, 'excluded');
});
(0, node_test_1.default)('inventory sanitizer keeps real apartment unit furniture', () => {
    const inventory = [
        {
            name: '3-Seat Sofa',
            room: 'Living Room',
            sourcePhotoRoom: 'living_room',
            qty: 1,
            cubicFeet: 90,
            weightLbs: 220,
            included: true,
            source: 'rep_upload',
        },
    ];
    const sanitized = (0, inventory_sanitizer_1.sanitizeInventoryRooms)(inventory);
    strict_1.default.equal(sanitized[0].included, true);
    strict_1.default.equal(sanitized[0].status, undefined);
    strict_1.default.equal(sanitized[0].room, 'Living Room');
});
