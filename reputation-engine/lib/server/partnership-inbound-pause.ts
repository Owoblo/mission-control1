/** Fail closed before reply classification. A notification failure cannot undo this pause. */
export async function persistPartnershipInboundPause(input: {
  url: string; headers: HeadersInit; contactId: string; channel: 'sms' | 'email' | 'phone'
}, request: typeof fetch = fetch) {
  const headers = new Headers(input.headers)
  headers.set('Content-Type', 'application/json')
  const response = await request(`${input.url}/rest/v1/rpc/pause_partnership_inbound`, {
    method: 'POST', headers,
    body: JSON.stringify({ p_contact_id: input.contactId, p_channel: input.channel }),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Inbound pause failed (${response.status}); webhook must retry`)
  const receipt = await response.json()
  if (receipt?.paused !== true || receipt?.contact_id !== input.contactId) throw new Error('Inbound pause receipt mismatch; webhook must retry')
  return receipt
}
