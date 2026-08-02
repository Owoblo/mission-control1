"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildManualQuoteSmsDraft = buildManualQuoteSmsDraft;
exports.buildAutomationQuoteSmsSummary = buildAutomationQuoteSmsSummary;
const customer_links_1 = require("./customer-links");
function buildManualQuoteSmsDraft(input) {
    const firstName = input.firstName || 'there';
    const acceptUrl = (0, customer_links_1.compactCustomerLink)(input.acceptUrl);
    if (input.commercial) {
        return input.isRevision
            ? `Hi ${firstName}, your updated commercial estimate is ready.\n\nPlease review the full estimate here:\n${acceptUrl}\n\nThe pricing and payment terms are included.`
            : `Hi ${firstName}, your commercial estimate is ready.\n\nPlease review the full estimate here:\n${acceptUrl}\n\nApprove it when you’re ready.`;
    }
    return input.isRevision
        ? `Hi ${firstName}, your updated Saturn Star estimate is ready.\n\nPlease review the full estimate here:\n${acceptUrl}\n\nThe latest changes are included.`
        : `Hi ${firstName}, your Saturn Star estimate is ready.\n\nPlease review the full estimate here:\n${acceptUrl}`;
}
function buildAutomationQuoteSmsSummary(input) {
    const acceptUrl = (0, customer_links_1.compactCustomerLink)(input.acceptUrl);
    return [
        `Hi ${input.firstName || 'there'}, your Saturn Star moving estimate is ready.`,
        '',
        'Please review the full estimate here:',
        acceptUrl,
        '',
        'Please review it when you’re ready. Text us here with any questions.',
    ].join('\n');
}
