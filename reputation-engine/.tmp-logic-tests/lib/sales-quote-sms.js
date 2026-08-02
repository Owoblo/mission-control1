"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildManualQuoteSmsDraft = buildManualQuoteSmsDraft;
exports.buildAutomationQuoteSmsSummary = buildAutomationQuoteSmsSummary;
function buildManualQuoteSmsDraft(input) {
    const firstName = input.firstName || 'there';
    if (input.commercial) {
        return input.isRevision
            ? `Hi ${firstName}, we updated your Saturn Star commercial estimate ${input.quoteNumber}. Please review the full estimate and payment terms here: ${input.acceptUrl}`
            : `Hi ${firstName}, your Saturn Star commercial estimate ${input.quoteNumber} is ready. Please review and approve it here: ${input.acceptUrl}`;
    }
    return input.isRevision
        ? `Hi ${firstName}, we updated your Saturn Star estimate ${input.quoteNumber}. Please review the full estimate here: ${input.acceptUrl}`
        : `Hi ${firstName}, your Saturn Star estimate ${input.quoteNumber} is ready. Please review the full estimate here: ${input.acceptUrl}`;
}
function buildAutomationQuoteSmsSummary(input) {
    return [
        `Hi ${input.firstName || 'there'}! Your Saturn Star moving estimate is ready 📦`,
        ``,
        input.routeLine,
        input.crewLine,
        ``,
        `Please review the full estimate here:`,
        input.acceptUrl,
        ``,
        `Text us here with any questions or changes.`,
    ].join('\n');
}
