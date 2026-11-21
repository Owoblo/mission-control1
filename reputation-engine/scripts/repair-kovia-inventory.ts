// One-lead repair from original inbound receipts. Dry-run unless --apply is supplied.
// Never sends customer communications. Uses an updated_at compare-and-swap.
import fs from 'node:fs'
import { resolveInboundSalesContext } from '../lib/sales-automation-context'
import { buildCustomerInventoryList } from '../lib/customer-inventory-review'
import { buildLeadQualificationState } from '../lib/sales-automation-qualification'
import type { CRMLead } from '../lib/types'

async function main() {
  const env = Object.fromEntries(fs.readFileSync('.env.partnership-runtime.local', 'utf8').split('\n')
    .filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
  async function request(table: string, query: Record<string, string>, method = 'GET', body?: unknown) {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(query)}`, {
      method, headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!r.ok) throw new Error(`${table}: ${r.status}`)
    return r.json()
  }
  const id = 'lead_td67zzrpl'
  const [row] = await request('crm_leads', { id: `eq.${id}` })
  if (!row || row.deleted) throw new Error('Lead not available')
  const current = row.data as CRMLead
  const marker = 'Inventory repair 2026-10-10: replayed original customer SMS'
  if (current.notes?.includes(marker)) { console.log('Repair already applied.'); return }
  if (current.inventory?.some(i => i.source !== 'customer_verification' || i.status === 'confirmed')) throw new Error('Human inventory edits exist; review before applying')
  if (current.originAddress !== '411 Main St. N' || current.destAddress !== '411 Main St. N') throw new Error('Route changed; review before applying')
  const receipts = await request('inbound_leads', { phone: 'eq.+14168260639', source: 'eq.twilio_sms', order: 'created_at.asc' })
  let repaired: CRMLead = { ...current, originAddress: '', destAddress: '', inventory: [], totalItems: 0, totalCubicFeet: 0, totalWeightLbs: 0, roomBreakdown: {}, notes: current.notes }
  for (const receipt of receipts) {
    if (receipt.raw_data?.linkedLeadId !== id) continue
    repaired = resolveInboundSalesContext(repaired, receipt.message)
  }
  if (repaired.originAddress !== '10 Dunlop Crt' || repaired.destAddress !== '411 Main St. N') throw new Error('Unexpected replay route')
  const now = new Date().toISOString()
  repaired.notes = `${current.notes || ''}\n\n${marker}. Pickup restored from customer receipt: 10 Dunlop Crt; destination: 411 Main St. N. Supersedes earlier incorrect route and partial inventory summaries. Unknown names/quantities and missing measurements remain unconfirmed. No message sent.\n\n${buildCustomerInventoryList(repaired.inventory)}`
  repaired.automationStatus = 'handoff'
  repaired.automationHandoffAt = now
  repaired.automationPauseReason = 'inventory_repair_owner_review'
  repaired.automationHandoffReason = 'John to review corrected route and full inventory before quoting.'
  repaired.followUpStatus = 'pending'
  repaired.followUpNote = 'Review corrected inventory, clarify futon/unclear item and smaller items, then prepare quote.'
  repaired.qualificationState = buildLeadQualificationState(repaired, { lastIntent: 'handoff', nextBestAction: 'coordinator_scope_review', capturedSummary: 'Customer requested a quote. Route and inventory repaired from original receipts; unresolved items and measurements require review.' })
  repaired.roomBreakdown = (repaired.inventory || []).reduce<Record<string, number>>((rooms, i) => {
    const room = i.room || 'Unassigned'; rooms[room] = (rooms[room] || 0) + Number(i.qty || 1); return rooms
  }, {})
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', origin: repaired.originAddress, destination: repaired.destAddress, list: buildCustomerInventoryList(repaired.inventory), knownSubtotalCuFt: repaired.totalCubicFeet, knownSubtotalLbs: repaired.totalWeightLbs, qualification: repaired.qualificationState }, null, 2))
  fs.mkdirSync('artifacts/kovia-review-20261010', { recursive: true })
  const snapshot = (lead: CRMLead) => ({ origin: lead.originAddress, destination: lead.destAddress, inventory: lead.inventory, totalItems: lead.totalItems, totalCubicFeet: lead.totalCubicFeet, totalWeightLbs: lead.totalWeightLbs, automationStatus: lead.automationStatus })
  fs.writeFileSync('artifacts/kovia-review-20261010/repair-preview.json', JSON.stringify({ before: snapshot(current), after: snapshot(repaired) }, null, 2))
  if (!process.argv.includes('--apply')) return
  const saved = await request('crm_leads', { id: `eq.${id}`, updated_at: `eq.${row.updated_at}` }, 'PATCH', { data: repaired, updated_at: now })
  if (saved.length !== 1) throw new Error('Concurrent update: repair not applied')
  const [verified] = await request('crm_leads', { id: `eq.${id}` })
  if (verified.data.originAddress !== repaired.originAddress || verified.data.inventory.length !== repaired.inventory!.length) throw new Error('Repair verification failed')
  fs.writeFileSync('artifacts/kovia-review-20261010/repair-receipt.json', JSON.stringify({ appliedAt: now, id, verified: snapshot(verified.data) }, null, 2))
  console.log('Verified live repair. No customer messages sent.')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
