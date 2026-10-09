import { createVerify } from 'node:crypto'

type Envelope = Record<string, string>
export async function verifySesInboundSns(envelope: Envelope, topic: string) {
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

