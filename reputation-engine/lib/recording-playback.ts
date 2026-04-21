export function getRecordingPlaybackUrl(recordingUrl?: string | null) {
  const normalizedUrl = (recordingUrl || '').trim()
  if (!normalizedUrl) return ''

  if (
    normalizedUrl.startsWith('https://api.twilio.com/') ||
    normalizedUrl.includes('://api.twilio.com/')
  ) {
    return `/api/sales/dialer/recording?url=${encodeURIComponent(normalizedUrl)}`
  }

  return normalizedUrl
}
