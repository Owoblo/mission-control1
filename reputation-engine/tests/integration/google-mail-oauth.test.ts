import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { startGoogleMail, finishGoogleMail, refreshGoogleMailAccess } from '../../lib/server/google-mail-oauth'
import { GOOGLE_MAIL_SCOPES } from '../../lib/google-mail-oauth'

test('OAuth start, one-time callback, identity validation and revoked refresh', async () => {
  const originalFetch = global.fetch
  const names = ['GOOGLE_MAIL_CLIENT_ID','GOOGLE_MAIL_CLIENT_SECRET','GOOGLE_MAIL_TOKEN_KEY','GOOGLE_MAIL_ORIGIN','SUPABASE_URL','SUPABASE_KEY']
  const old = Object.fromEntries(names.map(n => [n, process.env[n]]))
  Object.assign(process.env, { GOOGLE_MAIL_CLIENT_ID: 'test-client', GOOGLE_MAIL_CLIENT_SECRET: 'test-secret', GOOGLE_MAIL_TOKEN_KEY: randomBytes(32).toString('base64'), GOOGLE_MAIL_ORIGIN: 'https://crm.example.com', SUPABASE_URL: 'https://db.example.com', SUPABASE_KEY: 'test-db-key' })
  let attempt: any, saved: any, revoked = false, wrongMailbox = false
  global.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/google_mail_oauth_attempts') && init.method === 'POST') { attempt = JSON.parse(init.body); return new Response(null, { status: 201 }) }
    if (url.pathname.endsWith('/google_mail_oauth_attempts') && init.method === 'DELETE') {
      const matches = attempt && ['state_hash','owner_id','binding_hash'].every(k => url.searchParams.get(k) === `eq.${attempt[k]}`)
      const result = matches ? [attempt] : []
      if (matches) attempt = undefined
      return Response.json(result)
    }
    if (url.hostname === 'oauth2.googleapis.com') return revoked ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : Response.json({ access_token: 'access', refresh_token: 'refresh', scope: GOOGLE_MAIL_SCOPES.join(' ') })
    if (url.hostname === 'gmail.googleapis.com') return Response.json({ emailAddress: wrongMailbox ? 'johnny@moveswithsaturn.com' : 'john@moveswithsaturn.com' })
    if (url.pathname.endsWith('/google_mail_connections')) {
      if (init.method === 'POST') { saved = JSON.parse(init.body); return new Response(null, { status: 201 }) }
      if (init.method === 'PATCH') { Object.assign(saved, JSON.parse(init.body)); return new Response(null, { status: 204 }) }
      return Response.json(saved ? [saved] : [])
    }
    throw new Error('Unexpected test request')
  }) as typeof fetch
  try {
    const email = 'john@moveswithsaturn.com'
    const url = new URL(await startGoogleMail(email, 'owner', 'browser'))
    const state = url.searchParams.get('state')!
    await assert.rejects(finishGoogleMail('code', state, 'other-owner', 'browser'))
    await assert.rejects(finishGoogleMail('code', state, 'owner', 'other-browser'))
    assert.equal(await finishGoogleMail('code', state, 'owner', 'browser'), email)
    assert.equal(saved.campaign_enabled, false)
    assert.ok(saved.refresh_token_encrypted !== 'refresh')
    await assert.rejects(finishGoogleMail('code', state, 'owner', 'browser'))
    assert.equal(await refreshGoogleMailAccess(email), 'access')
    revoked = true
    await assert.rejects(refreshGoogleMailAccess(email))
    assert.equal(saved.status, 'reconnect_required')
    revoked = false; wrongMailbox = true; saved = undefined
    const second = new URL(await startGoogleMail(email, 'owner', 'browser'))
    await assert.rejects(finishGoogleMail('code', second.searchParams.get('state')!, 'owner', 'browser'))
    assert.equal(saved, undefined)
  } finally {
    global.fetch = originalFetch
    for (const n of names) { if (old[n] === undefined) delete process.env[n]; else process.env[n] = old[n] }
  }
})
