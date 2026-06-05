import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDefaultMoveExecutionEntries, deriveActualHoursFromExecutionLog, normalizeMoveExecutionLog } from '../../lib/move-execution'

test('move execution log derives actual hours from first and last timestamps', () => {
  const entries = buildDefaultMoveExecutionEntries().map(entry => {
    if (entry.phase === 'crew_depart_yard') return { ...entry, timestamp: '2026-06-05T09:00:00.000Z' }
    if (entry.phase === 'return_yard') return { ...entry, timestamp: '2026-06-05T15:45:00.000Z' }
    return entry
  })

  assert.equal(deriveActualHoursFromExecutionLog(entries), 6.75)
})

test('move execution log normalizes predicted variance and learning fields', () => {
  const entries = buildDefaultMoveExecutionEntries().map(entry => {
    if (entry.phase === 'crew_depart_yard') return { ...entry, timestamp: '2026-06-05T09:00:00.000Z' }
    if (entry.phase === 'return_yard') return { ...entry, timestamp: '2026-06-05T16:00:00.000Z', note: 'Back at yard' }
    return entry
  })

  const log = normalizeMoveExecutionLog({
    predictedHours: 6,
    varianceReason: 'Long carry at destination',
    entries,
    issues: [{
      id: 'issue_1',
      category: 'access',
      severity: 'medium',
      note: 'Elevator was slow',
      createdAt: '2026-06-05T16:00:00.000Z',
    }],
  })

  assert.equal(log?.actualHours, 7)
  assert.equal(log?.varianceHours, 1)
  assert.equal(log?.varianceReason, 'Long carry at destination')
  assert.equal(log?.issues?.length, 1)
})
