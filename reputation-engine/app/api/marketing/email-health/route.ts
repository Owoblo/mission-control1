import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { readEnv } from '@/lib/server/runtime'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getConfiguredEmailProvider, getSesLaunchReadiness } from '@/lib/server/email-provider'

export const dynamic = 'force-dynamic'

function present(name: string) {
  return Boolean(readEnv(name))
}

export async function GET() {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = getConfiguredEmailProvider()
  const launch = getSesLaunchReadiness()
  const domain = readEnv('AWS_SES_OUTREACH_DOMAIN') || 'saturnstarmovers.ca'
  const maxPerRun = Number(readEnv('PARTNERSHIP_EMAIL_MAX_PER_RUN') || 10) || 10
  const firstTouchPlainText = ['true', '1', 'yes', 'on', ''].includes(readEnv('PARTNERSHIP_EMAIL_FIRST_TOUCH_PLAIN_TEXT').toLowerCase())
  const checks = [
    { key: 'provider', label: 'Selected email provider', ok: true, value: provider },
    { key: 'partnership_email', label: 'Partnership from email', ok: present('PARTNERSHIP_EMAIL'), value: readEnv('PARTNERSHIP_EMAIL') || null },
    { key: 'reply_to', label: 'Partnership reply-to email', ok: present('PARTNERSHIP_EMAIL_REPLY_TO') || present('PARTNERSHIP_EMAIL'), value: readEnv('PARTNERSHIP_EMAIL_REPLY_TO') || readEnv('PARTNERSHIP_EMAIL') || null },
    { key: 'resend_key', label: 'Resend API key', ok: provider !== 'resend' || present('RESEND_API_KEY') },
    { key: 'aws_region', label: 'AWS region', ok: provider !== 'ses' || present('AWS_REGION') || present('AWS_DEFAULT_REGION'), value: readEnv('AWS_REGION') || readEnv('AWS_DEFAULT_REGION') || null },
    { key: 'aws_access_key', label: 'AWS access key', ok: provider !== 'ses' || present('AWS_ACCESS_KEY_ID') },
    { key: 'aws_secret_key', label: 'AWS secret key', ok: provider !== 'ses' || present('AWS_SECRET_ACCESS_KEY') },
    { key: 'ses_configuration_set', label: 'SES configuration set', ok: provider !== 'ses' || present('AWS_SES_CONFIGURATION_SET'), value: readEnv('AWS_SES_CONFIGURATION_SET') || null },
    { key: 'ses_production_confirmed', label: 'SES production access confirmed switch', ok: provider !== 'ses' || launch.productionAccessConfirmed, value: launch.productionAccessConfirmed },
    { key: 'outreach_domain', label: 'Outreach domain', ok: Boolean(domain), value: domain },
    { key: 'first_touch_plain_text', label: 'First touch plain text mode', ok: firstTouchPlainText, value: firstTouchPlainText },
    { key: 'zero_bounce', label: 'External email verification API', ok: true, value: present('ZEROBOUNCE_API_KEY') ? 'configured' : 'local checks only' },
    { key: 'max_per_run', label: 'Email max per worker run', ok: maxPerRun > 0 && maxPerRun <= 25, value: maxPerRun },
    { key: 'public_app_url', label: 'Public app URL for unsubscribe links', ok: present('PUBLIC_APP_URL') || present('NEXT_PUBLIC_APP_URL'), value: readEnv('PUBLIC_APP_URL') || readEnv('NEXT_PUBLIC_APP_URL') || null },
  ]

  return NextResponse.json({
    ok: checks.every(check => check.ok),
    provider,
    domain,
    launch,
    safeToUseSes: provider === 'ses' && checks.every(check => check.ok),
    checks,
  })
}
