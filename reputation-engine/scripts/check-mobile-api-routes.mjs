import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Native source (/mobile) is excluded from web uploads. These Next.js routes
// must still ship: an unanchored "mobile" exclusion removes both directories.
const required = [
  'auth/login', 'auth/me', 'caller-id', 'calls', 'contact-profile',
  'contacts', 'conversations', 'lines', 'upload-media',
]
const root = resolve(process.argv[2] || '.')
const missing = required.filter(route => !existsSync(resolve(root, `app/api/mobile/${route}/route.ts`)))
if (missing.length) {
  console.error(`Mobile API routes missing from deployment: ${missing.join(', ')}. Exclude /mobile only, never every directory named mobile.`)
  process.exit(1)
}
if (process.argv.includes('--built')) {
  const manifest = JSON.parse(readFileSync(resolve(root, '.next/server/app-paths-manifest.json'), 'utf8'))
  const missingBuilt = required.filter(route => !manifest[`/api/mobile/${route}/route`])
  if (missingBuilt.length) {
    console.error(`Mobile API routes missing from Next.js output: ${missingBuilt.join(', ')}`)
    process.exit(1)
  }
}
console.log(`Verified ${required.length} mobile API routes${process.argv.includes('--built') ? ' and build output' : ''}.`)
