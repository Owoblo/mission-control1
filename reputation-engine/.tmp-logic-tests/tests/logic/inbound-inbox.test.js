"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const inbound_inbox_1 = require("../../lib/inbound-inbox");
function makeInboundLead(overrides) {
    return {
        id: overrides.id || 'inbound_1',
        source: overrides.source || 'website_form',
        created_at: overrides.created_at || new Date().toISOString(),
        claimed: overrides.claimed ?? false,
        ...overrides,
    };
}
(0, node_test_1.default)('buildInboundQueueSummary separates open work, recent handoffs, and closed dispositions', () => {
    const openWebLead = (0, inbound_inbox_1.decorateInboundLead)(makeInboundLead({
        id: 'web_1',
        source: 'website_form',
        name: 'Robert',
        message: 'Need a quote for my move',
        raw_data: {
            aiSummary: {
                moveReadiness: 'hot',
            },
        },
    }));
    const recentHandoff = (0, inbound_inbox_1.decorateInboundLead)(makeInboundLead({
        id: 'dm_1',
        source: 'direct_mail',
        claimed: true,
        claimed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        raw_data: {
            linkedLeadId: 'lead_123',
            inboxDisposition: 'open',
        },
    }));
    const closedLostLead = (0, inbound_inbox_1.decorateInboundLead)(makeInboundLead({
        id: 'call_1',
        source: 'twilio_call',
        claimed: true,
        claimed_at: new Date().toISOString(),
        raw_data: {
            inboxDisposition: 'lost',
        },
    }));
    const summary = (0, inbound_inbox_1.buildInboundQueueSummary)([openWebLead, recentHandoff, closedLostLead]);
    strict_1.default.equal(openWebLead.inboxStatus, 'needs_action');
    strict_1.default.equal(recentHandoff.inboxStatus, 'recent_handoff');
    strict_1.default.equal(closedLostLead.inboxStatus, 'closed');
    strict_1.default.equal(summary.queue, 1);
    strict_1.default.equal(summary.priority, 1);
    strict_1.default.equal(summary.webForms, 2);
    strict_1.default.equal(summary.recentHandoffs, 1);
    strict_1.default.equal(summary.closed, 1);
    strict_1.default.equal(summary.focus.needs_action, 1);
    strict_1.default.equal(summary.focus.web_qr, 1);
    strict_1.default.equal(summary.focus.high_intent, 1);
    strict_1.default.equal(summary.closedByDisposition.lost, 1);
});
(0, node_test_1.default)('QR and mail attribution respects canonical source and raw tracking metadata', () => {
    const directMail = makeInboundLead({
        id: 'direct_1',
        source: 'direct_mail',
    });
    const qrTaggedWebForm = makeInboundLead({
        id: 'web_qr_1',
        source: 'website_form',
        raw_data: {
            trackingSource: 'saturn postcard qr',
        },
    });
    strict_1.default.equal((0, inbound_inbox_1.isQrOrDirectMailLead)(directMail), true);
    strict_1.default.equal((0, inbound_inbox_1.isQrOrDirectMailLead)(qrTaggedWebForm), true);
});
