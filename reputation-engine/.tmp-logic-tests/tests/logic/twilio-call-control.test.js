"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const twilio_call_control_1 = require("../../lib/twilio-call-control");
const repParent = {
    sid: 'CA11111111111111111111111111111111',
    from: 'client:saturn-rep-user1',
    to: '+15195550100',
};
const customerChild = {
    sid: 'CA22222222222222222222222222222222',
    parent_call_sid: repParent.sid,
    from: '+15195550100',
    to: '+15195550123',
    status: 'in-progress',
};
(0, node_test_1.default)('resolves an outbound browser parent and customer child', () => {
    strict_1.default.deepEqual((0, twilio_call_control_1.resolveTwilioCallLegs)(repParent, [customerChild]), {
        repCallSid: repParent.sid,
        customerCallSid: customerChild.sid,
        rootCallSid: repParent.sid,
    });
});
(0, node_test_1.default)('resolves an inbound customer parent and browser child', () => {
    const customerParent = { ...repParent, from: '+15195550123', to: '+15195550100' };
    const repChild = {
        ...customerChild,
        parent_call_sid: customerParent.sid,
        from: '+15195550100',
        to: 'client:saturn-rep-user1',
    };
    strict_1.default.deepEqual((0, twilio_call_control_1.resolveTwilioCallLegs)(repChild, [customerParent]), {
        repCallSid: repChild.sid,
        customerCallSid: customerParent.sid,
        rootCallSid: customerParent.sid,
    });
});
(0, node_test_1.default)('conference names are deterministic and safe', () => {
    strict_1.default.equal((0, twilio_call_control_1.makeConferenceName)(repParent.sid), `saturn_${repParent.sid}`);
    strict_1.default.equal((0, twilio_call_control_1.escapeTwiml)('<manager & "customer">'), '&lt;manager &amp; &quot;customer&quot;&gt;');
});
(0, node_test_1.default)('transfer targets reject TwiML injection and normalize supported destinations', () => {
    strict_1.default.deepEqual((0, twilio_call_control_1.normalizeInternalTransferTarget)('client:saturn-rep-manager'), {
        kind: 'client',
        target: 'saturn-rep-manager',
    });
    strict_1.default.deepEqual((0, twilio_call_control_1.normalizeInternalTransferTarget)('+15195550123'), {
        kind: 'number',
        target: '+15195550123',
    });
    strict_1.default.throws(() => (0, twilio_call_control_1.normalizeInternalTransferTarget)('client:x</Client><Hangup/>'));
});
