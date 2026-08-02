"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const booked_customer_support_1 = require("../../lib/booked-customer-support");
(0, node_test_1.default)('recognizes an overdue box-delivery request', () => {
    strict_1.default.equal((0, booked_customer_support_1.detectBookedCustomerSupportIntent)("Hello, the boxes were not delivered yet. I'd like to have them as soon as possible."), 'box_delivery');
});
(0, node_test_1.default)('booked and rep-owned customer replies require a human', () => {
    strict_1.default.equal((0, booked_customer_support_1.customerReplyRequiresHuman)({ isBookedCustomer: true }), true);
    strict_1.default.equal((0, booked_customer_support_1.customerReplyRequiresHuman)({
        isBookedCustomer: false,
        repWorkflowReason: 'A representative already contacted this lead.',
    }), true);
    strict_1.default.equal((0, booked_customer_support_1.customerReplyRequiresHuman)({ isBookedCustomer: false }), false);
});
(0, node_test_1.default)('semantic duplicate comparison ignores casing and whitespace', () => {
    strict_1.default.equal((0, booked_customer_support_1.sameNormalizedSmsBody)('Thanks Eva.  We sent this to operations.', ' thanks eva. we sent this to operations. '), true);
    strict_1.default.equal((0, booked_customer_support_1.sameNormalizedSmsBody)('We sent your box request to operations.', 'We sent your schedule question to operations.'), false);
});
