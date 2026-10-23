'use client'

export const SESSION_REQUIRED = 'crm:session-required'
export const SESSION_RESTORED = 'crm:session-restored'

export function isProtectedApiRequest(input: RequestInfo | URL, origin: string) {
  const url = new URL(input instanceof Request ? input.url : String(input), origin)
  return url.origin === origin && /^\/api\/(sales|marketing|crew|admin|partners|partner-portal|auth\/me)(\/|$)/.test(url.pathname)
}

// Observe failures without replaying writes or storing card fields or form contents.
export function observeSessionFailures() {
  const original = window.fetch
  const observed: typeof fetch = async (input, init) => {
    const response = await original(input, init)
    if (response.status === 401 && isProtectedApiRequest(input, window.location.origin)) {
      window.dispatchEvent(new Event(SESSION_REQUIRED))
    }
    return response
  }
  window.fetch = observed
  return () => { if (window.fetch === observed) window.fetch = original }
}
