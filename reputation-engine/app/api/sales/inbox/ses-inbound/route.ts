import { SNSClient, ConfirmSubscriptionCommand } from '@aws-sdk/client-sns'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import PostalMime from 'postal-mime'
import { readEnv, getWorkerSharedSecret } from '@/lib/server/runtime'
import { verifySesInboundSns } from '@/lib/server/ses-inbound-signature'
import { POST as importEmail } from '../email-inbound/route'

export const maxDuration = 60
export async function POST(request: Request) {
  const raw = await request.text()
  if (raw.length > 300000) return Response.json({ error: 'Envelope too large' }, { status: 413 })
  try {
    const envelope = JSON.parse(raw)
    const topic = readEnv('SES_INBOUND_TOPIC_ARN')
    if (!await verifySesInboundSns(envelope, topic)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const region = topic.split(':')[3]
    if (envelope.Type === 'SubscriptionConfirmation') {
      await new SNSClient({ region, maxAttempts: 1 }).send(new ConfirmSubscriptionCommand({ TopicArn: topic, Token: envelope.Token, AuthenticateOnUnsubscribe: 'true' }))
      return Response.json({ subscribed: true })
    }
    const message = JSON.parse(envelope.Message)
    const action = message.receipt?.action
    if (message.notificationType !== 'Received' || !message.mail?.messageId || action?.type !== 'S3') return Response.json({ ignored: true })
    const bucket = readEnv('SES_INBOUND_BUCKET')
    if (!bucket || action.bucketName !== bucket || action.objectKey !== `incoming/${message.mail.messageId}`) return Response.json({ error: 'Unexpected email storage' }, { status: 400 })
    const recipients: string[] = message.receipt.recipients || []
    const recipient = recipients.find(x => /^[^@]+@inbound\.starmovers\.ca$/i.test(x))
    if (!recipient) return Response.json({ ignored: true })
    if (['spamVerdict', 'virusVerdict'].some(key => message.receipt[key]?.status === 'FAIL')) {
      console.error('SES inbound message retained for review', { messageId: message.mail.messageId, reason: 'content_scan' })
      return Response.json({ quarantined: true })
    }
    const object = await new S3Client({ region }).send(new GetObjectCommand({ Bucket: bucket, Key: action.objectKey }))
    if (!object.Body || (object.ContentLength || 0) > 40000000) throw new Error('Missing or oversized email')
    const mail = await PostalMime.parse(await object.Body.transformToByteArray())
    if (!mail.from?.address) throw new Error('Email sender missing')
    const secret = getWorkerSharedSecret()
    if (!secret) throw new Error('Internal mail import authentication is unavailable')
    const response = await importEmail(new Request('https://internal.invalid/api/sales/inbox/email-inbound', {
      method: 'POST', headers: { 'x-internal-secret': secret, ...(recipient.toLowerCase() === 'ses-healthcheck@inbound.starmovers.ca' ? { 'x-health-check': '1' } : {}) },
      body: JSON.stringify({ from: mail.from.address, fromName: mail.from.name, to: recipient, subject: mail.subject, body: mail.text || mail.html || '(attachment-only email)', htmlBody: mail.html, receivedAt: message.mail.timestamp, providerMessageId: message.mail.messageId }),
    }))
    if (!response.ok) throw new Error('CRM email import failed')
    return response
  } catch (error) {
    console.error('SES inbound email failed', error instanceof Error ? error.message : 'Unknown error')
    return Response.json({ error: 'Email retained for retry' }, { status: 503 })
  }
}
