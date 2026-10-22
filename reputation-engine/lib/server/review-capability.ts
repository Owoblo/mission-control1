import { createHmac } from 'node:crypto'
import { requireEnv } from './runtime'
import { secretsEqual } from './security'
import type { Job } from '../types'

const lifetime = 30 * 24 * 60 * 60 * 1000
function signature(payload: string) { return createHmac('sha256', requireEnv('AUTH_SECRET')).update(`ssm:review-capability:v1:${payload}`).digest('base64url') }
export function issueReviewCapability(job: Pick<Job, 'id' | 'reviewAccessVersion'>, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ purpose:'review', id:job.id, version:job.reviewAccessVersion || 0, exp:now + lifetime })).toString('base64url')
  return `${payload}.${signature(payload)}`
}
export function verifyReviewCapability(token: string, job: Pick<Job, 'id' | 'reviewAccessVersion'>, now = Date.now()) {
  try {
    if (!token || token.length > 2048) return false
    const parts = token.split('.')
    if (parts.length !== 2 || !secretsEqual(parts[1], signature(parts[0]))) return false
    const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    return p.purpose === 'review' && p.id === job.id && p.version === (job.reviewAccessVersion || 0)
      && Number.isSafeInteger(p.exp) && p.exp > now && p.exp <= now + lifetime
  } catch { return false }
}
