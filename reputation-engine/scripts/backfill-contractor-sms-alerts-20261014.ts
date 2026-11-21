import fs from 'node:fs'
async function main() {
 await import('/Users/owoblo/Downloads/mission-control1/reputation-engine/scripts/gta-email-recovery-runtime.mjs')
 const {parseEnv}=await import('node:util')
 for(const [key,value] of Object.entries(parseEnv(fs.readFileSync('/Users/owoblo/Downloads/mission-control1/reputation-engine/.env.ses.local','utf8')))) if(key.startsWith('AWS_')||key.startsWith('SES_')) process.env[key]=value
 const {SESv2Client,GetAccountCommand}=await import('@aws-sdk/client-sesv2')
 const health=await new SESv2Client({region:process.env.AWS_REGION||'us-east-2'}).send(new GetAccountCommand({}))
 if(!health.ProductionAccessEnabled||!health.SendingEnabled)throw Error('SES account not ready')
 process.env.SES_PRODUCTION_ACCESS_CONFIRMED='true'
 const {contractorInboundEmail}=await import('../lib/server/contractor-inbound')
 const {sendProviderEmail}=await import('../lib/server/email-provider')
 const dir='/Users/owoblo/Downloads/mission-control1/reputation-engine/artifacts/gta-subcontractor-recruiting-20261014/'
 const data=JSON.parse(fs.readFileSync(dir+'verification.json','utf8'))
 for(const row of data.rows.filter((r:any)=>r.replies.length)) {
  const path=dir+`contractor-email-recap-${row.row}.json`
  if(fs.existsSync(path)&&JSON.parse(fs.readFileSync(path,'utf8')).state!=='not_sent_configuration_guard'){console.log(JSON.stringify({name:row.name,skipped:true}));continue}
  const body=row.replies.map((m:any)=>`${new Date(m.at).toLocaleString('en-CA',{timeZone:'America/Toronto'})} ET\n${m.body}`).join('\n\n——\n\n')
  const email=contractorInboundEmail({id:row.contractor_id,company_name:row.name,phone:row.phone},{from:row.phone,to:'+14374650584',body,sid:'recap',at:row.replies.at(-1).at})
  email.html='<p><b>Earlier replies — notification recap.</b> These messages were already received today; this is not a new reply. The conversation link shows the latest history.</p>'+email.html
  fs.writeFileSync(path,JSON.stringify({state:'reserved_no_retry',name:row.name,to:'business@starmovers.ca',subject:email.subject,at:new Date().toISOString()}))
  const receipt=await sendProviderEmail({from:'Saturn Star OS <notifications@saturnstarmovers.ca>',to:'business@starmovers.ca',replyTo:'business@starmovers.ca',...email,trackingMode:'deliverability'})
  fs.writeFileSync(path,JSON.stringify({state:receipt.accepted?'provider_accepted':'not_accepted',name:row.name,to:'business@starmovers.ca',subject:email.subject,messageId:receipt.messageId,at:new Date().toISOString()},null,2))
  if(!receipt.accepted)throw Error('Email not accepted: '+row.name)
  console.log(JSON.stringify({name:row.name,accepted:true,messageId:receipt.messageId}))
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
