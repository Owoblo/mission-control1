import type { SessionPayload, UserRole } from '@/lib/auth'
import { requireSupabaseEnv } from './runtime'
const roles = new Set<UserRole>(['owner','manager','sales_rep','operations_lead','crew','partnership_manager','partner_admin','partner_dispatcher','partner_crew'])
export async function currentSessionProfile(session: SessionPayload) {
  // Legacy owner sessions have no database account. They retain their original
  // expiry and must sign in again; never extend unverifiable claims forever.
  if (!session.userId || (session.userId === 'legacy-owner' && session.role === 'owner')) return { identity: session, renewable: false }
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/app_users?${new URLSearchParams({ id: `eq.${session.userId}`, limit: '1' })}`, { headers, cache: 'no-store' })
  if (!response.ok) throw new Error('Session profile unavailable')
  const [user] = await response.json() as Array<{ id: string; role: UserRole; name?: string; branch?: string; partner_id?: string; partner_member_id?: string }>
  if (!user || !roles.has(user.role)) return null
  return { renewable: true, identity: { exp: session.exp, userId: user.id, role: user.role, name: user.name, branch: user.branch || undefined, partnerId: user.partner_id || undefined, partnerMemberId: user.partner_member_id || undefined } as SessionPayload }
}
