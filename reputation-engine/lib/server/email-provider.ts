import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import { readEnv } from '@/lib/server/runtime'

type EmailProviderName = 'ses'

export interface ProviderEmailPayload {
  from: string
  to: string | string[]
  subject: string
  html?: string
  text?: string
  replyTo?: string
  headers?: Record<string, string>
  attachments?: Array<{ filename: string; content: string }>
  tags?: Record<string, string>
  trackingMode?: 'deliverability' | 'engagement'
}

export interface ProviderEmailReceipt {
  provider: EmailProviderName
  messageId: string | null
  accepted: boolean
  raw?: unknown
}

function selectedProvider(): EmailProviderName { return 'ses' }

function requireEmailBody(payload: Pick<ProviderEmailPayload, 'html' | 'text'>) {
  if (!payload.html && !payload.text) throw new Error('Email requires html or text body')
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
    maxAttempts: 1, // SES has no send idempotency key; never blindly retry an uncertain send.
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
    throw new Error('SES production access is not confirmed. Verify AWS approval and SES_PRODUCTION_ACCESS_CONFIRMED before sending outreach.')
  }

  const client = sesClient()
  const configurationSetName = sesConfigurationSetForPayload(payload)

  const result = await client.send(new SendEmailCommand({
    FromEmailAddress: payload.from,
    Destination: { ToAddresses: Array.isArray(payload.to) ? payload.to : [payload.to] },
    ReplyToAddresses: payload.replyTo ? [payload.replyTo] : undefined,
    ConfigurationSetName: configurationSetName,
    EmailTags: payload.tags
      ? Object.entries(payload.tags).map(([Name, Value]) => ({ Name, Value }))
      : undefined,
    Content: {
      Simple: {
        Subject: { Data: payload.subject, Charset: 'UTF-8' },
        Attachments: payload.attachments?.map(a => ({ FileName: a.filename, RawContent: Buffer.from(a.content, 'base64'), ContentTransferEncoding: 'BASE64' as const })),
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
  const receipt = await sendWithSes(payload)
  if (!receipt.accepted || !receipt.messageId) throw new Error('SES did not confirm acceptance')
  return receipt
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

/** Partnership sequence email is SES; never fall back to a transactional provider. */
export async function sendOutreachEmail(payload: ProviderEmailPayload): Promise<ProviderEmailReceipt> {
  requireEmailBody(payload)
  const receipt = await sendWithSes(payload)
  if (!receipt.accepted || !receipt.messageId) throw new Error("SES did not return an acceptance receipt")
  return receipt
}

/** Sales/quote delivery is configured independently from partnership outreach. */
export function salesEmailConfigured() {
  return Boolean(sesProductionAccessConfirmed() && readEnv('AWS_ACCESS_KEY_ID') && readEnv('AWS_SECRET_ACCESS_KEY') && readEnv('SALES_EMAIL_FROM'))
}

export async function sendSalesEmail(payload: Omit<ProviderEmailPayload, 'from' | 'replyTo'>): Promise<ProviderEmailReceipt> {
  requireEmailBody(payload)
  const from = readEnv('SALES_EMAIL_FROM')
  if (!from) throw new Error('SALES_EMAIL_FROM must be a verified SES sender')
  const message = { ...payload, from, replyTo: readEnv('SALES_EMAIL_REPLY_TO') || 'business@starmovers.ca', trackingMode: 'deliverability' as const }
  const receipt = await sendProviderEmail(message)
  if (!receipt.accepted || !receipt.messageId) throw new Error('Email provider did not confirm acceptance')
  return receipt
}
