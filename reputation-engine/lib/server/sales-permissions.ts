import type { SessionPayload, UserRole } from '@/lib/auth'
import { getLeadAssignedRepKey, getLeadAssignedRepName } from '@/lib/sales'
import type { CRMLead, CRMQuote } from '@/lib/types'

export const SALES_REP_MAX_DISCOUNT_PCT = 0.1
export const MANAGER_MAX_DISCOUNT_PCT = 0.2

type SalesWorkspaceRole = Extract<UserRole, 'owner' | 'manager' | 'sales_rep'>

export function isSalesWorkspaceRole(role?: UserRole | null): role is SalesWorkspaceRole {
  return role === 'owner' || role === 'manager' || role === 'sales_rep'
}

export function canAccessSalesWorkspace(session: SessionPayload | null | undefined) {
  return !!session && isSalesWorkspaceRole(session.role)
}

export function canAccessOperationsWorkspace(session: SessionPayload | null | undefined) {
  return !!session && (
    session.role === 'owner' ||
    session.role === 'manager' ||
    session.role === 'operations_lead'
  )
}

export function canAssignCrew(session: SessionPayload | null | undefined) {
  return !!session && (
    session.role === 'owner' ||
    session.role === 'manager' ||
    session.role === 'operations_lead'
  )
}

export function isLeadOwnedBySession(lead: CRMLead, session: SessionPayload | null | undefined) {
  if (!session?.userId && !session?.name) return false
  const ownerKey = getLeadAssignedRepKey(lead)
  if (!ownerKey) return false
  return ownerKey === session.userId || ownerKey === session.name || getLeadAssignedRepName(lead) === session.name
}

export function canEditLead(session: SessionPayload | null | undefined, lead: CRMLead) {
  if (!canAccessSalesWorkspace(session)) return false
  if (session?.role === 'owner' || session?.role === 'manager') return true
  return !getLeadAssignedRepKey(lead) || isLeadOwnedBySession(lead, session)
}

export function canHandleLeadCommunications(session: SessionPayload | null | undefined, _lead: CRMLead) {
  return canAccessSalesWorkspace(session)
}

export function canHandleLeadPayments(session: SessionPayload | null | undefined, lead: CRMLead) {
  return canEditLead(session, lead)
}

export function canReassignLead(session: SessionPayload | null | undefined) {
  return session?.role === 'owner' || session?.role === 'manager'
}

export function canDeleteLead(session: SessionPayload | null | undefined) {
  return session?.role === 'owner' || session?.role === 'manager'
}

export function canControlAutomation(session: SessionPayload | null | undefined, lead: CRMLead) {
  if (!canAccessSalesWorkspace(session)) return false
  if (session?.role === 'owner' || session?.role === 'manager') return true
  return isLeadOwnedBySession(lead, session)
}

export function canEditQuote(session: SessionPayload | null | undefined, lead: CRMLead | null) {
  if (!canAccessSalesWorkspace(session)) return false
  if (!lead) return session?.role === 'owner' || session?.role === 'manager'
  if (session?.role === 'owner' || session?.role === 'manager') return true
  return !getLeadAssignedRepKey(lead) || isLeadOwnedBySession(lead, session)
}

export function canReviseExistingQuote(session: SessionPayload | null | undefined) {
  return canAccessSalesWorkspace(session)
}

function deriveSubtotal(quote: CRMQuote, updates: Partial<CRMQuote>) {
  if (typeof updates.subtotal === 'number' && Number.isFinite(updates.subtotal)) {
    return updates.subtotal
  }

  if (Array.isArray(updates.lineItems)) {
    return updates.lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  }

  return Number(quote.subtotal || 0)
}

export function validateQuotePricingPermissions(
  session: SessionPayload | null | undefined,
  current: CRMQuote,
  updates: Partial<CRMQuote>
) {
  if (!canAccessSalesWorkspace(session)) {
    return 'Unauthorized'
  }

  // Any sales workspace user can apply a price override — audit trail captures who did it

  if (updates.discountAmount !== undefined) {
    const subtotal = deriveSubtotal(current, updates)
    const discountAmount = Math.max(0, Number(updates.discountAmount || 0))
    const discountPct = subtotal > 0 ? discountAmount / subtotal : 0

    if (session?.role === 'sales_rep' && discountPct > SALES_REP_MAX_DISCOUNT_PCT) {
      return 'Sales reps can apply up to a 10% discount.'
    }

    if (session?.role === 'manager' && discountPct > MANAGER_MAX_DISCOUNT_PCT) {
      return 'Managers can apply up to a 20% discount.'
    }
  }

  return null
}
