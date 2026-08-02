import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = resolve('deliverables/st-clair-quotes')
const jobs = [
  ['computer-lab-quote.html', 'Saturn-Star-Quote-01-St-Clair-Computer-Lab.pdf'],
  ['remaining-furniture-quote.html', 'Saturn-Star-Quote-02-St-Clair-Remaining-Furniture.pdf'],
]
const browser = await chromium.launch({ headless: true })
for (const [source, output] of jobs) {
  const page = await browser.newPage({ viewport: { width: 1224, height: 1584 } })
  await page.goto(pathToFileURL(resolve(dir, source)).href, { waitUntil: 'networkidle' })
  await page.pdf({ path: resolve(dir, output), format: 'Letter', printBackground: true, preferCSSPageSize: true })
  await page.close()
}
await browser.close()
