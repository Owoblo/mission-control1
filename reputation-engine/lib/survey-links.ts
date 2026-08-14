export const PHOTO_SURVEY_LINK_TTL_DAYS = 30

export function photoSurveyLinkExpiresAt(now = Date.now()) {
  return new Date(now + PHOTO_SURVEY_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

export function isPhotoSurveyLinkExpired(expiresAt?: string | null, now = Date.now()) {
  if (!expiresAt) return false
  const expiry = Date.parse(expiresAt)
  return Number.isFinite(expiry) && expiry <= now
}
