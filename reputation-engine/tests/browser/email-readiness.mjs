import {createRequire} from 'node:module';import {mkdirSync} from 'node:fs';import assert from 'node:assert/strict';
const root=process.cwd(),require=createRequire(root+'/package.json'),{chromium}=require('playwright'),createLoader=require(root+'/tests/helpers/load-typescript.cjs');
process.env.AUTH_SECRET='isolated-email-browser-fixture';const load=createLoader(root),auth=load(root+'/lib/auth.ts'),{DEFAULT_SETTINGS}=load(root+'/lib/server/dialer-settings.ts');
const base=process.env.CRM_BROWSER_URL||'http://127.0.0.1:3120',out=process.env.CRM_BROWSER_OUTPUT||'/tmp/crm-email-readiness-browser';mkdirSync(out,{recursive:true});
console.log('Launching local Chrome');const browser=await chromium.launch({headless:true,channel:'chrome',timeout:30000});console.log('Chrome ready');let posts=[];
const fixture={pending:[],senders:[{id:'sender1',email:'jo@saturnstarmovers.ca',name:'John | Saturn Star Movers',owner:'John',replyTo:'business@starmovers.ca',domain:'saturnstarmovers.ca',status:'setup',dailyCap:25}],domains:[{domain:'saturnstarmovers.ca',purpose:'outreach',status:'setup',daily_cap:50,postal_address:'3608 Seminole Street, Unit 3, Windsor, ON N8Y 1Y4, Canada',checked_at:new Date().toISOString(),health:{ready:true,replyReady:true,receiptRouteReady:true,dkim:'SUCCESS',spf:true,dmarc:true}}],provider:{checkedAt:new Date().toISOString(),snapshot:{max24HourSend:50000,sentLast24Hours:32,enforcement:'HEALTHY'}},counts:{recordedRecipientSends:20,applicationAttempts:0,unresolvedAttempts:0},recentReceipts:[]};
try{
 for(const role of ['owner','manager']){
 const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'mc_session',value:await auth.createSessionToken({role,userId:'fixture',name:'John'}),url:base,httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();page.setDefaultTimeout(15000);console.log('Loading '+role);let readinessReads=0;
 await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url());let data=[];
 if(url.pathname==='/api/auth/me')data={role,name:'John',userId:'fixture',branch:null};
 else if(url.pathname==='/api/sales/settings')data={settings:DEFAULT_SETTINGS,tableExists:true};
 else if(url.pathname==='/api/marketing/email-infrastructure'){readinessReads++;if(request.method()==='POST'){const p=request.postDataJSON();posts.push(p);if(p.action==='domain_state')fixture.domains[0].status=p.status;if(p.action==='register')fixture.senders.push({...fixture.senders[0],id:'new',email:p.email,name:p.name,owner:p.owner});}data=fixture}
 else if(url.pathname.includes('/dialer/'))return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Isolated browser fixture'})});
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(base+'/sales/settings',{waitUntil:'domcontentloaded',timeout:20000});console.log('Loaded '+role+' '+page.url());
 if(role==='owner'){
 await page.getByRole('heading',{name:'Email readiness',exact:true}).waitFor();assert.ok((await page.locator('body').innerText()).includes('12 account-wide sends'));
 await page.getByRole('button',{name:'Pause domain',exact:true}).click();await page.getByRole('button',{name:'Resume domain',exact:true}).waitFor();assert.deepEqual(posts.at(-1),{action:'domain_state',status:'paused'});
 await page.getByLabel('New outreach sender email').fill('john.testing@saturnstarmovers.ca');await page.getByRole('button',{name:'Register in setup',exact:true}).click();await page.locator('td').filter({hasText:'john.testing@saturnstarmovers.ca'}).waitFor();assert.equal(posts.at(-1).action,'register');
 await page.screenshot({path:out+'/settings-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/settings-mobile.png',fullPage:true});
 const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('main *,section *,input')].map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right,text:e.textContent.slice(0,45)})).filter(e=>e.right>391).slice(0,20)}));assert.ok(dimensions.scroll<=dimensions.width+1,JSON.stringify(dimensions));
 }else{assert.equal(await page.getByRole('heading',{name:'Email readiness',exact:true}).count(),0);assert.equal(readinessReads,0)}
 await context.close();
 }
 assert.ok(posts.every(p=>['domain_state','register'].includes(p.action)));console.log('PASS: owner settings render; pause and setup registration controls submit expected changes; manager cannot see or request sender administration; 390px mobile has no page overflow. All API responses mocked; zero emails sent.');
}finally{await browser.close()}
