export function requireSupabaseEnv() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_KEY

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY')
  }

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
  const url = process.env.WORKER_BASE_URL
  if (!url) {
    throw new Error('Missing WORKER_BASE_URL for outbound messaging')
  }

  return url.replace(/\/$/, '')
}

export function getGoogleMapsApiKey() {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_GEOCODING_API_KEY ||
    process.env.GOOGLE_DIRECTIONS_API_KEY ||
    ''
  )
}
