"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const lead_identity_1 = require("../../lib/server/lead-identity");
function makeLead(overrides) {
    return {
        id: overrides.id || 'lead_1',
        name: overrides.name || 'Lead Name',
        stage: overrides.stage || 'new',
        createdAt: overrides.createdAt || '2026-05-01',
        inventory: overrides.inventory || [],
        mediaAssets: overrides.mediaAssets || [],
        callLogs: overrides.callLogs || [],
        ...overrides,
    };
}
(0, node_test_1.default)('lead identity matches North American phone variants as the same customer', () => {
    const leads = [
        makeLead({
            id: 'lead_a',
            name: 'Roland Eight',
            phone: '+1 (519) 555-0101',
            createdAt: '2026-05-01',
        }),
        makeLead({
            id: 'lead_b',
            name: 'Different Lead',
            phone: '+1 (226) 555-0101',
            createdAt: '2026-05-02',
        }),
    ];
    const matches = (0, lead_identity_1.findLeadIdentityMatches)(leads, {
        phone: '519-555-0101',
        includeClosed: false,
    });
    strict_1.default.equal((0, lead_identity_1.normalizeLeadIdentityPhone)('5195550101'), '+15195550101');
    strict_1.default.equal(matches.length, 1);
    strict_1.default.equal(matches[0]?.id, 'lead_a');
});
(0, node_test_1.default)('canonical lead selection prefers richer active records over placeholders', () => {
    const canonical = (0, lead_identity_1.chooseCanonicalLead)([
        makeLead({
            id: 'placeholder',
            name: 'Unknown Caller',
            stage: 'new',
            phone: '+15195550101',
            createdAt: '2026-05-01',
        }),
        makeLead({
            id: 'quoted',
            name: 'Roland Eight',
            stage: 'quoted',
            phone: '519-555-0101',
            email: 'roland@example.com',
            quoteId: 'quote_1',
            moveDate: '2026-06-01',
            createdAt: '2026-05-02',
            lastTouchedAt: '2026-05-05T10:00:00.000Z',
        }),
    ]);
    strict_1.default.equal(canonical?.id, 'quoted');
});
(0, node_test_1.default)('closed customer matches are opt-in and beat new SMS placeholders', () => {
    const leads = [
        makeLead({
            id: 'sms_placeholder',
            name: '+15199990000',
            stage: 'new',
            phone: '+1 519 999 0000',
            inboundId: 'inb_new_sms',
            createdAt: '2026-06-06',
        }),
        makeLead({
            id: 'completed_customer',
            name: 'Rosemary Customer',
            stage: 'completed',
            phone: '519-999-0000',
            email: 'rosemary@example.com',
            moveDate: '2026-05-30',
            bookedAt: '2026-05-20T14:00:00.000Z',
            createdAt: '2026-05-01',
        }),
    ];
    const activeOnly = (0, lead_identity_1.findLeadIdentityMatches)(leads, {
        phone: '5199990000',
        includeClosed: false,
    });
    strict_1.default.equal(activeOnly[0]?.id, 'sms_placeholder');
    const withClosed = (0, lead_identity_1.findLeadIdentityMatches)(leads, {
        phone: '5199990000',
        includeClosed: true,
    });
    strict_1.default.equal(withClosed[0]?.id, 'completed_customer');
});
(0, node_test_1.default)('merging duplicate leads keeps one timeline and preserves richer details', () => {
    const primary = makeLead({
        id: 'lead_primary',
        name: 'Roland Eight',
        stage: 'quoted',
        phone: '+15195550101',
        email: 'roland@example.com',
        quoteId: 'quote_1',
        moveDate: '2026-06-01',
        callLogs: [{ id: 'call_1', type: 'call', date: '2026-05-01T10:00:00.000Z', notes: 'Initial call', callSid: 'CA123' }],
        notes: 'Quoted from web form.',
        createdAt: '2026-05-01',
    });
    const duplicate = makeLead({
        id: 'lead_duplicate',
        name: 'Unknown Caller',
        stage: 'contacted',
        phone: '519-555-0101',
        email: 'ROLAND@example.com',
        quoteIds: ['quote_2'],
        callLogs: [{ id: 'call_2', type: 'call', date: '2026-05-02T10:00:00.000Z', notes: 'Follow-up call', callSid: 'CA456' }],
        notes: 'Came back through direct mail.',
        createdAt: '2026-05-02',
    });
    const merged = (0, lead_identity_1.mergeLeadRecords)(primary, duplicate);
    strict_1.default.equal(merged.id, 'lead_primary');
    strict_1.default.equal(merged.name, 'Roland Eight');
    strict_1.default.equal(merged.identityPhone, '+15195550101');
    strict_1.default.equal(merged.identityEmail, 'roland@example.com');
    strict_1.default.deepEqual(merged.quoteIds, ['quote_1', 'quote_2']);
    strict_1.default.equal(merged.callLogs?.length, 2);
    strict_1.default.match(merged.notes || '', /Quoted from web form\./);
    strict_1.default.match(merged.notes || '', /Came back through direct mail\./);
});
