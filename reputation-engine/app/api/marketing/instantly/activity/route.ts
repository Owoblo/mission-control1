/**
 * GET /api/marketing/instantly/activity?email=...
 * Fetches Instantly email activity for a contact — opens, clicks, replies, bounces.
 * Used to embed the email timeline in the contact drawer without visiting Instantly.
 */
import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { readEnv } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'

interface InstantlyEmailActivity {
  id: string
  campaign_id: string
  campaign_name?: string
  email: string
  subject?: string
  status: string
  opened: boolean
  clicked: boolean
  replied: boolean
  bounced: boolean
  open_count?: number
  click_count?: number
  timestamp_created?: string
  timestamp_updated?: string
}

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const apiKey = readEnv('INSTANTLY_API_KEY')
  if (!apiKey) return NextResponse.json({ emails: [], error: 'Instantly not configured' })

  try {
    // Fetch lead activity across all campaigns
    const res = await fetch(
      `https://api.instantly.ai/api/v2/leads?email=${encodeURIComponent(email)}&limit=20`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
      }
    )

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { statusCode?: number }
      if (err.statusCode === 402) return NextResponse.json({ emails: [], plan_required: true })
      return NextResponse.json({ emails: [] })
    }

    const data = await res.json() as { items?: InstantlyEmailActivity[] }
    const emails = (data.items || []).map(item => ({
      id: item.id,
      campaign_id: item.campaign_id,
      subject: item.subject || '(no subject)',
      status: item.status,
      opened: item.opened,
      clicked: item.clicked,
      replied: item.replied,
      bounced: item.bounced,
      open_count: item.open_count || 0,
      click_count: item.click_count || 0,
      timestamp: item.timestamp_updated || item.timestamp_created,
    }))

    return NextResponse.json({ emails, total: emails.length })
  } catch {
    return NextResponse.json({ emails: [] })
  }
}
