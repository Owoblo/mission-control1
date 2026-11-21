import './gta-email-recovery-runtime.mjs'
import fs from 'node:fs/promises'
const account=process.env.TWILIO_ACCOUNT_SID.trim();const headers={Authorization:'Basic '+Buffer.from(account+':'+process.env.TWILIO_AUTH_TOKEN.trim()).toString('base64')};const base='https://api.twilio.com/2010-04-01/Accounts/'+account;
const results=await Promise.all([fetch(base+'/IncomingPhoneNumbers.json?PhoneNumber='+encodeURIComponent('+15486391428'),{headers}),fetch(base+'/Balance.json',{headers})]);for(const r of results)if(!r.ok)throw Error('Twilio check '+r.status)
const line=(await results[0].json()).incoming_phone_numbers;const balance=await results[1].json();if(line.length!==1||!line[0].capabilities.sms)throw Error('London sender not available')
const result={at:new Date().toISOString(),number:line[0].phone_number,sms_capable:line[0].capabilities.sms,inbound_webhook:line[0].sms_url,status:line[0].status,balance:balance.balance,currency:balance.currency};await fs.writeFile('artifacts/london-sarnia-subcontractor-recruiting-20261015/line-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
