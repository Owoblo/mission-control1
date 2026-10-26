import{chromium}from'playwright';import{createHmac}from'node:crypto';import assert from'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROME_PATH||undefined});
try{for(const role of ['owner','sales_rep']){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),p=Buffer.from(JSON.stringify({exp:Date.now()+600000,role,userId:'fixture',name:'Browser Fixture'})).toString('base64url');await context.addCookies([{name:'mc_session',value:p+'.'+createHmac('sha256','isolated-browser-fixture').update(p).digest('base64url'),url:'http://127.0.0.1:3109'}]);const page=await context.newPage(),writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const lead={id:'lead_fixture',name:'Lead Fixture',phone:'+14165550199',stage:'contacted',createdAt:'2026-10-26',source:'website_form',inventory:[],callLogs:[]},item={id:'inbound-fixture',type:'lead',source:'website_form',title:'Attention fixture',preview:'New website enquiry needs human attention',time:new Date().toISOString(),leadId:lead.id,phone:lead.phone,href:'/sales/leads/lead_fixture',priority:'interrupt',reason:'Human follow-up pending',requiredAction:'Review and assign',dedupeKey:'inbound:fixture'};
 let opened=false;await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());let data=[],status=200;
 if(req.method()!=='GET'){let body=null;try{body=req.postData()?req.postDataJSON():null}catch{}writes.push({path:url.pathname,body})}
 if(url.pathname==='/api/auth/me')data={role,userId:'fixture',name:'Browser Fixture'};
 else if(url.pathname==='/api/sales/leads/lead_fixture')data=lead;
 else if(url.pathname==='/api/sales/notifications'){if(req.method()==='POST'){if(req.postDataJSON().action==='opened')opened=true;data={ok:true}}else data={items:opened?[]:[item],totalCount:opened?0:1,breakdown:{leads:opened?0:1,sms:0,emails:0,alerts:0}}}
 else if(url.pathname.endsWith('/attention'))data=req.method()==='POST'?{ok:true}:{createdAt:'2026-10-26T10:21Z',assignedTo:null,alerts:[{recipient:'rep@example.test',state:'accepted',events:[{event_type:'email_delivered',occurred_at:'2026-10-26T10:22Z'}]}],receipts:[{id:'fixture',at:'2026-10-26T13:00Z',actor:'Rep Fixture',action:'displayed',evidenceSource:'authenticated_browser_report',notificationPermission:'denied',audioState:'suspended'}],humanContact:[],limits:['Browser display records do not prove someone read the content.','Shared mailbox clicks cannot identify a particular person.']};
 else if(url.pathname.endsWith('/communication-status'))data={sms:[],quoteChannels:[]};
 else if(url.pathname.includes('automation'))data={lead,jobs:[]};
 else if(url.pathname.includes('settings'))data={};
 else if(url.pathname.includes('/dialer/')){status=503;data={error:'Fixture; no telephony access'}}
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})});
 await page.goto('http://127.0.0.1:3109/sales/leads/lead_fixture',{waitUntil:'networkidle'});
 await page.getByText('New inbound lead',{exact:true}).waitFor();await page.getByRole('button',{name:'View →',exact:true}).click();
 await assertEventually(()=>writes.some(w=>w.path==='/api/sales/notifications'&&w.body.action==='displayed'));await assertEventually(()=>writes.some(w=>w.path==='/api/sales/notifications'&&w.body.action==='opened'));await assertEventually(()=>writes.some(w=>w.path.endsWith('/attention')));
 if(role==='owner'){await page.getByText('Follow-up evidence',{exact:true}).click();await page.getByText(/Responsible rep: Unassigned/).waitFor();await page.getByText(/Lead displayed|Alert displayed/).waitFor();await page.getByText(/Shared mailbox clicks/).waitFor();await page.getByText(/Desktop alerts: denied/).waitFor()}else assert.equal(await page.getByText('Follow-up evidence',{exact:true}).count(),0);
 assert.equal(writes.some(w=>w.path==='/api/sales/send'),false);assert.deepEqual(errors,[]);await page.screenshot({path:`/private/tmp/crm-lead-attention-${role}.png`,fullPage:true});console.log(`PASS ${role}: initial new-lead alert, independent display/open receipts, authenticated lead view, correct report access; no customer sends.`);await context.close();
}}finally{await browser.close()}
async function assertEventually(check){for(let i=0;i<30;i++){if(check())return;await new Promise(r=>setTimeout(r,100))}assert.ok(check())}
