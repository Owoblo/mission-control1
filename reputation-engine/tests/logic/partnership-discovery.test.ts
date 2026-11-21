import test from 'node:test'
import assert from 'node:assert/strict'
import { planListingTasks, readFeed, isOrganizationSignal } from '../../lib/server/partnership-discovery'

const now = new Date('2026-09-15T16:00:00Z')
const activity = { region: 'windsor', activity_key: 'a', contact_id: 'one', match_status: 'discovered', source_url: 'https://example.com/listing', observed_at: '2026-09-14T16:00:00Z', status_evidence: 'inferred_first_disappearance' }
const contact = { id: 'one', name: 'Person', city: 'Windsor', stage: 'target', sequence_paused: true }
test('new source contact gets stable task; multiple properties produce one review', () => {
  const a = planListingTasks([activity, { ...activity, activity_key: 'b' }], [contact], now)
  assert.equal(a.length, 1)
  assert.equal(a[0].source_key, planListingTasks([activity], [contact], new Date('2026-09-16'))[0].source_key)
  assert.match(a[0].description, /not a verified sale/)
})
test('suppression, already touched, active sequence and held region cannot become new outreach reviews', () => {
  for (const change of [{ do_not_contact: true }, { email_unsubscribed_at: now.toISOString() }, { cross_channel_suppressed_at: now.toISOString() }, { last_touch_at: now.toISOString() }, { sequence_paused: false }, { city: 'Ottawa' }, { next_follow_up: '2026-10-01' }]) {
    assert.equal(planListingTasks([activity], [{ ...contact, ...change }], now).length, 0)
  }
})
test('name collision stays in a match review instead of assigning a person', () => {
  const tasks = planListingTasks([{ ...activity, contact_id: null, match_status: 'ambiguous', representative: { name: 'Person' } }], [contact, { ...contact, id: 'two' }], now)
  assert.equal(tasks.length, 1); assert.equal(tasks[0].related_type, 'relationship')
})
test('stale feed gets health task, not relationship opportunity', () => {
  const tasks = planListingTasks([{ ...activity, observed_at: '2026-07-01' }], [contact], now)
  assert.equal(tasks.length, 1); assert.match(tasks[0].source_key, /feed-health/)
})
test('RSS parser handles CDATA and escaped URLs; rejects an HTML error page', () => {
  const rows = readFeed('<rss><channel><item><title><![CDATA[New factory opening]]></title><link>https://example.com/?a=1&amp;b=2</link><pubDate>Mon, 14 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>')
  assert.equal(rows[0].canonical_url, 'https://example.com/?a=1&b=2'); assert.equal(isOrganizationSignal(rows[0], now), true)
  assert.throws(() => readFeed('<html>Access denied</html>'))
})
test('old, undated and individual-distress headlines never enter the organization queue', () => {
  for (const row of [{ title: 'New hospital opening', published_at: '2026-07-01' }, { title: 'New hospital opening' }, { title: 'Residents displaced by apartment fire near new factory', published_at: '2026-09-14' }]) assert.equal(isOrganizationSignal(row, now), false)
})
