import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canJoinVideoSurvey,
  isVideoSurveyParticipantPresent,
  statusAfterVideoSurveyCustomerEvent,
  videoSurveyPresence,
  videoSurveyProcessingStages,
} from '../../lib/video-survey'

test('only pre-call and live survey states can be joined', () => {
  assert.equal(canJoinVideoSurvey('ready'), true)
  assert.equal(canJoinVideoSurvey('waiting'), true)
  assert.equal(canJoinVideoSurvey('live'), true)
  assert.equal(canJoinVideoSurvey('recording_processing'), false)
  assert.equal(canJoinVideoSurvey('review_required'), false)
  assert.equal(canJoinVideoSurvey('confirmed'), false)
})

test('temporary customer exits remain resumable until explicitly finished', () => {
  assert.equal(statusAfterVideoSurveyCustomerEvent('live', 'customer.left', true), 'reconnecting')
  assert.equal(statusAfterVideoSurveyCustomerEvent('waiting', 'customer.reconnecting', false), 'reconnecting')
  assert.equal(statusAfterVideoSurveyCustomerEvent('reconnecting', 'customer.reconnected', true), 'live')
  assert.equal(statusAfterVideoSurveyCustomerEvent('reconnecting', 'customer.reconnected', false), 'waiting')
  assert.equal(statusAfterVideoSurveyCustomerEvent('recording_processing', 'customer.left', false), undefined)
})

test('presence metadata distinguishes joined participants from stale states', () => {
  const presence = videoSurveyPresence({
    metadata: {
      presence: {
        customer: { state: 'joined', at: '2026-07-26T18:00:00.000Z' },
        representative: { state: 'left', at: '2026-07-26T18:02:00.000Z' },
      },
    },
  })
  assert.equal(isVideoSurveyParticipantPresent(presence.customer), true)
  assert.equal(isVideoSurveyParticipantPresent(presence.representative), false)
})

test('processing stages expose upload, AI, inventory, and human review progress', () => {
  const analyzing = videoSurveyProcessingStages({
    sessionStatus: 'analyzing',
    recordingStatus: 'uploaded',
    analysisStage: 'analyzing_video',
    analysisProgress: 40,
  })
  assert.deepEqual(analyzing.map(stage => stage.state), [
    'complete',
    'complete',
    'active',
    'pending',
    'pending',
  ])

  const review = videoSurveyProcessingStages({
    sessionStatus: 'review_required',
    recordingStatus: 'uploaded',
    analysisStage: 'review_required',
    analysisProgress: 100,
  })
  assert.deepEqual(review.map(stage => stage.state), [
    'complete',
    'complete',
    'complete',
    'complete',
    'active',
  ])
})
