export type TwilioRecordingLookupResult = {
  recordingSid?: string
  recordingUrl: string
  durationSeconds?: number
  callSid?: string
}

type TwilioRecordingEntry = {
  sid?: string
  uri?: string
  media_url?: string
  duration?: string | number
  call_sid?: string
  date_created?: string
}

type TwilioCallEntry = {
  sid: string
  parent_call_sid?: string | null
}

export function twilioAuth(accountSid: string, authToken: string) {
  // Prefer API key credentials — auth token may be rotated/expired in Vercel env.
  // API key SID + secret always works as Basic Auth for Twilio REST API.
  function clean(v?: string) { return (v || '').replace(/\\n/g, '').replace(/\\r/g, '').trim() }
  const apiKeySid    = clean(process.env.TWILIO_API_KEY_SID)
  const apiKeySecret = clean(process.env.TWILIO_API_KEY_SECRET)
  if (apiKeySid && apiKeySecret) {
    return `Basic ${Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString('base64')}`
  }
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`
}

export function normalizeTwilioRecordingSid(value?: string | null) {
  const sid = (value || '').trim()
  return /^RE[0-9a-fA-F]{32}$/.test(sid) ? sid : ''
}

export function buildTwilioRecordingMediaUrl(accountSid: string, recordingSid: string) {
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`
}

export function extractTwilioRecordingSidFromUrl(rawUrl?: string | null) {
  const value = normalizeTwilioRecordingMediaUrl(rawUrl)
  if (!value) return ''

  try {
    const url = new URL(value)
    const match = url.pathname.match(/\/Recordings\/(RE[0-9a-fA-F]{32})(?:\.(?:mp3|wav|json))?$/i)
    return normalizeTwilioRecordingSid(match?.[1] || '')
  } catch {
    return ''
  }
}

export function normalizeTwilioRecordingMediaUrl(rawUrl?: string | null) {
  const value = (rawUrl || '').trim()
  if (!value) return ''

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return ''
  }

  if (url.protocol !== 'https:' || url.hostname !== 'api.twilio.com') return ''

  if (url.pathname.endsWith('.json')) {
    url.pathname = url.pathname.replace(/\.json$/, '.mp3')
  } else if (!/\.(mp3|wav)$/i.test(url.pathname) && url.pathname.includes('/Recordings/')) {
    url.pathname = `${url.pathname}.mp3`
  }

  return url.toString()
}

async function fetchTwilioJson<T>(url: string, auth: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return null
    return response.json() as Promise<T>
  } catch {
    return null
  }
}

function toRecordingResult(
  accountSid: string,
  recording: TwilioRecordingEntry | null | undefined
): TwilioRecordingLookupResult | null {
  if (!recording) return null

  const recordingSid = normalizeTwilioRecordingSid(recording.sid)
  const fromSid = recordingSid ? buildTwilioRecordingMediaUrl(accountSid, recordingSid) : ''
  const fromMediaUrl = normalizeTwilioRecordingMediaUrl(recording.media_url)
  const fromUri = normalizeTwilioRecordingMediaUrl(recording.uri ? `https://api.twilio.com${recording.uri}` : '')
  const recordingUrl = fromMediaUrl || fromUri || fromSid
  if (!recordingUrl) return null

  const durationSeconds = Number(recording.duration || 0) || undefined

  return {
    recordingSid: recordingSid || undefined,
    recordingUrl,
    durationSeconds,
    callSid: recording.call_sid || undefined,
  }
}

async function fetchRecordingsForCall(
  accountSid: string,
  auth: string,
  callSid: string
): Promise<TwilioRecordingEntry[]> {
  const perCall = await fetchTwilioJson<{ recordings?: TwilioRecordingEntry[] }>(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}/Recordings.json`,
    auth
  )
  if (perCall?.recordings?.length) return perCall.recordings

  const global = await fetchTwilioJson<{ recordings?: TwilioRecordingEntry[] }>(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings.json?CallSid=${encodeURIComponent(callSid)}`,
    auth
  )
  return global?.recordings || []
}

async function fetchCall(accountSid: string, auth: string, callSid: string) {
  return fetchTwilioJson<TwilioCallEntry>(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}.json`,
    auth
  )
}

async function fetchChildCalls(accountSid: string, auth: string, parentCallSid: string) {
  const data = await fetchTwilioJson<{ calls?: TwilioCallEntry[] }>(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json?ParentCallSid=${encodeURIComponent(parentCallSid)}&PageSize=20`,
    auth
  )
  return data?.calls || []
}

export async function getTwilioRecordingBySid({
  accountSid,
  authToken,
  recordingSid,
}: {
  accountSid: string
  authToken: string
  recordingSid: string
}): Promise<TwilioRecordingLookupResult | null> {
  const sid = normalizeTwilioRecordingSid(recordingSid)
  if (!sid) return null

  const auth = twilioAuth(accountSid, authToken)
  const recording = await fetchTwilioJson<TwilioRecordingEntry>(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${sid}.json`,
    auth
  )

  return toRecordingResult(accountSid, recording) || {
    recordingSid: sid,
    recordingUrl: buildTwilioRecordingMediaUrl(accountSid, sid),
  }
}

export async function findTwilioRecordingForCall({
  accountSid,
  authToken,
  callSid,
  recordingSid,
}: {
  accountSid: string
  authToken: string
  callSid?: string | null
  recordingSid?: string | null
}): Promise<TwilioRecordingLookupResult | null> {
  const sidMatch = recordingSid ? await getTwilioRecordingBySid({ accountSid, authToken, recordingSid }) : null
  if (sidMatch) return sidMatch

  const normalizedCallSid = (callSid || '').trim()
  if (!normalizedCallSid) return null

  const auth = twilioAuth(accountSid, authToken)
  const checkedCallSids: Record<string, boolean> = {}

  async function checkCallRecordings(targetCallSid?: string | null) {
    const target = (targetCallSid || '').trim()
    if (!target || checkedCallSids[target]) return null
    checkedCallSids[target] = true

    const recordings = await fetchRecordingsForCall(accountSid, auth, target)
    return toRecordingResult(accountSid, recordings[0])
  }

  const direct = await checkCallRecordings(normalizedCallSid)
  if (direct) return direct

  const call = await fetchCall(accountSid, auth, normalizedCallSid)
  const parentCallSid = call?.parent_call_sid || ''
  if (parentCallSid) {
    const parent = await checkCallRecordings(parentCallSid)
    if (parent) return parent
  }

  const childCalls = await fetchChildCalls(accountSid, auth, normalizedCallSid)
  for (const childCall of childCalls) {
    const child = await checkCallRecordings(childCall.sid)
    if (child) return child
  }

  return null
}

export async function downloadTwilioRecording({
  accountSid,
  authToken,
  recordingUrl,
  recordingSid,
}: {
  accountSid: string
  authToken: string
  recordingUrl?: string | null
  recordingSid?: string | null
}) {
  const auth = twilioAuth(accountSid, authToken)
  const normalizedUrl = normalizeTwilioRecordingMediaUrl(recordingUrl)
  const effectiveSid = normalizeTwilioRecordingSid(recordingSid) || extractTwilioRecordingSidFromUrl(normalizedUrl)
  const resolvedBySid = effectiveSid
    ? await getTwilioRecordingBySid({ accountSid, authToken, recordingSid: effectiveSid }).catch(() => null)
    : null

  const seen: Record<string, boolean> = {}
  const candidates = [normalizedUrl, resolvedBySid?.recordingUrl, effectiveSid ? buildTwilioRecordingMediaUrl(accountSid, effectiveSid) : '']
    .filter((s): s is string => !!s && !seen[s] && (seen[s] = true))

  let lastStatus: number | null = null
  let sawNetworkFailure = false

  for (const candidate of candidates) {
    let response: Response
    try {
      response = await fetch(candidate, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      sawNetworkFailure = true
      continue
    }

    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer())
      return {
        buffer,
        contentType: response.headers.get('content-type') || 'audio/mpeg',
        resolvedUrl: candidate,
        recordingSid: effectiveSid || resolvedBySid?.recordingSid || undefined,
      }
    }

    lastStatus = response.status
  }

  if (sawNetworkFailure && lastStatus === null) {
    throw new Error('Failed to download recording: network error')
  }

  throw new Error(`Failed to download recording: ${lastStatus ?? 'unknown'}`)
}
