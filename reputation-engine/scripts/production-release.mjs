import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
execFileSync('git', ['fetch', 'origin', 'master'], { stdio: 'inherit' })
execFileSync(process.execPath, ['scripts/check-release-contracts.mjs', '--tracked'], { stdio: 'inherit' })
if (git('status','--porcelain','--untracked-files=normal')) throw new Error('Commit the reviewed release files before deploying. Use a clean checkout based on current master.')
const root = git('rev-parse','--show-toplevel')
const sourceSha = git('rev-parse','HEAD')
const baseSha = git('rev-parse','origin/master')
const project = JSON.parse(readFileSync(resolve(root, '.vercel/project.json'), 'utf8'))
if (project.projectId !== 'prj_uXzAkXKe2GJlqWAK3f7OWJpJANT6') throw new Error('This checkout is linked to a different Vercel project')
writeFileSync('release-manifest.json', JSON.stringify({ sourceSha, baseSha, createdAt: new Date().toISOString(), migrations: ['20261023000100_durable_financial_commands.sql','20261023000200_internal_alert_outbox.sql','20261024000100_relationship_next_step_journal.sql'] }, null, 2)+'\n')
// Build from source with Vercel's production environment. Never reuse a stale
// local prebuilt directory or embed placeholder secrets in a production build.
execFileSync('npx', ['vercel','deploy','--prod','--yes',...(process.argv.includes('--candidate') ? ['--skip-domain'] : []),'--cwd',root,'--meta',`crmSourceSha=${sourceSha}`,'--meta',`crmBaseSha=${baseSha}`], { stdio: 'inherit' })
