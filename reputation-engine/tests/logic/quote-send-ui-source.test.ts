import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const quotePage = fs.readFileSync(path.join(process.cwd(), 'app/sales/quotes/[id]/page.tsx'), 'utf8')

assert.match(
  quotePage,
  /if \(!quoteCommercialSnapshotChanged\(quote, pricingUpdates\)\) \{\s*return \{ quote, lead \}/,
  'an unchanged saved quote should proceed directly to delivery without a redundant pre-send PATCH',
)
assert.match(
  quotePage,
  /role="alert"[\s\S]*?\{error\}/,
  'delivery errors must remain visible inside the open send modal',
)
