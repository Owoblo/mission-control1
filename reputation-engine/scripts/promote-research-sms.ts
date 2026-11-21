import { readCompleteRest } from '../lib/server/read-complete-rest'
import { partnershipFunnel } from '../lib/server/partnership-funnel'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  authenticateResearchSmsApprover,
  promoteResearchSms,
  researchSmsRows,
  verifiedMobile,
} from '../lib/server/research-sms-promoter'
import { readEnv, requireSupabaseEnv } from '../lib/server/runtime'
import { normalizeMarketingPhone } from '../lib/server/partnership-sms'
async function main() {
  const { values: v } = parseArgs({
    options: {
      artifact: { type: 'string' },
      drafts: { type: 'string' },
      inventory: { type: 'string' },
      'mailbox-checks': { type: 'string' },
      agents: { type: 'string' },
      campaign: { type: 'string' },
      'clear-holds': { type: 'string' },
      'approved-by': { type: 'string' },
      'approval-session-file': { type: 'string' },
      'release-evidence': { type: 'string' },
      b2b: { type: 'boolean' },
      'review-revivals': { type: 'boolean' },
      'allow-revival': { type: 'boolean' },
      execute: { type: 'boolean' },
    },
  })
  if (v.b2b && (v['review-revivals'] || v['allow-revival']))
    throw Error('Revival options require Realtor artifacts')
  if (v['review-revivals'] && v.execute && !v['allow-revival'])
    throw Error('--review-revivals with --execute requires --allow-revival')
  if (v['allow-revival'] && !v['approved-by']?.trim())
    throw Error('--allow-revival requires --approved-by')
  const primaryInventory =
    v.artifact && basename(v.artifact) === 'verified-contact-inventory.json'
  const drafts = v.drafts || (!primaryInventory && v.artifact)
  const inventory = v.inventory || (primaryInventory && v.artifact)
  if (!drafts || !inventory || (!v.b2b && !v.agents) || !v.campaign)
    throw Error(
      'Supply --drafts, --inventory, --campaign, and either --b2b or --agents; --artifact may identify either primary input',
    )
  const items = (file: string) => JSON.parse(readFileSync(file, 'utf8')).items
  const authenticatedApprover = v['approval-session-file']
    ? await authenticateResearchSmsApprover(readFileSync(v['approval-session-file'], 'utf8'), v['approved-by'] || '')
    : undefined
  const options = {
    artifactPath: resolve(drafts),
    campaignKey: v.campaign,
    approvedBy: authenticatedApprover?.name || v['approved-by'] || '',
    authenticatedApprover,
    clearHolds: (v['clear-holds'] || '').split(',').filter(Boolean),
    releaseEvidence: v['release-evidence'],
    execute: v.execute,
    b2b: v.b2b,
    allowRevival: v['allow-revival'],
  }
  const researched = (v.agents ? items(v.agents) : []) as Parameters<typeof researchSmsRows>[2]
  const contacts = items(inventory) as Parameters<typeof researchSmsRows>[1]
  const rows = researchSmsRows(items(drafts), contacts, researched, options)
  const db = requireSupabaseEnv()
  const report = await promoteResearchSms(
    rows,
    options,
    db,
    readEnv('PREPARED_SMS_EXECUTION_ENABLED') === 'true',
  )
  const outcomes = await readCompleteRest<{
    id: string
    artifact_recipient_id: string
    provider_accepted: boolean
    delivered_or_replied: boolean
  }>(
    db.url +
      '/rest/v1/partnership_promotion_outcomes?campaign_key=eq.' +
      encodeURIComponent(options.campaignKey),
    db.headers,
  )
  const byId = new Map(outcomes.map((row) => [row.artifact_recipient_id, row]))
  const verifiedById = new Map(contacts.map((record) => [record.id, record]))
  const draftsById = new Map(
    rows.map((row) => [row.lineage.artifact_recipient_id, row]),
  )
  const heldPhones = new Set(report.blocked.map((row) => row.phone))
  const mailboxChecks = v['mailbox-checks'] ? JSON.parse(readFileSync(v['mailbox-checks'], 'utf8')).rows : {}
  const funnel = partnershipFunnel(
    (v.b2b ? contacts.filter((contact) => draftsById.has(contact.id)) : researched).map((person) => {
      const routes = verifiedById.get(person.id)?.verified_routes || []
      const row = draftsById.get(person.id)
      const outcome = byId.get(person.id)
      return {
        id: person.id,
        routeVerified: v.b2b ? !!row?.lineage.source_url : routes.some(
          (route) =>
            route.shared_in_research_batch === false && !!route.source_url,
        ),
        channelVerified: v.b2b ? !!row?.phone && !row.reviewReasons.includes('verify_unique_current_mobile') : routes.some((route) => {
          if (verifiedMobile(route)) return true
          if (route.kind !== 'email' || route.shared_in_research_batch !== false || !route.source_url) return false
          const check = mailboxChecks[route.value.toLowerCase()]
          const evidence = check?.saved_provider_receipt || check
          const age = Date.now() - Date.parse(evidence?.checked_at)
          return evidence?.mailbox_status === 'provider_checks_passed_identity_review_pending' && age >= 0 && age < 86400000
        }),
        releaseApproved:
          !!outcome ||
          (!!row &&
            !!options.approvedBy.trim() &&
            !heldPhones.has(normalizeMarketingPhone(row.phone))),
        queued: !!outcome,
        providerAccepted: outcome?.provider_accepted === true,
        deliveredOrReplied: outcome?.delivered_or_replied === true,
      }
    }),
  )
  console.log(
    JSON.stringify({
      funnel,
      prepared: report.prepared,
      send_ready: report.send_ready,
      would_queue: report.would_queue,
      already_queued: report.already_queued,
      existing_promotion_receipts: rows.filter((row) => byId.has(row.lineage.artifact_recipient_id)).length,
      held_without_promotion: rows.filter((row) => heldPhones.has(normalizeMarketingPhone(row.phone)) && !byId.has(row.lineage.artifact_recipient_id)).length,
      blocked: report.blocked.map((r) => ({
        name: r.contactName,
        reasons: r.reasons,
        ...(v['review-revivals'] ? { relationship_history: r.relationship_history } : {}),
      })),
      scheduled: 'scheduled' in report ? report.scheduled : 0,
    }),
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
