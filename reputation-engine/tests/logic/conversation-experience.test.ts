import assert from 'node:assert/strict'
import {
  buildConversationMemory,
  countCustomerQuestions,
  deriveConversationStage,
  detectCustomerEmotion,
  evaluateConversationMessage,
  nextConversationTopic,
} from '../../lib/conversation-experience'

assert.equal(detectCustomerEmotion("I can't give you the box count because I haven't packed yet"), 'uncertain')
assert.equal(detectCustomerEmotion('This is too much. I have no idea where to start.'), 'overwhelmed')
assert.equal(detectCustomerEmotion('I already told you that. Stop asking again.'), 'frustrated')
assert.equal(detectCustomerEmotion("Let's do it"), 'ready')

assert.equal(deriveConversationStage({}, ['move_date', 'origin_address', 'destination_address']), 'welcome')
assert.equal(deriveConversationStage({}, ['inventory']), 'inventory_discovery')
assert.equal(
  deriveConversationStage({ surveyRequestedAt: '2026-07-24T12:00:00.000Z' }, ['inventory']),
  'photo_inventory',
)
assert.equal(deriveConversationStage({ stage: 'quoted' }, []), 'booking')
assert.equal(deriveConversationStage({ stage: 'booked' }, []), 'booked_support')

assert.equal(nextConversationTopic(['access'], { propertyType: 'condo' }), 'elevator')
assert.equal(nextConversationTopic(['access'], { propertyType: 'detached_house' }), 'parking_exception')
assert.equal(nextConversationTopic(['inventory'], { moveType: 'packing' }), 'packing_scope')

const calmReply = "That's completely fine—most people don't know the box count yet. The furniture gives me enough to start. Are all three beds moving?"
assert.equal(countCustomerQuestions(calmReply), 1)
assert.deepEqual(evaluateConversationMessage(calmReply).violations, [])

const bundled = 'Are there stairs, elevators, or tight parking at either location?'
assert.equal(evaluateConversationMessage(bundled).bundledQuestion, true)

const memory = buildConversationMemory({
  lead: {},
  missingFields: ['inventory'],
  inboundMessage: "I don't know the number of boxes yet",
  outboundMessage: calmReply,
  now: '2026-07-24T12:00:00.000Z',
})
assert.equal(memory.stage, 'inventory_discovery')
assert.equal(memory.emotion, 'uncertain')
assert.equal(memory.questionsAsked.includes('inventory_confirmation'), true)
assert.equal(memory.nextQuestionTopic, 'inventory')

const repeated = evaluateConversationMessage('Thanks, that helps. Are all three beds moving?', memory)
assert.equal(repeated.repeatedQuestion, true)
