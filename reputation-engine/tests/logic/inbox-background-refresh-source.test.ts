import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const inboxSource = fs.readFileSync(
  path.join(process.cwd(), 'app/sales/inbox/page.tsx'),
  'utf8',
)

test('recent-call transcript polling refreshes silently', () => {
  const transcriptPollingEffect = inboxSource.match(
    /const needsRefresh =[\s\S]*?if \(!needsRefresh\) return[\s\S]*?return \(\) => window\.clearInterval\(interval\)/,
  )?.[0]

  assert.ok(transcriptPollingEffect, 'expected to find the recent-call polling effect')
  assert.match(transcriptPollingEffect, /void refresh\(true\)/)
  assert.doesNotMatch(transcriptPollingEffect, /void refresh\(\)/)
})
