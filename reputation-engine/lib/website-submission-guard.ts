const WEBSITE_SOURCES = new Set(['website_form', 'website-form', 'website-discovery', 'website_discovery'])
const KNOWN_EARNINGS_LINK = /https?:\/\/(?:www\.)?telegra\.ph\/Read-the-latest-news-and-earn-50000000-in-a-month/i
export function websiteSubmissionSpamReason(source: unknown, message: unknown) {
  return WEBSITE_SOURCES.has(String(source || '')) && KNOWN_EARNINGS_LINK.test(String(message || ''))
    ? 'Known earnings-link spam campaign; human review required' : null
}
export class WebsiteSubmissionHeldError extends Error {
  readonly held = true
}
