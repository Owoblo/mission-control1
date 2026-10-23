'use client'
import { useState } from 'react'
import type { CRMLead, CRMQuote } from '@/lib/types'
type Operation = { id: string; operation_key: string; kind: string; state: string }
export function PaymentRecovery({ quoteId, onUpdated }: { quoteId: string; onUpdated: (lead: CRMLead, quote: CRMQuote) => void }) {
  const [operations, setOperations] = useState<Operation[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function check(id?: string) {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/sales/stripe/payment-operations?quoteId=${encodeURIComponent(quoteId)}`, id ? { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: id }) } : { credentials: 'include', cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Payment check failed')
      if (id) {
        setMessage(result.message || 'Payment checked')
        if (result.state === 'failed') {
          const key = operations.find(op => op.id === id)?.operation_key
          for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const name = sessionStorage.key(i)
            if (name && /^(ssm:charge-|crm:payment-command:)/.test(name) && sessionStorage.getItem(name) === key) sessionStorage.removeItem(name)
          }
        }
        if (result.lead && result.quote) onUpdated(result.lead, result.quote)
      } else { setOperations(result.operations || []); if (!result.operations?.some((op: Operation) => !['complete','failed'].includes(op.state))) setMessage('No unresolved card payments.') }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Payment check failed') }
    finally { setBusy(false) }
  }
  return <div className="border-b p-3 text-sm">
    <button disabled={busy} onClick={() => void check()} className="underline disabled:opacity-50">Check a pending card payment</button>
    {operations.filter(op => !['complete','failed'].includes(op.state)).map(op => <div key={op.id} className="mt-2 rounded border border-amber-300 bg-amber-50 p-2">{op.kind.split(':')[0]}: pending review. <button disabled={busy} onClick={() => void check(op.id)} className="underline">Verify with Stripe</button></div>)}
    {message && <p role="status" className="mt-2">{message}</p>}
  </div>
}
