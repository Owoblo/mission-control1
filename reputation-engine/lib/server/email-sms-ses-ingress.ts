import { createVerify } from 'node:crypto'
import PostalMime, { addressParser } from 'postal-mime'
import { parseReplyAddress } from './email-sms-reply-policy'

type Envelope = Record<string, string>
export async function verifyReplySns(envelope: Envelope, topic: string) {
  if (!topic || envelope.TopicArn !== topic || !['Notification','SubscriptionConfirmation'].includes(envelope.Type) || !['1','2'].includes(envelope.SignatureVersion)) return false
  const timestamp = Date.parse(envelope.Timestamp)
  if (!Number.isFinite(timestamp) || timestamp > Date.now()+60000 || timestamp < Date.now()-86400000) return false
  const region = /^arn:aws:sns:([a-z0-9-]+):\d{12}:[\w-]+$/.exec(topic)?.[1]
  if (!region) return false
  let url: URL
  try { url = new URL(envelope.SigningCertURL) } catch { return false }
  if (url.origin !== `https://sns.${region}.amazonaws.com` || !/^\/SimpleNotificationService-[a-zA-Z0-9]+\.pem$/.test(url.pathname) || url.search || url.username || url.password) return false
  const fields = envelope.Type==='Notification' ? ['Message','MessageId',...(envelope.Subject?['Subject']:[]),'Timestamp','TopicArn','Type'] : ['Message','MessageId','SubscribeURL','Timestamp','Token','TopicArn','Type']
  if (fields.some(key=>typeof envelope[key]!=='string'||!envelope[key])) return false
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000)})
  if(!response.ok)return false
  const verifier=createVerify(envelope.SignatureVersion==='2'?'RSA-SHA256':'RSA-SHA1')
  verifier.update(fields.map(key=>`${key}\n${envelope[key]}\n`).join(''));verifier.end()
  try { return verifier.verify(await response.text(),envelope.Signature,'base64') } catch { return false }
}

/** Call ONLY after verifying the SNS signature and exact private receiving topic. */
export async function decodeAuthenticatedSesReply(message: any, domain: string) {
  if(message.notificationType!=='Received'||!message.mail?.messageId||!message.receipt)throw Error('Not an SES receiving event')
  const receipt=message.receipt
  for(const verdict of ['dkimVerdict','dmarcVerdict','spamVerdict','virusVerdict'])if(receipt[verdict]?.status!=='PASS')throw Error('Mail authentication or content verdict failed')
  if(typeof message.content!=='string'||message.content.length>250000)throw Error('Missing or oversized raw email')
  // SES UTF-8 notifications omit encoding (see AWS receiving-notification example).
  if(receipt.action?.type!=='SNS')throw Error('Not an SNS content action')
  const encoding=String(receipt.action.encoding||'UTF-8').toUpperCase()
  if(!['UTF-8','UTF8','BASE64'].includes(encoding))throw Error('Unknown SES content encoding: '+encoding.slice(0,30))
  const content=encoding==='BASE64'?Buffer.from(message.content,'base64'):message.content
  const mail=await PostalMime.parse(content)
  const fromHeaders=mail.headers.filter(h=>h.key.toLowerCase()==='from')
  if(fromHeaders.length!==1||addressParser(fromHeaders[0].value,{flatten:true}).length!==1||!mail.from?.address||mail.from.address.includes(','))throw Error('Ambiguous sender')
  const destinations=(receipt.recipients||[]).filter((address:unknown)=>typeof address==='string'&&parseReplyAddress(address,domain))
  if(destinations.length!==1)throw Error('Ambiguous SMS reply destination')
  const header=(name:string)=>mail.headers.find(h=>h.key.toLowerCase()===name)?.value||''
  if(header('list-id')||/^(bulk|junk|list)$/i.test(header('precedence')))throw Error('List or bulk message cannot send SMS')
  return {to:destinations[0],from:mail.from.address.toLowerCase(),authenticatedSender:mail.from.address.toLowerCase(),authenticationPassed:true,messageId:'ses:'+message.mail.messageId,text:mail.text||'',autoSubmitted:header('auto-submitted'),attachments:mail.attachments.length}
}
