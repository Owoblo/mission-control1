import { getSessionUser } from '@/lib/server/session'
import { verifyReviewCapability } from '@/lib/server/review-capability'
import { applyPublicReview, publicReview } from '@/lib/public-review'
import { NextResponse } from 'next/server'
import { getJob, patchPublicReview } from '@/lib/server/repository'
import { uploadLeadMediaAssets } from '@/lib/server/lead-media'
import type { ReviewProofAsset } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, props: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await props.params
  const job = await getJob(jobId).catch(() => null)
  if (!job) return NextResponse.json({ error: 'Review request not found' }, { status: 404 })
  if (!(await authorized(request, job))) return denied()
  return NextResponse.json(publicReview(job), { headers: { 'cache-control': 'no-store' } })
}

export async function PATCH(request: Request, props: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await props.params
  const current = await getJob(jobId).catch(() => null)
  if (!current) return NextResponse.json({ error: 'Review request not found' }, { status: 404 })
  if (!(await authorized(request, current))) return denied()
  try {
    const input = await request.json()
    applyPublicReview(current, input) // Validate before the transactional, field-scoped merge.
    const saved = await patchPublicReview(current, input)
    return NextResponse.json(publicReview(saved), { headers: { 'cache-control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'Invalid feedback or update failed' }, { status: 400 }) }
}

export async function POST(request: Request, props: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await props.params
  const current = await getJob(jobId).catch(() => null)
  if (!current) return NextResponse.json({ error: 'Review request not found' }, { status: 404 })
  if (!(await authorized(request, current))) return denied()
  const size = Number(request.headers.get('content-length') || 0)
  if (size > 80 * 1024 * 1024) return NextResponse.json({ error: 'Upload too large' }, { status: 413 })
  const formData = await request.formData()
  const requestedPlatform = String(formData.get('platform') || 'other')
  const platform = ['google', 'yelp', 'video', 'customer_experience'].includes(requestedPlatform)
    ? requestedPlatform as ReviewProofAsset['platform']
    : 'other'
  const files = (formData.getAll('files') as File[]).filter(file =>
    file && typeof file !== 'string' && ['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime','video/webm'].includes(file.type) && file.size <= 75 * 1024 * 1024
  ).slice(0, 6)
  if (files.reduce((sum, file) => sum + file.size, 0) > 75 * 1024 * 1024) return NextResponse.json({ error: 'Upload total exceeds 75 MB' }, { status: 413 })
  if (!files.length) return NextResponse.json({ error: 'Choose an image or video (75 MB maximum per file).' }, { status: 400 })

  const uploaded = await uploadLeadMediaAssets({
    leadId: current.crmLeadId || current.id,
    namespace: `review-proof-${Date.now()}`,
    files,
    room: 'Review proof',
    source: 'rep_upload',
    category: 'customer_media',
  })
  const proof: ReviewProofAsset[] = uploaded.map(asset => ({
    id: asset.id,
    url: asset.url,
    filename: asset.filename || 'review-proof',
    mimeType: asset.mimeType || 'application/octet-stream',
    kind: asset.kind === 'video' ? 'video' : 'image',
    platform,
    uploadedAt: asset.uploadedAt || new Date().toISOString(),
  }))
  const saved = await patchPublicReview(current, {}, proof)
  return NextResponse.json(await isStaff() ? saved : publicReview(saved), { headers: { 'cache-control': 'no-store' } })
}

async function isStaff() {
  const user = await getSessionUser()
  return !!user && ['owner','manager','sales_rep','operations_lead'].includes(user.role || '')
}
async function authorized(request: Request, job: import('@/lib/types').Job) {
  if (await isStaff()) return true
  return verifyReviewCapability(request.headers.get('x-review-token') || new URL(request.url).searchParams.get('token') || '', job)
}
function denied() { return NextResponse.json({ error: 'This link needs to be reissued. Please contact the moving team for a new review link.' }, { status: 403 }) }
