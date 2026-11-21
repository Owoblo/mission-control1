import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPartnershipSmsSchedule, parseSmsCampaignConfig } from '../../lib/server/partnership-sms'

test('campaign pace is not clamped to the old ceilings', () => {
  assert.equal(parseSmsCampaignConfig({type:'partnership_sms_campaign',dailyCap:3000})?.dailyCap,3000)
})
test('weekend schedules retain all recipients and roll forward on calendar days', () => {
  const rows=buildPartnershipSmsSchedule({count:3001,dailyCap:3000,startDate:'2026-10-02',senderNumbers:['+14374650584'],includeWeekends:true})
  assert.equal(rows.length,3001)
  assert.equal(rows[2999].scheduledAt.slice(0,10),'2026-10-02')
  assert.equal(rows[3000].scheduledAt.slice(0,10),'2026-10-03')
})
test('existing weekday scheduling is preserved unless weekends are selected', () => {
  const rows=buildPartnershipSmsSchedule({count:2,dailyCap:1,startDate:'2026-10-02',senderNumbers:['+14374650584']})
  assert.equal(rows[1].scheduledAt.slice(0,10),'2026-10-05')
})
test('nonfinite sending pace fails', () => {
  assert.throws(()=>buildPartnershipSmsSchedule({count:1,dailyCap:Infinity,senderNumbers:[]}))
})
