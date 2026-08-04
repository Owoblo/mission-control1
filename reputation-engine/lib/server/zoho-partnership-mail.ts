import { readEnv, requireEnv } from '@/lib/server/runtime'

const DEFAULT_ACCOUNTS_URL = 'https://accounts.zohocloud.ca'
const DEFAULT_MAIL_URL = 'https://mail.zohocloud.ca'
const DEFAULT_FROM_EMAIL = 'partnerships@starmovers.ca'

type ZohoEnvelope<T> = {
  status?: { code?: number; description?: string }
  data?: T
}

export type ZohoPartnershipMessage = {
  messageId: string
  folderId: string
  fromAddress: string
  sender?: string
  toAddress?: string
  ccAddress?: string
  subject?: string
  summary?: string
  receivedTime?: string
  sentDateInGMT?: string
  hasAttachment?: string | number
}

function config() {
  return {
    clientId: requireEnv('ZOHO_PARTNERSHIP_CLIENT_ID'),
    clientSecret: requireEnv('ZOHO_PARTNERSHIP_CLIENT_SECRET'),
    refreshToken: requireEnv('ZOHO_PARTNERSHIP_REFRESH_TOKEN'),
    accountId: requireEnv('ZOHO_PARTNERSHIP_ACCOUNT_ID'),
    fromEmail: readEnv('ZOHO_PARTNERSHIP_FROM_EMAIL') || DEFAULT_FROM_EMAIL,
    accountsUrl: (readEnv('ZOHO_PARTNERSHIP_ACCOUNTS_URL') || DEFAULT_ACCOUNTS_URL).replace(/\/$/, ''),
    mailUrl: (readEnv('ZOHO_PARTNERSHIP_MAIL_URL') || DEFAULT_MAIL_URL).replace(/\/$/, ''),
  }
}

let cachedAccessToken = ''
let accessTokenExpiresAt = 0

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt - 60_000) return cachedAccessToken

  const cfg = config()
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
  })
  const response = await fetch(`${cfg.accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })
  const result = await response.json().catch(() => ({})) as {
    access_token?: string
    expires_in?: number
    error?: string
  }
  if (!response.ok || !result.access_token) {
    throw new Error(`Zoho Partnerships authentication failed${result.error ? `: ${result.error}` : ''}`)
  }

  cachedAccessToken = result.access_token
  accessTokenExpiresAt = Date.now() + Math.max(300, Number(result.expires_in || 3600)) * 1000
  return cachedAccessToken
}

async function zohoFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const cfg = config()
  const token = await getAccessToken()
  const response = await fetch(`${cfg.mailUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Zoho-oauthtoken ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  })
  const result = await response.json().catch(() => ({})) as ZohoEnvelope<T> & {
    error?: { message?: string }
    message?: string
  }
  if (!response.ok || (result.status?.code && result.status.code >= 400)) {
    throw new Error(result.error?.message || result.message || result.status?.description || `Zoho Mail request failed (${response.status})`)
  }
  return result.data as T
}

export function isZohoPartnershipMailConfigured() {
  return Boolean(
    readEnv('ZOHO_PARTNERSHIP_CLIENT_ID') &&
    readEnv('ZOHO_PARTNERSHIP_CLIENT_SECRET') &&
    readEnv('ZOHO_PARTNERSHIP_REFRESH_TOKEN') &&
    readEnv('ZOHO_PARTNERSHIP_ACCOUNT_ID')
  )
}

export async function sendZohoPartnershipEmail(input: {
  to: string
  subject: string
  text: string
  html?: string
  cc?: string
  bcc?: string
}) {
  const cfg = config()
  const result = await zohoFetch<Record<string, unknown>>(
    `/api/accounts/${encodeURIComponent(cfg.accountId)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        fromAddress: cfg.fromEmail,
        toAddress: input.to,
        ...(input.cc ? { ccAddress: input.cc } : {}),
        ...(input.bcc ? { bccAddress: input.bcc } : {}),
        subject: input.subject,
        content: input.html || input.text.replace(/\n/g, '<br>'),
        mailFormat: input.html ? 'html' : 'plaintext',
        encoding: 'UTF-8',
      }),
    }
  )
  return result
}

export async function searchZohoPartnershipInbox(limit = 100) {
  const cfg = config()
  const query = new URLSearchParams({
    searchKey: 'in:inbox',
    start: '1',
    limit: String(Math.max(1, Math.min(limit, 200))),
    includeto: 'true',
  })
  return zohoFetch<ZohoPartnershipMessage[]>(
    `/api/accounts/${encodeURIComponent(cfg.accountId)}/messages/search?${query.toString()}`
  )
}

export async function getZohoPartnershipMessageContent(message: Pick<ZohoPartnershipMessage, 'folderId' | 'messageId'>) {
  const cfg = config()
  const result = await zohoFetch<{ messageId?: string; content?: string }>(
    `/api/accounts/${encodeURIComponent(cfg.accountId)}/folders/${encodeURIComponent(message.folderId)}/messages/${encodeURIComponent(message.messageId)}/content`
  )
  return result?.content || ''
}
