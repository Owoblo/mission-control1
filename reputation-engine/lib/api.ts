import type { PublicReviewJob } from './public-review'
import type { Job, Partner } from './types'

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = payload?.error || `Request failed: ${response.status}`
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

export async function fetchJobs(): Promise<Job[]> {
  const response = await fetch('/api/jobs', { cache: 'no-store' })
  return readJson<Job[]>(response)
}

export async function fetchJob(id: string, token = ''): Promise<PublicReviewJob | null> {
  const response = await fetch(`/api/public/reviews/${id}`, { cache: 'no-store', headers: { 'x-review-token': token } })
  if (response.status === 404 || response.status === 403) return null
  return readJson<PublicReviewJob>(response)
}

export async function saveJob(job: PublicReviewJob, token = ''): Promise<PublicReviewJob> {
  const response = await fetch(`/api/public/reviews/${job.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-review-token': token },
    body: JSON.stringify({ feedbackRating: job.feedbackRating, feedbackComment: job.feedbackComment, reviews: job.reviews }),
  })
  return readJson<PublicReviewJob>(response)
}

export async function removeJob(id: string): Promise<void> {
  const response = await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || 'Failed to delete job')
  }
}

export async function fetchPartners(): Promise<Partner[]> {
  const response = await fetch('/api/partners', { cache: 'no-store' })
  return readJson<Partner[]>(response)
}

export async function savePartner(partner: Partner): Promise<Partner> {
  const response = await fetch('/api/partners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partner),
  })
  return readJson<Partner>(response)
}

export async function removePartner(id: string): Promise<void> {
  const response = await fetch(`/api/partners/${id}`, { method: 'DELETE' })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || 'Failed to delete partner')
  }
}
