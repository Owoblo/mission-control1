import { readEnv } from './runtime'

type Account = {
  accountId: string
  primaryEmailAddress?: string
  emailAddress?: Array<{ mailId?: string; isConfirmed?: boolean }>
  incomingBlocked?: boolean
  outgoingBlocked?: boolean
}

export function zohoOrigin(value: string, service: 'accounts' | 'mail') {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !new RegExp(`^${service}\\.zoho(cloud)?\\.(com|ca|eu|in|com\\.au|jp|com\\.cn|sa)$`).test(url.hostname) ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid Zoho service URL')
  }
  return url.origin
}

export function accountContainsMailbox(account: Account, mailbox: string) {
  const expected = mailbox.trim().toLowerCase()
  return account.primaryEmailAddress?.toLowerCase() === expected ||
    Boolean(account.emailAddress?.some(item => item.isConfirmed !== false && item.mailId?.toLowerCase() === expected))
}

// Does not return credentials or email content; safe for an authenticated health check.
export async function checkZohoMailbox(fetcher: typeof fetch = fetch) {
  const required = ['ZOHO_PARTNERSHIP_CLIENT_ID', 'ZOHO_PARTNERSHIP_CLIENT_SECRET', 'ZOHO_PARTNERSHIP_REFRESH_TOKEN']
  const missing = required.filter(key => !readEnv(key))
  const mailbox = readEnv('PARTNERSHIP_EMAIL_REPLY_TO') || 'business@starmovers.ca'
  if (missing.length) return { ok: false, mailbox, reason: 'missing_credentials', missing }
  const accountsUrl = zohoOrigin(readEnv('ZOHO_PARTNERSHIP_ACCOUNTS_URL') || 'https://accounts.zohocloud.ca', 'accounts')
  const mailUrl = zohoOrigin(readEnv('ZOHO_PARTNERSHIP_MAIL_URL') || 'https://mail.zohocloud.ca', 'mail')
  const tokenResponse = await fetcher(`${accountsUrl}/oauth/v2/token`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), cache: 'no-store',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: readEnv('ZOHO_PARTNERSHIP_CLIENT_ID'),
      client_secret: readEnv('ZOHO_PARTNERSHIP_CLIENT_SECRET'),
      refresh_token: readEnv('ZOHO_PARTNERSHIP_REFRESH_TOKEN'),
    }),
  })
  const token = await tokenResponse.json() as { access_token?: string }
  if (!tokenResponse.ok || !token.access_token) return { ok: false, mailbox, reason: 'oauth_refresh_failed' }
  const headers = { Authorization: `Zoho-oauthtoken ${token.access_token}` }
  const accountsResponse = await fetcher(`${mailUrl}/api/accounts`, {
    headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
  })
  const accounts = await accountsResponse.json() as { status?: { code?: number }; data?: Account[] }
  if (!accountsResponse.ok || accounts.status?.code !== 200 || !Array.isArray(accounts.data)) {
    return { ok: false, mailbox, reason: 'account_read_failed' }
  }
  const account = accounts.data.find(item => accountContainsMailbox(item, mailbox))
  if (!account) return { ok: false, mailbox, reason: 'reply_mailbox_not_authorized' }
  if (account.incomingBlocked) return { ok: false, mailbox, reason: 'incoming_mail_blocked' }
  // A one-message read confirms message scopes without importing historical mail.
  const messagesResponse = await fetcher(`${mailUrl}/api/accounts/${encodeURIComponent(account.accountId)}/messages/view?start=1&limit=1`, {
    headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
  })
  const messages = await messagesResponse.json() as { status?: { code?: number }; data?: unknown[] }
  const readable = messagesResponse.ok && messages.status?.code === 200 && Array.isArray(messages.data)
  return {
    ok: readable, mailbox, accountId: account.accountId,
    reason: readable ? 'mailbox_read_verified' : 'message_read_failed',
    outgoingBlocked: Boolean(account.outgoingBlocked),
    replySendTested: false,
  }
}
