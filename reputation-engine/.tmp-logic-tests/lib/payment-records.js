"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYMENT_METHOD_LABELS = void 0;
exports.buildPaymentRecord = buildPaymentRecord;
const sales_1 = require("./sales");
const job_billing_1 = require("./server/job-billing");
exports.PAYMENT_METHOD_LABELS = {
    credit_card: 'Credit Card', debit: 'Debit', etransfer: 'Interac E-Transfer', cash: 'Cash',
    cheque: 'Cheque', bank_transfer: 'Bank Transfer', other: 'Other',
};
function buildPaymentRecord(input) {
    const paid = (0, job_billing_1.getQuotePaidSoFar)(input.quote, input.lead);
    const amount = Math.round(input.amount * 100) / 100;
    const paidAfterPayment = Math.round((paid.totalPaid + amount) * 100) / 100;
    const count = input.quote.paymentRecords?.length || 0;
    return {
        id: (0, sales_1.uid)('pay'),
        receiptNumber: `SSR-${new Date().getFullYear()}-${input.quote.number.replace(/[^A-Z0-9]/gi, '').slice(-8).toUpperCase()}-${String(count + 1).padStart(2, '0')}`,
        publicToken: crypto.randomUUID(), kind: input.kind, method: input.method, methodLabel: exports.PAYMENT_METHOD_LABELS[input.method],
        amount, totalBeforePayment: input.quote.total, paidBeforePayment: paid.totalPaid, paidAfterPayment,
        balanceAfterPayment: Math.max(0, Math.round((input.quote.total - paidAfterPayment) * 100) / 100),
        paidAt: input.paidAt || new Date().toISOString(), note: input.note, reference: input.reference,
        cardLast4: input.cardLast4, recordedBy: input.recordedBy, recordedByUserId: input.recordedByUserId,
    };
}
