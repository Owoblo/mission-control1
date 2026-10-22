import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { readEnv, requireSupabaseEnv } from './runtime'

const exec = promisify(execFile)
const MAX_INPUT = 50 * 1024 * 1024
const MAX_OUTPUT = 100 * 1024 * 1024
const pending = new Map<string, Promise<string>>()

export function videoPlaybackObjectPath(source: string) {
  return `video-playback/v1/${createHash('sha256').update(source).digest('hex')}.mp4`
}

export function allowedVideoSource(source: string, supabaseUrl: string, accountSid = '') {
  try {
    const url = new URL(source)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
    if (url.hostname === 'tlnx-mms-media.s3.us-east-1.amazonaws.com') return url.pathname.startsWith('/mms/')
    if (url.origin === new URL(supabaseUrl).origin) return url.pathname.startsWith('/storage/v1/object/public/ops-media/')
    return Boolean(accountSid && url.hostname === 'api.twilio.com' &&
      new RegExp(`^/2010-04-01/Accounts/${accountSid}/Messages/[^/]+/Media/[^/]+$`).test(url.pathname))
  } catch { return false }
}

async function downloadVideo(source: string) {
  const { url } = requireSupabaseEnv()
  const sid = readEnv('TWILIO_ACCOUNT_SID')
  if (!allowedVideoSource(source, url, sid)) throw new Error('This attachment provider is not supported for conversion.')
  const headers: Record<string, string> = {}
  if (new URL(source).hostname === 'api.twilio.com') {
    const token = readEnv('TWILIO_AUTH_TOKEN')
    if (!token) throw new Error('Video provider is not configured.')
    headers.Authorization = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`
  }
  let response = await fetch(source, { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
  if (response.status >= 300 && response.status < 400) {
    const destination = new URL(response.headers.get('location') || '', source)
    const trustedCdn = destination.protocol === 'https:' && !destination.username && !destination.password &&
      !destination.port && (destination.hostname === 'media.twiliocdn.com' || destination.hostname.endsWith('.media.twiliocdn.com'))
    if (!trustedCdn && !allowedVideoSource(destination.toString(), url)) throw new Error('The video provider returned an unsupported download location.')
    response = await fetch(destination, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
  }
  if (!response.ok || !response.body) throw new Error('The original video is no longer available from the provider.')
  if (Number(response.headers.get('content-length') || 0) > MAX_INPUT) {
    await response.body.cancel()
    throw new Error('Automatic conversion supports videos up to 50 MB.')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_INPUT) throw new Error('Automatic conversion supports videos up to 50 MB.')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  return Buffer.concat(chunks)
}

export async function transcodeVideoForBrowser(input: Uint8Array) {
  if (!ffmpegPath) throw new Error('Video conversion is unavailable on this server.')
  const directory = await mkdtemp(join(tmpdir(), 'video-playback-'))
  try {
    const source = join(directory, 'input')
    const output = join(directory, 'playback.mp4')
    await writeFile(source, input)
    await exec(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,mpeg,mpegts',
      '-threads', '2', '-i', source, '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-fs', String(MAX_OUTPUT), output,
    ], { timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }).catch(() => {
      throw new Error('This video could not be converted. You can still download the original.')
    })
    const info = await stat(output)
    if (!info.size || info.size >= MAX_OUTPUT) throw new Error('The converted video exceeds the playback size limit.')
    return await readFile(output)
  } finally { await rm(directory, { recursive: true, force: true }) }
}

async function prepare(source: string) {
  const { url, headers } = requireSupabaseEnv()
  if (!allowedVideoSource(source, url, readEnv('TWILIO_ACCOUNT_SID'))) throw new Error('This attachment provider is not supported for conversion.')
  const path = videoPlaybackObjectPath(source)
  const playbackUrl = `${url}/storage/v1/object/public/ops-media/${path}`
  const cached = await fetch(playbackUrl, { method: 'HEAD', signal: AbortSignal.timeout(15_000), cache: 'no-store' })
  if (cached.ok) return playbackUrl
  // Do not turn a storage outage into repeated, expensive conversions.
  if (![400, 404].includes(cached.status)) throw new Error('Video storage is temporarily unavailable. Please retry.')
  const bytes = await transcodeVideoForBrowser(await downloadVideo(source))
  const uploaded = await fetch(`${url}/storage/v1/object/ops-media/${path}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'video/mp4', 'x-upsert': 'true' },
    body: new Uint8Array(bytes), signal: AbortSignal.timeout(30_000),
  })
  if (!uploaded.ok) throw new Error('Could not save the playable video. Please retry.')
  return playbackUrl
}

export async function prepareVideoPlayback(source: string) {
  const existing = pending.get(source)
  if (existing) return existing
  const operation = prepare(source).finally(() => { pending.delete(source) })
  pending.set(source, operation)
  return operation
}
