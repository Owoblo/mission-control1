"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const quote_send_jobs_1 = require("../../lib/quote-send-jobs");
const base = {
    quoteId: 'quote_1',
    leadId: 'lead_1',
    channel: 'sms',
    recipient: '(226) 773-2993',
    body: 'Your quote is ready',
};
strict_1.default.equal((0, quote_send_jobs_1.normalizeQuoteSendRecipient)('sms', '(226) 773-2993'), '+12267732993');
strict_1.default.equal((0, quote_send_jobs_1.normalizeQuoteSendRecipient)('email', ' Customer@Example.COM '), 'customer@example.com');
{
    const first = (0, quote_send_jobs_1.buildQuoteSendDedupeKey)(base);
    const second = (0, quote_send_jobs_1.buildQuoteSendDedupeKey)({
        ...base,
        recipient: '+1 226 773 2993',
    });
    strict_1.default.equal(first, second);
}
{
    const first = (0, quote_send_jobs_1.buildQuoteSendDedupeKey)(base);
    const changedBody = (0, quote_send_jobs_1.buildQuoteSendDedupeKey)({
        ...base,
        body: 'Your updated quote is ready',
    });
    strict_1.default.notEqual(first, changedBody);
}
{
    const email = (0, quote_send_jobs_1.buildQuoteSendDedupeKey)({
        ...base,
        channel: 'email',
        recipient: 'customer@example.com',
        subject: 'Quote',
        htmlBody: '<p>Your quote is ready</p>',
    });
    const sms = (0, quote_send_jobs_1.buildQuoteSendDedupeKey)(base);
    strict_1.default.notEqual(email, sms);
}
