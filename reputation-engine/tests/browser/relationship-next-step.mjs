import { chromium } from 'playwright'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
process.env.AUTH_SECRET = 'isolated-intelligence-fixture'
const require = createRequire(import.meta.url)
require(resolve('tests/helpers/register-compiled-aliases.cjs'))
const auth = require(resolve('.tmp-logic-tests/lib/auth.js'))
const a = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const contact = { id: a, name: 'Partner Fixture', phone: '+16135550199', email: 'fixture@example.test', city: 'Ottawa', company: 'Fixture Realty', industry: 'Real Estate', normalized_stage: 'engaged', stage: 'engaged', sequence_step: 0, sequence_paused: true, touch_count: 2, needs_follow_up: false, latest_inbound_at: '2026-10-23T12:00:00Z', latest_inbound_note: 'Please send a digital card.', tags: [] }
const original = { key: 'fixture-request', contactId: a, contactName: contact.name, kind: 'digital_card', title: 'Review requested digital card', reason: 'A recorded request has no linked delivery evidence. Check the conversation before acting.', requestedAt: '2026-10-23T12:00:00Z', excerpt: 'Please send a digital card.', state: 'review', owner: null, dueAt: null, taskId: null, requestId: 'request', receiptId: null, delivery: null, needsConfirmation: false, evidenceVersion: 'v1' }
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined, headless: true })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    await context.addCookies([{ name: 'mc_session', value: await auth.createSessionToken({ role: 'owner', userId: 'fixture', name: 'Browser Fixture' }), url: 'http://127.0.0.1:3108', httpOnly: true, sameSite: 'Lax' }])
    const page = await context.newPage(), actions = [], errors = []
    let step = { ...original }, unavailable = false
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) console.log('BROWSER:', m.text()) })
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url())
      let data = [], status = 200
      if (url.pathname === '/api/auth/me') data = { role: 'owner', name: 'Browser Fixture', userId: 'fixture', branch: null }
      else if (url.pathname === '/api/marketing/next-steps') {
        if (request.method() === 'POST') {
          const body = request.postDataJSON(); actions.push(body)
          if (body.action === 'create_task') step = { ...step, taskId: 'task-fixture', owner: 'Browser Fixture', evidenceVersion: 'v2' }
          data = { ok: true, outboundSent: false }
        } else if (unavailable) { status = 503; data = { error: 'Evidence could not refresh.', coverage: { complete: false } } }
        else data = { rows: [step], total: 1, counts: { review: 1 }, receipts: [], existingWork: [], coverage: { complete: true }, generatedAt: '2026-10-24T12:00:00Z' }
      } else if (url.pathname === '/api/marketing/contacts') data = { contacts: [contact], total: 1, hasMore: false }
      else if (url.pathname === '/api/marketing/sms/replies') data = { responses: [{ contact }] }
      else if (url.pathname === '/api/marketing/touches') data = [{ id: 'request', contact_id: a, channel: 'sms', direction: 'inbound', notes: original.excerpt, created_at: original.requestedAt, metadata: { to: '+16135550100' } }]
      else if (url.pathname.endsWith('/context')) data = { complete: true, errors: [], responsibility: 'Partnerships', replyStatus: 'needs_review', events: [], jobs: [], outcomes: { linkedRecords: 0, movingOpportunities: 0, referralChannels: 0, quoted: 0, booked: 0, completed: 0 } }
      else if (url.pathname.includes('relationship-record')) data = { identity: { category: { label: 'Real estate' }, role: 'Agent', city: 'Ottawa' }, channels: {}, tasks: [] }
      else if (url.pathname.includes('notifications')) data = { items: [], totalCount: 0, breakdown: {} }
      else if (url.pathname.includes('relationship-summary')) data = {}
      else if (url.pathname.includes('settings')) data = {}
      else if (url.pathname.includes('/dialer/')) { status = 503; data = { error: 'Isolated fixture; no telephony access' } }
      if (request.method() !== 'GET' && url.pathname !== '/api/marketing/next-steps') {
        assert.ok(url.pathname.includes('/dialer/') || url.pathname.includes('notifications'), `Unexpected write: ${url.pathname}`)
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    })
    await page.goto(`http://127.0.0.1:3108/marketing/partners?tab=phone&contact=${a}`, { waitUntil: 'networkidle' })
    const panel = page.getByRole('region', { name: 'Next step', exact: true })
    try { await panel.getByText('Review requested digital card', { exact: true }).waitFor({ timeout: 12000 }) }
    catch (error) { await page.screenshot({ path: '/private/tmp/ssm-intelligence-browser-debug.png', fullPage: true }); console.log((await page.locator('body').innerText()).slice(0, 4000), errors); throw error }
    await page.screenshot({ path: `/private/tmp/ssm-intelligence-initial-${width}.png`, fullPage: true })
    await page.getByPlaceholder('Message…', { exact: true }).fill('Unsent customer-facing draft')
    await panel.getByRole('button', { name: 'Review in conversation', exact: true }).click()
    assert.equal(await page.getByPlaceholder('Message…', { exact: true }).inputValue(), 'Unsent customer-facing draft')
    await panel.getByRole('button', { name: 'View evidence', exact: true }).click()
    await panel.getByText(original.excerpt, { exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Correct suggestion', exact: true }).click()
    await panel.getByLabel('What did the system miss?').fill('Unsaved correction must survive a refresh')
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.waitForTimeout(400)
    assert.equal(await panel.getByLabel('What did the system miss?').inputValue(), 'Unsaved correction must survive a refresh')
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
    await panel.getByRole('button', { name: 'Assign review task', exact: true }).click()
    await panel.getByRole('link', { name: 'Open task', exact: true }).waitFor()
    assert.equal(actions.filter(a => a.action === 'create_task').length, 1)
    assert.ok(actions.some(a => a.action === 'shown'))
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page overflow')
    await page.screenshot({ path: `/private/tmp/ssm-intelligence-${width}.png`, fullPage: true })
    unavailable = true
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click()
    await panel.getByText('Evidence could not refresh.', { exact: false }).waitFor()
    assert.equal(await panel.getByRole('button', { name: 'Review in conversation' }).isDisabled(), true)
    unavailable = false
    await page.goto('http://127.0.0.1:3108/marketing/partners?tab=today', { waitUntil: 'networkidle' })
    const queue = page.getByRole('region', { name: 'Outstanding partner requests', exact: true })
    await queue.getByRole('link').filter({ hasText: 'Partner Fixture' }).waitFor()
    await queue.getByRole('link').filter({ hasText: 'Partner Fixture' }).click()
    await page.getByRole('region', { name: 'Next step', exact: true }).getByRole('link', { name: 'Open task', exact: true }).waitFor()
    assert.equal(actions.filter(a => a.action === 'create_task').length, 1)
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS ${width}px: request evidence, durable exposure, owned task, correction draft preservation, failure state, no provider writes or overflow.`)
  }
} finally { await browser.close() }
