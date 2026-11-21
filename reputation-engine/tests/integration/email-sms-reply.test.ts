import test from 'node:test'
import assert from 'node:assert/strict'
import { POST } from '../../app/api/marketing/sms/email-reply/route'

const token = 'ab'.repeat(20)
const input = { to:`sms+${token}@reply.example.com`, from:'john@example.com', authenticatedSender:'john@example.com', authenticationPassed:true, messageId:'<test@example.com>', text:'Thanks!\n\nOn Tuesday John wrote:\nold text' }
function request(body = input, secret = 'test-only-secret') { return new Request('https://example.com/api/marketing/sms/email-reply',{method:'POST',headers:{'x-email-sms-secret':secret},body:JSON.stringify(body)}) }

test('email bridge fails closed, claims atomically, and routes through shared Twilio execution', async () => {
  const priorEnv = {...process.env}; const originalFetch=global.fetch
  Object.assign(process.env,{EMAIL_SMS_REPLY_ENABLED:'true',EMAIL_SMS_INGRESS_SECRET:'test-only-secret',EMAIL_SMS_REPLY_DOMAIN:'reply.example.com',EMAIL_SMS_REPLY_OPERATORS:JSON.stringify({'john@example.com':{userId:'operator',name:'John',role:'owner'}}),SUPABASE_URL:'https://db.example.com',NEXT_PUBLIC_SUPABASE_URL:'https://db.example.com',SUPABASE_SERVICE_ROLE_KEY:'fixture',SUPABASE_KEY:'fixture',TWILIO_ACCOUNT_SID:'ACfixture',TWILIO_AUTH_TOKEN:'fixture'})
  let status='pending', sends=0, suppressed=false, changed=false
  const row=()=>({token_hash:'hash',source_touch_id:'source',contact_id:'contact',operator_email:'john@example.com',from_number:'+12268870667',to_number:'+19055182999',created_at:'2026-09-22T00:00:00Z',expires_at:'2030-01-01',status})
  global.fetch=async (url, init) => {
    const u=String(url); const body=init?.body && typeof init.body==='string'?JSON.parse(init.body):null
    const json=(value:unknown,code=200)=>Response.json(value,{status:code})
    if(u.includes('partnership_email_sms_replies')){
      if(init?.method==='PATCH') { if(u.includes('status=eq.pending')&&status!=='pending')return json([]);status=body.status;return json([row()]) }
      return json([row()])
    }
    if(u.includes('market_contacts'))return json([{id:'contact',phone:'+19055182999',city:'Brant',stage:suppressed?'dnc':'connected',do_not_contact:suppressed,partner_company_id:'account',last_inbound_at:'2026-09-22'}])
    if(u.includes('market_touches')&&u.includes('direction=eq.inbound'))return json([{id:'source',notes:'Inbound SMS: Yes please'}])
    if(u.includes('market_touches'))return json(changed&&u.includes('direction=eq.outbound')?[{id:'answered'}]:[])
    if(u.includes('reserve_partnership_action'))return json({allowed:!suppressed,reasons:suppressed?['account_suppressed']:[]})
    if(u.includes('api.twilio.com')&&u.includes('Messages.json')){sends++;assert.match(String(init?.body),/Thanks/);assert.doesNotMatch(String(init?.body),/old.text/);return json({sid:'SMfixture'})}
    if(u.includes('api.twilio.com'))return json({status:'active'})
    return json([])
  }
  try {
    assert.equal((await POST(request(input,'wrong'))).status,401);assert.equal(sends,0)
    assert.equal((await POST(request({...input,authenticationPassed:false}))).status,409);assert.equal(sends,0)
    changed=true;assert.equal((await POST(request())).status,409);assert.equal(sends,0);changed=false
    suppressed=true;assert.equal((await POST(request())).status,409);assert.equal(sends,0)
    suppressed=false;status='pending'
    assert.equal((await POST(request())).status,200);assert.equal(sends,1);assert.equal(status,'accepted')
    assert.equal((await POST(request())).status,409);assert.equal(sends,1)
    process.env.EMAIL_SMS_REPLY_ENABLED='false';assert.equal((await POST(request())).status,503)
  } finally { global.fetch=originalFetch; for(const key of Object.keys(process.env))if(!(key in priorEnv))delete process.env[key];Object.assign(process.env,priorEnv) }
})
