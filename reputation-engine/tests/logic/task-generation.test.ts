import test from 'node:test'
import assert from 'node:assert/strict'
import { generateConditionTasks, isLeadTaskCurrent } from '../../lib/server/task-generation'
import type { CRMLead } from '../../lib/types'

function lead(overrides: Partial<CRMLead> = {}): CRMLead {
  return { id: 'lead-task-1', name: 'Jordan Lee', stage: 'contacted', createdAt: '2026-08-01T12:00:00Z', ...overrides }
}

test('task generation turns a dated lead follow-up into accountable work', () => {
  const tasks = generateConditionTasks([
    lead({ assignedRepUserId: 'rep-1', assignedRepName: 'Thelma', followUpDate: '2026-08-12', followUpNote: 'Confirm the preferred moving date' }),
  ], [], new Date('2026-08-11T12:00:00Z'))
  const followUp = tasks.find(task => task.sourceKey === 'lead-follow-up:lead-task-1:2026-08-12')
  assert.equal(followUp?.title, 'Confirm the preferred moving date')
  assert.equal(followUp?.ownerUserId, 'rep-1')
  assert.equal(followUp?.relatedId, 'lead-task-1')
})

test('tentative reservations receive a decision task with a stable source key', () => {
  const tasks = generateConditionTasks([
    lead({ stage: 'tentative', tentativeReservationStatus: 'active', tentativeDecisionDate: '2026-08-11' }),
  ], [], new Date('2026-08-12T12:00:00Z'))
  const decision = tasks.find(task => task.sourceKey === 'tentative-decision:lead-task-1:2026-08-11')
  assert.equal(decision?.priority, 'urgent')
  assert.match(decision?.description || '', /deposit or release/i)
})

test('nurture check-ins create accountable work without becoming sales follow-up tasks', () => {
  const tasks = generateConditionTasks([
    lead({ stage: 'nurture', assignedRepUserId: 'rep-2', assignedRepName: 'Jordan', followUpDate: '2026-10-16', followUpNote: 'Check in on the move date' }),
  ], [], new Date('2026-10-16T12:00:00Z'))
  const nurtureTask = tasks.find(task => task.sourceKey === 'lead-nurture-check-in:lead-task-1:2026-10-16')
  assert.equal(nurtureTask?.category, 'nurture')
  assert.equal(nurtureTask?.ownerUserId, 'rep-2')
})

test('Lost creates no new tasks and removes persisted open tasks', () => {
  const current = lead({ stage: 'lost', followUpDate: '2026-10-02', tentativeReservationStatus: 'active', tentativeDecisionDate: '2026-10-02' })
  assert.equal(generateConditionTasks([current], []).length, 0)
  const task = generateConditionTasks([lead({followUpDate: '2026-10-02'})], [])[0]
  assert.equal(isLeadTaskCurrent(task, current), false)
  assert.equal(isLeadTaskCurrent(task, { ...current, stage: 'nurture' }), false)
})
test('previous nurture reminders become obsolete after a check-in or return', () => {
  const current = lead({ stage: 'nurture', followUpDate: '2026-10-16' })
  const task = generateConditionTasks([current], [])[0]
  assert.equal(isLeadTaskCurrent(task, current), true)
  assert.equal(isLeadTaskCurrent(task, { ...current, followUpDate: '2026-10-30' }), false)
  assert.equal(isLeadTaskCurrent(task, { ...current, stage: 'contacted' }), false)
})
