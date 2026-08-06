import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReviewRequestCopy } from '../../lib/review-request-content'

test('review request is warm, local-business focused, and includes the review flow', () => {
  const copy = buildReviewRequestCopy({ firstName: 'Steve', brandName: 'Saturn Star Movers', reviewFlowUrl: 'https://example.com/review/1' })
  assert.match(copy.smsBody, /Hi Steve/)
  assert.match(copy.smsBody, /local small business/)
  assert.match(copy.smsBody, /https:\/\/example.com\/review\/1/)
})

test('review request supports the Ottawa Dexa brand', () => {
  const copy = buildReviewRequestCopy({ firstName: 'Ana', brandName: 'Dexa Movers', reviewFlowUrl: 'https://example.com/review/2' })
  assert.match(copy.emailSubject, /Dexa Movers/)
  assert.doesNotMatch(copy.emailBody, /Saturn Star/)
})
