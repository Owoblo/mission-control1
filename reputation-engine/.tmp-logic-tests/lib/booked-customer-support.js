"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sameNormalizedSmsBody = sameNormalizedSmsBody;
exports.customerReplyRequiresHuman = customerReplyRequiresHuman;
exports.detectBookedCustomerSupportIntent = detectBookedCustomerSupportIntent;
function sameNormalizedSmsBody(left, right) {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizedLeft = normalize(left);
    return !!normalizedLeft && normalizedLeft === normalize(right);
}
function customerReplyRequiresHuman(input) {
    return input.isBookedCustomer || !!input.repWorkflowReason;
}
function detectBookedCustomerSupportIntent(message) {
    const text = (message || '').trim().toLowerCase();
    if (/\b(box|boxes|packing supplies?|materials?)\b/.test(text) && /\b(deliver\w*|arriv\w*|drop\w*|bring|receiv\w*|didn'?t get|not get|still waiting|overdue|late)\b/.test(text)) {
        return 'box_delivery';
    }
    if (/\b(damag|broken|scratch|missing|lost|complain|unhappy|upset|problem|issue)\b/.test(text)) {
        return 'damage_or_complaint';
    }
    if (/\b(when|what time|arrival|arrive|schedule|reschedule|date|day|late|delay)\b/.test(text)) {
        return 'schedule';
    }
    if (/\b(payment|paid|deposit|balance|receipt|invoice|refund|charge|card|e-?transfer)\b/.test(text)) {
        return 'payment_or_receipt';
    }
    if (/\b(add|remove|change|update|different|extra|no longer|instead|another stop|address)\b/.test(text)) {
        return 'change_request';
    }
    if (/\b(park|parking|truck|crew|mover|entrance|door|elevator|stairs|loading|access|hall|unit|apartment)\b/.test(text)) {
        return 'access_or_crew';
    }
    return 'general';
}
