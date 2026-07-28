import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(
  path.join(process.cwd(), 'app/components/sales/opportunity-network-workspace.tsx'),
  'utf8',
)

assert.match(
  source,
  /const \[expanded, setExpanded\] = useState\(false\)/,
  'Opportunity & network must be collapsed when a lead first opens',
)

assert.match(
  source,
  /aria-expanded=\{expanded\}/,
  'The workspace toggle must expose its state accessibly',
)

assert.match(
  source,
  /\{expanded \? <>\s*<div/,
  'The full workspace must only render after the operator expands it',
)
