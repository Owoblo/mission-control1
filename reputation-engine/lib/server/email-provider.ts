import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import { Resend } from 'resend'
import { readEnv } from '@/lib/server/runtime'

type EmailProviderName = 'resend' | 'ses'

export interface ProviderEmailPayload {
  from: string
  to: string
  subject: string
  html?: string
  text?: string
  replyTo?: string
  headers?: Record<string, string>
  tags?: Record<string, string>
  trackingMode?: 'deliverability' | 'engagement'
}

export interface ProviderEmailReceipt {
  provider: EmailProviderName
  messageId: string | null
  accepted: boolean
  raw?: unknown
}

function selectedProvider(): EmailProviderName {
  const value = readEnv('PARTNERSHIP_EMAIL_PROVIDER').toLowerCase()
  return value === 'ses' ? 'ses' : 'resend'
}

function requireEmailBody(payload: ProviderEmailPayload) {
  if (!payload.html && !payload.text) {
    throw new Error('Email requires html or text body')
  }
}

async function sendWithResend(payload: ProviderEmailPayload): Promise<ProviderEmailReceipt> {
  const apiKey = readEnv('RESEND_API_KEY')
  if (!apiKey) throw new Error('RESEND_API_KEY not configured')

  const resend = new Resend(apiKey)
  const email: Record<string, unknown> = {
    from: payload.from,
    to: payload.to,
    subject: payload.subject,
  }
  if (payload.html) email.html = payload.html
  if (payload.text) email.text = payload.text
  if (payload.replyTo) email.replyTo = payload.replyTo
  if (payload.headers) email.headers = payload.headers
  if (payload.tags) {
    email.tags = Object.entries(payload.tags).map(([name, value]) => ({ name, value }))
  }

  const result = await resend.emails.send(email as unknown as Parameters<typeof resend.emails.send>[0])

  if (result.error) throw new Error(`Resend: ${result.error.message}`)

  return {
    provider: 'resend',
    messageId: result.data?.id ?? null,
    accepted: Boolean(result.data?.id),
    raw: result.data,
  }
}

function sesClient() {
  const region = readEnv('AWS_REGION') || readEnv('AWS_DEFAULT_REGION') || 'ca-central-1'
  const accessKeyId = readEnv('AWS_ACCESS_KEY_ID')
  const secretAccessKey = readEnv('AWS_SECRET_ACCESS_KEY')

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required for SES sending')
  }

  return new SESv2Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  })
}

function sesProductionAccessConfirmed() {
  return ['true', '1', 'yes'].includes(readEnv('SES_PRODUCTION_ACCESS_CONFIRMED').toLowerCase())
}

function sesConfigurationSetForPayload(payload: ProviderEmailPayload) {
  if (payload.trackingMode === 'deliverability') {
    return readEnv('AWS_SES_DELIVERABILITY_CONFIGURATION_SET') || readEnv('AWS_SES_CONFIGURATION_SET') || undefined
  }
  return readEnv('AWS_SES_CONFIGURATION_SET') || undefined
}

async function sendWithSes(payload: ProviderEmailPayload): Promise<ProviderEmailReceipt> {
  if (!sesProductionAccessConfirmed()) {
    throw new Error('SES production access is not confirmed. Keep PARTNERSHIP_EMAIL_PROVIDER on resend until AWS approves production access, then set SES_PRODUCTION_ACCESS_CONFIRMED=true.')
  }

  const client = sesClient()
  const configurationSetName = sesConfigurationSetForPayload(payload)

  const result = await client.send(new SendEmailCommand({
    FromEmailAddress: payload.from,
    Destination: { ToAddresses: [payload.to] },
    ReplyToAddresses: payload.replyTo ? [payload.replyTo] : undefined,
    ConfigurationSetName: configurationSetName,
    EmailTags: payload.tags
      ? Object.entries(payload.tags).map(([Name, Value]) => ({ Name, Value }))
      : undefined,
    Content: {
      Simple: {
        Subject: { Data: payload.subject, Charset: 'UTF-8' },
        Headers: payload.headers
          ? Object.entries(payload.headers).map(([Name, Value]) => ({ Name, Value }))
          : undefined,
        Body: {
          ...(payload.text ? { Text: { Data: payload.text, Charset: 'UTF-8' } } : {}),
          ...(payload.html ? { Html: { Data: payload.html, Charset: 'UTF-8' } } : {}),
        },
      },
    },
  }))

  return {
    provider: 'ses',
    messageId: result.MessageId ?? null,
    accepted: Boolean(result.MessageId),
    raw: result,
  }
}

export async function sendProviderEmail(payload: ProviderEmailPayload): Promise<ProviderEmailReceipt> {
  requireEmailBody(payload)
  const provider = selectedProvider()
  return provider === 'ses' ? sendWithSes(payload) : sendWithResend(payload)
}

export function getConfiguredEmailProvider(): EmailProviderName {
  return selectedProvider()
}

export function getSesLaunchReadiness() {
  return {
    provider: selectedProvider(),
    productionAccessConfirmed: sesProductionAccessConfirmed(),
    engagementConfigurationSet: readEnv('AWS_SES_CONFIGURATION_SET') || null,
    deliverabilityConfigurationSet: readEnv('AWS_SES_DELIVERABILITY_CONFIGURATION_SET') || readEnv('AWS_SES_CONFIGURATION_SET') || null,
  }
}
