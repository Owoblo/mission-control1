import type { SessionPayload, UserRole } from '../auth'
import { detectSalesBranchFromLocation, getLeadAssignedRepKey, getLeadAssignedRepName } from '../sales'
import type { CRMLead, CRMQuote } from '../types'

export const SALES_REP_MAX_DISCOUNT_PCT = 0.1
export const MANAGER_MAX_DISCOUNT_PCT = 0.2

type SalesWorkspaceRole = Extract<UserRole, 'owner' | 'manager' | 'sales_rep'>

export function isSalesWorkspaceRole(role?: UserRole | null): role is SalesWorkspaceRole {
  return role === 'owner' || role === 'manager' || role === 'sales_rep'
}

export function canAccessSalesWorkspace(session: SessionPayload | null | undefined) {
  return !!session && isSalesWorkspaceRole(session.role)
}

export function isBranchScopedManager(session: SessionPayload | null | undefined) {
  return session?.role === 'manager' && Boolean(session.branch)
}

export function leadMatchesSessionBranch<T extends Partial<Pick<CRMLead, 'id' | 'branch' | 'originCity' | 'originAddress' | 'destCity' | 'destAddress'>>>(
  lead: T,
  session: SessionPayload | null | undefined
) {
  if (!isBranchScopedManager(session)) return true
  const detected = lead.branch || detectSalesBranchFromLocation(
    lead.originCity,
    lead.originAddress,
    lead.destCity,
    lead.destAddress
  )
  return detected === session?.branch
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
  if (!leadMatchesSessionBranch(lead, session)) return false
  if (session?.role === 'owner' || session?.role === 'manager') return true
  return !getLeadAssignedRepKey(lead) || isLeadOwnedBySession(lead, session)
}

export function canHandleLeadCommunications(session: SessionPayload | null | undefined, lead: CRMLead) {
  return canAccessSalesWorkspace(session) && leadMatchesSessionBranch(lead, session)
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
  if (!leadMatchesSessionBranch(lead, session)) return false
  if (session?.role === 'owner' || session?.role === 'manager') return true
  return isLeadOwnedBySession(lead, session)
}

export function canEditQuote(session: SessionPayload | null | undefined, lead: CRMLead | null) {
  if (!canAccessSalesWorkspace(session)) return false
  if (lead && !leadMatchesSessionBranch(lead, session)) return false
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

  // Reps can apply healthy-margin overrides directly, but low/unknown margin needs an approval code.
  const overrideLineItem = Array.isArray(updates.lineItems)
    ? updates.lineItems.find(item => item.description === 'Moving Services — Agreed Rate')
    : null
  if (session?.role === 'sales_rep' && overrideLineItem) {
    const overrideAmount = Math.round(Number(overrideLineItem.amount || 0) * 100) / 100
    const approvedAmount = Math.round(Number(current.priceOverrideApprovalAmount || 0) * 100) / 100
    const currentBaseAmount = Math.round(Number(current.subtotal || 0) * 100) / 100
    const isUpwardOverride = currentBaseAmount > 0 && overrideAmount >= currentBaseAmount
    const details = String(overrideLineItem.details || updates.priceOverrideReason || '')
    const marginMatch = details.match(/Projected margin:\s*(-?\d+(?:\.\d+)?)%/i)
    const projectedMargin = marginMatch ? Number(marginMatch[1]) : null
    const hasApproval =
      current.priceOverrideApprovalStatus === 'approved' &&
      approvedAmount > 0 &&
      approvedAmount === overrideAmount
    const hasMeaningfulNote = details.replace(/Projected margin:.*$/i, '').trim().length >= 12
    if (!hasMeaningfulNote) {
      return 'Sales reps must add a quick note explaining every manual price override.'
    }
    // Raising the base price cannot create the discount/margin risk this gate is
    // designed to prevent. Keep the audit note, but never block an upward revision.
    if (!isUpwardOverride && (projectedMargin === null || projectedMargin < 55) && !hasApproval) {
      return 'Sales reps need an owner/manager approval code before applying a manual price override.'
    }
  }

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
