"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sales_quote_sms_1 = require("../../lib/sales-quote-sms");
(0, node_test_1.default)('manual quote SMS sends customer to estimate link without price or deposit', () => {
    const body = (0, sales_quote_sms_1.buildManualQuoteSmsDraft)({
        firstName: 'Lisa',
        quoteNumber: 'QT-2026-0706-LM',
        acceptUrl: 'https://go.quote2move.com/quote-accept?id=qt_123',
    });
    strict_1.default.match(body, /estimate is ready/);
    strict_1.default.doesNotMatch(body, /QT-2026-0706-LM/);
    strict_1.default.match(body, /Please review the full estimate here/);
    strict_1.default.doesNotMatch(body, /\$\d/);
    strict_1.default.doesNotMatch(body, /deposit/i);
    strict_1.default.doesNotMatch(body, /starting at/i);
});
(0, node_test_1.default)('automation quote SMS omits price and reply-yes booking language', () => {
    const body = (0, sales_quote_sms_1.buildAutomationQuoteSmsSummary)({
        firstName: 'Siddarth',
        routeLine: 'Windsor to Windsor - Sat, Jul 11',
        crewLine: '3 movers - 1 truck - ~4-6hrs',
        acceptUrl: 'https://go.quote2move.com/quote-accept?id=qt_123',
    });
    strict_1.default.match(body, /Please review the full estimate here/);
    strict_1.default.doesNotMatch(body, /\$\d/);
    strict_1.default.doesNotMatch(body, /deposit/i);
    strict_1.default.doesNotMatch(body, /reply yes/i);
});
