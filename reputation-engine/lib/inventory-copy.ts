import type { InventoryItem } from './types'

const LABEL_ALIASES: Array<[RegExp, string]> = [
  [/^lazy[- ]?boy recliner couch$/i, 'La-Z-Boy Reclining Sofa'],
  [/^armoire\s*\/\s*chest of drawers$/i, 'Chest of Drawers'],
  [/^recliner$/i, 'Recliner Chair'],
]

const IRREGULAR_PLURALS: Record<string, string> = {
  'La-Z-Boy Reclining Sofa': 'La-Z-Boy Reclining Sofas',
  'Chest of Drawers': 'Chests of Drawers',
  TV: 'TVs',
}

function displayLabel(item: InventoryItem) {
  const raw = (item.name || item.item || item.size || 'Item').trim()
  return LABEL_ALIASES.find(([pattern]) => pattern.test(raw))?.[1] || raw
}

function pluralize(label: string, quantity: number) {
  if (quantity === 1) return label
  if (IRREGULAR_PLURALS[label]) return IRREGULAR_PLURALS[label]
  if (/(s|x|z|ch|sh)$/i.test(label)) return `${label}es`
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`
  return `${label}s`
}

function publicRoomLabel(room: string) {
  return /^(packing scope|custom items?)$/i.test(room.trim()) ? 'Additional Item' : room.trim()
}

function handlingNotes(items: InventoryItem[]) {
  const notes: string[] = []
  let hasHeadboardDisassembly = false
  let hasBedFrameDisassembly = false
  const add = (value: string) => {
    if (!notes.includes(value)) notes.push(value)
  }

  for (const item of items) {
    const label = displayLabel(item)
    const evidence = [label, item.size, item.notes].filter(Boolean).join(' ').toLowerCase()
    if (/^(tv|television)(\b| ·)/i.test(label) && !/\bstand\b/i.test(label)) add('TV requires screen protection or a TV box.')
    if (/pinball/.test(evidence)) add('Pinball machines require heavy-item handling equipment.')
    if (/headboard/.test(label.toLowerCase()) && /disassembl/.test(evidence)) {
      hasHeadboardDisassembly = true
    } else if (/bed frame/.test(label.toLowerCase()) && /disassembl/.test(evidence)) {
      hasBedFrameDisassembly = true
    } else if (/disassembl/.test(evidence)) {
      add(`${pluralize(label, 2)} require disassembly.`)
    }
    if (/recliner/.test(evidence) && /lay flat|laid.flat/.test(evidence)) {
      add('Recliner chair should be transported in the laid-flat position.')
    }
  }
  if (hasHeadboardDisassembly && hasBedFrameDisassembly) {
    add('Headboard and bed frame require disassembly.')
  } else if (hasHeadboardDisassembly) {
    add('Headboard requires disassembly.')
  } else if (hasBedFrameDisassembly) {
    add('Bed frame requires disassembly.')
  }
  return notes
}

function customerItemNote(item: InventoryItem) {
  const note = (item.notes || '').toLowerCase()
  if (/move (it|them|these)?\s*(myself|ourselves)|might move|may move/.test(note)) {
    return 'Customer may move these separately.'
  }
  return ''
}

export function buildInventorySnapshotCopyText(inventory: InventoryItem[]) {
  const included = inventory.filter(item => item.included !== false)
  if (!included.length) return ''

  const groups = new Map<string, InventoryItem[]>()
  for (const item of included) {
    const room = publicRoomLabel(item.room || 'Additional Item')
    groups.set(room, [...(groups.get(room) || []), item])
  }

  const sections = Array.from(groups.entries()).map(([room, items]) => {
    const count = items.reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0)
    const cubicFeet = Math.round(items.reduce(
      (sum, item) => sum + Math.max(0, Number(item.cubicFeet || 0)) * Math.max(1, Number(item.qty || 1)),
      0,
    ))
    const lines = items.flatMap(item => {
      const quantity = Math.max(1, Number(item.qty || 1))
      const line = `* ${quantity} ${pluralize(displayLabel(item), quantity)}`
      const note = customerItemNote(item)
      return note ? [line, `  *${note}*`] : [line]
    })
    return [
      `## ${room}`,
      '',
      `**${count} item${count === 1 ? '' : 's'} · ${cubicFeet} cu. ft.**`,
      '',
      ...lines,
    ].join('\n')
  })

  const totalItems = included.reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0)
  const totalCubicFeet = Math.round(included.reduce(
    (sum, item) => sum + Math.max(0, Number(item.cubicFeet || 0)) * Math.max(1, Number(item.qty || 1)),
    0,
  ))
  const specialHandling = handlingNotes(included)
  const summary = [
    '## Estimated Total',
    '',
    `**${totalItems} item${totalItems === 1 ? '' : 's'} · ${totalCubicFeet} cu. ft.**`,
  ]
  if (specialHandling.length) {
    summary.push('', '### Special Handling', '', ...specialHandling.map(note => `* ${note}`))
  }

  return [...sections, summary.join('\n')].join('\n\n')
}
