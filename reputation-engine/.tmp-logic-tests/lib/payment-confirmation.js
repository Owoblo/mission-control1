"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPaymentConfirmationSms = buildPaymentConfirmationSms;
function firstName(value) {
    return String(value || '').trim().split(/\s+/)[0] || 'there';
}
function money(value) {
    return new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: 'CAD',
    }).format(Number(value || 0));
}
function buildPaymentConfirmationSms(input) {
    const balance = Math.max(0, Number(input.balanceAfterPayment || 0));
    const status = balance <= 0
        ? 'Your move is now paid in full.'
        : `Your remaining balance is ${money(balance)}.`;
    return [
        `Hi ${firstName(input.customerName)}, we've received your payment of ${money(input.amount)}. ${status}`,
        input.receiptUrl ? `View your receipt: ${input.receiptUrl}` : '',
        `Thank you for choosing ${input.brandName}.`,
    ].filter(Boolean).join('\n\n');
}
