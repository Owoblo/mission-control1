import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareReviewedOutreach, addOutreachFooter, reserveEmail, reviewedTextHtml, assertReviewedTransportBody } from '../../lib/server/email-delivery'

test('prepared exact-body path preserves approved text and retains one-click headers', async () => {
  const original = global.fetch
  const env = {SUPABASE_URL:'https://db.invalid',SUPABASE_KEY:'fixture',AUTH_SECRET:'fixture',APP_BASE_URL:'https://app.invalid'}
  const before = Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]))
  Object.assign(process.env,env)
  const reservations: any[] = []
  global.fetch = async (input,options) => {
    const url = new URL(String(input))
    assert.equal(url.hostname,'db.invalid')
    if(url.pathname.endsWith('/crm_email_domains'))return Response.json([{postal_address:'123 Fixture Street, Windsor, ON N8N 1A1'}])
    if(url.pathname.endsWith('/email_sender_accounts'))return Response.json([{from_name:'John Owolabi',reply_to_email:'business@starmovers.ca'}])
    if(url.pathname.endsWith('/rpc/reserve_crm_email')){reservations.push(JSON.parse(String(options?.body)));return Response.json({allowed:true,attemptId:'fixture'})}
    throw Error('Unexpected provider request '+url)
  }
  const text = 'Hi,\nI run Saturn Star Movers.\nP.S. Just reply “no thanks” and I will happily honour that.'
  const payload = {from:'John Owolabi <john@saturnstarmovers.ca>',to:'info@example.ca',subject:'Working with Example',text,replyTo:'business@starmovers.ca',reviewedBody:{text},purpose:'outreach' as const,idempotencyKey:'prepared-email:action',context:{source:'prepared-email',contactId:'contact',policyActionKey:'action'}}
  try{
    const prepared = await prepareReviewedOutreach(payload,'saturnstarmovers.ca','https://app.invalid/unsubscribe')
    assert.equal(prepared.text,text)
    assert.equal(prepared.headers['List-Unsubscribe'],'<https://app.invalid/unsubscribe>')
    assert.equal(prepared.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click')
    assert.ok(!prepared.text.includes('https://'))
    assert.ok(!prepared.text.includes('123 Fixture Street'))
    for(const replacement of [text.replace('Saturn Star Movers','Example'),text.replace('reply “no thanks”','get in touch'),text+'\nhttps://example.ca']){
      await assert.rejects(prepareReviewedOutreach({...payload,text:replacement,reviewedBody:{text:replacement}},'saturnstarmovers.ca','https://app.invalid/unsubscribe'))
    }
    await assert.rejects(prepareReviewedOutreach({...payload,text:text+' changed'},'saturnstarmovers.ca','https://app.invalid/unsubscribe'),/approved plain-text/)
    await assert.rejects(prepareReviewedOutreach({...payload,context:{...payload.context,source:'untrusted'}},'saturnstarmovers.ca','https://app.invalid/unsubscribe'),/trusted prepared/)
    const legacy=await addOutreachFooter(payload,'saturnstarmovers.ca','https://app.invalid/unsubscribe')
    assert.ok(legacy.text?.includes('Stop outreach emails: https://app.invalid/unsubscribe'))
    await reserveEmail(payload)
    await reserveEmail({...payload,reviewedBody:undefined})
    assert.notEqual(reservations[0].p_fingerprint,reservations[1].p_fingerprint,'Prepared mode is part of the idempotency fingerprint')
    await assert.rejects(reserveEmail({...payload,replyTo:'wrong@example.ca'}),/registered sender/)
  }finally{
    global.fetch=original
    for(const [key,value]of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value}
  }
})

test('Dexa approved body retains Courage identity and exact copy under SES headers', async () => {
 const text='My name is Courage, and I run Dexa Movers.\nYou can reach me on 548-290-8695.\nP.S. Just reply “no thanks” and I will happily honour that.'
 const payload={text,replyTo:'hello@dexamovers.ca',reviewedBody:{text},idempotencyKey:'prepared-email:ottawa',context:{source:'prepared-email',contactId:'ottawa-contact',policyActionKey:'ottawa'}}
 const prepared=await prepareReviewedOutreach(payload,'dexamovers.ca','https://app.invalid/unsubscribe')
 assert.equal(prepared.text,text);assert.equal(prepared.replyTo,'hello@dexamovers.ca');assert.ok(prepared.headers['List-Unsubscribe'])
 assert.equal(prepared.text.includes('Saturn'),false);assert.equal(prepared.text.includes('http'),false)
 await assert.rejects(prepareReviewedOutreach({...payload,replyTo:'business@starmovers.ca'},'dexamovers.ca','https://app.invalid/unsubscribe'),/Ottawa mailbox/)
 await assert.rejects(prepareReviewedOutreach(payload,'saturnstarmovers.ca','https://app.invalid/unsubscribe'),/regional brand/)
})


test('HTML alternative escapes markup, keeps approved text and rejects transport mutations',async()=>{
 const text='Saturn Star Movers & <team> "hello"\n\nReply “no thanks” and I will honour that.'
 const payload={text,reviewedBody:{text},context:{source:'prepared-email',contactId:'c',policyActionKey:'a'},idempotencyKey:'prepared-email:a'}
 const prepared=await prepareReviewedOutreach(payload,'saturnstarmovers.ca','https://app.invalid/unsubscribe')
 assert.equal(prepared.text,text)
 assert.equal(prepared.html,reviewedTextHtml(text))
 assert.ok(prepared.html.includes('&amp; &lt;team&gt; &quot;hello&quot;\n\n'))
 assert.ok(!/<a\b|<img\b|http|postal/i.test(prepared.html))
 assert.deepEqual(prepared.reviewedBody,{text})
 assertReviewedTransportBody(prepared)
 assert.throws(()=>assertReviewedTransportBody({...prepared,html:prepared.html+'extra'}),/differs/)
 assert.throws(()=>assertReviewedTransportBody({...prepared,text:text+'extra'}),/differs/)
 await assert.rejects(prepareReviewedOutreach({...payload,html:'<p>injected</p>'},'saturnstarmovers.ca','https://app.invalid/unsubscribe'),/approved plain-text/)
})
