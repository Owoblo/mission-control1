import type { Job, Partner, ReviewKey, ReviewStatus } from './types'

const REVIEW_KEYS: ReviewKey[] = ['google', 'yelp', 'facebook', 'media']
const ACTIVE_JOB_STATUSES: ReviewStatus[] = ['sent', 'feedback-received', 'in-progress', 'complete']

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export function reviewCount(reviews: Job['reviews']): number {
  return Object.values(reviews).filter(Boolean).length
}

export function normalizeJob(input: Partial<Job> & Pick<Job, 'id' | 'customerName' | 'customerEmail' | 'customerPhone' | 'moveDate' | 'moveFrom' | 'moveTo' | 'crewLead' | 'createdAt'>): Job {
  const reviews = REVIEW_KEYS.reduce((acc, key) => {
    acc[key] = Boolean(input.reviews?.[key])
    return acc
  }, {} as Job['reviews'])

  return {
    id: input.id,
    customerName: input.customerName.trim(),
    customerEmail: input.customerEmail.trim(),
    customerPhone: input.customerPhone.trim(),
    moveDate: input.moveDate,
    moveFrom: input.moveFrom.trim(),
    moveTo: input.moveTo.trim(),
    crewLead: input.crewLead.trim(),
    referralPartnerId: input.referralPartnerId || undefined,
    referralPartnerName: input.referralPartnerName || undefined,
    status: input.status ?? 'pending',
    feedbackRating: input.feedbackRating,
    feedbackComment: input.feedbackComment?.trim() || undefined,
    reviews,
    reviewConfirmedAt: input.reviewConfirmedAt ?? {},
    incentiveEarned: Boolean(input.incentiveEarned),
    incentivePaid: Boolean(input.incentivePaid),
    proofSentToPartner: Boolean(input.proofSentToPartner),
    createdAt: input.createdAt,
    reviewSentAt: input.reviewSentAt,
  }
}

export function normalizePartner(input: Partial<Partner> & Pick<Partner, 'id' | 'name' | 'type' | 'email' | 'createdAt'>): Partner {
  return {
    id: input.id,
    name: input.name.trim(),
    type: input.type,
    email: input.email.trim(),
    phone: input.phone?.trim() || undefined,
    company: input.company?.trim() || undefined,
    totalJobsReferred: input.totalJobsReferred ?? 0,
    totalIncentiveOwed: input.totalIncentiveOwed ?? 0,
    createdAt: input.createdAt,
  }
}

export function hydratePartnerStats(partners: Partner[], jobs: Job[]): Partner[] {
  return partners.map(partner => {
    const referredJobs = jobs.filter(job => job.referralPartnerId === partner.id)
    return {
      ...partner,
      totalJobsReferred: referredJobs.length,
      totalIncentiveOwed: referredJobs.filter(job => job.incentiveEarned && !job.incentivePaid).length,
    }
  })
}

export function linksSentCount(jobs: Job[]): number {
  return jobs.filter(job => ACTIVE_JOB_STATUSES.includes(job.status)).length
}
