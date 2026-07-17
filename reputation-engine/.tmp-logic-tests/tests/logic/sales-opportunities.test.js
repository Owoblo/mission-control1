"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const sales_1 = require("../../lib/sales");
const realtor_opportunity_1 = require("../../lib/realtor-opportunity");
const baseLead = {
    id: 'lead_opportunity',
    name: 'Realtor lead — 631 Doon South Drive',
    stage: 'new',
    createdAt: '2026-05-15',
    leadKind: 'realtor_opportunity',
    primaryContactRole: 'realtor',
    source: 'destination_opportunity',
    moveType: 'residential',
    opportunityAddress: '631 Doon South Drive, Kitchener, ON, Canada',
    sourceLeadMoveDate: '2026-06-26',
    inventory: [],
    mediaAssets: [],
    callLogs: [],
};
{
    const updated = (0, realtor_opportunity_1.applyRealtorContactToOpportunityLead)(baseLead, {
        realtorName: 'Varinder Singh',
        realtorPhone: '+15195551212',
        realtorEmail: 'varinder@example.com',
    });
    strict_1.default.equal(updated.name, baseLead.name);
    strict_1.default.equal(updated.phone, undefined);
    strict_1.default.equal(updated.email, undefined);
    strict_1.default.equal(updated.realtorName, 'Varinder Singh');
    strict_1.default.equal(updated.realtorPhone, '+15195551212');
    strict_1.default.equal(updated.realtorEmail, 'varinder@example.com');
}
{
    const normalized = (0, sales_1.normalizeLead)({
        ...baseLead,
        realtorName: 'Varinder Kaur Singh',
        realtorPhone: '4167405100',
    });
    strict_1.default.equal(normalized.name, baseLead.name);
    strict_1.default.equal(normalized.phone, undefined);
    strict_1.default.equal(normalized.realtorName, 'Varinder Kaur Singh');
    strict_1.default.equal(normalized.realtorPhone, '4167405100');
}
{
    const safe = (0, realtor_opportunity_1.canAutoApplyRealtorContact)({
        rawText: 'Listing agent Sean Turner, Sutton Group Select Realty Inc., email shawn@shawnturner.ca, call 519-777-9961.',
        expectedBrokerage: 'Sutton Group Select Realty Inc.',
        realtorName: 'Sean Turner',
        realtorPhone: '519-777-9961',
        realtorEmail: 'shawn@shawnturner.ca',
        realtorBrokerage: 'Sutton Group Select Realty Inc.',
        contactKind: 'listing_agent',
        confidence: 'high',
    });
    strict_1.default.equal(safe, true);
}
{
    const unsafePersonalEmail = (0, realtor_opportunity_1.canAutoApplyRealtorContact)({
        rawText: 'Angela Cope can be reached at angelamcope@icloud.com or 519-566-5701 for the listing.',
        expectedBrokerage: 'Remax Preferred Realty Ltd. - 588 Brokerage',
        realtorName: 'Angela Cope',
        realtorPhone: '519-566-5701',
        realtorEmail: 'angelamcope@icloud.com',
        realtorBrokerage: 'Remax Preferred Realty Ltd. - 588 Brokerage',
        contactKind: 'sales_representative',
        confidence: 'high',
    });
    strict_1.default.equal(unsafePersonalEmail, false);
}
{
    const displayName = (0, realtor_opportunity_1.getListingSideContactDisplayName)(baseLead);
    strict_1.default.equal(displayName, 'Listing-side contact pending');
    strict_1.default.equal((0, realtor_opportunity_1.getListingSideContactRoleLabel)('sales_representative'), 'Sales representative');
}
{
    const sms = (0, realtor_opportunity_1.buildDestinationOpportunityPitch)({
        ...baseLead,
        realtorName: 'Varinder Singh',
    }, 'sms');
    strict_1.default.match(sms, /Varinder/i);
    strict_1.default.match(sms, /631 Doon South Drive/i);
    strict_1.default.match(sms, /paired-move rate/i);
    strict_1.default.match(sms, /Jun/i);
}
{
    const email = (0, realtor_opportunity_1.buildDestinationOpportunityPitch)({
        ...baseLead,
        realtorName: 'Varinder Singh',
    }, 'email');
    strict_1.default.match(email.subject, /631 Doon South Drive/i);
    strict_1.default.match(email.body, /Saturn Star Moving/i);
    strict_1.default.match(email.body, /preferred paired-move rate/i);
}
