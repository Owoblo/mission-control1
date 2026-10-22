/** Greeting text copied from an inbound message is not a verified person name. */
export function isGreetingDerivedContactName(value?: string | null) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return false
  return /^(?:hi|hey|hello|good morning|good afternoon|good evening)\b(?:\s+(?:john|there|saturn|sir|ma'am|team))?[,!?.]?$/i.test(text)
}
