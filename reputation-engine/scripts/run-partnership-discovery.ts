import { writeFileSync } from 'node:fs'
import { runPartnershipDiscovery } from '../lib/server/partnership-discovery'

runPartnershipDiscovery({ dryRun: !process.argv.includes('--apply') }).then(result => {
  const output = JSON.stringify(result, null, 2)
  const index = process.argv.indexOf('--output')
  if (index >= 0) writeFileSync(process.argv[index + 1], output + '\n')
  console.log(output)
  if (!result.ok) process.exitCode = 1
}).catch(error => { console.error(error.message); process.exitCode = 1 })
