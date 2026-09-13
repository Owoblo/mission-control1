#!/usr/bin/env node
const projectId = process.env.VERCEL_PROJECT_ID || 'prj_uXzAkXKe2GJlqWAK3f7OWJpJANT6'
const teamId = process.env.VERCEL_TEAM_ID || 'team_EAg0Uem06yxKWgslp95UsC6Z'
const token = process.env.VERCEL_TOKEN
const force = process.argv.includes('--force')
const activateSes = process.argv.includes('--activate-ses')

if (!token) throw new Error('Missing VERCEL_TOKEN')

const keys = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_SES_OUTREACH_DOMAIN',
  'AWS_SES_CONFIGURATION_SET',
  'AWS_SES_MAIL_FROM_DOMAIN',
  'AWS_SES_EVENT_WEBHOOK_URL',
  'PARTNERSHIP_EMAIL',
  'PARTNERSHIP_EMAIL_REPLY_TO',
  'PARTNERSHIP_EMAIL_FROM_NAME',
  'PARTNERSHIP_EMAIL_WEBSITE',
  'PARTNERSHIP_EMAIL_FIRST_TOUCH_PLAIN_TEXT',
  'PARTNERSHIP_EMAIL_MAX_PER_RUN',
  'PARTNERSHIP_EMAIL_ALLOW_RISKY',
  'SES_PRODUCTION_ACCESS_CONFIRMED',
  'PUBLIC_APP_URL',
  'ZEROBOUNCE_API_KEY',
]
if (activateSes) keys.push('PARTNERSHIP_EMAIL_PROVIDER')

async function vercel(path, init = {}) {
  const url = `https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(teamId)}`
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) throw new Error(`Vercel ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  return data
}

async function main() {
  const existing = await vercel(`/v10/projects/${encodeURIComponent(projectId)}/env`)
  const existingByKey = new Map((existing.envs || []).map(env => [env.key, env]))
  const report = { projectId, teamId, added: [], skipped: [], deleted: [] }

  for (const key of keys) {
    const value = process.env[key]
    if (!value) {
      report.skipped.push({ key, reason: 'missing_local_value' })
      continue
    }
    const current = existingByKey.get(key)
    if (current && !force) {
      report.skipped.push({ key, reason: 'already_exists' })
      continue
    }
    if (current && force) {
      await vercel(`/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(current.id)}`, { method: 'DELETE' })
      report.deleted.push({ key })
    }
    await vercel(`/v10/projects/${encodeURIComponent(projectId)}/env`, {
      method: 'POST',
      body: JSON.stringify({
        key,
        value,
        type: 'encrypted',
        target: ['production'],
      }),
    })
    report.added.push({ key })
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch(error => {
  console.error(error?.message || error)
  process.exit(1)
})
