import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTOMATION_JOB_LOCK_TIMEOUT_MS,
  getAutomationJobRetryDelayMs,
  shouldRetryAutomationJob,
} from '../../lib/automation-job-retry'

test('automation jobs retry with bounded exponential backoff', () => {
  assert.equal(getAutomationJobRetryDelayMs(1), 30_000)
  assert.equal(getAutomationJobRetryDelayMs(2), 60_000)
  assert.equal(getAutomationJobRetryDelayMs(3), 120_000)
  assert.equal(getAutomationJobRetryDelayMs(99), 300_000)
})

test('automation jobs dead-letter after the third claimed attempt', () => {
  assert.equal(shouldRetryAutomationJob(1), true)
  assert.equal(shouldRetryAutomationJob(2), true)
  assert.equal(shouldRetryAutomationJob(3), false)
  assert.equal(AUTOMATION_JOB_LOCK_TIMEOUT_MS, 600_000)
})
