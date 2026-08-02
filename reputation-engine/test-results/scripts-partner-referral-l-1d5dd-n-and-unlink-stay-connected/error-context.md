# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scripts/partner-referral-local-qa.spec.js >> partnership directory search, creation, lead attribution, and unlink stay connected
- Location: scripts/partner-referral-local-qa.spec.js:25:1

# Error details

```
Test timeout of 120000ms exceeded.
```

```
Error: locator.fill: Test timeout of 120000ms exceeded.
Call log:
  - waiting for getByLabel(/password/i)

```

# Page snapshot

```yaml
- generic [active] [ref=e1]: Loading...
```

# Test source

```ts
  1   | const { test, expect } = require('@playwright/test')
  2   | const fs = require('fs')
  3   | 
  4   | const env = {}
  5   | for (const path of ['.env.local', '/private/tmp/saturn-current-production.env']) {
  6   |   if (!fs.existsSync(path)) continue
  7   |   for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
  8   |     if (!line || line.startsWith('#') || !line.includes('=')) continue
  9   |     const index = line.indexOf('=')
  10  |     const key = line.slice(0, index)
  11  |     if (env[key] === undefined) env[key] = line.slice(index + 1).replace(/^"|"$/g, '').replace(/\\n$/, '').trim()
  12  |   }
  13  | }
  14  | const baseUrl = 'http://127.0.0.1:3108'
  15  | const dbHeaders = {
  16  |   apikey: env.SUPABASE_KEY,
  17  |   Authorization: `Bearer ${env.SUPABASE_KEY}`,
  18  | }
  19  | 
  20  | test.use({
  21  |   browserName: 'chromium',
  22  |   launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  23  | })
  24  | 
  25  | test('partnership directory search, creation, lead attribution, and unlink stay connected', async ({ page }) => {
  26  |   test.setTimeout(120_000)
  27  |   const suffix = Date.now().toString().slice(-8)
  28  |   const partnerName = `QA Referral Partner ${suffix}`
  29  |   let contactId = ''
  30  |   let leadId = ''
  31  | 
  32  |   try {
  33  |     await page.goto(`${baseUrl}/login`)
> 34  |     await page.getByLabel(/password/i).fill(env.AUTH_PASSWORD)
      |                                        ^ Error: locator.fill: Test timeout of 120000ms exceeded.
  35  |     await page.getByRole('button', { name: 'Sign in' }).click()
  36  |     await page.waitForURL(/\/sales(?:\?.*)?$/)
  37  | 
  38  |     const importedSearch = await page.evaluate(async () => {
  39  |       const response = await fetch('/api/sales/partner-directory?q=JASON%20BROWN')
  40  |       return { ok: response.ok, payload: await response.json() }
  41  |     })
  42  |     console.log('importedSearch', JSON.stringify(importedSearch))
  43  |     expect(importedSearch.ok).toBeTruthy()
  44  |     expect(importedSearch.payload.contacts.some(contact => /jason brown/i.test(contact.name))).toBeTruthy()
  45  | 
  46  |     const created = await page.evaluate(async input => {
  47  |       const response = await fetch('/api/sales/partner-directory', {
  48  |         method: 'POST',
  49  |         headers: { 'Content-Type': 'application/json' },
  50  |         body: JSON.stringify(input),
  51  |       })
  52  |       return { ok: response.ok, payload: await response.json() }
  53  |     }, {
  54  |       name: partnerName,
  55  |       company: 'QA Realty',
  56  |       category: 'realtor',
  57  |       city: 'London',
  58  |       email: `qa-ref-${suffix}@example.com`,
  59  |     })
  60  |     expect(created.ok).toBeTruthy()
  61  |     contactId = created.payload.contact.id
  62  | 
  63  |     await page.goto(`${baseUrl}/sales/new`)
  64  |     await page.locator('select').filter({ has: page.locator('option[value="partner_referral"]') }).selectOption('partner_referral')
  65  |     await page.getByPlaceholder(/Search name, brokerage/i).fill(partnerName)
  66  |     await page.getByRole('button', { name: new RegExp(partnerName) }).click()
  67  |     await expect(page.getByText('Connected partnership record')).toBeVisible()
  68  | 
  69  |     const createdLead = await page.evaluate(async input => {
  70  |       const response = await fetch('/api/sales/leads', {
  71  |         method: 'POST',
  72  |         headers: { 'Content-Type': 'application/json' },
  73  |         body: JSON.stringify(input),
  74  |       })
  75  |       return { ok: response.ok, payload: await response.json() }
  76  |     }, {
  77  |       name: `QA Referred Customer ${suffix}`,
  78  |       phone: `+1519555${suffix.slice(-4)}`,
  79  |       source: 'partner_referral',
  80  |       partnerReferralContactId: contactId,
  81  |       partnerReferralName: partnerName,
  82  |       partnerReferralCompany: 'QA Realty',
  83  |       partnerReferralCategory: 'realtor',
  84  |       originCity: 'London',
  85  |       forceNew: true,
  86  |     })
  87  |     expect(createdLead.ok).toBeTruthy()
  88  |     leadId = createdLead.payload.id
  89  |     expect(createdLead.payload.partnerReferralContactId).toBe(contactId)
  90  | 
  91  |     const referralResponse = await fetch(
  92  |       `${env.SUPABASE_URL}/rest/v1/partner_referrals?crm_lead_id=eq.${leadId}&select=id,contact_id,source`,
  93  |       { headers: dbHeaders }
  94  |     )
  95  |     const referrals = await referralResponse.json()
  96  |     expect(referrals).toHaveLength(1)
  97  |     expect(referrals[0].contact_id).toBe(contactId)
  98  |     expect(referrals[0].source).toBe('crm_lead_attribution')
  99  | 
  100 |     const unlinked = await page.evaluate(async leadId => {
  101 |       const response = await fetch(`/api/sales/leads/${leadId}`, {
  102 |         method: 'PATCH',
  103 |         headers: { 'Content-Type': 'application/json' },
  104 |         body: JSON.stringify({
  105 |           source: 'google_online_search',
  106 |           partnerReferralContactId: '',
  107 |           partnerReferralName: '',
  108 |           partnerReferralCompany: '',
  109 |           partnerReferralCategory: '',
  110 |         }),
  111 |       })
  112 |       return { ok: response.ok, payload: await response.json() }
  113 |     }, leadId)
  114 |     expect(unlinked.ok).toBeTruthy()
  115 |     expect(unlinked.payload.partnerReferralContactId).toBeUndefined()
  116 | 
  117 |     const removedResponse = await fetch(
  118 |       `${env.SUPABASE_URL}/rest/v1/partner_referrals?crm_lead_id=eq.${leadId}&select=id`,
  119 |       { headers: dbHeaders }
  120 |     )
  121 |     expect(await removedResponse.json()).toEqual([])
  122 |   } finally {
  123 |     if (leadId) {
  124 |       await fetch(`${env.SUPABASE_URL}/rest/v1/partner_referrals?crm_lead_id=eq.${leadId}`, { method: 'DELETE', headers: dbHeaders })
  125 |       await fetch(`${env.SUPABASE_URL}/rest/v1/crm_leads?id=eq.${leadId}`, { method: 'DELETE', headers: dbHeaders })
  126 |     }
  127 |     if (contactId) {
  128 |       await fetch(`${env.SUPABASE_URL}/rest/v1/market_contacts?id=eq.${contactId}`, { method: 'DELETE', headers: dbHeaders })
  129 |     }
  130 |   }
  131 | })
  132 | 
```