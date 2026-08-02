"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const conversation_experience_1 = require("../../lib/conversation-experience");
strict_1.default.equal((0, conversation_experience_1.detectCustomerEmotion)("I can't give you the box count because I haven't packed yet"), 'uncertain');
strict_1.default.equal((0, conversation_experience_1.detectCustomerEmotion)('This is too much. I have no idea where to start.'), 'overwhelmed');
strict_1.default.equal((0, conversation_experience_1.detectCustomerEmotion)('I already told you that. Stop asking again.'), 'frustrated');
strict_1.default.equal((0, conversation_experience_1.detectCustomerEmotion)("Let's do it"), 'ready');
strict_1.default.equal((0, conversation_experience_1.deriveConversationStage)({}, ['move_date', 'origin_address', 'destination_address']), 'welcome');
strict_1.default.equal((0, conversation_experience_1.deriveConversationStage)({}, ['inventory']), 'inventory_discovery');
strict_1.default.equal((0, conversation_experience_1.deriveConversationStage)({ surveyRequestedAt: '2026-07-24T12:00:00.000Z' }, ['inventory']), 'photo_inventory');
strict_1.default.equal((0, conversation_experience_1.deriveConversationStage)({ stage: 'quoted' }, []), 'booking');
strict_1.default.equal((0, conversation_experience_1.deriveConversationStage)({ stage: 'booked' }, []), 'booked_support');
strict_1.default.equal((0, conversation_experience_1.nextConversationTopic)(['access'], { propertyType: 'condo' }), 'elevator');
strict_1.default.equal((0, conversation_experience_1.nextConversationTopic)(['access'], { propertyType: 'detached_house' }), 'parking_exception');
strict_1.default.equal((0, conversation_experience_1.nextConversationTopic)(['inventory'], { moveType: 'packing' }), 'packing_scope');
const calmReply = "That's completely fine—most people don't know the box count yet. The furniture gives me enough to start. Are all three beds moving?";
strict_1.default.equal((0, conversation_experience_1.countCustomerQuestions)(calmReply), 1);
strict_1.default.deepEqual((0, conversation_experience_1.evaluateConversationMessage)(calmReply).violations, []);
const bundled = 'Are there stairs, elevators, or tight parking at either location?';
strict_1.default.equal((0, conversation_experience_1.evaluateConversationMessage)(bundled).bundledQuestion, true);
const memory = (0, conversation_experience_1.buildConversationMemory)({
    lead: {},
    missingFields: ['inventory'],
    inboundMessage: "I don't know the number of boxes yet",
    outboundMessage: calmReply,
    now: '2026-07-24T12:00:00.000Z',
});
strict_1.default.equal(memory.stage, 'inventory_discovery');
strict_1.default.equal(memory.emotion, 'uncertain');
strict_1.default.equal(memory.questionsAsked.includes('inventory_confirmation'), true);
strict_1.default.equal(memory.nextQuestionTopic, 'inventory');
const repeated = (0, conversation_experience_1.evaluateConversationMessage)('Thanks, that helps. Are all three beds moving?', memory);
strict_1.default.equal(repeated.repeatedQuestion, true);
