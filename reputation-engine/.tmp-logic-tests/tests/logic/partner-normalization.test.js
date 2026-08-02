"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const store_1 = require("../../lib/store");
(0, node_test_1.default)('partner normalization tolerates historical database nulls', () => {
    const partner = (0, store_1.normalizePartner)({
        id: ' partner-1 ',
        name: null,
        type: null,
        email: null,
        phone: null,
        company: null,
        createdAt: null,
    });
    strict_1.default.equal(partner.id, 'partner-1');
    strict_1.default.equal(partner.name, 'Unnamed partner');
    strict_1.default.equal(partner.type, 'other');
    strict_1.default.equal(partner.email, '');
    strict_1.default.equal(partner.phone, undefined);
    strict_1.default.equal(partner.company, undefined);
    strict_1.default.equal(partner.createdAt, '');
});
