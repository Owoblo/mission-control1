const { test, expect } = require('@playwright/test')
const fs = require('fs')

const baseUrl = process.env.BASE_URL || 'https://reputation-engine.vercel.app'
const envPath = '.env.local'

function loadEnv(file) {
  const values = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const idx = line.indexOf('=')
    const key = line.slice(0, idx)
    let value = line.slice(idx + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    value = value.replace(/\\n/g, '').trim()
    values[key] = value
  }
  return values
}

function parseMoney(input) {
  return Number(String(input || '').replace(/[^0-9.-]+/g, ''))
}

async function supabase(path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { response, text, json }
}

async function getSummaryAmount(modal, label) {
  const node = modal.locator(`xpath=.//div[normalize-space()="${label}"]/following-sibling::div[1]`).first()
  await expect(node).toBeVisible()
  return parseMoney(await node.innerText())
}

const env = loadEnv(envPath)

test('production estimate builder keeps discount math and address flow aligned', async ({ page }) => {
  test.setTimeout(180000)

  const runSuffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8)
  const phone = `+1519555${runSuffix.slice(-4)}`

  let leadId = ''
  let quoteId = ''
  let clientId = ''

  try {
    console.log('step: login page')
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
    await page.getByLabel(/password/i).fill(env.AUTH_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/sales(?:\?.*)?$/, { timeout: 30000 })
    await expect(page.getByRole('heading', { name: 'Live Feed' })).toBeVisible({ timeout: 30000 })

    console.log('step: create lead')
    const createLead = await page.evaluate(async ({ phone, runSuffix }) => {
      const inventory = [
        { name: 'Samsung TV', item: 'Samsung TV', room: 'Living Room', qty: 1, cubicFeet: 18, weightLbs: 55, included: true },
        { name: 'Dining Table', item: 'Dining Table', room: 'Dining Room', qty: 1, cubicFeet: 45, weightLbs: 120, included: true },
        { name: 'Patio Set', item: 'Patio Set', room: 'Outdoor', qty: 1, cubicFeet: 55, weightLbs: 95, included: true },
        { name: 'Office Table', item: 'Office Table', room: 'Office', qty: 1, cubicFeet: 28, weightLbs: 70, included: true },
      ]

      const response = await fetch('/api/sales/leads', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `QA Estimate ${runSuffix}`,
          phone,
          source: 'direct_mail',
          moveType: 'residential',
          branch: 'windsor',
          originAddress: '171 Ouellette Ave',
          originCity: 'Windsor',
          destAddress: '300 Chatham St W',
          destCity: 'Windsor',
          notes: 'Synthetic estimate-builder QA lead.',
          inventory,
          totalItems: inventory.reduce((sum, item) => sum + (item.qty || 1), 0),
          totalCubicFeet: inventory.reduce((sum, item) => sum + ((item.cubicFeet || 0) * (item.qty || 1)), 0),
          totalWeightLbs: inventory.reduce((sum, item) => sum + ((item.weightLbs || 0) * (item.qty || 1)), 0),
        }),
      })
      const json = await response.json().catch(() => null)
      return { ok: response.ok, json }
    }, { phone, runSuffix })

    expect(createLead.ok).toBeTruthy()
    leadId = createLead.json?.id || ''
    expect(leadId).toBeTruthy()

    console.log('step: create quote')
    const createQuote = await page.evaluate(async ({ leadId }) => {
      const response = await fetch('/api/sales/quotes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })
      const json = await response.json().catch(() => null)
      return { ok: response.ok, json }
    }, { leadId })

    expect(createQuote.ok).toBeTruthy()
    quoteId = createQuote.json?.quote?.id || ''
    clientId = createQuote.json?.quote?.clientId || ''
    expect(quoteId).toBeTruthy()

    console.log('step: address suggest')
    const suggestResult = await page.evaluate(async () => {
      const response = await fetch('/api/sales/address-suggest?q=171%20Ouellette%20Ave%20Windsor', {
        credentials: 'include',
      })
      const json = await response.json().catch(() => null)
      return { ok: response.ok, json }
    })
    expect(suggestResult.ok).toBeTruthy()
    expect(Array.isArray(suggestResult.json?.suggestions)).toBeTruthy()
    expect(suggestResult.json.suggestions.length).toBeGreaterThan(0)

    console.log('step: open lead page')
    await page.goto(`${baseUrl}/sales/leads/${leadId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Build Estimate' })).toBeVisible({ timeout: 30000 })
    console.log('step: open estimate modal')
    await page.getByRole('button', { name: 'Build Estimate' }).click()

    const modal = page.locator('div').filter({ hasText: 'Estimate Draft' }).first()
    await expect(modal.getByText('Estimate Draft')).toBeVisible({ timeout: 30000 })
    await expect(modal.getByText('Customer', { exact: true })).toHaveCount(0)
    await expect(modal.getByText('Origin Address', { exact: true })).toHaveCount(0)
    await expect(modal.getByText('Destination Address', { exact: true })).toHaveCount(0)
    await expect(modal.getByText('Route Confirmation', { exact: true })).toHaveCount(0)
    await expect(modal.getByText('Inventory + Scope Tools', { exact: true })).toHaveCount(0)
    await expect(modal.getByText('Destination + Scope')).toHaveCount(0)
    await expect(modal.getByRole('button', { name: 'Refresh Origin Inventory' })).toHaveCount(0)
    await expect(modal.getByText('How the route is priced')).toHaveCount(0)
    await expect(modal.getByText(/Origin → Destination:/)).toHaveCount(0)
    await expect(modal.getByText('Inventory Snapshot')).toBeVisible()

    console.log('step: check discount math')
    const originalEstimate = await getSummaryAmount(modal, 'Original estimate')
    const subtotalBefore = await getSummaryAmount(modal, 'Subtotal')
    expect(subtotalBefore).toBe(originalEstimate)

    const spotDiscountToggle = modal.locator('xpath=.//div[normalize-space()="10% Spot Discount"]/following-sibling::button[1]').first()
    await spotDiscountToggle.click()
    await expect(modal.getByText('10% off the current base estimate')).toBeVisible()

    const subtotalAfter = await getSummaryAmount(modal, 'Subtotal')
    expect(subtotalAfter).toBeLessThan(subtotalBefore)
    expect(Math.abs(subtotalAfter - Math.round(originalEstimate * 0.9 * 100) / 100)).toBeLessThanOrEqual(0.02)

    await spotDiscountToggle.click()
    await expect(modal.getByText('10% off the current base estimate')).toHaveCount(0)

    const subtotalReset = await getSummaryAmount(modal, 'Subtotal')
    expect(Math.abs(subtotalReset - originalEstimate)).toBeLessThanOrEqual(0.02)

    console.log('step: screenshot')
    await page.screenshot({ path: '/tmp/estimate-builder-prod-qa.png', fullPage: true })
  } finally {
    if (quoteId) {
      await supabase(`crm_quotes?id=eq.${encodeURIComponent(quoteId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      })
      await supabase(`crm_followup_logs?data->>quoteId=eq.${encodeURIComponent(quoteId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      })
    }

    if (clientId) {
      await supabase(`crm_clients?id=eq.${encodeURIComponent(clientId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      })
    }

    if (leadId) {
      await supabase(`crm_followup_logs?data->>leadId=eq.${encodeURIComponent(leadId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      })
      await supabase(`crm_leads?id=eq.${encodeURIComponent(leadId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      })
    }
  }
})
