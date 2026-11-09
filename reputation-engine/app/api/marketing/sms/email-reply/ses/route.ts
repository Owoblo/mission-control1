import { SNSClient, ConfirmSubscriptionCommand } from '@aws-sdk/client-sns'
import { readEnv } from '@/lib/server/runtime'
import { verifyReplySns, decodeAuthenticatedSesReply } from '@/lib/server/email-sms-ses-ingress'
import { POST as handleReply } from '../route'

export async function POST(request: Request) {
  const raw=await request.text()
  if(raw.length>350000)return Response.json({error:'Too large'},{status:413})
  try{
    const envelope=JSON.parse(raw)
    const topic=readEnv('EMAIL_SMS_SES_TOPIC_ARN')
    if(!await verifyReplySns(envelope,topic))return Response.json({error:'Invalid SNS signature or topic'},{status:401})
    if(envelope.Type==='SubscriptionConfirmation'){
      const region=topic.split(':')[3]
      await new SNSClient({region,maxAttempts:1}).send(new ConfirmSubscriptionCommand({TopicArn:topic,Token:envelope.Token,AuthenticateOnUnsubscribe:'true'}))
      return Response.json({subscribed:true})
    }
    if(readEnv('EMAIL_SMS_REPLY_ENABLED')!=='true')return Response.json({error:'Disabled'},{status:503})
    const input=await decodeAuthenticatedSesReply(JSON.parse(envelope.Message),readEnv('EMAIL_SMS_REPLY_DOMAIN'))
    const response=await handleReply(new Request('https://internal.invalid/api/marketing/sms/email-reply',{method:'POST',headers:{'x-email-sms-secret':readEnv('EMAIL_SMS_INGRESS_SECRET')},body:JSON.stringify(input)}))
    // Permanent validation/duplicate holds are acknowledged to avoid endless provider replay.
    if(response.status===409)return Response.json({received:true,reviewRequired:true})
    return response
  }catch(error){
    console.error('SES SMS reply ingress rejected',error instanceof Error?error.message:'Invalid email')
    return Response.json({error:'Email ingress requires review'},{status:400})
  }
}
