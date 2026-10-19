import { NextResponse } from 'next/server'
import { getOnboardingInvite } from '@/lib/server/partner-pilot'
import { applicationErrors, inviteIsOpen, parseApplication, REQUIRED_DOCUMENTS } from '@/lib/contractor-onboarding'
import { listOnboardingDocuments, publicDocuments, saveOnboardingVersion } from '@/lib/server/contractor-onboarding'
import { readEnv } from '@/lib/server/runtime'

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const invite = await getOnboardingInvite(token)
    if (!invite || (invite.expires_at && Date.parse(invite.expires_at) <= Date.now())) return NextResponse.json({ error: 'This link has expired. Please ask Saturn for a new link.' }, { status: 404 })
    const documents = await listOnboardingDocuments(invite.id)
    return NextResponse.json({ invite: { stage: invite.stage, application: invite.application, editable: inviteIsOpen(invite), documents: publicDocuments(documents), additionalInsuredInstructions: readEnv('PARTNER_ADDITIONAL_INSURED_INSTRUCTIONS') || 'Please ask your insurer to add MARS RELOCATION SERVICES INC as an additional insured for your work with Saturn Star Movers. Saturn will confirm the address and any insurer-specific details before you request the endorsement. Upload the resulting evidence here for review.' } }, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
  } catch { return NextResponse.json({ error: 'We could not load your application. Please try again or contact Saturn.' }, { status: 503 }) }
}
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const current = await getOnboardingInvite(token)
    if (!inviteIsOpen(current)) return NextResponse.json({ error: 'This application is closed or expired. Contact Saturn to update your details.' }, { status: 409 })
    const body = await request.json()
    if (!['save', 'application'].includes(body.action)) return NextResponse.json({ error: 'Use the application form. Agreements and activation are reviewed separately.' }, { status: 400 })
    const application = parseApplication(body.application)
    if (body.action === 'application') {
      const errors = applicationErrors(application)
      const docs = await listOnboardingDocuments(current.id)
      if (REQUIRED_DOCUMENTS.some(kind => !docs.some(d => d.kind === kind))) errors.push('Upload business registration, proof of insurance and photo ID before submitting. You can save and return later.')
      if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 })
    }
    const stage = body.action === 'application' ? 'verification' : current.stage === 'verification' ? 'verification' : 'application'
    await saveOnboardingVersion(current, { stage, application, checklist: { ...current.checklist, application: body.action === 'application', submittedAt: body.action === 'application' ? new Date().toISOString() : null } })
    return NextResponse.json({ ok: true, stage })
  } catch { return NextResponse.json({ error: 'We could not save your details. Please check the form and try again.' }, { status: 400 }) }
}
