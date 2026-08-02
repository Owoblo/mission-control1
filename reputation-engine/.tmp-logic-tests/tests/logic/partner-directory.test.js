"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const partner_directory_1 = require("../../lib/partner-directory");
(0, node_test_1.default)('partner directory search normalizes whitespace and limits abusive query length', () => {
    strict_1.default.equal((0, partner_directory_1.normalizePartnerDirectoryQuery)('  Jane   Smith  '), 'Jane Smith');
    strict_1.default.equal((0, partner_directory_1.normalizePartnerDirectoryQuery)('x'.repeat(140)).length, 100);
});
(0, node_test_1.default)('partner directory labels retain the contact-company-city graph', () => {
    strict_1.default.equal((0, partner_directory_1.partnerDirectoryEntryLabel)({
        id: 'contact_1',
        name: 'Jane Smith',
        company: 'Example Realty',
        city: 'Kitchener',
    }), 'Jane Smith · Example Realty · Kitchener · Waterloo / KW area');
});
(0, node_test_1.default)('municipalities resolve to the operating area without losing their city identity', () => {
    strict_1.default.equal((0, partner_directory_1.partnerServiceAreaForCity)('Amherstburg'), 'Windsor area');
    strict_1.default.equal((0, partner_directory_1.partnerServiceAreaForCity)('London'), 'London area');
    strict_1.default.equal((0, partner_directory_1.partnerServiceAreaForCity)('Unknown Place'), 'Outside core service areas');
});
