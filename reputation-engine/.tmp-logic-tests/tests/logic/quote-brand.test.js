"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const quote_brand_1 = require("../../lib/quote-brand");
(0, node_test_1.default)('Ottawa route overrides a stale Waterloo branch for customer quote branding', () => {
    strict_1.default.equal((0, quote_brand_1.getCustomerFacingQuoteBranch)({
        branch: 'waterloo',
        originAddress: '65 Woodpark Way, Nepean, ON',
        originCity: 'Nepean',
        destAddress: '319 River Landing Avenue, Nepean, ON',
        destCity: 'Nepean',
    }), 'ottawa');
});
(0, node_test_1.default)('saved branch remains the fallback while route is incomplete', () => {
    strict_1.default.equal((0, quote_brand_1.getCustomerFacingQuoteBranch)({ branch: 'waterloo' }), 'waterloo');
});
(0, node_test_1.default)('short KW alias does not accidentally match Woodpark', () => {
    strict_1.default.equal((0, quote_brand_1.getCustomerFacingQuoteBranch)({ originAddress: '65 Woodpark Way, Nepean, ON' }), 'ottawa');
});
