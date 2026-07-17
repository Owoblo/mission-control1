"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const inventory_verification_1 = require("../../lib/inventory-verification");
(0, node_test_1.default)('inventory verification converts customer decisions into scoped inventory updates', () => {
    const inventory = [
        { id: 'item_1', room: 'Living Room', name: 'Sectional Sofa', qty: 1, cubicFeet: 90, weightLbs: 240, included: true, source: 'mls' },
        { id: 'item_2', room: 'Bedroom 1', name: 'Queen Bed', qty: 1, cubicFeet: 55, weightLbs: 180, included: true, source: 'mls' },
    ];
    const keyMap = (0, inventory_verification_1.buildInventoryVerificationChoiceKeyMap)(inventory);
    const verification = {
        addressConfirmed: false,
        addressMismatchNote: 'This looks like unit 603, not 601.',
        itemChoices: [
            {
                itemKey: keyMap.get(0) || '',
                decision: 'not_going',
                note: 'Seller is leaving this behind.',
                updatedAt: '2026-05-14T10:00:00.000Z',
            },
            {
                itemKey: keyMap.get(1) || '',
                decision: 'going',
                note: 'Bed is definitely moving.',
                updatedAt: '2026-05-14T10:01:00.000Z',
            },
        ],
        addedItems: [
            {
                id: 'added_1',
                room: 'Garage',
                name: 'Snowblower',
                qty: 1,
                note: 'Also moving from the garage.',
                createdAt: '2026-05-14T10:02:00.000Z',
            },
        ],
    };
    const updatedInventory = (0, inventory_verification_1.applyInventoryVerificationToInventory)(inventory, verification);
    const summary = (0, inventory_verification_1.buildInventoryVerificationSummary)(verification);
    strict_1.default.equal(summary.notGoingCount, 1);
    strict_1.default.equal(summary.goingCount, 1);
    strict_1.default.equal(summary.addedCount, 1);
    strict_1.default.equal(summary.addressMismatch, true);
    strict_1.default.equal(updatedInventory.length, 3);
    strict_1.default.equal(updatedInventory[0].included, false);
    strict_1.default.equal(updatedInventory[0].status, 'excluded');
    strict_1.default.match(updatedInventory[0].confirmReason || '', /leaving this behind/i);
    strict_1.default.equal(updatedInventory[1].status, 'confirmed');
    strict_1.default.match(updatedInventory[1].confirmReason || '', /definitely moving/i);
    strict_1.default.equal(updatedInventory[2].source, 'customer_verification');
    strict_1.default.equal(updatedInventory[2].room, 'Garage');
});
(0, node_test_1.default)('inventory verification activity surfaces the latest customer edits with item context', () => {
    const inventory = [
        { id: 'item_1', room: 'Living Room', name: 'Sectional Sofa', qty: 1, included: true, source: 'mls' },
    ];
    const keyMap = (0, inventory_verification_1.buildInventoryVerificationChoiceKeyMap)(inventory);
    const lead = {
        id: 'lead_1',
        name: 'Customer Lead',
        stage: 'quoted',
        createdAt: '2026-05-20',
        inventory,
        mediaAssets: [],
        callLogs: [],
        inventoryVerification: {
            lastUpdatedAt: '2026-05-21T11:05:00.000Z',
            addressMismatchNote: 'Suite number looks wrong.',
            itemChoices: [
                {
                    itemKey: keyMap.get(0) || '',
                    decision: 'unsure',
                    note: 'Might stay with the buyer.',
                    updatedAt: '2026-05-21T11:04:00.000Z',
                    updatedBy: 'customer',
                },
            ],
            addedItems: [
                {
                    id: 'added_1',
                    room: 'Garage',
                    name: 'Snowblower',
                    qty: 1,
                    note: 'Also moving.',
                    createdAt: '2026-05-21T11:03:00.000Z',
                    createdBy: 'customer',
                },
            ],
        },
    };
    const activity = (0, inventory_verification_1.buildInventoryVerificationActivity)(lead);
    strict_1.default.equal(activity.length, 3);
    strict_1.default.equal(activity[0]?.kind, 'address');
    strict_1.default.equal(activity[1]?.title, 'Sectional Sofa');
    strict_1.default.match(activity[1]?.detail || '', /flagged this for review/i);
    strict_1.default.equal(activity[2]?.title, 'Snowblower added');
});
