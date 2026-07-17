"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const sales_1 = require("../../lib/sales");
const baseLead = {
    id: 'lead_followup_status',
    name: 'Test Lead',
    stage: 'contacted',
    createdAt: '2026-05-20',
    source: 'website_form',
    inventory: [],
    mediaAssets: [],
    callLogs: [],
};
{
    const normalized = (0, sales_1.normalizeLead)({
        ...baseLead,
        lastInboundAt: '2026-05-20T10:00:00.000Z',
    });
    strict_1.default.equal(normalized.followUpStatus, 'pending');
}
{
    const normalized = (0, sales_1.normalizeLead)({
        ...baseLead,
        followUpDate: '2099-05-24',
        lastInboundAt: '2026-05-20T10:00:00.000Z',
        lastHumanOutboundAt: '2026-05-20T12:00:00.000Z',
    });
    strict_1.default.equal(normalized.followUpStatus, 'following_up');
}
{
    const normalized = (0, sales_1.normalizeLead)({
        ...baseLead,
        followUpDate: '2026-05-01',
        lastInboundAt: '2026-05-20T10:00:00.000Z',
        lastHumanOutboundAt: '2026-05-20T12:00:00.000Z',
    });
    strict_1.default.equal(normalized.followUpStatus, 'no_response');
}
{
    const normalized = (0, sales_1.normalizeLead)({
        ...baseLead,
        followUpStatus: 'followed_up',
        lastInboundAt: '2026-05-20T10:00:00.000Z',
    });
    strict_1.default.equal(normalized.followUpStatus, 'followed_up');
}
