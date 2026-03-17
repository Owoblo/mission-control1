import { NextResponse } from 'next/server'
import { saveInboundLead } from '@/lib/server/sales-repository'
import { uid } from '@/lib/sales'

// Parses "John Smith <john@example.com>" or bare "john@example.com"
function parseEmailAddress(value: string): { name: string | null; email: string } {
  const match = value.match(/^(.+?)\s*<([^>]+)>$/)
  if (match) {
    return { name: match[1].trim().replace(/^["']|["']$/g, '') || null, email: match[2].trim().toLowerCase() }
  }
  return { name: null, email: value.trim().toLowerCase() }
}

function firstNonEmpty(...values: (string | undefined | null)[]): string {
  for (const v of values) {
    if (v && v.trim()) return v.trim()
  }
  return ''
}

// Accepts both JSON and form-encoded bodies (Resend, Mailgun, Zapier all differ)
async function parseBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const json = await request.json().catch(() => ({}))
    return json as Record<string, string>
  }
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => new FormData())
    const result: Record<string, string> = {}
    form.forEach((value, key) => { if (typeof value === 'string') result[key] = value })
    return result
  }
  // Fallback: try JSON
  const text = await request.text().catch(() => '')
  try { return JSON.parse(text) as Record<string, string> } catch { return {} }
}

export async function POST(request: Request) {
  try {
    // Shared-secret check — prevents random internet POSTs
    const secret = process.env.WORKER_SHARED_SECRET
    if (secret) {
      const authHeader = request.headers.get('authorization') || ''
      const internalHeader = request.headers.get('x-internal-secret') || ''
      const url = new URL(request.url)
      const querySecret = url.searchParams.get('secret') || ''
      const provided = authHeader.replace(/^Bearer\s+/i, '') || internalHeader || querySecret
      if (provided !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const body = await parseBody(request)

    // Normalize fields across Resend / Mailgun / Zapier / custom
    const rawFrom = firstNonEmpty(body.from, body.From, body.sender, body.Sender)
    const subject = firstNonEmpty(body.subject, body.Subject, '(no subject)')
    // Text body — Mailgun uses 'stripped-text' or 'body-plain', Resend uses 'text', Zapier uses 'body'
    const textBody = firstNonEmpty(
      body['stripped-text'],
      body['body-plain'],
      body.text,
      body.body,
      body.Body,
      body.message,
      body.Message,
    )

    if (!rawFrom) {
      return NextResponse.json({ error: 'Missing from address' }, { status: 400 })
    }

    const { name: senderName, email: senderEmail } = parseEmailAddress(rawFrom)

    // Compose the inbound lead message — subject + body preview
    const messageLines: string[] = []
    messageLines.push(`Subject: ${subject}`)
    if (textBody) {
      // Trim to keep inbox tidy — first 1000 chars
      messageLines.push('', textBody.slice(0, 1000))
    }
    const message = messageLines.join('\n')

    await saveInboundLead({
      id: uid('inb'),
      source: 'email',
      name: senderName || undefined,
      email: senderEmail || undefined,
      message,
      raw_data: {
        from: rawFrom,
        subject,
        body: textBody || '',
        receivedAt: new Date().toISOString(),
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    // Never expose internal errors to external callers
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process email' },
      { status: 500 }
    )
  }
}
