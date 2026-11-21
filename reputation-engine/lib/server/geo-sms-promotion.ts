import { createHash } from 'node:crypto'
import policy from '../../scripts/market_map/geo_sms_templates.json'
import { isOttawa } from '../partnership-core/ottawa.mjs'
import { researchSmsRows } from './research-sms-promoter'

type Drafts = Parameters<typeof researchSmsRows>[0]
type Inventory = Parameters<typeof researchSmsRows>[1]

const useCases = new Map(Object.values(policy.families).flatMap(family =>
  family.sectors.join(' ').split(' ').map(sector => [sector, family.use_case] as const),
))
const requiresReview = new Set(policy.review.join(' ').split(' '))

export function prepareGeoSmsPromotion(input: {
  day: string
  draft_version: string
  drafts: Drafts
  inventory: Inventory
  dry_run?: boolean
}, now = Date.now()) {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input.day) ||
      input.draft_version !== policy.version ||
      (input.dry_run !== undefined && typeof input.dry_run !== 'boolean') ||
      !Array.isArray(input.drafts) || !Array.isArray(input.inventory) ||
      !input.drafts.length || input.drafts.length > 1000 || input.inventory.length > 1000) {
    throw new Error('Invalid daily geography batch')
  }
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
  if (input.dry_run !== true && input.day !== today) throw new Error('Only the current Toronto day can be promoted automatically')
  const inventory = new Map(input.inventory.map(record => [record.id, record]))
  for (const draft of input.drafts) {
    const record = inventory.get(draft.id)
    const city = record?.city
    const name = record?.name
    const sector = record?.sector?.trim().toLowerCase() || ''
    const useCase = useCases.get(sector)
    if (!name || !city || /[\r\n\t]/.test(name + city) || name.length > 180 ||
        !useCase || requiresReview.has(sector)) throw new Error('Draft outside the geography copy policy')
    const variant = createHash('sha256').update(draft.id).digest()
    const opener = policy.openers[variant[0] % policy.openers.length].replace(
      /\{(name|city|brand)\}/g,
      (_, field: 'name' | 'city' | 'brand') => ({ name, city, brand: isOttawa(city) ? 'Dexa Movers' : 'Saturn Star Movers' })[field],
    )
    const expected = [opener, useCase, policy.closers[variant[1] % policy.closers.length], policy.unsubscribe].join(' ')
    if (draft.body !== expected) throw new Error('Draft does not match the approved geography template')
  }
  const options = {
    artifactPath: `railway:scaled-geography/days/${input.day}/results/geo-sms-preparation.json`,
    campaignKey: `geo-b2b-daily-${input.day.replaceAll('-', '')}`,
    approvedBy: `railway:geo-b2b-template:${policy.version}`,
    automatedTemplateVersion: policy.version,
    clearHolds: [],
    b2b: true,
    execute: input.dry_run !== true,
  }
  return { rows: researchSmsRows(input.drafts, input.inventory, [], options, now), options }
}
