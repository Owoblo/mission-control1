import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessOperationsWorkspace } from '@/lib/server/sales-permissions'
import { createOnboardingInvite, updateOnboardingInvite } from '@/lib/server/partner-pilot'
import { listOnboardingDocuments, onboardingRest, saveOnboardingVersion } from '@/lib/server/contractor-onboarding'
import { REQUIRED_DOCUMENTS } from '@/lib/contractor-onboarding'
import { requireSupabaseEnv } from '@/lib/server/runtime'

async function context(id: string) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) return null
  const partners = await onboardingRest<any[]>(`subcontractors?id=eq.${encodeURIComponent(id)}&select=id,company_name,contact_name,phone,email,status,service_cities,home_market`)
  if (!partners[0]) return null
  const invites = await onboardingRest<any[]>(`partner_onboarding_invites?subcontractor_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=1`)
  return { session, partner: partners[0], invite: invites[0] }
}
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await context((await params).id)
    if (!c) return NextResponse.json({ error: 'Not authorized or contractor not found.' }, { status: 403 })
    const documents = c.invite ? await listOnboardingDocuments(c.invite.id) : []
    return NextResponse.json({ invite: c.invite || null, documents: documents.map(({ object_path, ...d }) => d) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'Could not load onboarding. Please try again.' }, { status: 503 }) }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await context((await params).id)
    if (!c) return NextResponse.json({ error: 'Not authorized or contractor not found.' }, { status: 403 })
    const body = await request.json()
    if (body.action === 'invite') {
      if (c.partner.status === 'blocked') return NextResponse.json({ error: 'This contractor is blocked.' }, { status: 409 })
      if (c.invite && !['invited', 'screening', 'application', 'verification'].includes(c.invite.stage)) return NextResponse.json({ error: 'This contractor has moved beyond the application stage.' }, { status: 409 })
      let invite = c.invite
      if (invite) {
        invite = await updateOnboardingInvite(invite.token, { expires_at: new Date(Date.now() + 14 * 86400000).toISOString() })
      } else {
        invite = await createOnboardingInvite({ subcontractorId: c.partner.id, phone: c.partner.phone, email: c.partner.email, createdBy: c.session?.name })
        invite = await updateOnboardingInvite(invite.token, { application: { legalBusinessName: c.partner.company_name || '', contactName: c.partner.contact_name || '', phone: c.partner.phone || '', email: c.partner.email || '', homeMarket: c.partner.home_market || '', serviceAreas: (c.partner.service_cities || []).join(', ') } })
      }
      return NextResponse.json({ url: `${new URL(request.url).origin}/onboard/${invite.token}` })
    }
    if (!c.invite) return NextResponse.json({ error: 'No application found.' }, { status: 404 })
    const documents = await listOnboardingDocuments(c.invite.id)
    if (body.action === 'document') {
      const document = documents.find(d => d.id === body.documentId)
      if (!document) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
      const { url, headers } = requireSupabaseEnv()
      const r = await fetch(`${url}/storage/v1/object/sign/partner-onboarding/${document.object_path}`, { method: 'POST', headers, body: JSON.stringify({ expiresIn: 60 }) })
      if (!r.ok) throw Error('Document unavailable')
      const signed = await r.json()
      return NextResponse.json({ url: `${url}/storage/v1${signed.signedURL}` }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (body.action === 'review') {
      if (c.invite.stage !== 'verification' || !c.invite.checklist?.application || body.verified !== true) return NextResponse.json({ error: 'A submitted application and explicit document review are required.' }, { status: 409 })
      if ([...REQUIRED_DOCUMENTS, 'additional_insured'].some(kind => !documents.some(d => d.kind === kind))) return NextResponse.json({ error: 'Registration, insurance, ID and additional-insured evidence are required before progressing.' }, { status: 409 })
      await saveOnboardingVersion(c.invite, { stage: 'agreement', checklist: { ...c.invite.checklist, documentsReviewedAt: new Date().toISOString(), documentsReviewedBy: c.session?.name, reviewNote: String(body.note || '').slice(0, 4000), reviewedDocumentIds: documents.map(d => d.id) } })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch { return NextResponse.json({ error: 'Could not complete this onboarding action.' }, { status: 503 }) }
}
