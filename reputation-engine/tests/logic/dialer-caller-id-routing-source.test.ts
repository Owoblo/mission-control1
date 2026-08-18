import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()

test('dialer does not reuse caller ID from a previous lead', () => {
  const source = fs.readFileSync(path.join(root, 'app/components/floating-dialer.tsx'), 'utf8')
  assert.match(source, /const preferredFromNumber = input\?\.preferredFromNumber \|\| ''/)
  assert.doesNotMatch(source, /nextLeadId \? callerProfileRef\.current\?\.fromNumber/)
})

test('inbox passes the inbound branch number into callback dialer events', () => {
  const source = fs.readFileSync(path.join(root, 'app/sales/inbox/page.tsx'), 'utf8')
  assert.match(source, /detail: \{ phone, name, leadId, branchNumber \}/)
  assert.match(source, /getSaturnBranchNumberFromRawData\(selectedRaw\)/)
})
