"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const partnership_sms_1 = require("../../lib/server/partnership-sms");
(0, node_test_1.default)('partnership SMS templates normalize smart punctuation to GSM-safe text', () => {
    const input = 'Hey {{first_name}}, I\u2019m Courage \u2014 Ottawa\u2019s mover\u2026';
    const normalized = (0, partnership_sms_1.normalizeSmsToGsm)(input);
    strict_1.default.equal(normalized, "Hey {{first_name}}, I'm Courage - Ottawa's mover...");
    strict_1.default.equal((0, partnership_sms_1.isPlainGsmSms)(normalized), true);
});
(0, node_test_1.default)('partnership SMS rendering keeps merged values GSM-safe', () => {
    const rendered = (0, partnership_sms_1.mergePartnershipSmsTemplate)('Hey {{first_name}}, I\u2019m serving {{city}}.', { name: 'Jos\u00E9 Tremblay', city: 'Orl\u00E9ans' });
    strict_1.default.equal(rendered, "Hey Jose, I'm serving Orleans.");
    strict_1.default.equal((0, partnership_sms_1.isPlainGsmSms)(rendered), true);
});
(0, node_test_1.default)('campaign template cleanup runs through ensureSmsOptOutLine', () => {
    strict_1.default.equal((0, partnership_sms_1.ensureSmsOptOutLine)('  Buyers \u2014 sellers\u00A0and closings\u2026  '), 'Buyers - sellers and closings...');
});
