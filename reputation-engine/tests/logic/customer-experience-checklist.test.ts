import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeJob } from '../../lib/store'

const baseJob = {
  id: 'review_1',
  customerName: 'Steve',
  customerEmail: 'steve@example.com',
  customerPhone: '2265550100',
  moveDate: '2026-08-06',
  moveFrom: 'Amherstburg, ON',
  moveTo: 'Windsor, ON',
  crewLead: '',
  createdAt: '2026-08-06T12:00:00.000Z',
}

test('new review records receive a fully manual four-track checklist', () => {
  const job = normalizeJob(baseJob)
  assert.deepEqual(job.customerExperience, {
    googleStatus: 'not_started',
    yelpAccountStatus: 'unknown',
    yelpStatus: 'not_started',
    videoStatus: 'not_started',
    privateFeedbackStatus: 'not_started',
    nextFollowUpAt: undefined,
    assignedOwner: undefined,
    notes: undefined,
    updatedAt: undefined,
  })
})

test('manual checklist state and platform evidence survive normalization', () => {
  const job = normalizeJob({
    ...baseJob,
    customerExperience: {
      googleStatus: 'completed',
      yelpAccountStatus: 'yes',
      yelpStatus: 'in_progress',
      videoStatus: 'not_applicable',
      privateFeedbackStatus: 'completed',
      assignedOwner: 'John',
    },
    reviewProofAssets: [{ id: 'proof_1', url: 'https://example.com/proof.jpg', filename: 'google.jpg', mimeType: 'image/jpeg', kind: 'image', platform: 'google', uploadedAt: '2026-08-06T13:00:00.000Z' }],
  })
  assert.equal(job.customerExperience?.yelpAccountStatus, 'yes')
  assert.equal(job.reviewProofAssets?.[0].platform, 'google')
})
