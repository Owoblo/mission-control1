import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getOnboardingInvite } from '@/lib/server/partner-pilot'
import { detectDocumentType, DOCUMENT_TYPES, inviteIsOpen } from '@/lib/contractor-onboarding'
import { listOnboardingDocuments, saveOnboardingVersion, publicDocuments } from '@/lib/server/contractor-onboarding'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const invite = await getOnboardingInvite(token)
    if (!inviteIsOpen(invite)) return NextResponse.json({ error: 'This link is closed or expired.' }, { status: 409 })
    if (Number(request.headers.get('content-length')) > 4.3 * 1024 * 1024) return NextResponse.json({ error: 'Choose a file under 4 MB.' }, { status: 413 })
    const form = await request.formData()
    const file = form.get('file'), kind = String(form.get('kind') || '')
    if (!Object.hasOwn(DOCUMENT_TYPES, kind) || !(file instanceof File) || !file.size || file.size > 4 * 1024 * 1024) return NextResponse.json({ error: 'Choose a PDF, JPG or PNG under 4 MB and a document type.' }, { status: 400 })
    const existing = await listOnboardingDocuments(invite.id)
    if (existing.length >= 20) return NextResponse.json({ error: 'Upload limit reached. Contact Saturn for help replacing documents.' }, { status: 409 })
    const bytes = new Uint8Array(await file.arrayBuffer()), format = detectDocumentType(bytes)
    if (!format) return NextResponse.json({ error: 'Only PDF, JPG and PNG documents are accepted.' }, { status: 400 })
    const path = `${invite.id}/${randomUUID()}.${format.extension}`
    const { url, headers } = requireSupabaseEnv()
    const uploaded = await fetch(`${url}/storage/v1/object/partner-onboarding/${path}`, { method: 'POST', headers: { ...headers, 'Content-Type': format.type, 'x-upsert': 'false' }, body: bytes })
    if (!uploaded.ok) throw new Error('Upload unavailable')
    try {
      await saveOnboardingVersion(invite, { checklist: { ...invite.checklist, application: false, onboardingDocuments: [{ id: randomUUID(), invite_id: invite.id, kind, filename: file.name.slice(0, 180), object_path: path, created_at: new Date().toISOString() }, ...existing] } })
    } catch (error) {
      await fetch(`${url}/storage/v1/object/partner-onboarding`, { method: 'DELETE', headers, body: JSON.stringify({ prefixes: [path] }) }).catch(() => null)
      throw error
    }
    return NextResponse.json({ documents: publicDocuments(await listOnboardingDocuments(invite.id)) }, { status: 201 })
  } catch { return NextResponse.json({ error: 'Upload could not be completed. Please try again or contact Saturn.' }, { status: 503 }) }
}
