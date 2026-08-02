"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDepositConfirmationSms = buildDepositConfirmationSms;
function money(value) {
    return new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: 'CAD',
    }).format(Math.max(0, Number(value || 0)));
}
function buildDepositConfirmationSms(input) {
    const firstName = String(input.customerName || '').trim().split(/\s+/)[0] || 'there';
    return [
        `Hi ${firstName}, we've received your ${money(input.amount)} deposit - thank you.`,
        `Your move is confirmed, and the ${input.brandName} team is looking forward to making moving day smooth and well taken care of.`,
        input.receiptUrl ? `Your receipt: ${input.receiptUrl}` : '',
    ].filter(Boolean).join(' ');
}
