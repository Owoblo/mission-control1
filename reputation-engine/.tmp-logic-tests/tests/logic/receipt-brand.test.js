"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const receipt_brand_1 = require("../../lib/receipt-brand");
(0, node_test_1.default)('receipt branding uses Dexa for Ottawa branch records', () => {
    const brand = (0, receipt_brand_1.getReceiptBrand)({ branch: 'ottawa' });
    strict_1.default.equal(brand.name, 'Dexa Movers');
    strict_1.default.equal(brand.phone, '613-519-3236');
    strict_1.default.equal(brand.logoPath, undefined);
});
(0, node_test_1.default)('receipt branding recovers Ottawa from route when branch is missing', () => {
    const brand = (0, receipt_brand_1.getReceiptBrand)(null, { originCity: 'Ottawa', destCity: 'Kanata' });
    strict_1.default.equal(brand.name, 'Dexa Movers');
});
(0, node_test_1.default)('receipt branding defaults to the Saturn Star master brand', () => {
    const brand = (0, receipt_brand_1.getReceiptBrand)({ branch: 'windsor' });
    strict_1.default.equal(brand.name, 'Saturn Star');
    strict_1.default.equal(brand.logoPath, '/brand/saturn-star-horizontal-full-color.png');
});
