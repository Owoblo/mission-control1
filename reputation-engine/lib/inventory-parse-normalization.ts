export interface ParsedInventoryPhrase {
  name: string
  qty: number
  room?: string
}

/**
 * Split only customer phrases that clearly describe separately handled objects.
 */
export function expandCompoundInventoryPhrases(items: ParsedInventoryPhrase[]) {
  return items.flatMap(item => {
    const name = item.name.trim()
    const television = name.match(/\b(\d{2,3})\s*(?:inch|inches|in|")?\s*(?:plasma\s+)?(?:television|tv)\b/i)
    const includesStand = /(?:\b(?:with|and)\b|\+)\s+(?:a\s+)?(?:tv\s+)?stand\b/i.test(name)
    if (television && includesStand) {
      return [
        { ...item, name: `${television[1]}" TV` },
        { ...item, name: 'TV Stand' },
      ]
    }
    return [item]
  })
}
