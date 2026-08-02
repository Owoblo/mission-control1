"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const sms_message_scope_1 = require("../../lib/sms-message-scope");
(0, node_test_1.default)('accepts messages whose customer participant is the lead phone', () => {
    strict_1.default.equal((0, sms_message_scope_1.smsMessageBelongsToPhone)({
        from_number: '+12262419853',
        to_number: '+1 (226) 929-7953',
    }, '2269297953'), true);
});
(0, node_test_1.default)('rejects a shared partnership-line message stamped with the wrong lead id', () => {
    strict_1.default.equal((0, sms_message_scope_1.smsMessageBelongsToPhone)({
        from_number: '+12262419853',
        to_number: '+12267492135',
    }, '+12269297953'), false);
});
