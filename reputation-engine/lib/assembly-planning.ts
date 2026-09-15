import type { InventoryItem, JobFactors } from './types'

export interface AssemblyInstructions {
  responsibility: 'crew' | 'customer' | 'not_required'
  originMinutes: number
  destinationMinutes: number
  workers: number
  evidence: string
  tools?: string
}

export interface AssemblyTask {
  itemKey: string
  itemLabel: string
  quantity: number
  end: 'origin' | 'destination'
  minutes: number
  workers: number
  provisional: boolean
  tools: string
}

export const COMPLEX_ASSEMBLY = /\b(day[ -]?bed|trundle|pull[ -]?out|sleeper|storage bed|captain'?s? bed|bunk|murphy|wall bed|treadmill|trampoline)\b/i
const ORDINARY_ASSEMBLY = /\b(bed frame|bed base|king (?:size )?bed|queen (?:size )?bed|twin (?:size )?bed|queen platform|king platform|double bed|full bed|platform bed|sleigh bed|canopy bed|crib|dining table|kitchen table|conference table|office table|executive desk|corner desk|l[ -]shaped desk|standing desk|desk frame|workstation desk|computer desk|office desk|china cabinet|hutch|bookcase|bookshelf|mirror dresser|dresser with mirror|mirrored dresser|dresser mirror|sectional)\b/i
const EXCLUSIONS = /\b(desk chair|coffee table|end table|side table|night table|nightstand|patio table|bar stool)\b/i

export function assemblyText(item: InventoryItem) {
  return [item.name || item.item, item.size, item.notes].filter(Boolean).join(' ')
}

export function needsItemAssembly(item: InventoryItem) {
  if (item.included === false) return false
  if (item.assembly?.evidence?.trim() && ['customer', 'not_required'].includes(item.assembly.responsibility)) return false
  const text = assemblyText(item)
  if (item.assembly?.responsibility === 'crew' || /\b(disassembly required|requires disassembly|reassembly required)\b/i.test(text)) return true
  if (EXCLUSIONS.test(item.name || item.item || '')) return false
  return COMPLEX_ASSEMBLY.test(text) || ORDINARY_ASSEMBLY.test(text)
}

export function buildAssemblyPlan(inventory: InventoryItem[], mode: JobFactors['disassemblyMode'] = 'both') {
  const tasks: AssemblyTask[] = []
  const reviewReasons: string[] = []
  for (const [index, item] of inventory.entries()) {
    if (!needsItemAssembly(item)) continue
    const complex = COMPLEX_ASSEMBLY.test(assemblyText(item))
    const instructions = item.assembly
    const verified = Boolean(instructions?.evidence?.trim() &&
      [instructions.originMinutes, instructions.destinationMinutes].every(n => Number.isFinite(n) && n >= 0 && n <= 1440) &&
      Number.isInteger(instructions.workers) && instructions.workers >= 1 && instructions.workers <= 20)
    const quantity = Math.max(1, Number(item.qty || 1))
    const label = item.name || item.item || 'Item'
    if (complex && !verified) reviewReasons.push(`${label}: verify mechanism/model and plan disassembly and reassembly with operations.`)
    // Interim planning allowances, not measured performance standards. Complex tasks
    // are sequential crew-clock allowances; never divide them by crew headcount.
    const origin = verified ? instructions!.originMinutes : complex ? 45 : 10
    const destination = verified ? instructions!.destinationMinutes : complex ? 60 : 15
    for (const end of ['origin', 'destination'] as const) {
      if ((mode === 'disassemble_only' && end === 'destination') || (mode === 'reassemble_only' && end === 'origin')) continue
      const minutes = end === 'origin' ? origin : destination
      if (minutes <= 0) continue
      tasks.push({ itemKey: item.id || `item-${index}`, itemLabel: label, quantity, end, minutes: minutes * quantity,
        workers: verified ? instructions!.workers : complex ? 2 : 1, provisional: !verified,
        tools: instructions?.tools || 'Confirm tools, photograph joints, label and bag hardware; retain assembly instructions.' })
    }
  }
  const minutes = tasks.reduce((sum, task) => sum + task.minutes, 0)
  return { tasks, reviewReasons, hours: Math.ceil(minutes / 15) / 4,
    personHours: tasks.reduce((sum, task) => sum + task.minutes * task.workers, 0) / 60 }
}

/** Keep details when an item is renamed; never infer that a removed component is a second item. */
export function preserveInventoryHandlingEvidence(previous: InventoryItem[], next: InventoryItem[]) {
  const removed = previous.filter(item => item.included !== false && item.id && !next.some(candidate => candidate.id === item.id) && /pull[ -]?out|trundle/i.test(assemblyText(item)))
  return next.map(input => {
    let item = input
    const matchingParents = next.filter(candidate => candidate.included !== false && /day[ -]?bed/i.test(assemblyText(candidate)))
    if (matchingParents.length === 1 && item === matchingParents[0]) {
      const missing = removed.filter(component => !assemblyText(item).includes(assemblyText(component)))
      if (missing.length) item = { ...item, notes: [item.notes, ...missing.map(component => `Component removed from separate inventory line — reconcile handling: ${assemblyText(component)}`)].filter(Boolean).join('\n') }
    }
    const old = item.id ? previous.find(candidate => candidate.id === item.id) : undefined
    if (!old) return item
    const oldText = assemblyText(old)
    const disclosed = oldText.match(/pull[ -]?out|trundle|storage|heavy|disassembly required|bunk|murphy/gi) || []
    const lostDetail = disclosed.some(detail => !assemblyText(item).toLowerCase().includes(detail.toLowerCase()))
    if (!lostDetail) return item
    return { ...item, notes: [item.notes, `Previously disclosed handling: ${oldText}`].filter(Boolean).join('\n') }
  })
}
