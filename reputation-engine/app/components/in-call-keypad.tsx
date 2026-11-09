'use client'

import { useState } from 'react'
import { sendCallKeypadDigit, type DtmfCall } from '@/lib/dialer-dtmf'

export function InCallKeypad({ getCall, blocked }: { getCall: () => DtmfCall | null; blocked: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [feedback, setFeedback] = useState('')

  function press(digit: string) {
    try {
      sendCallKeypadDigit(getCall(), digit, blocked)
      // Do not retain or log keypad input: callers may enter private PINs.
      setFeedback('Keypad tone sent.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Unable to send keypad tone. Please try again.')
    }
  }

  return <div className="mt-4 w-full px-1">
    <button type="button" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); setFeedback('') }}
      className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15">
      {expanded ? 'Hide keypad' : 'Keypad'}
    </button>
    {expanded && <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="mb-2 text-xs text-white/60">For call screening or extensions, listen to the prompt and press the requested key.</p>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="In-call keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(digit =>
          <button key={digit} type="button" disabled={blocked} aria-label={`Send ${digit}`}
            onClick={() => press(digit)}
            className="h-11 rounded-lg bg-white/10 text-lg text-white hover:bg-white/20 disabled:opacity-40">
            {digit}
          </button>)}
      </div>
      <p role="status" className="mt-2 text-xs text-white/70">{blocked ? 'Keypad unavailable during hold or transfer.' : feedback}</p>
    </div>}
  </div>
}
