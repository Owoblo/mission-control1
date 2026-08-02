"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasDeliverableQuotePricing = hasDeliverableQuotePricing;
exports.quotePricingUpdateWouldEraseSnapshot = quotePricingUpdateWouldEraseSnapshot;
function hasDeliverableQuotePricing(quote) {
    return Boolean(quote &&
        Number(quote.total || 0) > 0 &&
        Array.isArray(quote.lineItems) &&
        quote.lineItems.length > 0 &&
        quote.lineItems.some(item => Number(item.amount || 0) > 0));
}
function quotePricingUpdateWouldEraseSnapshot(current, updates) {
    const pricingTouched = [
        'lineItems',
        'subtotal',
        'hst',
        'total',
        'deposit',
        'balance',
    ].some(key => Object.prototype.hasOwnProperty.call(updates, key));
    if (!pricingTouched || !hasDeliverableQuotePricing(current))
        return false;
    return !hasDeliverableQuotePricing({ ...current, ...updates });
}
