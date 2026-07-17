"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeQuoteSendRecipient = normalizeQuoteSendRecipient;
exports.buildQuoteSendDedupeKey = buildQuoteSendDedupeKey;
const crypto_1 = require("crypto");
function normalizeText(value) {
    return (value || '').trim();
}
function normalizeQuoteSendRecipient(channel, value) {
    const trimmed = normalizeText(value);
    if (channel === 'email')
        return trimmed.toLowerCase();
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 10)
        return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1'))
        return `+${digits}`;
    return trimmed;
}
function buildQuoteSendDedupeKey(input) {
    const contentHash = (0, crypto_1.createHash)('sha256')
        .update([
        input.quoteId,
        input.leadId || '',
        input.channel,
        normalizeQuoteSendRecipient(input.channel, input.recipient),
        normalizeText(input.subject),
        normalizeText(input.body),
        normalizeText(input.htmlBody),
    ].join('\n'))
        .digest('hex')
        .slice(0, 32);
    return `quote-send:${input.quoteId}:${input.channel}:${contentHash}`;
}
