import { createHash } from 'node:crypto'
import { mailboxAllowed } from '../google-mail-oauth'
import { refreshGoogleMailAccess } from './google-mail-oauth'
import { readScaledMailInventory } from './scaledmail-inventory'
import { readEnv, requireSupabaseEnv } from './runtime'
import { isOptOutText } from './partnership-sms'

export function managedGoogleSender(sender: string, replyTo: string) {
  const address = sender?.match(/^John \| Saturn Star Movers <([^<>]+)>$/)?.[1]
  return address && address === replyTo && mailboxAllowed(address)
    ? address
    : null
}
async function db(path: string, method = 'GET', body?: unknown) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(url + '/rest/v1/' + path, {
    method,
    headers: { ...headers, Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  if (!response.ok) {
    const reason = await response.json().catch(() => ({}))
    if (
      path === 'rpc/claim_partnership_google_slot' &&
      reason.message === 'Inbox daily capacity reached'
    )
      throw new InboxCapacityReached('Inbox daily capacity reached')
    throw Error('Google partnership ledger request failed: ' + response.status)
  }
  const text = await response.text()
  return text ? JSON.parse(text) : null
}
async function gmail(token: string, path: string, body?: unknown) {
  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/' + path,
    {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    },
  )
  if (!response.ok) throw Error('Gmail request failed: ' + response.status)
  return response.json()
}
export class InboxCapacityReached extends Error {}
export async function reserveGoogleCapacity(
  payload: Record<string, string>,
  mailbox: string,
) {
  await db('rpc/claim_partnership_google_slot', 'POST', {
    p_mailbox: mailbox,
    p_key: payload.actionKey,
    p_contact: payload.contactId,
    p_recipient: payload.recipient,
  })
}
export async function sendManagedGoogle(
  payload: Record<string, string>,
  mailbox: string,
) {
  const token = await refreshGoogleMailAccess(mailbox)
  const mime = [
    'From: ' + payload.sender,
    'To: ' + payload.recipient,
    'Reply-To: ' + mailbox,
    'Subject: =?UTF-8?B?' +
      Buffer.from(payload.subject).toString('base64') +
      '?=',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(payload.text)
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join('\r\n'),
  ].join('\r\n')
  const result = await gmail(token, 'messages/send', {
    raw: Buffer.from(mime).toString('base64url'),
  })
  if (!result.id || !result.threadId) throw Error('Ambiguous Gmail acceptance')
  const saved = await db(
    'partnership_google_slots?action_key=eq.' +
      encodeURIComponent(payload.actionKey),
    'PATCH',
    { thread_id: result.threadId },
  )
  if (saved.length !== 1) throw Error('Missing Gmail thread binding')
  return { provider: 'gmail', accepted: true, messageId: result.id }
}
export async function syncManagedGoogleReplies() {
  const routes = await db(
    'partnership_google_routes?select=mailbox&order=mailbox.asc',
  )
  if (!routes.length) return { mailboxes: 0 }
  const inventory = await readScaledMailInventory(
    readEnv('SCALEDMAIL_API_KEY'),
    readEnv('SCALEDMAIL_ORGANIZATION_ID'),
  ).catch(() => ({ complete: false, domains: [] }))
  const active = new Set(
    inventory.domains
      .filter(
        (d) =>
          d.status.toLowerCase() === 'active' && /google/i.test(d.provider),
      )
      .flatMap((d) => d.emails.map((email) => email.toLowerCase())),
  )
  const results = await Promise.allSettled(
    routes.map(async ({ mailbox }: { mailbox: string }) => {
      const token = await refreshGoogleMailAccess(mailbox)
      const profile = await gmail(token, 'profile')
      if (profile.emailAddress?.toLowerCase() !== mailbox)
        throw Error('Mailbox identity mismatch')
      const query = new URLSearchParams({
        mailbox: 'eq.' + mailbox,
        thread_id: 'not.is.null',
        order: 'last_scanned.asc.nullsfirst,action_key.asc',
        limit: '25',
      })
      for (const slot of await db('partnership_google_slots?' + query)) {
        const thread = await gmail(
          token,
          'threads/' + encodeURIComponent(slot.thread_id) + '?format=full',
        )
        for (const msg of thread.messages || []) {
          const from = String(
            msg.payload?.headers?.find(
              (h: { name: string }) => h.name.toLowerCase() === 'from',
            )?.value || '',
          )
          const address = (from.match(/<([^<>]+)>/)?.[1] || from)
            .trim()
            .toLowerCase()
          if (
            address !== slot.recipient.toLowerCase() ||
            msg.labelIds?.includes('SENT')
          )
            continue
          const hash = createHash('sha256')
            .update(mailbox + ':' + msg.id)
            .digest('hex')
          const eventId = [
            hash.slice(0, 8),
            hash.slice(8, 12),
            hash.slice(12, 16),
            hash.slice(16, 20),
            hash.slice(20, 32),
          ].join('-')
          const when = new Date(Number(msg.internalDate)).toISOString()
          await db('rpc/record_partnership_google_reply', 'POST', {
            p_key: slot.action_key,
            p_message: msg.id,
            p_email: address,
            p_body: msg.snippet || '',
            p_at: when,
            p_event: eventId,
            p_stop: isOptOutText(msg.snippet),
          })
        }
        await db(
          'partnership_google_slots?action_key=eq.' +
            encodeURIComponent(slot.action_key),
          'PATCH',
          { last_scanned: new Date().toISOString() },
        )
      }
      const checked = new Date().toISOString()
      const pending = await db(
        'partnership_google_slots?' +
          new URLSearchParams({
            mailbox: 'eq.' + mailbox,
            thread_id: 'not.is.null',
            or:
              '(last_scanned.is.null,last_scanned.lt.' +
              new Date(Date.now() - 900000).toISOString() +
              ')',
            select: 'action_key',
            limit: '1',
          }),
      )
      await db(
        'partnership_google_routes?mailbox=eq.' + encodeURIComponent(mailbox),
        'PATCH',
        {
          last_reply_sync: pending.length ? null : checked,
          inventory_verified_at:
            inventory.complete && active.has(mailbox)
              ? checked
              : '1970-01-01T00:00:00Z',
        },
      )
      return mailbox
    }),
  )
  if (results.some((r) => r.status === 'rejected'))
    throw Error('One or more managed inboxes failed reply synchronization')
  return { mailboxes: results.length }
}
