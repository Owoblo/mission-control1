import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS, findBlockedCaller, normalizeBlockedCallerPhone, saveDialerSettings } from '../../lib/server/dialer-settings'

test('persistent block matching handles formats without matching a different caller', () => {
  const settings={...DEFAULT_SETTINGS,blockedCallers:[{phone:'+13652501420',tag:'Unwanted vendor',blockedAt:'2026-10-16T17:00:00Z'}]}
  for (const phone of ['3652501420','(365) 250-1420','+1 365 250 1420']) assert.ok(findBlockedCaller(settings,phone))
  assert.equal(findBlockedCaller(settings,'+13652501421'),null)
  assert.equal(findBlockedCaller(settings,'anonymous'),null)
  assert.equal(normalizeBlockedCallerPhone('+12267732993'),'+12267732993')
})

test('a failed block-list save must not report success', async () => {
  const oldFetch=global.fetch, oldUrl=process.env.SUPABASE_URL, oldKey=process.env.SUPABASE_KEY
  try {
    process.env.SUPABASE_URL='https://example.invalid';process.env.SUPABASE_KEY='unit-test'
    global.fetch=async()=>new Response('unavailable',{status:503})
    await assert.rejects(saveDialerSettings(DEFAULT_SETTINGS),/Unable to save dialer settings \(503\)/)
  } finally {
    global.fetch=oldFetch
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl
    if(oldKey===undefined)delete process.env.SUPABASE_KEY;else process.env.SUPABASE_KEY=oldKey
  }
})
