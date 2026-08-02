"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const deposit_confirmation_1 = require("../../lib/deposit-confirmation");
(0, node_test_1.default)('deposit confirmation is warm, specific, and customer-facing', () => {
    const body = (0, deposit_confirmation_1.buildDepositConfirmationSms)({
        customerName: 'Scott Vanderweyst',
        brandName: 'Saturn Star Moving',
        amount: 269.62,
        receiptUrl: 'https://go.quote2move.com/receipt?id=q1&token=t1',
    });
    strict_1.default.match(body, /Hi Scott/);
    strict_1.default.match(body, /\$269\.62 deposit/);
    strict_1.default.match(body, /move is confirmed/);
    strict_1.default.match(body, /receipt:/i);
    strict_1.default.doesNotMatch(body, /\bQT-\d/i);
    strict_1.default.doesNotMatch(body, /amazing|can't wait|super excited/i);
});
