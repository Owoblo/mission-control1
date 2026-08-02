"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const lead_draft_1 = require("../../app/components/sales/lead-detail/lead-draft");
function makeLead(inventory) {
    return {
        id: 'lead_autosave_1',
        name: 'Sam',
        phone: '226-000-0000',
        email: 'sam@example.com',
        stage: 'quoted',
        createdAt: '2026-06-06T10:00:00.000Z',
        moveDate: '2026-06-30',
        moveType: 'residential',
        originAddress: '203 Catherine Street #601, Ottawa, ON, Canada',
        destAddress: '2A Caroline Avenue, Ottawa, ON, Canada',
        inventory,
        mediaAssets: [],
        callLogs: [],
    };
}
(0, node_test_1.default)('lead draft autosave ignores inventory changes handled by dedicated inventory persistence', () => {
    const leadWithSamInventory = makeLead([
        { id: 'item_1', name: 'Sectional Sofa', room: 'Living Room', qty: 1, cubicFeet: 90, included: true, owner: 'person_a' },
    ]);
    const leadAfterConjointEdit = makeLead([
        { id: 'item_2', name: 'Dining Table', room: 'Dining Room', qty: 1, cubicFeet: 40, included: true, owner: 'person_b' },
    ]);
    strict_1.default.equal((0, lead_draft_1.buildSavedLeadSignature)(leadWithSamInventory), (0, lead_draft_1.buildSavedLeadSignature)(leadAfterConjointEdit));
    const draft = (0, lead_draft_1.createLeadDraftState)(leadWithSamInventory);
    const draftAfterInventoryEdit = {
        ...draft,
        inventory: leadAfterConjointEdit.inventory,
    };
    strict_1.default.equal((0, lead_draft_1.buildDraftLeadSignature)(draft), (0, lead_draft_1.buildDraftLeadSignature)(draftAfterInventoryEdit));
    const payload = (0, lead_draft_1.buildLeadDraftPayload)(leadWithSamInventory, draftAfterInventoryEdit);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(payload, 'inventory'), false);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(payload, 'roomBreakdown'), false);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(payload, 'totalCubicFeet'), false);
});
(0, node_test_1.default)('lead draft persists structured partnership attribution and clears it when source changes', () => {
    const lead = makeLead([]);
    const draft = {
        ...(0, lead_draft_1.createLeadDraftState)(lead),
        leadSource: 'partner_referral',
        partnerReferral: {
            id: 'contact_realtor_1',
            name: 'Alex Realtor',
            company: 'North Star Realty',
            category: 'realtor',
            email: 'alex@example.com',
            city: 'London',
        },
    };
    const linked = (0, lead_draft_1.buildLeadDraftPayload)(lead, draft);
    strict_1.default.equal(linked.source, 'partner_referral');
    strict_1.default.equal(linked.partnerReferralContactId, 'contact_realtor_1');
    strict_1.default.equal(linked.partnerReferralName, 'Alex Realtor');
    strict_1.default.equal(linked.partnerReferralCompany, 'North Star Realty');
    const cleared = (0, lead_draft_1.buildLeadDraftPayload)({ ...lead, ...linked }, { ...draft, leadSource: 'google_online_search', partnerReferral: null });
    strict_1.default.equal(cleared.partnerReferralContactId, '');
    strict_1.default.equal(cleared.partnerReferralName, '');
});
(0, node_test_1.default)('lead draft does not persist an incomplete partnership source while selection is in progress', () => {
    const lead = makeLead([]);
    const draft = {
        ...(0, lead_draft_1.createLeadDraftState)(lead),
        leadSource: 'partner_referral',
        partnerReferral: null,
    };
    const payload = (0, lead_draft_1.buildLeadDraftPayload)(lead, draft);
    strict_1.default.equal(payload.source, lead.source);
    strict_1.default.equal(payload.partnerReferralContactId, '');
});
