const INTERNAL_QUOTE_SENTENCE_PATTERNS = [
  /\b(?:current|projected|gross|net|live)\s+margin\b/i,
  /\bmargin\s+(?:is|review|approval|gate|threshold)\b/i,
  /\bmanager\s+(?:review|approval)\b/i,
  /\bapproval\s+code\b/i,
]

/** Removes internal pricing/approval notes before text reaches a public quote. */
export function sanitizeCustomerQuoteText(value?: string | null): string | undefined {
  if (!value?.trim()) return undefined

  const cleaned = value
    .split(/(?<=[.!?])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)
    .filter(sentence => !INTERNAL_QUOTE_SENTENCE_PATTERNS.some(pattern => pattern.test(sentence)))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  return cleaned || undefined
}

/**
 * Returns only an intentional, short quote-option label for the public hero.
 * General move descriptions can contain provisional findings and must never be
 * promoted into this prominent customer-facing slot.
 */
export function getCustomerQuoteOptionLabel(input: {
  jobLabel?: string | null
  moveDescription?: string | null
}): string | undefined {
  const explicitDescriptionLabel = input.moveDescription
    ?.match(/^Quote option:\s*([^\n\r]+)/i)?.[1]
    ?.trim()
  const candidate = (input.jobLabel?.trim() || explicitDescriptionLabel || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!candidate || candidate.length > 120) return undefined
  return candidate
}
