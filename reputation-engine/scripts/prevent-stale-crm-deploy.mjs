import { execFileSync } from 'node:child_process'
try {
  execFileSync('git', ['merge-base', '--is-ancestor', 'origin/master', 'HEAD'], { stdio: 'pipe' })
} catch {
  console.error('This draft checkout does not include production master. Use the reviewed CRM release branch or rebase the draft before deploying. See docs/audits/2026-10-23-crm-remediation.md.')
  process.exit(1)
}
const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim()
if (changes) {
  console.error('Commit and validate the reviewed source before a production deploy. This checkout has pending local edits.')
  process.exit(1)
}
