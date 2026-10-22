import { requireSupabaseEnv } from './runtime'
export async function onboardingRest<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init?.headers }, cache: 'no-store' })
  if (!response.ok) throw new Error('Onboarding storage is unavailable. Please try again or contact Saturn.')
  return response.status === 204 ? undefined as T : response.json()
}
export type OnboardingDocument = { id: string; invite_id: string; kind: string; filename: string; object_path: string; created_at: string }
export async function listOnboardingDocuments(inviteId: string): Promise<OnboardingDocument[]> {
  const rows = await onboardingRest<any[]>(`partner_onboarding_invites?id=eq.${encodeURIComponent(inviteId)}&select=checklist&limit=1`)
  return rows[0]?.checklist?.onboardingDocuments || []
}
export async function saveOnboardingVersion(current: { id: string; updated_at: string }, patch: Record<string, unknown>) {
  const rows = await onboardingRest<any[]>(`partner_onboarding_invites?id=eq.${encodeURIComponent(current.id)}&updated_at=eq.${encodeURIComponent(current.updated_at)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) })
  if (!rows.length) throw new Error('Your application changed in another request. Refresh before saving again.')
  return rows[0]
}
export function publicDocuments(documents: OnboardingDocument[]) { return documents.map(({ id, kind, filename, created_at }) => ({ id, kind, filename, created_at })) }
