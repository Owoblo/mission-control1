export type SmsMediaInput = {
  body?: string | null
  media?: Array<{ url?: string | null; contentType?: string | null }> | null
  mediaUrls?: Array<string | null | undefined> | null
  metadata?: {
    media?: Array<{ url?: string | null; contentType?: string | null }> | null
    mediaUrls?: Array<string | null | undefined> | null
    media_urls?: Array<string | null | undefined> | null
  } | null
}

const MMS_MARKER_PATTERN = /\n?\[MMS:\s*([^\]]+)\]/ig

function cleanUrl(value: string) {
  return value.trim().replace(/[),.;]+$/g, '')
}

export function extractMmsUrlsFromBody(body?: string | null) {
  if (!body) return []
  const urls: string[] = []
  MMS_MARKER_PATTERN.lastIndex = 0
  let match = MMS_MARKER_PATTERN.exec(body)
  while (match) {
    const raw = match[1] || ''
    for (const part of raw.split(',')) {
      const url = cleanUrl(part)
      if (url) urls.push(url)
    }
    match = MMS_MARKER_PATTERN.exec(body)
  }
  return urls
}

export function stripMmsMarkersFromBody(body?: string | null) {
  return (body || '').replace(MMS_MARKER_PATTERN, '').trim()
}

export function isTwilioApiMediaUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' &&
      parsed.hostname === 'api.twilio.com' &&
      parsed.pathname.startsWith('/2010-04-01/Accounts/') &&
      parsed.pathname.includes('/Media/')
  } catch {
    return false
  }
}

export function normalizeSmsMediaUrls(input: SmsMediaInput) {
  const urls = new Set<string>()
  const add = (value?: string | null) => {
    const url = cleanUrl(value || '')
    if (url) urls.add(url)
  }

  for (const item of input.media || []) add(item?.url)
  for (const item of input.metadata?.media || []) add(item?.url)
  for (const url of input.mediaUrls || []) add(url)
  for (const url of input.metadata?.mediaUrls || []) add(url)
  for (const url of input.metadata?.media_urls || []) add(url)
  for (const url of extractMmsUrlsFromBody(input.body)) add(url)

  return Array.from(urls)
}
