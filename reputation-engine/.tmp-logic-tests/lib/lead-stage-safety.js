"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeAutomatedStageSuggestion = sanitizeAutomatedStageSuggestion;
const AUTOMATION_SUGGESTIBLE_STAGES = new Set([
    'new',
    'contacted',
    'estimate_scheduled',
    'estimate_completed',
    'pricing',
    'quoted',
    'nurture',
    'booked',
]);
/**
 * Closing a sales lead is a human decision. Automation may surface evidence for
 * review, but it must never recommend or write `lost`.
 */
function sanitizeAutomatedStageSuggestion(value) {
    if (typeof value !== 'string')
        return undefined;
    return AUTOMATION_SUGGESTIBLE_STAGES.has(value)
        ? value
        : undefined;
}
