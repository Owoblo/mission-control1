import { createHash } from 'node:crypto'
import { buildMoveScopeSnapshot } from '@/lib/move-scope-version'
import type { CRMLead, CRMQuote } from '@/lib/types'
import { requireSupabaseEnv } from './runtime'

type AcceptanceEvidence = {
  acceptedAt: string
  termsVersion: string
  ipAddress?: string
  userAgent?: string
}

function hashSnapshot(snapshot: unknown) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

export async function preserveAcceptedScopeSnapshot(lead: CRMLead, quote: CRMQuote, evidence: AcceptanceEvidence) {
  const { url, headers } = requireSupabaseEnv()
  const existingResponse = await fetch(
    `${url}/rest/v1/move_scope_versions?quote_id=eq.${encodeURIComponent(quote.id)}&status=eq.accepted&select=id,snapshot_hash&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!existingResponse.ok) throw new Error(`Could not check accepted scope snapshot (${existingResponse.status})`)
  const existing = await existingResponse.json() as Array<{ id: string; snapshot_hash: string }>
  if (existing[0]) return existing[0]

  const versionsResponse = await fetch(
    `${url}/rest/v1/move_scope_versions?lead_id=eq.${encodeURIComponent(lead.id)}&select=id,version,status&order=version.desc`,
    { headers, cache: 'no-store' }
  )
  if (!versionsResponse.ok) throw new Error(`Could not load scope version history (${versionsResponse.status})`)
  const versions = await versionsResponse.json() as Array<{ id: string; version: number; status: string }>
  const version = (versions[0]?.version || 0) + 1
  const snapshot = buildMoveScopeSnapshot(lead, quote, evidence.acceptedAt, {
    acceptedAt: evidence.acceptedAt,
    termsVersion: evidence.termsVersion,
    customerConfirmedScope: true,
    customerConfirmedHiddenAreas: true,
    customerConfirmedAccess: true,
    customerConfirmedSpecialtyItems: true,
    customerAcknowledgedArrivalVerification: true,
    customerAcknowledgedChangeOrders: true,
    ipAddress: evidence.ipAddress,
    userAgent: evidence.userAgent,
  })
  const row = {
    scope_code: `SSM-${lead.id.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()}-V${version}`,
    lead_id: lead.id,
    quote_id: quote.id,
    version,
    predecessor_id: versions[0]?.id || null,
    change_reason: version === 1 ? 'Customer accepted initial move scope' : 'Customer accepted revised move scope',
    snapshot,
    snapshot_hash: hashSnapshot(snapshot),
    status: 'accepted',
    issued_at: evidence.acceptedAt,
    accepted_at: evidence.acceptedAt,
    created_by: 'Customer acceptance',
  }
  const response = await fetch(`${url}/rest/v1/move_scope_versions`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(row),
  })
  if (!response.ok) throw new Error(`Could not preserve accepted scope snapshot (${response.status})`)
  const [saved] = await response.json() as Array<{ id: string; snapshot_hash: string }>
  if (saved?.id) {
    const supersedeResponse = await fetch(
      `${url}/rest/v1/move_scope_versions?lead_id=eq.${encodeURIComponent(lead.id)}&status=eq.accepted&id=neq.${encodeURIComponent(saved.id)}`,
      { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'superseded' }) }
    )
    if (!supersedeResponse.ok) console.error(`Could not supersede prior accepted scope snapshots (${supersedeResponse.status})`)
  }
  return saved
}
