import type { InventoryItem, MovePolicyCategory, MoveType } from './types'

type MovePolicyRule = {
  id: string
  category: MovePolicyCategory
  label: string
  keywords: string[]
  customerNote: string
  repNote: string
  forceExclude?: boolean
}

export interface MovePolicyFinding {
  ruleId: string
  category: MovePolicyCategory
  label: string
  itemLabel: string
  customerNote: string
  repNote: string
  forceExclude: boolean
  source: 'inventory' | 'move_type'
}

export interface MovePolicySummary {
  findings: MovePolicyFinding[]
  blocked: MovePolicyFinding[]
  hazardous: MovePolicyFinding[]
  manualReview: MovePolicyFinding[]
  specialtyFee: MovePolicyFinding[]
  defaultExclude: MovePolicyFinding[]
}

const MOVE_POLICY_RULES: MovePolicyRule[] = [
  {
    id: 'bathroom_vanity',
    category: 'default_exclude',
    label: 'Bathroom vanity / built-in bath fixture',
    keywords: ['bathroom vanity', 'vanity cabinet', 'washroom vanity', 'medicine cabinet', 'toilet', 'sink vanity'],
    customerNote: 'Built-in bathroom fixtures stay with the home unless confirmed otherwise.',
    repNote: 'Bathroom vanity / built-in fixture detected. Keep excluded by default unless the customer clearly says it is being taken.',
    forceExclude: true,
  },
  {
    id: 'stove_range',
    category: 'default_exclude',
    label: 'Stove / cooker',
    keywords: ['stove', 'gas stove', 'gas cooker', 'electric stove', 'range', 'gas range', 'cooker', 'oven', 'dishwasher'],
    customerNote: 'Kitchen appliances stay excluded by default unless the customer confirms they are taking them.',
    repNote: 'Stove / cooker / dishwasher detected. Leave excluded by default and include only if the customer confirms it is moving.',
    forceExclude: true,
  },
  {
    id: 'laundry_appliance',
    category: 'default_exclude',
    label: 'Washer / dryer',
    keywords: ['washer', 'dryer', 'washing machine'],
    customerNote: 'Laundry appliances stay excluded by default unless the customer confirms they are taking them.',
    repNote: 'Washer / dryer detected. Leave excluded by default and include only if the customer confirms it is moving.',
    forceExclude: true,
  },
  {
    id: 'standard_fridge',
    category: 'default_exclude',
    label: 'Fridge / refrigerator',
    keywords: ['fridge', 'refrigerator', 'freezer'],
    customerNote: 'Standard fridges and freezers stay excluded by default unless the customer confirms they are taking them.',
    repNote: 'Fridge / freezer detected. Keep excluded by default unless the customer confirms it is moving.',
    forceExclude: true,
  },
  {
    id: 'hot_tub',
    category: 'specialty_fee',
    label: 'Hot tub',
    keywords: ['hot tub', 'jacuzzi'],
    customerNote: 'Hot-tub handling requires a specialty subcontractor, equipment and access confirmation; a specialty charge applies.',
    repNote: 'Hot tub detected. Confirm dimensions, weight, drainage/disconnection, access, equipment and subcontractor charge before finalizing.',
    forceExclude: false,
  },
  {
    id: 'pool_table',
    category: 'specialty_fee',
    label: 'Pool table',
    keywords: ['pool table', 'billiard table', 'snooker table'],
    customerNote: 'Pool-table handling requires specialty disassembly, protection and reassembly confirmation; a specialty charge applies.',
    repNote: 'Pool table detected. Confirm type, dimensions, access, disassembly/reassembly scope and subcontractor charge before finalizing.',
    forceExclude: false,
  },
  {
    id: 'propane',
    category: 'hazardous',
    label: 'Propane tank',
    keywords: ['propane tank', 'propane cylinder', 'bbq propane'],
    customerNote: 'Propane tanks cannot travel with the move and must be removed by the customer before move day.',
    repNote: 'Do not load propane tanks. Customer must clear them before the crew arrives.',
    forceExclude: true,
  },
  {
    id: 'fuel',
    category: 'hazardous',
    label: 'Fuel or gas can',
    keywords: ['gas can', 'gasoline', 'diesel can', 'fuel can', 'kerosene', 'lighter fluid'],
    customerNote: 'Fuel, gasoline, and similar flammables cannot travel with the move.',
    repNote: 'Flag flammables and fuel containers as non-transport items.',
    forceExclude: true,
  },
  {
    id: 'fireworks',
    category: 'hazardous',
    label: 'Fireworks or explosives',
    keywords: ['fireworks', 'ammunition', 'ammo', 'gunpowder', 'explosive'],
    customerNote: 'Explosives, fireworks, and ammunition cannot travel with the move.',
    repNote: 'Do not quote or transport fireworks, ammunition, or other explosive items.',
    forceExclude: true,
  },
  {
    id: 'chemicals',
    category: 'hazardous',
    label: 'Hazardous chemicals',
    keywords: ['paint thinner', 'solvent', 'pool chemical', 'pool chlorine', 'pesticide', 'chemical container', 'corrosive cleaner'],
    customerNote: 'Hazardous chemicals cannot travel with the move and must be removed beforehand.',
    repNote: 'Hazardous chemicals should be excluded and called out before move day.',
    forceExclude: true,
  },
  {
    id: 'compressed_gas',
    category: 'hazardous',
    label: 'Compressed gas cylinder',
    keywords: ['oxygen tank', 'oxygen cylinder', 'compressed gas cylinder', 'scuba tank'],
    customerNote: 'Compressed gas cylinders cannot travel with the move and must be handled separately.',
    repNote: 'Flag compressed gas cylinders for customer removal.',
    forceExclude: true,
  },
  {
    id: 'server_rack',
    category: 'manual_review',
    label: 'Server rack',
    keywords: ['server rack', 'network rack', 'telecom rack'],
    customerNote: 'Commercial-style equipment is not included by default and requires management review.',
    repNote: 'Server racks are outside the standard residential lane. Escalate before quoting.',
    forceExclude: true,
  },
  {
    id: 'copier',
    category: 'manual_review',
    label: 'Commercial copier or printer',
    keywords: ['copier', 'commercial printer', 'plotter printer', 'office printer'],
    customerNote: 'Commercial office equipment is not included by default and requires management review.',
    repNote: 'Commercial copier/printer detected. Remove from standard scope until approved.',
    forceExclude: true,
  },
  {
    id: 'restaurant_equipment',
    category: 'manual_review',
    label: 'Commercial equipment',
    keywords: ['restaurant equipment', 'commercial refrigerator', 'commercial fridge', 'vending machine', 'pallet rack', 'warehouse shelving', 'industrial shelving'],
    customerNote: 'Commercial equipment is not included by default and requires management review.',
    repNote: 'Detected commercial equipment. Treat as outside standard residential scope.',
    forceExclude: true,
  },
  {
    id: 'safe',
    category: 'specialty_fee',
    label: 'Safe',
    keywords: ['gun safe', 'fire safe', 'fireproof safe', 'floor safe', 'small safe', 'large safe', 'safe'],
    customerNote: 'Safe handling is included only after photo, weight, and access are confirmed; a specialty handling fee may apply.',
    repNote: 'Safe detected. We can move safes, but confirm size/weight/access and price the correct specialty handling before sending the final quote.',
    forceExclude: false,
  },
  {
    id: 'piano',
    category: 'specialty_fee',
    label: 'Piano',
    keywords: ['upright piano', 'baby grand piano', 'grand piano', 'piano'],
    customerNote: 'Piano handling requires specialty confirmation and the right crew/equipment.',
    repNote: 'Piano detected. Confirm the type and route before finalizing pricing.',
    forceExclude: false,
  },
]

const COMMERCIAL_MOVE_FINDING: MovePolicyFinding = {
  ruleId: 'commercial_move_scope',
  category: 'manual_review',
  label: 'Commercial move scope',
  itemLabel: 'Commercial move scope',
  customerNote: 'Commercial jobs require management review and are not included in standard residential quoting by default.',
  repNote: 'Lead is marked commercial. Escalate instead of treating this like a standard residential move.',
  forceExclude: true,
  source: 'move_type',
}

function normalizePolicyText(value?: string) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function appendUniqueNote(existing: string | undefined, addition: string) {
  const next = addition.trim()
  if (!next) return existing
  const current = (existing || '').trim()
  if (!current) return next
  if (current.toLowerCase().includes(next.toLowerCase())) return current
  return `${current} ${next}`
}

function buildItemSearchText(item: InventoryItem) {
  return normalizePolicyText([
    item.name,
    item.item,
    item.notes,
    item.size,
    item.room,
    item.policyReason,
  ].filter(Boolean).join(' '))
}

function buildPrimaryItemText(item: InventoryItem) {
  return normalizePolicyText([
    item.name,
    item.item,
    item.size,
    item.room,
  ].filter(Boolean).join(' '))
}

function buildItemLabel(item: InventoryItem, fallback: string) {
  return (item.name || item.item || fallback).trim()
}

function matchRule(text: string, primaryText = text) {
  if (!text) return null
  return MOVE_POLICY_RULES.find(rule => {
    if (rule.id === 'safe') {
      return (
        primaryText.includes('gun safe') ||
        primaryText.includes('heavy safe') ||
        primaryText.includes('floor safe') ||
        primaryText.includes('fireproof safe') ||
        /(^| )safe( |$)/.test(primaryText)
      )
    }
    return rule.keywords.some(keyword => text.includes(normalizePolicyText(keyword)))
  }) || null
}

function dedupeFindings(findings: MovePolicyFinding[]) {
  const seen = new Set<string>()
  return findings.filter(finding => {
    const key = `${finding.category}:${finding.label}:${finding.itemLabel}:${finding.source}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function formatMovePolicyCategoryLabel(category: MovePolicyCategory) {
  if (category === 'default_exclude') return 'Excluded by default'
  if (category === 'blocked') return 'Do not move'
  if (category === 'hazardous') return 'Hazardous'
  if (category === 'manual_review') return 'Manager review'
  return 'Specialty fee'
}

export function getMovePolicyFinding(item: InventoryItem): MovePolicyFinding | null {
  const text = buildItemSearchText(item)
  const primaryText = buildPrimaryItemText(item)
  const matchedRule = matchRule(text, primaryText)
  if (!matchedRule) {
    if (item.policyCategory && item.policyReason) {
      return {
        ruleId: `saved_${item.policyCategory}`,
        category: item.policyCategory,
        label: buildItemLabel(item, formatMovePolicyCategoryLabel(item.policyCategory)),
        itemLabel: buildItemLabel(item, formatMovePolicyCategoryLabel(item.policyCategory)),
        customerNote: item.exclusionReason || item.policyReason,
        repNote: item.policyReason,
        forceExclude: item.policyCategory !== 'specialty_fee',
        source: 'inventory',
      }
    }
    return null
  }

  return {
    ruleId: matchedRule.id,
    category: matchedRule.category,
    label: matchedRule.label,
    itemLabel: buildItemLabel(item, matchedRule.label),
    customerNote: matchedRule.customerNote,
    repNote: matchedRule.repNote,
    forceExclude: matchedRule.forceExclude !== false,
    source: 'inventory',
  }
}

export function applyMovePolicyToInventory(
  inventory: InventoryItem[],
  options?: { enforceExclusion?: boolean }
) {
  const enforceExclusion = options?.enforceExclusion !== false

  return inventory.map(item => {
    const finding = getMovePolicyFinding(item)
    if (!finding) return item

    const next: InventoryItem = {
      ...item,
      policyCategory: finding.category,
      policyReason: finding.repNote,
    }

    if (finding.category === 'specialty_fee') {
      next.notes = appendUniqueNote(next.notes, finding.customerNote)
      return next
    }

    if (finding.category === 'default_exclude' && item.policyOverride === 'include') {
      next.included = true
      next.exclusionReason = ''
      return next
    }

    if (enforceExclusion && finding.forceExclude) {
      next.included = false
      next.exclusionReason = finding.customerNote
    }

    return next
  })
}

export function summarizeMovePolicy(
  inventory: InventoryItem[] | null | undefined,
  options?: { moveType?: MoveType }
): MovePolicySummary {
  const findings: MovePolicyFinding[] = []

  if (options?.moveType === 'commercial') {
    findings.push(COMMERCIAL_MOVE_FINDING)
  }

  for (const item of inventory || []) {
    const finding = getMovePolicyFinding(item)
    if (finding) findings.push(finding)
  }

  const deduped = dedupeFindings(findings)

  return {
    findings: deduped,
    blocked: deduped.filter(finding => finding.category === 'blocked'),
    hazardous: deduped.filter(finding => finding.category === 'hazardous'),
    manualReview: deduped.filter(finding => finding.category === 'manual_review'),
    specialtyFee: deduped.filter(finding => finding.category === 'specialty_fee'),
    defaultExclude: deduped.filter(finding => finding.category === 'default_exclude'),
  }
}
