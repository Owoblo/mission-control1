import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, getSalesQuote } from '@/lib/server/sales-repository'
import { canHandleLeadPayments } from '@/lib/server/sales-permissions'
import { assertQuoteStripeAccount, requireStripeAccountForLead } from '@/lib/server/stripe-accounts'
import { financialStorage } from '@/lib/server/financial-command'
import { stripeGet } from '@/lib/server/stripe-payments'
async function access(request: Request) {
  const session = await getSessionUser()
  const quoteId = new URL(request.url).searchParams.get('quoteId')
  const quote = quoteId ? await getSalesQuote(quoteId) : null
  const lead = quote?.leadId ? await getSalesLead(quote.leadId) : null
  if (!session || !quote || !lead || !canHandleLeadPayments(session, lead)) throw new Error('Forbidden')
  const account = requireStripeAccountForLead(lead); assertQuoteStripeAccount(quote, account.key)
  const mode = /^(sk|rk)_test_/.test(account.secretKey) ? 'test' : 'live'
  return { session, quote, lead, account, mode }
}
export async function GET(request: Request) {
  try {
    const { quote, account, mode } = await access(request)
    const operations = await financialStorage(`crm_financial_commands?${new URLSearchParams({ quote_id: `eq.${quote.id}`, provider_account: `eq.${account.key}`, provider_mode: `eq.${mode}`, select: 'id,operation_key,kind,state,created_at,updated_at,lease_until', order: 'created_at.desc', limit: '20' })}`)
    return Response.json({ operations }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ error: 'Payment operations unavailable or access denied' }, { status: 403 }) }
}
export async function POST(request: Request) {
  try {
    const { quote, lead, account, mode } = await access(request)
    const { operationId } = await request.json()
    if (typeof operationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(operationId)) return Response.json({ error: 'Valid operation ID required' }, { status: 400 })
    const rows = await financialStorage<Array<{ id: string; state: string; kind: string; lease_until: string | null; provider_path: string | null; provider_result: Record<string, unknown> | null }>>(`crm_financial_commands?${new URLSearchParams({ id: `eq.${operationId}`, quote_id: `eq.${quote.id}`, provider_account: `eq.${account.key}`, provider_mode: `eq.${mode}`, select: '*' })}`)
    const op = rows[0]
    if (!op) throw new Error('Operation not found')
    if (op.state === 'complete' || op.state === 'failed') return Response.json({ ok: true, state: op.state, quote, lead })
    if (op.lease_until && Date.parse(op.lease_until) > Date.now()) throw new Error('This operation is still running. Wait before checking again.')
    const knownId = typeof op.provider_result?.id === 'string' ? op.provider_result.id : op.provider_path?.match(/^payment_intents\/(pi_[A-Za-z0-9]+)\//)?.[1]
    const found = knownId
      ? [await stripeGet<Record<string, unknown>>(`payment_intents/${encodeURIComponent(knownId)}`, account.secretKey)]
      : (await stripeGet<{ data?: Record<string, unknown>[] }>(`payment_intents/search?query=${encodeURIComponent(`metadata['crmCommandId']:'${op.id}'`)}&limit=2`, account.secretKey)).data || []
    const intent = found.length === 1 ? found[0] : null
    const metadata = intent?.metadata as Record<string, string> | undefined
    if (!intent?.id || intent.livemode !== (mode === 'live') || intent.currency !== 'cad' || metadata?.quoteId !== quote.id || metadata?.leadId !== lead.id || (!knownId && metadata?.crmCommandId !== op.id)) throw new Error('No conclusive provider result. The collection hold remains.')
    const { client_secret: _secret, ...safeIntent } = intent
    const canceled = intent.status === 'canceled' && !op.kind.endsWith(':cancel')
    const changed = await financialStorage<unknown[]>(`crm_financial_commands?id=eq.${op.id}&state=neq.complete&or=(lease_until.is.null,lease_until.lte.${encodeURIComponent(new Date().toISOString())})`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ state: canceled ? 'failed' : 'provider_returned', provider_result: safeIntent, lease_until: null, updated_at: new Date().toISOString() }) })
    if (!changed.length) throw new Error('The operation changed; reload before continuing.')
    return Response.json({ ok: true, state: canceled ? 'failed' : 'provider_returned', message: canceled ? 'Stripe confirms the intent was canceled. A new authorized payment can be started.' : 'Provider result verified. Retry the original action to finish recording it; no additional collection will be submitted.', quote, lead })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Reconciliation remains unresolved. Do not charge again.' }, { status: 409 }) }
}
