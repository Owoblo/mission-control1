import test from 'node:test'
import assert from 'node:assert/strict'
import { isWithinNurtureReturnWindow, nextNurtureCheckInDate, applyNurtureTransition, recordNurtureCheckIn, validNurtureDate } from '../../lib/nurture-policy'

test('nurture leads return inside the configured move window', () => {
  const today = new Date('2026-10-02T12:00:00Z')
  assert.equal(isWithinNurtureReturnWindow('2026-11-01', today), true)
  assert.equal(isWithinNurtureReturnWindow('2026-11-02', today), false)
  assert.equal(isWithinNurtureReturnWindow('2026-10-01', today), false)
  assert.equal(isWithinNurtureReturnWindow('2026-12-01', today, 60), true)
})

test('nurture check-ins advance by the selected interval', () => {
  assert.equal(nextNurtureCheckInDate('2026-10-02', 14), '2026-10-16')
  assert.equal(nextNurtureCheckInDate(new Date('2026-10-02T12:00:00Z'), 30), '2026-11-01')
})

const lead = { id: 'fixture', name: 'Test', stage: 'contacted' as const, createdAt: '2026-10-02T12:00:00Z', followUpDate: '2026-10-03' }
const now = new Date('2026-10-02T12:00:00Z')
test('Follow-Up → Nurture requires a real date and defaults the schedule', () => {
  assert.throws(() => applyNurtureTransition(lead, { ...lead, stage: 'nurture' }, now), /expected move date/)
  assert.equal(validNurtureDate('2027-02-30'), false)
  const next = applyNurtureTransition(lead, { ...lead, stage: 'nurture', moveDate: '2027-02-01' }, now)
  assert.equal(next.followUpDate, '2026-10-16')
  assert.equal(next.nurtureIntervalDays, 14)
  assert.equal(next.nurtureReturnWindowDays, 30)
})
test('Follow-Up → Lost and Nurture → Lost clear reminders after serialization', () => {
  for (const stage of ['contacted', 'nurture'] as const) {
    const current = { ...lead, stage, nurtureNextCheckInAt: '2026-10-16T14:00:00Z' }
    const saved = JSON.parse(JSON.stringify(applyNurtureTransition(current, { ...current, stage: 'lost' }, now)))
    assert.equal(saved.stage, 'lost')
    assert.equal(saved.followUpDate, undefined)
    assert.equal(saved.nurtureNextCheckInAt, undefined)
  }
})
test('check-in saves actor, notes and date while advancing the reminder', () => {
  const result = recordNurtureCheckIn({ ...lead, stage: 'nurture', nurtureIntervalDays: 30 }, 'Still waiting for house sale', { name: 'Rep', userId: 'rep1' }, now)
  assert.equal(result.followUpDate, '2026-11-01')
  assert.equal(result.nurtureCheckIns?.[0].actorUserId, 'rep1')
  assert.equal(result.nurtureCheckIns?.[0].notes, 'Still waiting for house sale')
})
test('Nurture → Follow-Up clears the nurture reminder', () => {
  const current = { ...lead, stage: 'nurture' as const, nurtureNextCheckInAt: '2026-10-16T14:00:00Z' }
  const result = applyNurtureTransition(current, { ...current, stage: 'contacted', followUpDate: '2026-10-02' }, now)
  assert.equal(result.nurtureNextCheckInAt, undefined)
  assert.equal(result.followUpDate, '2026-10-02')
})
