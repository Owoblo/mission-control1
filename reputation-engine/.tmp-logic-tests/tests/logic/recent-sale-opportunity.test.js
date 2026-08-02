"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const recent_sale_opportunity_1 = require("../../lib/recent-sale-opportunity");
(0, node_test_1.default)('matches a Realtor most strongly by exact phone and name', () => {
    const result = (0, recent_sale_opportunity_1.scoreRecentSaleContact)({ name: 'Trudy Enns, Realtor', phone: '(519) 555-1212', brokerage: 'Example Realty Brokerage' }, { id: '1', name: 'Trudy Enns', phone: '+1 519-555-1212', company: 'Example Realty' });
    strict_1.default.equal(result.score, 190);
    strict_1.default.deepEqual(result.reasons, ['phone', 'name', 'brokerage']);
});
(0, node_test_1.default)('event keys deduplicate the same MLS and Realtor', () => {
    strict_1.default.equal((0, recent_sale_opportunity_1.buildRecentSaleEventKey)({ mls: 'X123', address: '10 Main St', realtorName: 'Trudy Enns' }), (0, recent_sale_opportunity_1.buildRecentSaleEventKey)({ mls: 'X123', address: 'Different Address', realtorName: 'TRUDY ENNS, REALTOR' }));
});
(0, node_test_1.default)('recent-sale drafts use the approved relationship template', () => {
    const relationship = (0, recent_sale_opportunity_1.classifyRecentSaleRelationship)({
        id: '1',
        name: 'Trudy Enns',
        stage: 'partnership_active',
    });
    const message = (0, recent_sale_opportunity_1.buildRecentSaleMessage)({
        realtorName: 'Trudy Enns',
        address: '10 Main Street, Windsor',
        city: 'Windsor',
        relationship,
    });
    strict_1.default.equal(relationship, 'active_partner');
    strict_1.default.equal(message, `Hi Trudy, congratulations on the sale of 10 Main Street.

I wanted to reach out in case your client still needs help with their move. We’d be happy to provide them with a straightforward estimate and make the process as easy as possible.

No pressure at all, but would you be comfortable passing along our number to them?`);
    strict_1.default.match(recent_sale_opportunity_1.RECENT_SALE_MESSAGE_TEMPLATE, /\{\{name\}\}/);
    strict_1.default.match(recent_sale_opportunity_1.RECENT_SALE_MESSAGE_TEMPLATE, /\{\{address\}\}/);
});
(0, node_test_1.default)('recent-sale listing links prefer the stored source and fall back to a targeted search', () => {
    strict_1.default.equal((0, recent_sale_opportunity_1.buildRecentSaleListingUrl)({
        address: '37 Kintail Cres, London, ON',
        city: 'London',
        metadata: { ListingURL: 'https://www.zillow.com/homedetails/example/' },
    }), 'https://www.zillow.com/homedetails/example/');
    strict_1.default.match((0, recent_sale_opportunity_1.buildRecentSaleListingUrl)({ address: '10 Main Street, Windsor', city: 'Windsor' }), /google\.com\/search/);
});
