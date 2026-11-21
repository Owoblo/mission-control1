export type DtmfCall = {
  status: () => string
  sendDigits: (digits: string) => void
}

export function sendCallKeypadDigit(call: DtmfCall | null, digit: string, blocked = false) {
  if (!/^[0-9*#]$/.test(digit)) throw new Error('Choose one keypad digit.')
  if (blocked) throw new Error('Keypad unavailable during hold or transfer.')
  if (!call || call.status() !== 'open') throw new Error('Wait for the call to connect, then try again.')
  call.sendDigits(digit)
}
