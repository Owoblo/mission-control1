"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCustomerFacingQuoteBranch = getCustomerFacingQuoteBranch;
const sales_1 = require("./sales");
function getCustomerFacingQuoteBranch(quote) {
    const routeParts = [
        quote.originCity,
        quote.originAddress,
        quote.destCity,
        quote.destAddress,
        ...(quote.legs || []).flatMap(leg => [
            leg.originCity,
            leg.originAddress,
            leg.destCity,
            leg.destAddress,
        ]),
    ];
    // The actual route is current operational truth. The stored branch remains a
    // fallback for incomplete routes, not an override for customer branding.
    return (0, sales_1.detectSalesBranchFromLocation)(...routeParts) || quote.branch;
}
