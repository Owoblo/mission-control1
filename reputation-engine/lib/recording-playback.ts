export function getRecordingPlaybackUrl({
  recordingUrl,
  recordingSid,
}: {
  recordingUrl?: string | null
  recordingSid?: string | null
}) {
  const normalizedUrl = (recordingUrl || '').trim()
  const normalizedSid = (recordingSid || '').trim()
  if (normalizedUrl && (
    normalizedUrl.startsWith('https://api.twilio.com/') ||
    normalizedUrl.includes('://api.twilio.com/')
  )) {
    const params = new URLSearchParams({ url: normalizedUrl })
    if (/^RE[0-9a-fA-F]{32}$/.test(normalizedSid)) {
      params.set('sid', normalizedSid)
    }
    return `/api/sales/dialer/recording?${params.toString()}`
  }

  if (/^RE[0-9a-fA-F]{32}$/.test(normalizedSid)) {
    return `/api/sales/dialer/recording?sid=${encodeURIComponent(normalizedSid)}`
  }

  if (!normalizedUrl) return ''

  return normalizedUrl
}
