const KNOWN_LOCALITIES = [
  'Niagara Falls', 'St. Catharines', 'Chatham-Kent', 'Windsor', 'Essex', 'LaSalle', 'Tecumseh',
  'Amherstburg', 'Leamington', 'Kingsville', 'Chatham', 'Ridgetown', 'Blenheim', 'Merlin', 'Bothwell',
  'Tilbury', 'London', 'St. Thomas', 'Strathroy', 'Sarnia', 'Petrolia', 'Woodstock', 'Ingersoll',
  'Kitchener', 'Waterloo', 'Cambridge', 'Guelph', 'Stratford', 'Toronto', 'Mississauga', 'Hamilton',
  'Niagara', 'Welland', 'Aurora', 'Barrie', 'Ottawa', 'Kanata', 'Nepean', 'Orleans', 'Barrhaven',
  'Arnprior', 'Kingston', 'Brampton', 'Gatineau',
]

const localityPattern = new RegExp(`\\b(${KNOWN_LOCALITIES.sort((a, b) => b.length - a.length).map(value => value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')).join('|')})\\b`, 'i')

/** Accept a locality only after a clear statement by the partner. */
export function extractPartnerLocality(text?: string | null) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  const cue = /\b(?:we are|we're|i am|i'm|located in|based in|from|i service|we service|serving|serve)\b/i.exec(value)
  if (!cue) return null
  const afterCue = value.slice(cue.index + cue[0].length)
  const match = localityPattern.exec(afterCue)
  if (!match) return null
  const city = KNOWN_LOCALITIES.find(item => item.toLowerCase() === match[1].toLowerCase()) || match[1]
  const start = cue.index
  const localityEnd = cue.index + cue[0].length + (match.index || 0) + match[1].length
  const sentenceEnd = value.slice(localityEnd).search(/[.!?]/)
  const end = sentenceEnd >= 0 ? localityEnd + sentenceEnd + 1 : localityEnd
  return { city, evidence: value.slice(start, end).trim() }
}

export function appendLocalityEvidence(notes: string | null | undefined, city: string, evidence: string) {
  const line = `Locality correction: ${city} (partner stated: ${evidence})`
  return String(notes || '').includes(line) ? String(notes || '') : [String(notes || '').trim(), line].filter(Boolean).join('\n')
}
