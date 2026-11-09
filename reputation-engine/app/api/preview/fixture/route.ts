import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { fixtureDirectory, fixtureSearch, fixtureId } from '@/lib/preview/synthetic-crm'
export async function GET(request: Request) {
  if (process.env.CRM_SYNTHETIC_PREVIEW !== '1' || process.env.VERCEL_ENV === 'production') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const session = await getSessionUser()
  if (!session || !['owner', 'manager', 'partnership_manager'].includes(session.role || '')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const params = new URL(request.url).searchParams, path = params.get('__path')
  let body: unknown = []
  try {
    if (path === '/api/preview/safety') {
      const configuredIntegrationKeys = Object.keys(process.env).filter(key => /(SUPABASE|TWILIO|STRIPE|RESEND|ZOHO|AWS_|SMTP|WORKER_SHARED_SECRET|SENDGRID|SENTRY_AUTH_TOKEN|MAPBOX)/.test(key) && Boolean(process.env[key])).sort()
      const networkBlocked = await fetch('https://crm-synthetic-network-check.invalid', { signal: AbortSignal.timeout(500) }).then(() => false, error => String(error?.message).includes('External network disabled in synthetic CRM preview'))
      body = { synthetic: true, deploymentTarget: process.env.VERCEL_ENV || 'local', configuredIntegrationKeys, networkBlocked, writesEnabled: false }
    }
    else if (path === '/api/auth/me') body = session
    else if (path === '/api/sales/leads' && params.get('mode') === 'cards') return NextResponse.json({ error: 'Experimental sales cards are disabled' }, { status: 404 })
    else if (path === '/api/marketing/contacts/search') body = fixtureSearch(params, session)
    else if (path === '/api/marketing/contacts') body = fixtureDirectory(params, session)
    else if (path === '/api/marketing/batches') body = [{ id: fixtureId(90000), name: 'Synthetic Campaign Cobalt', city: 'Toronto', industry: 'real_estate', created_at: '2026-01-01' }, { id: fixtureId(90001), name: 'Rare Campaign Cobalt', city: 'Toronto', industry: 'real_estate', created_at: '2026-01-02' }]
    else if (path === '/api/marketing/sms/replies') {
      const contacts = fixtureDirectory(new URLSearchParams({ limit: '1' }), session).contacts
      body = { responses: contacts.map(contact => ({ contact })) }
    } else if (path === '/api/marketing/touches') {
      const contact = fixtureDirectory(new URLSearchParams({ id: params.get('contact_id') || '' }), session).contacts[0]
      body = contact ? [{ id: fixtureId(80000), contact_id: contact.id, channel: 'sms', direction: 'inbound', notes: contact.latest_inbound_note, created_at: '2026-10-01T12:00:00Z', metadata: {} }] : []
    } else if (path === '/api/marketing/next-steps') body = { rows: [], counts: {}, coverage: { complete: true } }
    else if (path?.endsWith('/context')) body = { complete: true, errors: [], responsibility: 'Partnerships', replyStatus: 'needs_review', events: [], jobs: [], outcomes: { linkedRecords: 0, movingOpportunities: 0, referralChannels: 0, quoted: 0, booked: 0, completed: 0 } }
    else if (path?.includes('relationship-record')) body = { identity: { category: { label: 'Real estate' }, role: 'Agent', city: session.branch || 'Toronto' }, channels: {}, tasks: [] }
    else if (path?.includes('dialer')) return NextResponse.json({ error: 'External communication is disabled in this synthetic preview.' }, { status: 503 })
    else if (path === '/api/marketing/relationship-summary') body = { markets: null }
    else if (path?.includes('inbox')) body = { items: [], leads: [], emails: [], calls: [], unreadCount: 0 }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store', 'X-CRM-Data': 'synthetic' } })
  } catch { return NextResponse.json({ error: 'Invalid synthetic query' }, { status: 400 }) }
}
