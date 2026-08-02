"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const payment_confirmation_1 = require("../../lib/payment-confirmation");
(0, node_test_1.default)('final payment confirmation is calm and keeps accounting detail in the receipt', () => {
    const body = (0, payment_confirmation_1.buildPaymentConfirmationSms)({
        customerName: 'Geena Gohn',
        brandName: 'Saturn Star Moving',
        amount: 1491.6,
        balanceAfterPayment: 0,
        receiptUrl: 'https://go.quote2move.com/receipt?id=quote&token=token',
    });
    strict_1.default.match(body, /^Hi Geena, we've received your payment of \$1,491\.60\./);
    strict_1.default.match(body, /Your move is now paid in full\./);
    strict_1.default.match(body, /View your receipt:/);
    strict_1.default.match(body, /Thank you for choosing Saturn Star Moving\./);
    strict_1.default.doesNotMatch(body, /SSR-/);
    strict_1.default.doesNotMatch(body, /Balance: \$0\.00/);
});
(0, node_test_1.default)('partial payment confirmation states the useful remaining balance', () => {
    const body = (0, payment_confirmation_1.buildPaymentConfirmationSms)({
        customerName: 'Mario Rossi',
        brandName: 'Saturn Star Moving',
        amount: 500,
        balanceAfterPayment: 725.25,
    });
    strict_1.default.match(body, /Your remaining balance is \$725\.25\./);
    strict_1.default.doesNotMatch(body, /paid in full/);
});
