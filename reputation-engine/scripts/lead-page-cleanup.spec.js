const { test, expect } = require('@playwright/test')
const fs = require('fs')

const baseUrl = process.env.BASE_URL || 'https://reputation-engine.vercel.app'
const leadPath = process.env.LEAD_PATH || '/sales/leads/lead_v14c1verz'

function loadEnv(file) {
  const values = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const idx = line.indexOf('=')
    const key = line.slice(0, idx)
    let value = line.slice(idx + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    values[key] = value.replace(/\\n/g, '').trim()
  }
  return values
}

const env = loadEnv('.env.local')

test('lead page keeps inventory workflow inside build estimate only', async ({ page }) => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/password/i).fill(env.AUTH_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/sales(?:\?.*)?$/, { timeout: 30000 })

  await page.goto(`${baseUrl}${leadPath}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Build Estimate' })).toBeVisible({ timeout: 30000 })

  await expect(page.getByRole('button', { name: /^Inventory$/ })).toHaveCount(0)
  await expect(page.getByText('Inventory + Scope', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Build the inventory before you price.', { exact: true })).toHaveCount(0)

  console.log('leadCleanupCheck', JSON.stringify({
    url: `${baseUrl}${leadPath}`,
    inventoryTabVisible: await page.getByRole('button', { name: /^Inventory$/ }).count(),
    inventoryScopeVisible: await page.getByText('Inventory + Scope', { exact: true }).count(),
  }))
})
