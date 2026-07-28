import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeAutomatedStageSuggestion } from '../../lib/lead-stage-safety'

test('automation cannot recommend the manual-only lost stage', () => {
  assert.equal(sanitizeAutomatedStageSuggestion('lost'), undefined)
})

test('automation can still recommend active sales stages', () => {
  assert.equal(sanitizeAutomatedStageSuggestion('nurture'), 'nurture')
  assert.equal(sanitizeAutomatedStageSuggestion('booked'), 'booked')
})

test('unknown model output cannot become a CRM stage', () => {
  assert.equal(sanitizeAutomatedStageSuggestion('closed_won'), undefined)
  assert.equal(sanitizeAutomatedStageSuggestion(null), undefined)
})
