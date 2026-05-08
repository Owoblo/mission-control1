function normalizeEnvValue(value?: string | null) {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''

  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed

  return unquoted
    .replace(/\\r/g, '')
    .replace(/\\n/g, '')
    .replace(/\r/g, '')
    .replace(/\n/g, '')
    .trim()
}

export function readEnv(name: string) {
  return normalizeEnvValue(process.env[name])
}

export function requireEnv(name: string, message = `Missing ${name}`) {
  const value = readEnv(name)
  if (!value) {
    throw new Error(message)
  }
  return value
}

export function getAppBaseUrl(fallback = '') {
  const normalizedFallback = fallback.trim()
  const url = readEnv('NEXT_PUBLIC_APP_URL') || normalizedFallback
  return url.replace(/\/$/, '')
}

export function getWorkerSharedSecret() {
  return readEnv('WORKER_SHARED_SECRET')
}

export function requireSupabaseEnv() {
  const url = requireEnv('SUPABASE_URL', 'Missing SUPABASE_URL or SUPABASE_KEY')
  const key = requireEnv('SUPABASE_KEY', 'Missing SUPABASE_URL or SUPABASE_KEY')

  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  }
}

export function requireWorkerBaseUrl() {
  return requireEnv('WORKER_BASE_URL', 'Missing WORKER_BASE_URL for outbound messaging').replace(/\/$/, '')
}

export function getTwilioCredentials() {
  const accountSid = readEnv('TWILIO_ACCOUNT_SID')
  const authToken = readEnv('TWILIO_AUTH_TOKEN')
  if (!accountSid || !authToken) {
    throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN')
  }
  return { accountSid, authToken }
}

export function getGoogleMapsApiKey() {
  return (
    readEnv('GOOGLE_MAPS_API_KEY') ||
    readEnv('GOOGLE_GEOCODING_API_KEY') ||
    readEnv('GOOGLE_DIRECTIONS_API_KEY') ||
    ''
  )
}
