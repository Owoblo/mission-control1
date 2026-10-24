import {chromium} from 'playwright'
import {createHmac} from 'node:crypto'
import assert from 'node:assert/strict'
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROME_PATH||undefined})
const lead={id:'lead_fixture',name:'Customer Fixture',phone:'+14165550199',stage:'contacted',source:'other',createdAt:'2026-10-24',moveDate:'2026-10-26',moveDateConfirmation:'unconfirmed',branch:'toronto',automationStatus:'handoff',deliveryFailureReview:{messageKey:'SMfixture',status:'open',occurredAt:'2026-10-24T12:00Z'},conversationReview:{key:'review',kind:'date_unconfirmed',evidence:'Once unit is ready.',status:'open',occurredAt:'2026-10-24T12:00Z'},callbackCommitment:{key:'callback',notBefore:'2030-10-26T21:00:00Z',dueAt:'2030-10-26T21:00:00Z',requestedDay:'2030-10-26',customerWillReply:true,evidence:'I will contact you Monday.',status:'open',occurredAt:'2026-10-24T12:00Z'},callLogs:[{id:'call_fixture',type:'call',date:'2026-10-24T12:00:00Z',notes:'Recorded customer call',direction:'outbound',recordingSid:'RE'+'a'.repeat(32),recordingUrl:'/api/sales/dialer/recording?key=fixture',recordingStatus:'verified',transcriptionStatus:'retry',duration:'2m 0s'}]}
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:1000}}),payload=Buffer.from(JSON.stringify({exp:Date.now()+3600000,role:'owner',userId:'legacy-owner',name:'Browser Fixture'})).toString('base64url')
 await context.addCookies([{name:'mc_session',value:payload+'.'+createHmac('sha256','isolated-browser-fixture').update(payload).digest('base64url'),url:'http://127.0.0.1:3107'}])
 const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/api/**',async route=>{
  const req=route.request(),u=new URL(req.url());let data=[],status=200
  if(req.method()!=='GET')writes.push(u.pathname)
  if(u.pathname==='/api/auth/me')data={role:'owner',userId:'legacy-owner',name:'Browser Fixture'}
  else if(u.pathname==='/api/sales/leads/lead_fixture')data=lead
  else if(u.pathname.endsWith('/communication-status'))data={sms:[{id:'sms',created_at:'2026-10-24T12:00Z'}],quoteChannels:[{id:'email',channel:'email',status:'failed',created_at:'2026-10-24T12:00Z'}]}
  else if(u.pathname.includes('notifications'))data={items:[],totalCount:0,breakdown:{}}
  else if(u.pathname.includes('automation'))data={jobs:[],lead}
  else if(u.pathname.includes('settings'))data={}
  else if(u.pathname.includes('/dialer/')){status=503;data={error:'Fixture has no telephony access'}}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 })
 await page.goto('http://127.0.0.1:3107/sales/leads/lead_fixture',{waitUntil:'networkidle'})
 try{
  const panel=page.getByRole('region',{name:'Customer communication needs attention'})
  await panel.waitFor({timeout:15000});await panel.getByText(/1 SMS was not delivered/).waitFor();await panel.getByText(/Quote email delivery failed/).waitFor();await panel.getByText(/Customer said they will reply/).waitFor()
  assert.equal(await panel.getByRole('button',{name:'Record callback completion'}).count(),0)
  assert.equal(await panel.getByRole('button',{name:'Record confirmed move date'}).count(),1)
  const call=page.getByText('Recorded customer call',{exact:true});await call.waitFor();
  // Every card reference remains accessible; opening it exposes audio/retry state.
  const open=page.getByRole('button',{name:'Open',exact:true});if(await open.count())await open.last().click()
  await page.getByText('Audio is saved and playable. Transcription was interrupted; a retry is scheduled.',{exact:true}).first().waitFor()
  assert.equal(writes.filter(p=>p==='/api/sales/send').length,0);assert.deepEqual(errors,[])
  await page.screenshot({path:`/private/tmp/crm-customer-communication-${width}.png`,fullPage:true})
  console.log(`PASS ${width}px: failed channels, unconfirmed date, shared callback hold and expandable recording retry are visible; no customer sends.`)
 }catch(error){await page.screenshot({path:`/private/tmp/crm-customer-communication-failure-${width}.png`,fullPage:true});console.log('Page errors:',errors);console.log((await page.locator('body').innerText()).slice(-2000));throw error}
 await context.close()
}}finally{await browser.close()}
