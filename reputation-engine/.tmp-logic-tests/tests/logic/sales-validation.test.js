"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const sales_validation_1 = require("../../lib/server/sales-validation");
{
    const updates = (0, sales_validation_1.validateLeadPatchPayload)({
        followUpDate: '2026-05-15',
    });
    strict_1.default.equal(updates.followUpDate, '2026-05-15');
}
{
    const updates = (0, sales_validation_1.validateLeadPatchPayload)({
        propertyBedrooms: '3_bedrooms',
        propertyType: 'detached_house',
    });
    strict_1.default.equal(updates.propertyBedrooms, '3_bedrooms');
    strict_1.default.equal(updates.propertyType, 'detached_house');
}
{
    strict_1.default.throws(() => (0, sales_validation_1.validateLeadPatchPayload)({
        propertyBedrooms: '12_bedrooms',
    }), /Invalid property bedrooms/);
    strict_1.default.throws(() => (0, sales_validation_1.validateLeadPatchPayload)({
        propertyType: 'castle',
    }), /Invalid property type/);
}
{
    const updates = (0, sales_validation_1.validateLeadPatchPayload)({
        opportunityContext: {
            position: 'collecting_inventory',
            bookingConfidence: 60,
            nextAction: 'Call after photos arrive',
            nextActionDueAt: '2026-07-29T14:00:00.000Z',
            updatedAt: '2026-07-28T14:00:00.000Z',
        },
        attributionSignals: [{
                id: 'attr_1',
                channel: 'Direct mail',
                influence: 'first_touch',
                confidence: 'confirmed',
                observedAt: '2026-07-28T14:00:00.000Z',
            }],
        moveRelationships: [{
                id: 'rel_1',
                contactId: 'contact_1',
                name: 'Jane Smith',
                role: 'listing_realtor',
                confidence: 'confirmed',
                createdAt: '2026-07-28T14:00:00.000Z',
            }],
    });
    strict_1.default.equal(updates.opportunityContext?.position, 'collecting_inventory');
    strict_1.default.equal(updates.attributionSignals?.length, 1);
    strict_1.default.equal(updates.moveRelationships?.[0]?.role, 'listing_realtor');
}
