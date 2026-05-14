const { test, expect } = require('@playwright/test')
const fs = require('fs')

const baseUrl = process.env.BASE_URL || 'https://reputation-engine.vercel.app'

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

test('debug inbox recording requests', async ({ page }) => {
  const twilioRequests = []
  const proxyRequests = []

  page.on('request', request => {
    if (request.url().includes('twilio') || request.url().includes('/api/sales/dialer/recording')) {
      console.log('request', request.method(), request.url())
    }
    if (request.url().includes('api.twilio.com')) {
      twilioRequests.push(request.url())
    }
    if (request.url().includes('/api/sales/dialer/recording')) {
      proxyRequests.push(request.url())
    }
  })
  page.on('response', async response => {
    const url = response.url()
    if (url.includes('twilio') || url.includes('/api/sales/dialer/recording')) {
      console.log('response', response.status(), url)
    }
  })
  page.on('dialog', dialog => {
    console.log('dialog', dialog.type(), dialog.message())
    dialog.dismiss().catch(() => {})
  })

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/password/i).fill(env.AUTH_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/sales(?:\?.*)?$/, { timeout: 30000 })

  await page.goto(`${baseUrl}/sales/inbox`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Lead Inbox' })).toBeVisible({ timeout: 30000 })

  const loadButton = page.getByRole('button', { name: 'Load recording' }).first()
  await expect(loadButton).toBeVisible()
  await expect(page.locator('audio')).toHaveCount(0)
  console.log('twilioRequestsBeforeClick', JSON.stringify(twilioRequests))
  console.log('proxyRequestsBeforeClick', JSON.stringify(proxyRequests))

  await loadButton.click()
  await expect(page.locator('audio')).toHaveCount(1)

  const allAudio = await page.locator('audio').evaluateAll(nodes =>
    nodes.map(node => ({
      src: node.getAttribute('src'),
      currentSrc: node.currentSrc,
      preload: node.getAttribute('preload'),
    }))
  ).catch(() => [])
  console.log('allAudio', JSON.stringify(allAudio))
  console.log('twilioRequestsAfterClick', JSON.stringify(twilioRequests))
  console.log('proxyRequestsAfterClick', JSON.stringify(proxyRequests))

  await page.waitForTimeout(5000)
})
