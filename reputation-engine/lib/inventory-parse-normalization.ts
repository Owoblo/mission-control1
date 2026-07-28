export interface ParsedInventoryPhrase {
  name: string
  qty: number
  room?: string
  notes?: string
  status?: 'confirmed' | 'needs_confirmation'
  confirmReason?: string
}

/**
 * Split only customer phrases that clearly describe separately handled objects.
 */
export function expandCompoundInventoryPhrases(items: ParsedInventoryPhrase[]) {
  return items.flatMap(item => {
    const parentheticalNotes = Array.from(item.name.matchAll(/\(([^)]+)\)/g))
      .map(match => match[1]?.trim())
      .filter(Boolean)
    const name = item.name.replace(/\s*\([^)]+\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
    const uncertainDisposition = parentheticalNotes.some(note =>
      /\b(?:might|may|maybe|not sure|unsure|possibly|probably)\b.*\b(?:move|take|carry|keep|sell|leave)\b/i.test(note)
    )
    const normalizedItem = {
      ...item,
      name,
      ...(parentheticalNotes.length
        ? { notes: [item.notes, ...parentheticalNotes].filter(Boolean).join(' — ') }
        : {}),
      ...(uncertainDisposition
        ? {
            status: 'needs_confirmation' as const,
            confirmReason: 'Confirm whether the customer wants Saturn Star to move this item.',
          }
        : {}),
    }
    const television = name.match(/\b(\d{2,3})\s*(?:inch|inches|in|")?\s*(?:plasma\s+)?(?:television|tv)\b/i)
    const includesStand = /(?:\b(?:with|and)\b|\+)\s+(?:a\s+)?(?:tv\s+)?stand\b/i.test(name)
    if (television && includesStand) {
      return [
        { ...normalizedItem, name: `${television[1]}" TV` },
        { ...normalizedItem, name: 'TV Stand' },
      ]
    }
    return [normalizedItem]
  })
}
