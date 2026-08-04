import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import {
  getZohoPartnershipMessageContent,
  isZohoPartnershipMailConfigured,
  searchZohoPartnershipInbox,
  type ZohoPartnershipMessage,
} from '@/lib/server/zoho-partnership-mail'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
}

function readableBody(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function occurredAt(message: ZohoPartnershipMessage) {
  const raw = message.receivedTime || message.sentDateInGMT
  const millis = Number(raw || 0)
  return Number.isFinite(millis) && millis > 0 ? new Date(millis).toISOString() : new Date().toISOString()
}

async function existingZohoMessageIds() {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/market_touches?channel=eq.email&select=metadata&order=created_at.desc&limit=5000`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) throw new Error('Could not read Partnership email deduplication state')
  const rows = await response.json() as Array<{ metadata?: Record<string, unknown> | null }>
  return new Set(
    rows
      .map(row => String(row.metadata?.zoho_message_id || ''))
      .filter(Boolean)
  )
}

export async function GET(request: Request) {
  return POST(request)
}

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session) && session?.role !== 'partnership_manager') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  if (!isZohoPartnershipMailConfigured()) {
    return NextResponse.json({ error: 'Zoho Partnerships mailbox is not configured' }, { status: 503 })
  }

  try {
    const [messages, importedIds] = await Promise.all([
      searchZohoPartnershipInbox(200),
      existingZohoMessageIds(),
    ])
    const results: Array<Record<string, unknown>> = []

    // Oldest first preserves the natural conversation order when several replies arrive between polls.
    const ordered = [...messages].sort((left, right) => occurredAt(left).localeCompare(occurredAt(right)))
    for (const message of ordered) {
      if (!message.messageId || !message.folderId || !message.fromAddress) continue
      if (importedIds.has(String(message.messageId))) {
        results.push({ messageId: message.messageId, skipped: true, reason: 'already_imported' })
        continue
      }

      const rawContent = await getZohoPartnershipMessageContent(message).catch(() => '')
      const body = readableBody(rawContent) || readableBody(message.summary || '') || '(no readable body)'
      const at = occurredAt(message)
      const match = await pausePartnershipSequenceForInbound({
        channel: 'email',
        email: message.fromAddress,
        occurredAt: at,
        notes: body,
        metadata: {
          provider: 'zoho',
          mailbox: 'partnerships@starmovers.ca',
          zoho_message_id: String(message.messageId),
          zoho_folder_id: String(message.folderId),
          zoho_subject: message.subject || '(no subject)',
          to: message.toAddress || 'partnerships@starmovers.ca',
          has_attachment: String(message.hasAttachment || '0') !== '0',
        },
      })
      results.push({
        messageId: message.messageId,
        from: message.fromAddress,
        subject: message.subject,
        matched: match.matched,
        contactId: match.matched ? match.contactId : null,
      })
      if (match.matched) importedIds.add(String(message.messageId))
    }

    return NextResponse.json({
      ok: true,
      mailbox: 'partnerships@starmovers.ca',
      scanned: messages.length,
      imported: results.filter(item => item.matched).length,
      skipped: results.filter(item => item.skipped).length,
      unmatched: results.filter(item => item.matched === false).length,
      results,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Zoho Partnerships poll failed' },
      { status: 500 }
    )
  }
}
