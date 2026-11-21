import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

// Deliberately sandbox-only; this runner never loads the CRM's live environment.
const env = Object.fromEntries(readFileSync(new URL('../.env.moneris-saturn.local', import.meta.url), 'utf8')
  .trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)] }))
const base = 'https://api.sb.moneris.io'
for (const key of ['SATURN_MONERIS_CLIENT_ID', 'SATURN_MONERIS_CLIENT_SECRET', 'SATURN_MONERIS_MERCHANT_ID']) {
  if (!env[key]) throw new Error(`Missing ${key}`)
}
const response = await fetch(`${base}/oauth2/token`, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials',
    client_id: env.SATURN_MONERIS_CLIENT_ID, client_secret: env.SATURN_MONERIS_CLIENT_SECRET,
    scope: 'payment.write payment.read refund.write refund.read' }),
})
const data = await response.json()
console.log(JSON.stringify({ step: 'oauth', httpStatus: response.status, tokenReceived: Boolean(data.access_token),
  tokenType: data.token_type, expiresIn: data.expires_in, error: data.error,
  errorDescription: data.error_description }))
if (!response.ok || !data.access_token) process.exit(1)
const reconcileRun = process.argv[process.argv.indexOf('--reconcile-run') + 1]
const reconciliationOnly = process.argv.includes('--reconcile-run')
const parityOnly = process.argv.includes('--parity')
const threeDSOnly = process.argv.includes('--3ds')
const vaultOnly = process.argv.includes('--vault')
if (reconciliationOnly && !/^[0-9a-f-]{36}$/.test(reconcileRun)) throw new Error('Expected a sandbox run UUID')
if (!process.argv.includes('--payments') && !process.argv.includes('--declines') && !reconciliationOnly && !parityOnly && !threeDSOnly && !vaultOnly) process.exit(0)

const runId = randomUUID()
const results = []
const requests = []
const checks = []
const reportDir = new URL('../reports/moneris-sandbox/', import.meta.url)
mkdirSync(reportDir, { recursive: true })
function persistReport() {
  writeFileSync(new URL(`${runId}.json`, reportDir), JSON.stringify({ runId, account: 'saturn',
    environment: 'sandbox', apiVersion: '2026-08-14', testedAt: new Date().toISOString(), requests, results }, null, 2), { mode: 0o600 })
}
async function request(step, path, body, timeoutMs = 45000) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid sandbox path')
  requests.push({ step, path, idempotencyKey: body?.idempotencyKey, orderId: body?.orderId,
    amount: body?.amount, refundAmount: body?.refundAmount, sentAt: new Date().toISOString() })
  persistReport()
  const res = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${data.access_token}`, 'Content-Type': 'application/json',
      'Api-Version': '2026-08-14', 'X-Merchant-Id': env.SATURN_MONERIS_MERCHANT_ID,
      'X-Correlation-Id': runId },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const value = await res.json()
  // Allowlist output: never persist tokens, raw card data, or full response bodies.
  const summary = { step, httpStatus: res.status, orderId: value.orderId || body?.orderId,
    idempotencyKey: body?.idempotencyKey, paymentId: value.paymentId,
    paymentStatus: value.paymentStatus, paymentMethodId: value.paymentMethod?.paymentMethodId ?? value.paymentMethodId,
    refundId: value.refundId, refundStatus: value.refundStatus, amount: value.amount, refundAmount: value.refundAmount,
    transactionDetails: value.transactionDetails, title: value.title, detail: value.detail,
    category: value.category, errors: value.errors, credentialOnFileResponse: value.credentialOnFileResponse,
    matchedPayments: value.data?.filter(p => p.customData?.runId === (reconciliationOnly ? reconcileRun : runId))
      .map(p => ({ paymentId: p.paymentId, orderId: p.orderId, paymentStatus: p.paymentStatus, amount: p.amount })),
    threeDSecureAuthenticationId: value.threeDSecureAuthenticationId,
    threeDSecureTransactionStatus: value.threeDSecureTransactionStatus,
    next: value.next }
  results.push(summary)
  persistReport()
  console.log(JSON.stringify(summary))
  return { httpStatus: res.status, ...value }
}
async function reconcile(targetRun) {
  let path = '/payments?limit=20'
  const matches = []
  const seen = new Set()
  while (path) {
    if (seen.has(path) || seen.size >= 100) throw new Error('Reconciliation pagination incomplete')
    seen.add(path)
    const page = await request('reconcile-list', path)
    if (page.httpStatus !== 200 || !Array.isArray(page.data)) throw new Error('Payment lookup failed')
    matches.push(...page.data.filter(p => p.customData?.runId === targetRun))
    if (page.next) {
      const next = new URL(page.next, base)
      if (next.origin !== base || next.pathname !== '/payments') throw new Error('Unexpected pagination URL')
      path = next.pathname + next.search
    } else path = null
  }
  return matches
}
if (reconciliationOnly) {
  const matches = await reconcile(reconcileRun)
  const delayed = matches.filter(p => p.amount?.amount === 91)
  for (const p of delayed) await request('interrupted-payment-readback', `/payments/${p.paymentId}`)
  console.log(JSON.stringify({ targetRun: reconcileRun, delayedPaymentMatches: delayed.length,
    statuses: delayed.map(p => p.paymentStatus) }))
  if (delayed.length !== 1 || delayed[0].paymentStatus !== 'SUCCEEDED') process.exitCode = 1
  process.exit(process.exitCode || 0)
}
// Published Moneris synthetic Visa card. Never accept real card input here.
const testCard = { paymentMethodSource: 'CARD', card: { cardNumber: '4242424242424242',
  expiryMonth: 1, expiryYear: 2028, cardSecurityCode: '123' } }
function purchase(amount, paymentMethod = testCard, automaticCapture = true) {
  return { idempotencyKey: randomUUID(), orderId: `saturn-test-${randomUUID().slice(0, 8)}`,
    amount: { amount, currency: 'CAD' }, paymentMethod, automaticCapture,
    ecommerceIndicator: 'NON_AUTHENTICATED_ECOMMERCE',
    customData: { business: 'saturn', purpose: 'sandbox-validation', runId } }
}
function check(name, passed) {
  checks.push({ name, passed: Boolean(passed) })
  if (!passed) process.exitCode = 1
}
function finish() {
  writeFileSync(new URL(`${runId}.checks.json`, reportDir), JSON.stringify({ runId, checks }, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ runId, checks }))
}
function saveForMerchantUse(paymentMethod) {
  return { ...paymentMethod, storePaymentMethod: 'MERCHANT_INITIATED',
    credentialOnFileInformation: { paymentIndicator: 'UNSCHEDULED_CREDENTIAL_ON_FILE', paymentInformation: 'FIRST' } }
}
function savedPaymentMethod(payment) {
  return { paymentMethodSource: 'PAYMENT_METHOD_ID', paymentMethodId: payment.paymentMethod?.paymentMethodId,
    credentialOnFileInformation: { paymentIndicator: 'MERCHANT_INITIATED', paymentInformation: 'SUBSEQUENT',
      issuerId: payment.credentialOnFileResponse?.issuerId } }
}
async function readHostedPaymentMethod() {
  let token = ''
  for await (const chunk of process.stdin) {
    token += chunk
    if (token.length > 256) throw new Error('Invalid hosted token')
  }
  token = token.trim()
  if (!/^[A-Za-z0-9_-]{10,256}$/.test(token)) throw new Error('Invalid hosted token')
  return { paymentMethodSource: 'TEMPORARY_TOKEN', temporaryToken: token }
}
const hostedMethod = process.argv.includes('--hosted-token-stdin') ? await readHostedPaymentMethod() : null

async function verifyVault(paymentMethod) {
  const stored = await request('save-card-without-charge', '/payment-methods', {
    ...paymentMethod, idempotencyKey: randomUUID(), customData: { runId },
  })
  const storedId = stored.paymentMethodId
  check('save a card without submitting a payment', stored.httpStatus === 201 && storedId)
  if (storedId) {
    const verified = await request('saved-card-readback', `/payment-methods/${storedId}`)
    check('stored card is readable under the same sandbox merchant', verified.httpStatus === 200 &&
      verified.paymentMethodId === storedId && verified.merchantId === env.SATURN_MONERIS_MERCHANT_ID)
  } else check('stored card is readable under the same sandbox merchant', false)
  const laterCharge = storedId ? await request('charge-vaulted-card-later', '/payments', {
    ...purchase(1500, { paymentMethodSource: 'PAYMENT_METHOD_ID', paymentMethodId: storedId,
      credentialOnFileInformation: { paymentIndicator: 'UNSCHEDULED_CREDENTIAL_ON_FILE', paymentInformation: 'FIRST' } }),
    ecommerceIndicator: 'MAIL_TELEPHONE_ORDER_SINGLE',
  }) : null
  check('charge the separately vaulted card without re-entering card data',
    laterCharge?.paymentStatus === 'SUCCEEDED' && laterCharge.amount?.amount === 1500)
}

if (vaultOnly) {
  if (!hostedMethod) throw new Error('The vault test requires a token from the Moneris sandbox iframe')
  await verifyVault({ ...hostedMethod, storePaymentMethod: 'MERCHANT_INITIATED' })
  finish()
  process.exit(process.exitCode || 0)
}

if (parityOnly) {
  await verifyVault(testCard)
  const phonePayment = await request('phone-deposit-with-card-save', '/payments', {
    ...purchase(2500, saveForMerchantUse(hostedMethod ?? testCard)), ecommerceIndicator: 'MAIL_TELEPHONE_ORDER_SINGLE',
  })
  const retainedCard = savedPaymentMethod(phonePayment)
  check('phone deposit and saved card', phonePayment.paymentStatus === 'SUCCEEDED' && retainedCard.paymentMethodId)
  check('phone deposit is classified as MOTO', phonePayment.transactionDetails?.ecommerceIndicator === 'MAIL_TELEPHONE_ORDER_SINGLE')

  const hold = retainedCard.paymentMethodId ? await request('saved-card-incrementable-hold', '/payments', {
    ...purchase(2000, retainedCard, false), incrementalAuthorization: true,
  }) : null
  check('incrementable balance hold on saved card', hold?.paymentStatus === 'AUTHORIZED')
  const increase = hold?.paymentStatus === 'AUTHORIZED' ? await request('increase-hold', `/payments/${hold.paymentId}/increment`, {
    idempotencyKey: randomUUID(), amount: { amount: 500, currency: 'CAD' },
  }) : null
  const incremented = increase?.httpStatus === 200 && increase.paymentStatus === 'INCREMENTED' && increase.amount?.amount === 500
  check('increment the authorized amount', incremented)
  const capture = incremented ? await request('capture-part-of-increased-hold', `/payments/${hold.paymentId}/complete`, {
    idempotencyKey: randomUUID(), amount: { amount: 2300, currency: 'CAD' },
  }) : null
  check('capture below the increased authorization', capture?.paymentStatus === 'SUCCEEDED' && capture.amount?.amount === 2300)
  const confirmed = capture?.paymentStatus === 'SUCCEEDED' ? await request('read-back-incremented-capture', `/payments/${hold.paymentId}`) : null
  check('payment lookup confirms the partial capture amount', confirmed?.paymentStatus === 'SUCCEEDED' && confirmed.amount?.amount === 2300)
  if (hold?.paymentStatus === 'AUTHORIZED' && !confirmed) {
    const currentHold = await request('read-back-incomplete-hold', `/payments/${hold.paymentId}`)
    if (['AUTHORIZED', 'INCREMENTED'].includes(currentHold.paymentStatus)) {
      await request('release-sandbox-hold', `/payments/${hold.paymentId}/cancel`, { idempotencyKey: randomUUID() })
    }
  }
  finish()
  process.exit(process.exitCode || 0)
}

if (threeDSOnly) {
  // Moneris's published browser-authentication fixture. No real card is accepted.
  const card = hostedMethod ?? { ...testCard, card: { ...testCard.card, cardNumber: '4365729291041247' } }
  const payment = purchase(2500, card)
  const authentication = await request('browser-3ds-authentication', '/three-d-secure/authentications', {
    idempotencyKey: randomUUID(), amount: payment.amount, paymentMethod: card,
    threeDSecureDeviceChannel: 'BROWSER', threeDSecureMessageCategory: 'PAYMENT',
    threeDSecureRequestType: 'CARDHOLDER', threeDSecureChallengeRequested: 'NO_PREFERENCE',
    threeDSecureNotificationUrl: encodeURIComponent('https://localhost:3100/moneris-3ds-return'),
    threeDSecureCompletionIndicator: 'UNAVAILABLE', threeDSecureChallengeWindowSize: 'FULL_SCREEN',
    browserIpAddress: '192.0.2.1', browserUserAgent: 'Mozilla/5.0', browserJavaEnabled: false,
    browserJavascriptEnabled: true, browserLanguage: 'en', browserScreenHeight: 1080, browserScreenWidth: 1920,
    cardholderName: 'Sandbox Test', cardholderEmail: 'sandbox@example.com', cardholderPhoneNumber: '+14165550100',
    billingAddress: { streetNumber: '3300', streetName: 'Bloor', city: 'Toronto', province: 'ON', postalCode: 'M8X 2X2', country: 'CA' },
  })
  const authenticationId = authentication.threeDSecureAuthenticationId ?? authentication.authenticationId
  const authenticated = [200, 201].includes(authentication.httpStatus) && authenticationId &&
    authentication.threeDSecureTransactionStatus === 'AUTHENTICATED'
  check('frictionless card authentication', authenticated)
  const result = authenticated ? await request('authenticated-sandbox-deposit', '/payments', {
    ...payment, ecommerceIndicator: 'AUTHENTICATED_ECOMMERCE',
    threeDSecureData: { threeDSecureAuthenticationId: authenticationId },
  }) : null
  check('authenticated deposit captured', result?.paymentStatus === 'SUCCEEDED' && result.amount?.amount === payment.amount.amount)
  finish()
  process.exit(process.exitCode || 0)
}
if (process.argv.includes('--declines')) {
  for (const amount of [51, 54, 5100, 12000]) await request(`decline-probe-${amount}`, '/payments', purchase(amount))
  process.exit(0)
}
const depositRequest = purchase(2500, saveForMerchantUse(hostedMethod ?? testCard))
const deposit = await request('deposit-save-card', '/payments', depositRequest)
if (deposit.paymentStatus !== 'SUCCEEDED') process.exit(1)
check('deposit and reusable card', deposit.paymentStatus === 'SUCCEEDED' && deposit.paymentMethod?.paymentMethodId)
const replay = await request('duplicate-deposit', '/payments', depositRequest)
check('duplicate request rejected or same payment returned',
  (replay.httpStatus === 409 && replay.title === 'IDEMPOTENCY_KEY_ALREADY_EXISTS') ||
  (replay.httpStatus < 300 && replay.paymentId === deposit.paymentId))
const changedReplay = await request('duplicate-key-changed-amount', '/payments',
  { ...depositRequest, amount: { amount: 2600, currency: 'CAD' } })
check('changed request with same key rejected', changedReplay.httpStatus === 409)
const readback = await request('deposit-readback', `/payments/${deposit.paymentId}`)
check('payment can be reconciled by ID', readback.paymentStatus === 'SUCCEEDED' && readback.amount?.amount === 2500)
const savedCard = savedPaymentMethod(deposit)
const balance = await request('saved-card-balance', '/payments', purchase(7500, savedCard))
check('merchant initiated balance without card input', balance.paymentStatus === 'SUCCEEDED')
for (const [step, amount, expectedCode] of [['insufficient-funds', 51, '51'], ['expired-card', 54, '54']]) {
  const declined = await request(step, '/payments', purchase(amount))
  check(step, (declined.paymentStatus === 'DECLINED' || declined.category === 'DECLINED_ERROR') &&
    (declined.transactionDetails?.isoResponseCode === expectedCode || declined.detail?.includes(expectedCode)))
}
if (balance.paymentStatus === 'SUCCEEDED') {
  const partial = await request('partial-refund', '/refunds', { idempotencyKey: randomUUID(), paymentId: balance.paymentId,
    refundAmount: { amount: 2500, currency: 'CAD' }, reason: 'Sandbox partial refund test' })
  check('partial refund', partial.refundStatus === 'SUCCEEDED')
  const remainder = await request('remaining-refund', '/refunds', { idempotencyKey: randomUUID(), paymentId: balance.paymentId,
    refundAmount: { amount: 5000, currency: 'CAD' }, reason: 'Sandbox remaining refund test' })
  check('refund remaining balance', remainder.refundStatus === 'SUCCEEDED')
  const excess = await request('over-refund', '/refunds', { idempotencyKey: randomUUID(), paymentId: balance.paymentId,
    refundAmount: { amount: 100, currency: 'CAD' }, reason: 'Sandbox over-refund rejection test' })
  check('over-refund rejected', [400, 422].includes(excess.httpStatus) && excess.refundStatus !== 'SUCCEEDED'
    && /refund/i.test(excess.detail || ''))
}
const full = await request('full-deposit-refund', '/refunds', { idempotencyKey: randomUUID(), paymentId: deposit.paymentId,
  refundAmount: { amount: 2500, currency: 'CAD' }, reason: 'Sandbox full refund test' })
check('full deposit refund', full.refundStatus === 'SUCCEEDED')
const hold = await request('preauthorization', '/payments', purchase(2000, testCard, false))
check('preauthorization', hold.paymentStatus === 'AUTHORIZED')
if (hold.paymentStatus === 'AUTHORIZED') {
  const completion = await request('capture-preauthorization', `/payments/${hold.paymentId}/complete`, { idempotencyKey: randomUUID() })
  check('capture preauthorization', completion.paymentStatus === 'SUCCEEDED')
}
const cancelHold = await request('preauthorization-for-cancel', '/payments', purchase(2000, testCard, false))
if (cancelHold.paymentStatus === 'AUTHORIZED') {
  const canceled = await request('cancel-preauthorization', `/payments/${cancelHold.paymentId}/cancel`,
    { idempotencyKey: randomUUID(), reason: 'Sandbox cancellation test' })
  check('cancel preauthorization', canceled.paymentStatus === 'CANCELED')
} else check('cancel preauthorization', false)
// Deliberately lose a response; use the identical key/body to recover this synthetic payment.
const delayedRequest = purchase(91)
try {
  await request('delayed-payment', '/payments', delayedRequest, 1000)
  check('client timeout induced', false)
} catch (error) {
  check('client timeout induced', error.name === 'TimeoutError')
  console.log(JSON.stringify({ step: 'delayed-payment', outcome: 'unknown', error: error.name }))
}
const recovered = await request('recover-after-timeout-same-key', '/payments', delayedRequest)
// A duplicate-order error does NOT prove the original declined. Reconcile read-only.
const matches = (await reconcile(runId)).filter(p => p.orderId === delayedRequest.orderId
  && p.merchantId === env.SATURN_MONERIS_MERCHANT_ID && p.amount?.amount === 91 && p.amount?.currency === 'CAD')
check('exactly one payment after interrupted request', matches.length === 1)
if (matches.length === 1) {
  const recoveredRead = await request('recovered-payment-readback', `/payments/${matches[0].paymentId}`)
  check('interrupted payment reconciled without another charge', recoveredRead.paymentStatus === 'SUCCEEDED'
    && recoveredRead.orderId === delayedRequest.orderId && recoveredRead.amount?.amount === 91)
} else {
  check('interrupted payment reconciled without another charge', false)
}
finish()
