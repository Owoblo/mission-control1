"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const listing_1 = require("../../lib/listing");
(0, node_test_1.default)('listing helpers expose richer property context when available', () => {
    const listing = {
        zpid: '460694309',
        address: '928 Evens Pond Ct, Kitchener, ON N2R 0B8',
        city: 'Kitchener',
        beds: 6,
        baths: 5,
        description: 'END OF COURT. INGROUND POOL. OVERSIZED LOT. BACKING ONTO GREENSPACE WITH A WALKOUT BASEMENT.',
        parkingFeatures: ['Attached Garage', 'Private Drive Triple+ Wide'],
        basement: 'Separate Entrance,Walk-Out Access,Full,Finished',
        livingArea: 3106,
        yearBuilt: 2011,
        streetViewMetadataUrl: 'https://maps.googleapis.com/maps/api/streetview/metadata?...',
        carouselphotos: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
    };
    strict_1.default.equal((0, listing_1.formatListingPropertySummary)(listing), '6 beds · 5 baths');
    strict_1.default.match((0, listing_1.getListingDescription)(listing) || '', /walkout basement/i);
    const highlights = (0, listing_1.getListingOperationalHighlights)(listing);
    strict_1.default.ok(highlights.some(item => /attached garage/i.test(item)));
    strict_1.default.ok(highlights.some(item => /walk-out access/i.test(item)));
    strict_1.default.ok(highlights.some(item => /3,106 sq ft/i.test(item)));
    strict_1.default.ok(highlights.some(item => /street view metadata available/i.test(item)));
});
(0, node_test_1.default)('richer listing snapshots replace thin snapshots', () => {
    const thin = {
        zpid: '460694309',
        address: '928 Evens Pond Ct, Kitchener, ON N2R 0B8',
        city: 'Kitchener',
        carouselphotos: ['https://example.com/1.jpg'],
    };
    const rich = {
        ...thin,
        beds: 6,
        baths: 5,
        description: 'Walkout basement and triple-wide drive.',
        parkingFeatures: ['Attached Garage'],
        streetViewMetadataUrl: 'https://maps.googleapis.com/maps/api/streetview/metadata?...',
        carouselphotos: ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg'],
    };
    strict_1.default.equal((0, listing_1.shouldPreferListingSnapshot)(thin, rich), true);
    strict_1.default.equal((0, listing_1.shouldPreferListingSnapshot)(rich, thin), false);
});
(0, node_test_1.default)('matched listings still surface a context summary when structured bed and bath fields are missing', () => {
    const thinMatched = {
        zpid: '12345',
        address: '631 Doon South Drive, Kitchener, ON, Canada',
        city: 'Kitchener',
        carouselphotos: ['https://example.com/1.jpg'],
    };
    strict_1.default.equal((0, listing_1.formatListingContextSummary)(thinMatched), 'Listing matched');
});
