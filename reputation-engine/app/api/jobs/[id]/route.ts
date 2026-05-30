import { NextResponse } from 'next/server'
import { deleteJobRecord, getJob, saveJobRecord } from '@/lib/server/repository'
import { hasInternalSession } from '@/lib/server/session'
import type { Job } from '@/lib/types'

export const dynamic = 'force-dynamic'

function publicReviewJob(job: Job): Job {
  return {
    id: job.id,
    customerName: job.customerName,
    customerEmail: '',
    customerPhone: '',
    moveDate: job.moveDate,
    moveFrom: '',
    moveTo: '',
    crewLead: '',
    status: job.status,
    feedbackRating: job.feedbackRating,
    reviews: job.reviews,
    reviewConfirmedAt: job.reviewConfirmedAt,
    incentiveEarned: job.incentiveEarned,
    incentivePaid: false,
    proofSentToPartner: false,
    createdAt: job.createdAt,
  }
}

function confirmedReviewCount(reviews: Job['reviews']) {
  return Object.values(reviews).filter(Boolean).length
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const job = await getJob(params.id)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (await hasInternalSession()) {
      return NextResponse.json(job)
    }
    return NextResponse.json(publicReviewJob(job))
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const existing = await getJob(params.id)
    if (!existing) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const payload = (await request.json()) as Partial<Job>
    const reviews = payload.reviews ? { ...existing.reviews, ...payload.reviews } : existing.reviews
    const reviewConfirmedAt = payload.reviewConfirmedAt
      ? { ...existing.reviewConfirmedAt, ...payload.reviewConfirmedAt }
      : existing.reviewConfirmedAt

    const reviewCount = confirmedReviewCount(reviews)
    const status = payload.status === 'flagged'
      ? 'flagged'
      : reviewCount === 4
        ? 'complete'
        : payload.feedbackRating && payload.feedbackRating >= 4
          ? 'in-progress'
          : existing.status

    const nextJob = await saveJobRecord({
      ...existing,
      status,
      feedbackRating: payload.feedbackRating ?? existing.feedbackRating,
      feedbackComment: typeof payload.feedbackComment === 'string'
        ? payload.feedbackComment.slice(0, 2000)
        : existing.feedbackComment,
      reviews,
      reviewConfirmedAt,
      incentiveEarned: reviewCount === 4,
    })

    return NextResponse.json(publicReviewJob(nextJob))
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await hasInternalSession())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    await deleteJobRecord(params.id)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
