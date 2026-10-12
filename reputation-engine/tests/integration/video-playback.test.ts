import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedVideoSource, prepareVideoPlayback, videoPlaybackObjectPath } from '../../lib/server/video-playback'

const source = 'https://tlnx-mms-media.s3.us-east-1.amazonaws.com/mms/example/video.3gp'
const storage = 'https://storage.example'

test('conversion only downloads supported provider attachments, not arbitrary URLs or other Twilio accounts', () => {
  assert.equal(allowedVideoSource(source, storage), true)
  assert.equal(allowedVideoSource(`${storage}/storage/v1/object/public/ops-media/chat.mov`, storage), true)
  for (const url of ['http://127.0.0.1/video', 'https://example.com/video', source.replace('.com/', '.com.evil/'), source.replace('https://', 'https://user:pass@'), `${storage}/rest/v1/private`, source.replace('.com/', '.com:1234/')]) {
    assert.equal(allowedVideoSource(url, storage), false, url)
  }
  assert.equal(allowedVideoSource('https://api.twilio.com/2010-04-01/Accounts/ACours/Messages/SM123/Media/ME123', storage, 'ACours'), true)
  assert.equal(allowedVideoSource('https://api.twilio.com/2010-04-01/Accounts/ACother/Messages/SM123/Media/ME123', storage, 'ACours'), false)
})

test('cached playable copies survive expired provider URLs and concurrent requests share the lookup', async () => {
  const before = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY }
  process.env.SUPABASE_URL = storage; process.env.SUPABASE_KEY = 'test'
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (input, options) => {
    calls++
    assert.equal(String(input), `${storage}/storage/v1/object/public/ops-media/${videoPlaybackObjectPath(source)}`)
    assert.equal(options?.method, 'HEAD')
    return new Response(null, { status: 200 })
  }
  try {
    const results = await Promise.all([prepareVideoPlayback(source), prepareVideoPlayback(source)])
    assert.equal(results[0], results[1]); assert.equal(calls, 1)
  } finally {
    globalThis.fetch = originalFetch
    if (before.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = before.url
    if (before.key === undefined) delete process.env.SUPABASE_KEY; else process.env.SUPABASE_KEY = before.key
  }
})

test('untrusted redirects and oversized downloads fail before conversion or storage writes', async () => {
  const before = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY }
  process.env.SUPABASE_URL = storage; process.env.SUPABASE_KEY = 'test'
  const originalFetch = globalThis.fetch
  try {
    for (const [response, message] of [
      [new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/internal' } }), /unsupported download location/],
      [new Response('oversize', { headers: { 'content-length': String(51 * 1024 * 1024) } }), /50 MB/],
    ] as const) {
      globalThis.fetch = async (input, options) => {
        if (options?.method === 'HEAD') return new Response(null, { status: 404 })
        assert.equal(String(input), source)
        assert.equal(options?.redirect, 'manual')
        return response
      }
      await assert.rejects(prepareVideoPlayback(source), message)
    }
  } finally {
    globalThis.fetch = originalFetch
    if (before.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = before.url
    if (before.key === undefined) delete process.env.SUPABASE_KEY; else process.env.SUPABASE_KEY = before.key
  }
})
