// Read-only route smoke check: deliberately sends no credentials.
const origin = process.argv[2] || 'https://go.quote2move.com'
const checks = [
  ['auth/login', 'POST', 400, 'Password is required'],
  ['auth/me', 'GET', 401],
  ['caller-id', 'GET', 401],
  ['calls', 'GET', 401],
  ['contact-profile', 'GET', 401],
  ['contacts', 'GET', 401],
  ['conversations', 'GET', 401],
  ['lines', 'GET', 401],
  ['upload-media', 'POST', 401],
]
let failures = 0
for (const [route, method, expectedStatus, expectedError] of checks) {
  const response = await fetch(`${origin}/api/mobile/${route}`, {
    method,
    ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
    signal: AbortSignal.timeout(20000),
  })
  const payload = await response.json().catch(() => null)
  const ok = response.status === expectedStatus && payload !== null && (!expectedError || payload.error === expectedError)
  if (!ok) failures++
  console.log(JSON.stringify({ route, status: response.status, json: payload !== null, ok }))
}
if (failures) process.exitCode = 1
