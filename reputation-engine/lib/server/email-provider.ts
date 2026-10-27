import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import { readEnv } from '@/lib/server/runtime'
import { reserveEmail, beginEmailAttempt, finishEmailAttempt, addOutreachFooter, prepareReviewedOutreach, emailHash, EmailOutcomeUnknownError, EmailPreflightError, type EmailPurpose, type EmailContext } from './email-delivery'

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
  purpose?: EmailPurpose
  idempotencyKey?: string
  context?: EmailContext
  /** Prepared campaigns must approve the final body after all provider transformations. */
  reviewedBody?: { text?: string; html?: string }
}

export interface ProviderEmailReceipt {
  provider: EmailProviderName
  messageId: string | null
  accepted: boolean
  raw?: unknown
  auditState?: 'recorded' | 'pending_reconciliation'
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
    throw new EmailPreflightError('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required for SES sending')
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
  if (payload.trackingMode !== 'engagement' || payload.purpose === 'outreach') {
    return readEnv('AWS_SES_DELIVERABILITY_CONFIGURATION_SET') || 'saturn-crm-deliverability'
  }
  return readEnv('AWS_SES_CONFIGURATION_SET') || undefined
}

async function sendWithSes(payload: ProviderEmailPayload): Promise<ProviderEmailReceipt> {
  if (!sesProductionAccessConfirmed()) {
    throw new EmailPreflightError('SES production access is not confirmed. Verify AWS approval and SES_PRODUCTION_ACCESS_CONFIRMED before sending outreach.')
  }

  const client = sesClient()
  const configurationSetName = sesConfigurationSetForPayload(payload)
  const reservation = await reserveEmail(payload)
  if (reservation.accepted && reservation.messageId) return {provider:'ses',messageId:reservation.messageId,accepted:true,auditState:'recorded'}
  if (reservation.unsubscribeUrl) {
    payload = payload.reviewedBody
      ? await prepareReviewedOutreach(payload,reservation.from.split('@')[1],reservation.unsubscribeUrl)
      : await addOutreachFooter(payload,reservation.from.split('@')[1],reservation.unsubscribeUrl)
  }
  if (payload.reviewedBody && ((payload.text || '') !== (payload.reviewedBody.text || '') || (payload.html || '') !== (payload.reviewedBody.html || ''))) {
    throw new EmailPreflightError('Final outreach body differs from the approved prepared message; review the required footer before sending')
  }
  const transportFingerprint=emailHash(JSON.stringify({from:payload.from,to:reservation.recipients,subject:payload.subject,html:payload.html||'',text:payload.text||'',headers:payload.headers||{},replyTo:payload.replyTo||'',configurationSetName,reviewedBody:payload.reviewedBody||null,attachments:(payload.attachments||[]).map(a=>[a.filename,emailHash(a.content)])}))
  await beginEmailAttempt(reservation.attemptId,transportFingerprint)
  let result: { MessageId?: string }
  try { result = await client.send(new SendEmailCommand({
    FromEmailAddress: payload.from,
    Destination: { ToAddresses: reservation.recipients },
    ReplyToAddresses: payload.replyTo ? [payload.replyTo] : undefined,
    ConfigurationSetName: configurationSetName,
    EmailTags: Object.entries({...payload.tags,...(payload.context?.contactId ? {contact_id:payload.context.contactId} : {}),crm_send_id:reservation.attemptId}).map(([Name,Value])=>({Name,Value})),
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
  })) } catch (error) {
    const failure = error as { $metadata?: {httpStatusCode?:number}; name?:string }
    const status = failure.$metadata?.httpStatusCode
    const rejected = Boolean(status && status >= 400 && status < 500)
    await finishEmailAttempt(reservation.attemptId,rejected?'rejected':'unknown',undefined,failure.name || 'provider_error').catch(()=>{})
    if (!rejected) throw new EmailOutcomeUnknownError('SES outcome is unknown. Check the send ledger before retrying.')
    throw error
  }
  if (!result.MessageId) {
    await finishEmailAttempt(reservation.attemptId,'unknown',undefined,'missing_provider_receipt').catch(()=>{})
    throw new EmailOutcomeUnknownError('SES did not return an acceptance receipt. Reconcile before retrying.')
  }
  let auditState: 'recorded' | 'pending_reconciliation' = 'recorded'
  try { await finishEmailAttempt(reservation.attemptId,'accepted',result.MessageId) }
  catch { auditState='pending_reconciliation'; console.error('SES accepted an email; send ledger requires reconciliation',{attemptId:reservation.attemptId,messageId:result.MessageId}) }

  return {
    provider: 'ses',
    messageId: result.MessageId ?? null,
    accepted: Boolean(result.MessageId),
    raw: result,
    auditState,
  }
}

export async function sendProviderEmail(payload: ProviderEmailPayload): Promise<ProviderEmailReceipt> {
  requireEmailBody(payload)
  const receipt = await sendWithSes(payload)
  if (!receipt.accepted || !receipt.messageId) throw new Error('SES did not confirm acceptance')
  return receipt
}

/** Use SES for operational alerts even when another provider is configured for other mail. */
export async function sendSesProviderEmail(payload: ProviderEmailPayload): Promise<ProviderEmailReceipt> {
  requireEmailBody(payload)
  return sendWithSes({...payload,purpose:payload.purpose || 'internal'})
}

export function getConfiguredEmailProvider(): EmailProviderName {
  return selectedProvider()
}

export function getSesLaunchReadiness() {
  return {
    provider: selectedProvider(),
    productionAccessConfirmed: sesProductionAccessConfirmed(),
    engagementConfigurationSet: readEnv('AWS_SES_CONFIGURATION_SET') || null,
    deliverabilityConfigurationSet: readEnv('AWS_SES_DELIVERABILITY_CONFIGURATION_SET') || 'saturn-crm-deliverability',
  }
}

/** Partnership sequence email is SES; never fall back to a transactional provider. */
export async function sendOutreachEmail(payload: ProviderEmailPayload): Promise<ProviderEmailReceipt> {
  requireEmailBody(payload)
  const receipt = await sendWithSes({...payload,purpose:'outreach',trackingMode:'deliverability'})
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
