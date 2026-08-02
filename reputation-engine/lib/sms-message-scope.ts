function phoneDigits(value?: string | null) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

export function smsMessageBelongsToPhone(
  message: { from_number?: string | null; to_number?: string | null },
  phone?: string | null
) {
  const expected = phoneDigits(phone)
  if (!expected) return false
  return phoneDigits(message.from_number) === expected || phoneDigits(message.to_number) === expected
}
