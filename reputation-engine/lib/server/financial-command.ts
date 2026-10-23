import { refreshCheckoutReservations } from './checkout-operation'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { CRMLead, CRMQuote } from '@/lib/types'
import { getSessionUser } from './session'
import { canHandleLeadPayments } from './sales-permissions'
import { getSalesLead, getSalesQuote } from './sales-repository'
import { assertQuoteStripeAccount, requireStripeAccountForLead } from './stripe-accounts'
import { getQuotePaidSoFar } from './job-billing'
import { requireSupabaseEnv } from './runtime'

type Command = { id: string; state: string; created_at: string; provider_result: Record<string, unknown> | null; provider_hash: string | null; result: Record<string, unknown> | null; lease_token: string; kind: string }
type Context = { command: Command; attempted: boolean; account: string; mode: string; quote: CRMQuote; lead: CRMLead }
const context = new AsyncLocalStorage<Context>()
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export async function financialStorage<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init?.headers }, cache: 'no-store' })
  if (!response.ok) throw new Error('Payment operation is busy or needs reconciliation. No additional charge was submitted. Retry the same action.')
  return response.json()
}
async function updateCommand(values: Record<string, unknown>) {
  const active = context.getStore()
  if (!active) throw new Error('Missing payment command')
  const rows = await financialStorage<Command[]>(`crm_financial_commands?id=eq.${active.command.id}&lease_token=eq.${active.command.lease_token}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }) })
  if (!rows[0]) throw new Error('Payment command lease changed; reconcile this operation before retrying.')
  active.command = rows[0]
}

// Called by stripePost only for financial mutations in an authorized command.
// The response is saved before projecting anything into the CRM. Retries after a
// CRM failure reuse that fact; unknown outcomes retain the quote collection lock.
export async function financialProviderPost<T>(path: string, key: string, params: URLSearchParams, send: (idempotencyKey: string) => Promise<T>): Promise<T> {
  const active = context.getStore()
  if (!active) throw new Error('A durable payment command is required for financial mutations.')
  const mode = /^(sk|rk)_test_/.test(key) ? 'test' : 'live'
  if (mode !== active.mode) throw new Error('Payment mode changed')
  const amount = Number(params.get('amount') || params.get('amount_to_capture') || 0)
  if (!path.endsWith('/cancel')) {
    const paid = getQuotePaidSoFar(active.quote, active.lead)
    if ((active.command.kind === 'charge-deposit:' || active.command.kind === 'save-payment-method:') && paid.depositPaid > 0) throw new Error('A deposit is already recorded. Verify that entry before collecting another deposit.')
    const remaining = Math.max(0, Math.round((active.quote.total - paid.totalPaid) * 100))
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) throw new Error('The amount must be positive and cannot exceed the unpaid quote balance.')
  }
  const providerHash = hash(`${path}\n${params.toString()}`)
  if (active.command.provider_hash && active.command.provider_hash !== providerHash) throw new Error('The payment details changed. Reconcile the original operation first.')
  if (active.command.provider_result) {
    const fact = active.command.provider_result
    if (fact.id && (fact.livemode !== (mode === 'live') || fact.currency !== 'cad')) throw new Error('Provider identity mismatch')
    if (fact.status === 'succeeded' && fact.amount_received !== amount) throw new Error('Captured amount mismatch')
    return fact as T
  }
  if (Date.now() - Date.parse(active.command.created_at) > 20 * 60 * 60_000) throw new Error('This payment needs provider reconciliation before it can be retried.')
  active.attempted = true
  await updateCommand({ state: 'provider_pending', provider_hash: providerHash, provider_path: path })
  params.set('metadata[crmCommandId]', active.command.id)
  // metadata is supported on create/update/capture; cancel does not accept it.
  if (path.endsWith('/cancel') || path.endsWith('/increment_authorization')) params.delete('metadata[crmCommandId]')
  const result = await send(`crm-command-${active.command.id}`)
  const fact = result as Record<string, unknown>
  const { client_secret: _secret, ...safeFact } = fact
  await updateCommand({ state: 'provider_returned', provider_result: safeFact })
  if (fact.id && (fact.livemode !== (mode === 'live') || fact.currency !== 'cad')) throw new Error('Provider account or currency did not match this operation.')
  if (fact.status === 'succeeded' && fact.amount_received !== amount) throw new Error('Captured amount differs from this request; reconcile before continuing.')
  if (fact.status === 'requires_capture' && fact.amount !== amount) throw new Error('Authorized amount differs from this request.')
  return result
}

// A single database transaction applies both payment projections and records the
// result. This prevents a charged quote with an unchanged lead, or duplicate
// ledger entries after a partial save. Card numbers never enter this table.
export async function persistFinancialProjection(quote: CRMQuote, lead?: CRMLead) {
  const active = context.getStore()
  if (!active) throw new Error('Missing payment command')
  const leadFields = ['paymentStatus', 'depositAmount', 'depositMethod', 'depositDate', 'stripeCustomerId', 'stripePaymentMethodId', 'stripeCardBrand', 'stripeCardLast4']
  const patch = Object.fromEntries(leadFields.filter(field => lead && field in lead).map(field => [field, (lead as unknown as Record<string, unknown>)[field]]))
  const result = await financialStorage<{ quote: CRMQuote; lead: CRMLead }>('rpc/apply_financial_projection', { method: 'POST', body: JSON.stringify({ p_id: active.command.id, p_lease: active.command.lease_token, p_revision: active.quote.revision || 0, p_quote: quote, p_lead_patch: patch }) })
  active.command.state = 'complete'
  active.command.result = { ok: true, ...result, balance: result.quote.balance, amount: Number(active.command.provider_result?.amount_received || 0) / 100, depositCharged: active.command.kind === 'save-payment-method:', cardBrand: quote.depositStripeCardBrand, cardLast4: quote.depositStripeCardLast4 }
  return result
}

export async function withFinancialCommand(request: Request, kind: string, handler: (request: Request) => Promise<Response>) {
  let active: Context | undefined
  try {
    const body = await request.clone().json() as Record<string, unknown>
    // Saving a confirmed card without collection has no financial mutation.
    if (kind === 'save-payment-method' && !body.chargeDepositNow) return handler(request)
    if (!body.leadId || !body.quoteId) return NextResponse.json({ error: 'leadId and quoteId are required' }, { status: 400 })
    if (kind === 'save-payment-method' && !body.quoteId) return NextResponse.json({ error: 'Select a quote before charging a deposit.' }, { status: 400 })
    const operationKey = request.headers.get('x-payment-operation-id') || String(body.operationId || '')
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(operationKey)) return NextResponse.json({ error: 'Reload this payment screen to use safe payment retries.' }, { status: 400 })
    if (kind === 'balance-authorization' && !['authorize', 'increment', 'capture', 'cancel'].includes(String(body.action))) return NextResponse.json({ error: 'Invalid authorization action' }, { status: 400 })
    const session = await getSessionUser()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const [lead, quote] = await Promise.all([getSalesLead(String(body.leadId)), getSalesQuote(String(body.quoteId))])
    if (!lead || !quote || quote.leadId !== lead.id) return NextResponse.json({ error: 'Lead or quote not found' }, { status: 404 })
    if (!canHandleLeadPayments(session, lead)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const account = requireStripeAccountForLead(lead)
    assertQuoteStripeAccount(quote, account.key)
    const mode = /^(sk|rk)_test_/.test(account.secretKey) ? 'test' : 'live'
    await refreshCheckoutReservations(quote.id, account.key, account.secretKey)
    const command = await financialStorage<Command>('rpc/reserve_financial_command', { method: 'POST', body: JSON.stringify({ p_key: operationKey, p_hash: hash(JSON.stringify({ kind, body, account: account.key, mode })), p_quote: quote.id, p_lead: lead.id, p_kind: `${kind}:${body.action || ''}`, p_account: account.key, p_mode: mode, p_actor: session.userId || null, p_lease: randomUUID() }) })
    if (command.state === 'complete') return NextResponse.json(command.result)
    active = { command, attempted: false, account: account.key, mode, quote, lead }
    return await context.run(active, async () => {
      const response = await handler(request)
      if (active!.command.state === 'complete') {
        if (response.ok) await updateCommand({ result: await response.clone().json() }).catch(() => undefined)
        else return NextResponse.json(active!.command.result || { ok: true, quote, lead, message: 'Payment was recorded. Refresh the record to view the receipt.' })
      } else if (!active!.attempted && !active!.command.provider_hash) {
        await updateCommand({ state: 'failed', lease_until: null })
      } else {
        await updateCommand({ lease_until: null })
      }
      return response
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Payment needs reconciliation' }, { status: 409 })
  }
}
