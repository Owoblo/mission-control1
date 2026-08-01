import type { SessionPayload } from '../auth'
import {
  getSalesBranchFromSaturnLabel,
  getSalesBranchFromSaturnPhone,
  getSaturnBranchLabel,
  getSaturnBranchPhoneNumbers,
  getSaturnTrackingSource,
} from '../sales-phones'

export type MobilePhoneLine = {
  number: string
  label: string
  workspace: 'sales' | 'partnership'
  branch: string
}

function sessionBranch(session?: SessionPayload | null) {
  return getSalesBranchFromSaturnLabel(session?.branch) || session?.branch?.toLowerCase()
}

export function canUseAllMobilePhoneLines(session?: SessionPayload | null) {
  return session?.role === 'owner' || (session?.role === 'manager' && !session.branch)
}

export function listMobilePhoneLines(session?: SessionPayload | null): MobilePhoneLine[] {
  if (!session) return []
  const branch = sessionBranch(session)
  return getSaturnBranchPhoneNumbers()
    .filter(number => {
      if (canUseAllMobilePhoneLines(session)) return true
      const workspace = getSaturnTrackingSource(number) === 'partnership_outreach'
        ? 'partnership'
        : 'sales'
      if (!branch || getSalesBranchFromSaturnPhone(number) !== branch) return false
      if (session.role === 'sales_rep') return workspace === 'sales'
      if (session.role === 'partnership_manager') return workspace === 'partnership'
      return true
    })
    .map(number => ({
      number,
      label: getSaturnBranchLabel(number) || number,
      workspace: getSaturnTrackingSource(number) === 'partnership_outreach'
        ? 'partnership'
        : 'sales',
      branch: getSalesBranchFromSaturnPhone(number) || '',
    }))
}

export function canUseMobilePhoneLine(session: SessionPayload | null | undefined, number?: string | null) {
  return listMobilePhoneLines(session).some(line => line.number === number)
}
