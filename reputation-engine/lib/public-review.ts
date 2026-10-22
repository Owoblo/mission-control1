import type { Job, ReviewKey } from './types'
export type PublicReviewJob = Pick<Job, 'id' | 'customerName' | 'status' | 'feedbackRating' | 'feedbackComment' | 'reviews' | 'reviewConfirmedAt' | 'googleReviewUrl' | 'googleProfileLocation' | 'reviewProofAssets' | 'incentiveEarned'>
export function publicReview(job: Job): PublicReviewJob {
  return { id:job.id, customerName:job.customerName.split(/\s+/)[0], status:job.status,
    feedbackRating:job.feedbackRating, feedbackComment:job.feedbackComment, reviews:job.reviews,
    reviewConfirmedAt:job.reviewConfirmedAt, googleReviewUrl:job.googleReviewUrl, googleProfileLocation:job.googleProfileLocation,
    reviewProofAssets:job.reviewProofAssets, incentiveEarned:job.incentiveEarned }
}
export function applyPublicReview(current: Job, input: unknown, now = new Date().toISOString()): Job {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid feedback')
  const patch = input as Record<string, unknown>
  if (Object.keys(patch).some(k => !['feedbackRating','feedbackComment','reviews'].includes(k))) throw new Error('Field not permitted')
  if (patch.feedbackRating !== undefined && (!Number.isInteger(patch.feedbackRating) || Number(patch.feedbackRating) < 1 || Number(patch.feedbackRating) > 5)) throw new Error('Rating must be 1 to 5')
  if (patch.feedbackComment !== undefined && (typeof patch.feedbackComment !== 'string' || patch.feedbackComment.length > 5000)) throw new Error('Invalid comment')
  const reviews = {...current.reviews}; const confirmed = {...current.reviewConfirmedAt}
  if (patch.reviews !== undefined) {
    if (!patch.reviews || typeof patch.reviews !== 'object' || Array.isArray(patch.reviews)) throw new Error('Invalid review confirmations')
    for (const [key, value] of Object.entries(patch.reviews)) {
      if (!['google','yelp','facebook','media'].includes(key) || typeof value !== 'boolean') throw new Error('Invalid review confirmation')
      if (value) { reviews[key as ReviewKey] = true; confirmed[key as ReviewKey] ||= now }
    }
  }
  const rating = patch.feedbackRating === undefined ? current.feedbackRating : Number(patch.feedbackRating)
  return {...current, feedbackRating:rating, feedbackComment:patch.feedbackComment === undefined ? current.feedbackComment : String(patch.feedbackComment),
    reviews, reviewConfirmedAt:confirmed, status:rating && rating < 4 ? 'flagged' : Object.values(reviews).every(Boolean) ? 'complete' : 'in-progress' }
}
