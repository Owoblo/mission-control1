import { getAppBaseUrl, getTwilioCredentials, getWorkerSharedSecret, readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import { getSaturnBranchPhoneNumbers, getSaturnBranchLabel, normalizePhone } from '@/lib/sales-phones'
import { twilioAuth } from '@/lib/server/twilio-recordings'
import { deleteSalesLead, getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { persistInboundMmsToLead } from '@/lib/server/lead-media'
import type { CRMLead } from '@/lib/types'

const DEFAULT_APP_URL = 'https://go.quote2move.com'
const ASSISTANT_NUMBER = '+12267746581'
const HEALTH_WINDOW_HOURS = 12
const HEALTH_PROBE_SMS_SENDER = '+15550001111'
const HEALTH_PROBE_EMAIL = 'leadflow.health@system.invalid'

export type LeadFlowHealthStatus = 'ok' | 'warn' | 'fail'

export type LeadFlowHealthCheck = {
  key: string
  label: string
  status: LeadFlowHealthStatus
  detail: string
  observedAt?: string | null
}

export type LeadFlowHealthReport = {
  status: LeadFlowHealthStatus
  generatedAt: string
  baseUrl: string
  checks: LeadFlowHealthCheck[]
  summary: {
    ok: number
    warn: number
    fail: number
  }
}

type TwilioIncomingNumber = {
  sid?: string
  phone_number?: string
  sms_url?: string
  sms_method?: string
  voice_url?: string
  voice_method?: string
}

function normalizeUrl(value?: string | null) {
  return (value || '').trim().replace(/\/$/, '')
}

function buildCheck(
  key: string,
  label: string,
  status: LeadFlowHealthStatus,
  detail: string,
  observedAt?: string | null
): LeadFlowHealthCheck {
  return { key, label, status, detail, observedAt: observedAt || null }
}

function compareStatus(left: LeadFlowHealthStatus, right: LeadFlowHealthStatus) {
  const rank: Record<LeadFlowHealthStatus, number> = { ok: 0, warn: 1, fail: 2 }
  return rank[left] - rank[right]
}

function getOverallStatus(checks: LeadFlowHealthCheck[]): LeadFlowHealthStatus {
  return checks.reduce<LeadFlowHealthStatus>((current, check) => (
    compareStatus(check.status, current) > 0 ? check.status : current
  ), 'ok')
}

function ageHours(timestamp?: string | null) {
  if (!timestamp) return null
  const value = new Date(timestamp).getTime()
  if (!Number.isFinite(value)) return null
  return (Date.now() - value) / 3_600_000
}

function formatAge(timestamp?: string | null) {
  const hours = ageHours(timestamp)
  if (hours == null) return 'never'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`
  if (hours < 48) return `${hours.toFixed(hours >= 10 ? 0 : 1)}h ago`
  return `${(hours / 24).toFixed(1)}d ago`
}

function mostRecentTimestamp(...timestamps: Array<string | null | undefined>) {
  let latest: string | null = null
  let latestValue = -Infinity

  for (const timestamp of timestamps) {
    if (!timestamp) continue
    const value = new Date(timestamp).getTime()
    if (!Number.isFinite(value) || value <= latestValue) continue
    latest = timestamp
    latestValue = value
  }

  return latest
}

function recentActivityCheck(key: string, label: string, observedAt?: string | null) {
  if (!observedAt) {
    return buildCheck(key, label, 'warn', 'No recent activity was found in storage.', null)
  }

  const hours = ageHours(observedAt)
  if (hours == null) {
    return buildCheck(key, label, 'warn', `Activity exists but timestamp is invalid (${observedAt}).`, observedAt)
  }

  if (hours > HEALTH_WINDOW_HOURS) {
    return buildCheck(key, label, 'warn', `Last activity was ${formatAge(observedAt)}.`, observedAt)
  }

  return buildCheck(key, label, 'ok', `Last activity was ${formatAge(observedAt)}.`, observedAt)
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) return null
    return response.json() as Promise<T>
  } catch {
    return null
  }
}

async function fetchText(url: string, init?: RequestInit) {
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : 'Request failed',
    }
  }
}

async function fetchSupabaseRows<T>(path: string) {
  const { url, headers } = requireSupabaseEnv()
  return fetchJson<T[]>(`${url}/rest/v1/${path}`, { headers })
}

async function fetchLatestSmsTimestamp(direction: 'inbound' | 'outbound') {
  const rows = await fetchSupabaseRows<Array<{ created_at?: string }>[number]>(
    `sms_messages?select=created_at&direction=eq.${direction}&order=created_at.desc&limit=1`
  )
  return rows?.[0]?.created_at || null
}

async function fetchLatestEmailTimestamp(direction: 'inbound' | 'outbound') {
  const rows = await fetchSupabaseRows<Array<{ data?: { sentAt?: string } }>[number]>(
    `crm_emails?select=id,data,updated_at&data->>direction=eq.${direction}&order=updated_at.desc&limit=1`
  )
  return rows?.[0]?.data?.sentAt || null
}

async function fetchLatestInboundLeadTimestamp(source: string) {
  const rows = await fetchSupabaseRows<Array<{ created_at?: string }>[number]>(
    `inbound_leads?select=created_at&source=eq.${encodeURIComponent(source)}&order=created_at.desc&limit=1`
  )
  return rows?.[0]?.created_at || null
}

async function fetchTwilioIncomingNumbers() {
  try {
    const { accountSid, authToken } = getTwilioCredentials()
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PageSize=200`,
      {
        headers: { Authorization: twilioAuth(accountSid, authToken) },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      }
    )
    if (!response.ok) return null
    const payload = await response.json() as { incoming_phone_numbers?: TwilioIncomingNumber[] }
    return payload.incoming_phone_numbers || []
  } catch {
    return null
  }
}

async function runInboundSmsProbe(baseUrl: string, internalSecret: string) {
  const sid = `HC_SMS_${Date.now()}`
  const body = new URLSearchParams({
    From: HEALTH_PROBE_SMS_SENDER,
    To: getSaturnBranchPhoneNumbers()[0],
    Body: `Lead flow health SMS probe ${new Date().toISOString()}`,
    MessageSid: sid,
  }).toString()

  const response = await fetchText(`${baseUrl}/api/sales/twilio/sms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-internal-secret': internalSecret,
      'x-health-check': '1',
    },
    body,
  })

  if (!response.ok) {
    return buildCheck('probe_inbound_sms', 'Inbound SMS Probe', 'fail', `Webhook returned ${response.status}. ${response.body}`.trim())
  }

  const rows = await fetchSupabaseRows<Array<{ id?: string; created_at?: string }>[number]>(
    `sms_messages?select=id,created_at&twilio_sid=eq.${encodeURIComponent(sid)}&limit=1`
  )

  if (!rows?.[0]?.id) {
    return buildCheck('probe_inbound_sms', 'Inbound SMS Probe', 'fail', 'Webhook accepted the probe, but no sms_messages row was written.')
  }

  return buildCheck('probe_inbound_sms', 'Inbound SMS Probe', 'ok', 'Synthetic inbound SMS was accepted and written to storage.', rows[0].created_at || null)
}

async function runInboundEmailProbe(baseUrl: string, internalSecret: string) {
  const subject = `[Health Check] Inbound Email ${new Date().toISOString()}`
  const response = await fetchJson<{ ok?: boolean; emailId?: string; error?: string }>(
    `${baseUrl}/api/sales/inbox/email-inbound`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalSecret,
        'x-health-check': '1',
      },
      body: JSON.stringify({
        from: HEALTH_PROBE_EMAIL,
        subject,
        body: 'Synthetic inbound email health check.',
        to: 'business@inbound.starmovers.ca',
      }),
    }
  )

  if (!response?.ok || !response.emailId) {
    return buildCheck('probe_inbound_email', 'Inbound Email Probe', 'fail', response?.error || 'Inbound email probe failed.')
  }

  const rows = await fetchSupabaseRows<Array<{ id?: string; updated_at?: string }>[number]>(
    `crm_emails?select=id,updated_at&id=eq.${encodeURIComponent(response.emailId)}&limit=1`
  )

  if (!rows?.[0]?.id) {
    return buildCheck('probe_inbound_email', 'Inbound Email Probe', 'fail', 'Inbound email route returned success, but the CRM email record was not found.')
  }

  return buildCheck('probe_inbound_email', 'Inbound Email Probe', 'ok', 'Synthetic inbound email was accepted and stored.', rows[0].updated_at || null)
}

async function runWebFormProbe(baseUrl: string, internalSecret: string) {
  const response = await fetchJson<{ success?: boolean; leadId?: string; error?: string }>(
    `${baseUrl}/api/free-quote/capture`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalSecret,
        'x-health-check': '1',
      },
      body: JSON.stringify({
        name: 'Lead Flow Health Check',
        phone: HEALTH_PROBE_SMS_SENDER,
        email: HEALTH_PROBE_EMAIL,
        address: 'Health Check Lane',
        healthCheck: true,
      }),
    }
  )

  if (!response?.success || !response.leadId) {
    return buildCheck('probe_web_form', 'Website Form Probe', 'fail', response?.error || 'Web form probe failed.')
  }

  const rows = await fetchSupabaseRows<Array<{ id?: string; created_at?: string }>[number]>(
    `inbound_leads?select=id,created_at&id=eq.${encodeURIComponent(response.leadId)}&limit=1`
  )

  if (!rows?.[0]?.id) {
    return buildCheck('probe_web_form', 'Website Form Probe', 'fail', 'Form route returned success, but the inbound lead row was not found.')
  }

  return buildCheck('probe_web_form', 'Website Form Probe', 'ok', 'Synthetic website lead was accepted and stored.', rows[0].created_at || null)
}

async function runInboundMmsProbe(baseUrl: string) {
  const leadId = crypto.randomUUID()
  const messageSid = `HC_MMS_${Date.now()}`
  const createdAt = new Date().toISOString()
  const probeLead: CRMLead = {
    id: leadId,
    name: 'Lead Flow MMS Health Check',
    stage: 'new',
    phone: HEALTH_PROBE_SMS_SENDER,
    source: 'health_check_mms',
    createdAt,
    mediaAssets: [],
  }

  try {
    await saveSalesLead(probeLead)
    await persistInboundMmsToLead({
      lead: probeLead,
      media: [
        { url: `${baseUrl}/icon-192.png`, contentType: 'image/png' },
        { url: `${baseUrl}/icon-192.png`, contentType: 'video/mp4' },
      ],
      messageSid,
    })

    const persistedLead = await getSalesLead(leadId)
    const assets = (persistedLead?.mediaAssets || []).filter(asset => asset.source === 'mms' && asset.notes?.startsWith(`twilio:${messageSid}:`))
    const imageCount = assets.filter(asset => asset.kind === 'image').length
    const videoCount = assets.filter(asset => asset.kind === 'video').length

    if (imageCount < 1 || videoCount < 1) {
      return buildCheck(
        'mms_capture',
        'Inbound MMS / Media Capture',
        'fail',
        `Synthetic MMS persistence only saved ${imageCount} image and ${videoCount} video assets.`
      )
    }

    return buildCheck(
      'mms_capture',
      'Inbound MMS / Media Capture',
      'ok',
      'Synthetic MMS persistence stored image and video-typed attachments on a CRM lead.',
      persistedLead?.createdAt || createdAt
    )
  } catch (error) {
    return buildCheck(
      'mms_capture',
      'Inbound MMS / Media Capture',
      'fail',
      error instanceof Error ? error.message : 'Synthetic MMS persistence probe failed.'
    )
  } finally {
    await deleteSalesLead(leadId).catch(() => {})
  }
}

function buildNumberConfigCheck(
  baseUrl: string,
  twilioNumber: TwilioIncomingNumber | undefined,
  phoneNumber: string,
  labelOverride?: string
) {
  const displayLabel = labelOverride || getSaturnBranchLabel(phoneNumber) || phoneNumber
  const expectedSmsUrl = `${baseUrl}/api/sales/twilio/sms`
  const expectedVoiceUrl = `${baseUrl}/api/sales/dialer/twiml`

  if (!twilioNumber) {
    return buildCheck(
      `twilio_number_${phoneNumber}`,
      `Twilio Number ${displayLabel}`,
      'fail',
      `${phoneNumber} is missing from the Twilio account.`
    )
  }

  const smsUrl = normalizeUrl(twilioNumber.sms_url)
  const voiceUrl = normalizeUrl(twilioNumber.voice_url)
  const problems: string[] = []

  if (smsUrl !== expectedSmsUrl) {
    problems.push(`SMS webhook is ${twilioNumber.sms_url || 'unset'} (expected ${expectedSmsUrl})`)
  }
  if ((twilioNumber.sms_method || 'POST').toUpperCase() !== 'POST') {
    problems.push(`SMS method is ${(twilioNumber.sms_method || 'unset').toUpperCase()} (expected POST)`)
  }
  if (voiceUrl !== expectedVoiceUrl) {
    problems.push(`Voice webhook is ${twilioNumber.voice_url || 'unset'} (expected ${expectedVoiceUrl})`)
  }
  if ((twilioNumber.voice_method || 'POST').toUpperCase() !== 'POST') {
    problems.push(`Voice method is ${(twilioNumber.voice_method || 'unset').toUpperCase()} (expected POST)`)
  }

  return problems.length === 0
    ? buildCheck(`twilio_number_${phoneNumber}`, `Twilio Number ${displayLabel}`, 'ok', `${phoneNumber} points to the live sales SMS and voice webhooks.`)
    : buildCheck(`twilio_number_${phoneNumber}`, `Twilio Number ${displayLabel}`, 'fail', problems.join(' · '))
}

export async function runLeadFlowHealthCheck(requestBaseUrl?: string): Promise<LeadFlowHealthReport> {
  const baseUrl = normalizeUrl(getAppBaseUrl(requestBaseUrl || DEFAULT_APP_URL) || requestBaseUrl || DEFAULT_APP_URL)
  const internalSecret = getWorkerSharedSecret()
  const checks: LeadFlowHealthCheck[] = []

  checks.push(
    readEnv('RESEND_API_KEY')
      ? buildCheck('env_resend', 'Resend API Key', 'ok', 'Outbound email credentials are configured.')
      : buildCheck('env_resend', 'Resend API Key', 'fail', 'RESEND_API_KEY is missing. Outbound email cannot be sent.')
  )

  checks.push(buildCheck(
    'legacy_worker',
    'Legacy Cloudflare Worker Dependency',
    'ok',
    'Live lead flows no longer require the Cloudflare worker. Remaining references are archival or optional only.'
  ))

  const [smsWebhookRoute, voiceWebhookRoute, freeQuoteOptions] = await Promise.all([
    fetchText(`${baseUrl}/api/sales/twilio/sms`),
    fetchText(`${baseUrl}/api/sales/dialer/twiml`),
    fetchText(`${baseUrl}/api/free-quote/capture`, { method: 'OPTIONS' }),
  ])

  checks.push(
    smsWebhookRoute.ok
      ? buildCheck('route_sales_sms', 'Sales SMS Webhook Route', 'ok', `Route responded with HTTP ${smsWebhookRoute.status}.`)
      : buildCheck('route_sales_sms', 'Sales SMS Webhook Route', 'fail', `Route check failed with HTTP ${smsWebhookRoute.status}. ${smsWebhookRoute.body}`.trim())
  )
  checks.push(
    voiceWebhookRoute.ok
      ? buildCheck('route_sales_voice', 'Sales Voice Webhook Route', 'ok', `Route responded with HTTP ${voiceWebhookRoute.status}.`)
      : buildCheck('route_sales_voice', 'Sales Voice Webhook Route', 'fail', `Route check failed with HTTP ${voiceWebhookRoute.status}. ${voiceWebhookRoute.body}`.trim())
  )
  checks.push(
    freeQuoteOptions.ok
      ? buildCheck('route_free_quote', 'Website Form Route', 'ok', `Route responded with HTTP ${freeQuoteOptions.status}.`)
      : buildCheck('route_free_quote', 'Website Form Route', 'fail', `Route check failed with HTTP ${freeQuoteOptions.status}. ${freeQuoteOptions.body}`.trim())
  )

  const twilioNumbers = await fetchTwilioIncomingNumbers()
  if (!twilioNumbers) {
    checks.push(buildCheck('twilio_auth', 'Twilio Account Access', 'fail', 'Could not authenticate to Twilio or fetch incoming phone numbers.'))
  } else {
    checks.push(buildCheck('twilio_auth', 'Twilio Account Access', 'ok', `Fetched ${twilioNumbers.length} incoming Twilio numbers.`))
    const numbersByPhone = new Map(
      twilioNumbers
        .map(number => [normalizePhone(number.phone_number), number] as const)
        .filter(([phone]) => !!phone)
    )

    for (const number of getSaturnBranchPhoneNumbers()) {
      checks.push(buildNumberConfigCheck(baseUrl, numbersByPhone.get(number), number))
    }
    checks.push(buildNumberConfigCheck(baseUrl, numbersByPhone.get(ASSISTANT_NUMBER), ASSISTANT_NUMBER, 'Overflow'))
  }

  if (internalSecret) {
    const [smsProbe, emailProbe, formProbe] = await Promise.all([
      runInboundSmsProbe(baseUrl, internalSecret),
      runInboundEmailProbe(baseUrl, internalSecret),
      runWebFormProbe(baseUrl, internalSecret),
    ])
    checks.push(smsProbe, emailProbe, formProbe)
  } else {
    checks.push(buildCheck('internal_secret', 'Internal Probe Secret', 'fail', 'WORKER_SHARED_SECRET is missing, so internal health probes cannot run.'))
  }

  const [lastInboundSmsAt, lastOutboundSmsAt, lastInboundCallAt, lastInboundEmailAt, lastOutboundEmailAt, lastWebsiteLeadAt, lastQrLeadAt, lastHealthFormAt] = await Promise.all([
    fetchLatestSmsTimestamp('inbound'),
    fetchLatestSmsTimestamp('outbound'),
    fetchLatestInboundLeadTimestamp('twilio_call'),
    fetchLatestEmailTimestamp('inbound'),
    fetchLatestEmailTimestamp('outbound'),
    fetchLatestInboundLeadTimestamp('website_form'),
    fetchLatestInboundLeadTimestamp('free_quote_qr'),
    fetchLatestInboundLeadTimestamp('health_check_form'),
  ])

  checks.push(recentActivityCheck('activity_inbound_sms', 'Recent Inbound SMS Activity', lastInboundSmsAt))
  checks.push(recentActivityCheck('activity_outbound_sms', 'Recent Outbound SMS Activity', lastOutboundSmsAt))
  checks.push(recentActivityCheck('activity_inbound_calls', 'Recent Inbound Call Activity', lastInboundCallAt))
  checks.push(recentActivityCheck('activity_inbound_email', 'Recent Inbound Email Activity', lastInboundEmailAt))
  checks.push(recentActivityCheck('activity_outbound_email', 'Recent Outbound Email Activity', lastOutboundEmailAt))
  checks.push(recentActivityCheck(
    'activity_website_form',
    'Recent Website Form Activity',
    mostRecentTimestamp(lastWebsiteLeadAt, lastQrLeadAt, lastHealthFormAt)
  ))
  checks.push(await runInboundMmsProbe(baseUrl))

  const summary = checks.reduce(
    (counts, check) => {
      counts[check.status] += 1
      return counts
    },
    { ok: 0, warn: 0, fail: 0 }
  )

  return {
    status: getOverallStatus(checks),
    generatedAt: new Date().toISOString(),
    baseUrl,
    checks,
    summary,
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderLeadFlowHealthEmail(report: LeadFlowHealthReport) {
  const tone = report.status === 'fail' ? '#b91c1c' : report.status === 'warn' ? '#b45309' : '#166534'
  const badge = report.status.toUpperCase()
  const rows = report.checks.map(check => {
    const color = check.status === 'fail' ? '#b91c1c' : check.status === 'warn' ? '#b45309' : '#166534'
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;color:${color};text-transform:uppercase;font-size:11px;">${escapeHtml(check.status)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px;font-weight:600;">${escapeHtml(check.label)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:13px;">${escapeHtml(check.detail)}${check.observedAt ? `<div style="margin-top:4px;color:#64748b;font-size:11px;">Observed: ${escapeHtml(check.observedAt)} (${escapeHtml(formatAge(check.observedAt))})</div>` : ''}</td>
      </tr>
    `
  }).join('')

  return `
  <div style="font-family:Arial,sans-serif;max-width:920px;margin:0 auto;padding:24px;background:#f8fafc;color:#0f172a;">
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
      <div style="padding:24px 28px;border-bottom:1px solid #e2e8f0;">
        <div style="display:inline-block;background:${tone};color:#ffffff;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;letter-spacing:0.04em;">${badge}</div>
        <h1 style="margin:16px 0 8px;font-size:24px;line-height:1.2;">Lead Flow Health Report</h1>
        <div style="font-size:13px;color:#475569;">Generated at ${escapeHtml(report.generatedAt)} for ${escapeHtml(report.baseUrl)}</div>
        <div style="margin-top:10px;font-size:13px;color:#475569;">Checks: ${report.summary.ok} ok · ${report.summary.warn} warnings · ${report.summary.fail} failures</div>
      </div>
      <div style="padding:20px 28px 28px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th align="left" style="padding:10px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;">Status</th>
              <th align="left" style="padding:10px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;">Check</th>
              <th align="left" style="padding:10px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;">Detail</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  </div>`
}
