'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { fetchJob, savePublicReviewJob } from '@/lib/api'
import { BRAND, INCENTIVE_AMOUNT, REVIEW_LINKS } from '@/lib/config'
import { reviewCount } from '@/lib/store'
import type { Job, ReviewKey } from '@/lib/types'

const STARS = [1, 2, 3, 4, 5]

type Step = 'rating' | 'negative' | 'reviews' | 'complete' | 'not-found'

const REVIEW_CARDS: Array<{
  key: ReviewKey
  label: string
  desc: string
  cta: string
  href: string
}> = [
  { key: 'google', label: 'Google Review', desc: 'Best for local search visibility', cta: 'Open Google', href: REVIEW_LINKS.google },
  { key: 'yelp', label: 'Yelp Review', desc: 'Useful for comparison shoppers', cta: 'Open Yelp', href: REVIEW_LINKS.yelp },
  { key: 'facebook', label: 'Facebook Recommendation', desc: 'Visible to friends and referrals', cta: 'Open Facebook', href: REVIEW_LINKS.facebook },
  { key: 'media', label: 'Photo Or Video', desc: 'Optional proof of the finished move', cta: 'Confirm upload', href: '' },
]

export default function ReviewPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [job, setJob] = useState<Job | null | undefined>(undefined)
  const [hover, setHover] = useState(0)
  const [step, setStep] = useState<Step>('rating')
  const [negText, setNegText] = useState('')
  const [negSent, setNegSent] = useState(false)
  const [pendingReview, setPendingReview] = useState<ReviewKey | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      const nextJob = await fetchJob(jobId)
      if (!nextJob) {
        setStep('not-found')
        setJob(null)
        return
      }

      setJob(nextJob)
      setError(null)
      if (nextJob.status === 'complete') setStep('complete')
      else if (nextJob.status === 'flagged') setStep('negative')
      else if (nextJob.status === 'in-progress' || (nextJob.feedbackRating ?? 0) >= 4) setStep('reviews')
      else setStep('rating')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void refresh()
  }, [jobId])

  async function updateJob(nextJob: Job, nextStep?: Step) {
    const saved = await savePublicReviewJob(nextJob)
    setJob(saved)
    if (nextStep) setStep(nextStep)
  }

  async function handleRating(stars: number) {
    if (!job) return

    const nextJob: Job = {
      ...job,
      feedbackRating: stars,
      status: stars >= 4 ? 'in-progress' : 'flagged',
    }

    await updateJob(nextJob, stars >= 4 ? 'reviews' : 'negative')
  }

  async function submitNegativeFeedback() {
    if (!job) return
    await updateJob({ ...job, feedbackComment: negText.trim(), status: 'flagged' }, 'negative')
    setNegSent(true)
  }

  async function markReviewDone(key: ReviewKey) {
    if (!job) return

    const reviews = { ...job.reviews, [key]: true }
    const count = reviewCount(reviews)
    const nextJob: Job = {
      ...job,
      reviews,
      reviewConfirmedAt: { ...job.reviewConfirmedAt, [key]: new Date().toISOString() },
      status: count === 4 ? 'complete' : 'in-progress',
      incentiveEarned: count === 4,
    }

    await updateJob(nextJob, count === 4 ? 'complete' : 'reviews')
    setPendingReview(null)
  }

  function openReview(key: ReviewKey, href: string) {
    if (!href) return
    window.open(href, '_blank', 'noopener,noreferrer')
    setPendingReview(key)
  }

  if (job === undefined) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      </div>
    )
  }

  if (step === 'not-found') {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <div className="mb-4 text-5xl">?</div>
        <h2 className="mb-2 text-xl font-bold text-white">Link not found</h2>
        <p className="text-sm text-slate-400">This review link is invalid or the job has not been synced yet.</p>
      </div>
    )
  }

  const count = job ? reviewCount(job.reviews) : 0

  if (step === 'complete') {
    return (
      <div className="mx-auto max-w-md py-12 text-center animate-slide-up">
        <div className="inline-flex h-24 w-24 items-center justify-center rounded-full border-2 border-gold bg-gold/10 text-5xl">
          OK
        </div>
        <h2 className="mt-6 text-2xl font-bold text-white">Thank you</h2>
        <p className="mt-2 text-slate-300">
          You confirmed all 4 review steps, <span className="font-semibold text-gold">{job?.customerName.split(' ')[0]}</span>.
        </p>

        <div className="card mt-6 space-y-2 p-6 text-left">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Reward status</span>
            <span className="text-lg font-bold text-gold">${INCENTIVE_AMOUNT}</span>
          </div>
          <div className="h-px bg-[#2D4A6A]" />
          <p className="text-xs text-slate-500">
            Your reward is now marked for the office team to validate and apply back to your invoice.
          </p>
        </div>
      </div>
    )
  }

  if (step === 'negative') {
    return (
      <div className="mx-auto max-w-md py-12 animate-slide-up">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#2D4A6A] bg-[#1A2940] text-3xl">
            !
          </div>
          <h2 className="mt-4 text-xl font-bold text-white">We want to fix this</h2>
          <p className="mt-1 text-sm text-slate-400">Tell us what went wrong and a manager will follow up directly.</p>
        </div>

        {negSent ? (
          <div className="card space-y-3 p-6 text-center">
            <p className="font-semibold text-white">We got your message</p>
            <p className="text-sm text-slate-400">Our manager will reach out within 24 hours.</p>
            <p className="text-xs text-slate-500">
              Need help now? Call <a href={`tel:${BRAND.phone}`} className="text-gold">{BRAND.phone}</a>
            </p>
          </div>
        ) : (
          <div className="card space-y-4 p-6">
            <label className="label">Tell us what happened</label>
            <textarea
              className="input min-h-[120px] resize-none"
              value={negText}
              onChange={event => setNegText(event.target.value)}
            />
            <button onClick={() => void submitNegativeFeedback()} disabled={!negText.trim()} className="btn-gold w-full disabled:cursor-not-allowed disabled:opacity-40">
              Send Feedback
            </button>
          </div>
        )}
      </div>
    )
  }

  if (step === 'rating') {
    return (
      <div className="mx-auto max-w-md py-12 text-center animate-slide-up">
        {error && <div className="card mb-5 border-red-800/50 p-4 text-sm text-red-300">{error}</div>}
        <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-medium text-gold">
          Saturn Star Movers
        </div>
        <h1 className="mt-4 text-2xl font-bold text-white">How was your move, {job?.customerName.split(' ')[0]}?</h1>
        <p className="mt-2 text-sm text-slate-400">Start with a quick rating. If it was great, the review links unlock next.</p>

        <div className="my-10 flex justify-center gap-3">
          {STARS.map(star => (
            <button
              key={star}
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() => setHover(0)}
              onClick={() => void handleRating(star)}
              className="text-5xl transition-all duration-100 hover:scale-110 active:scale-95"
              style={{ filter: (hover || 0) >= star ? 'brightness(1)' : 'grayscale(0.8) brightness(0.5)' }}
            >
              *
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg py-8 animate-slide-up">
      {error && <div className="card mb-5 border-red-800/50 p-4 text-sm text-red-300">{error}</div>}

      <div className="mb-6 text-center">
        <h2 className="text-xl font-bold text-white">Review follow-up</h2>
        <p className="mt-1 text-sm text-slate-400">
          Complete each step, then come back here and confirm it. The office validates rewards before payout.
        </p>
      </div>

      <div className="card-elevated mb-5 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-slate-400">{count} of 4 completed</span>
          <span className="text-xs font-semibold text-gold">
            {count === 4 ? `$${INCENTIVE_AMOUNT} pending review` : `${4 - count} more for $${INCENTIVE_AMOUNT}`}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#0F1B2D]">
          <div className="h-full rounded-full bg-gradient-to-r from-gold to-gold-2 transition-all duration-500" style={{ width: `${(count / 4) * 100}%` }} />
        </div>
      </div>

      <div className="space-y-3">
        {REVIEW_CARDS.map(card => {
          const done = job?.reviews[card.key] ?? false
          const unavailable = card.key !== 'media' && !card.href

          return (
            <div key={card.key} className={`card flex items-center gap-4 p-4 ${done ? 'opacity-60' : ''}`}>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">{card.label}</p>
                <p className="text-xs text-slate-500">{card.desc}</p>
                {unavailable && (
                  <p className="mt-1 text-xs text-red-300">This review link is not configured yet.</p>
                )}
                {job?.reviewConfirmedAt[card.key] && (
                  <p className="mt-1 text-xs text-slate-500">Confirmed: {new Date(job.reviewConfirmedAt[card.key] as string).toLocaleString()}</p>
                )}
              </div>

              {done ? (
                <span className="text-xs font-medium text-emerald-400">Done</span>
              ) : card.key === 'media' ? (
                <button onClick={() => setPendingReview('media')} className="btn-gold px-3 py-2 text-xs">
                  Confirm Upload
                </button>
              ) : (
                <button onClick={() => openReview(card.key, card.href)} disabled={unavailable} className="btn-gold px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40">
                  {card.cta}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {pendingReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-sm space-y-4 p-6 animate-slide-up">
            <h3 className="text-lg font-bold text-white">Confirm step</h3>
            <p className="text-sm text-slate-400">
              Mark this only after you actually completed the {pendingReview === 'media' ? 'photo/video upload' : `${pendingReview} review`}.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setPendingReview(null)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={() => void markReviewDone(pendingReview)} className="btn-gold flex-1">I completed it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
