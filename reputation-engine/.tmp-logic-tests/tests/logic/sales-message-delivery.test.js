"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sales_message_delivery_1 = require("../../lib/sales-message-delivery");
(0, node_test_1.default)('automation delivery reports semantic duplicates as not sent', () => {
    strict_1.default.equal((0, sales_message_delivery_1.wasSalesMessageDelivered)({
        deduped: true,
        result: { ok: true, deduped: true },
    }), false);
});
(0, node_test_1.default)('automation delivery reports policy-blocked messages as not sent', () => {
    strict_1.default.equal((0, sales_message_delivery_1.wasSalesMessageDelivered)({
        deduped: false,
        result: { ok: true, blocked: true },
    }), false);
});
(0, node_test_1.default)('automation delivery reports provider-accepted messages as sent', () => {
    strict_1.default.equal((0, sales_message_delivery_1.wasSalesMessageDelivered)({
        deduped: false,
        result: { ok: true, sid: 'SM123' },
    }), true);
});
