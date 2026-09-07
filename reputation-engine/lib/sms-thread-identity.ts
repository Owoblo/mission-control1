function digitsOnly(value?: string | null) {
  return (value || '').replace(/\D/g, '')
}

export function completeNorthAmericanPhoneKey(value?: string | null) {
  const rawDigits = digitsOnly(value)
  const digits = rawDigits.length === 10 ? `1${rawDigits}` : rawDigits
  return digits.length === 11 && digits.startsWith('1') ? digits : null
}

export function smsThreadPhoneMatches(left?: string | null, right?: string | null) {
  const leftKey = completeNorthAmericanPhoneKey(left)
  const rightKey = completeNorthAmericanPhoneKey(right)
  return !!leftKey && leftKey === rightKey
}
