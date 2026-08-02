"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const partner_customer_intent_1 = require("../../lib/partner-customer-intent");
(0, node_test_1.default)('detects when the partnership contact is personally moving', () => {
    strict_1.default.equal((0, partner_customer_intent_1.isPartnerMovingLeadIntent)("I'm moving some stuff out of my residence that I sold."), true);
    strict_1.default.equal((0, partner_customer_intent_1.isPartnerMovingLeadIntent)('Appointment booked for a moving service next week.'), true);
    strict_1.default.equal((0, partner_customer_intent_1.isPartnerMovingLeadIntent)('Can I get your rates and availability for my move?'), true);
});
(0, node_test_1.default)('does not turn ordinary partner referral language into a customer lead', () => {
    strict_1.default.equal((0, partner_customer_intent_1.isPartnerMovingLeadIntent)('If any of my clients need movers I will send them your way.'), false);
    strict_1.default.equal((0, partner_customer_intent_1.isPartnerMovingLeadIntent)('Thanks, I will keep your digital business cards handy.'), false);
    strict_1.default.equal((0, partner_customer_intent_1.isPartnerMovingLeadIntent)('Feel free to stop by the office next week.'), false);
});
