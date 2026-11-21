import assert from 'node:assert/strict'
import test from 'node:test'
import { deferredCampaignSmsTime } from '../../lib/server/campaign-window-deferral'

const campaign = { timezone: 'America/Toronto', startHour: 10, endHour: 19 }

test('early SMS jobs wait for the configured same-day window', () => {
  assert.equal(
    deferredCampaignSmsTime(JSON.stringify(campaign), 'campaign_window_not_open', new Date('2026-11-20T13:00:00Z')),
    '2026-11-20T15:00:00.000Z',
  )
  assert.equal(
    deferredCampaignSmsTime(campaign, 'campaign_window_not_open', new Date('2026-07-20T13:00:00Z')),
    '2026-07-20T14:00:00.000Z',
  )
})

test('expired, closed, invalid and already open windows cannot create a new slot', () => {
  const now = new Date('2026-11-20T15:01:00Z')
  assert.equal(deferredCampaignSmsTime(campaign, 'campaign_day_expired', now), null)
  assert.equal(deferredCampaignSmsTime(campaign, 'campaign_window_closed', now), null)
  assert.equal(deferredCampaignSmsTime(campaign, 'campaign_window_not_open', now), null)
  assert.equal(deferredCampaignSmsTime('{', 'campaign_window_not_open', now), null)
})
