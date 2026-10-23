import { chromium } from 'playwright';
import { createRequire } from 'node:module';import assert from 'node:assert/strict';import { resolve } from 'node:path';
process.env.AUTH_SECRET='isolated-browser-fixture';const require=createRequire(import.meta.url);require(resolve('tests/helpers/register-compiled-aliases.cjs'));const auth=require(resolve('.tmp-logic-tests/lib/auth.js'));
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROME_PATH || undefined,headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'mc_session',value:await auth.createSessionToken({role:'manager',userId:'fixture',name:'Browser Fixture'}),url:'http://127.0.0.1:3107',httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();let posts=0,logins=0;
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());let data=[],status=200;
  if(url.pathname==='/api/auth/me')data={role:'manager',name:'Browser Fixture',userId:'fixture',branch:null};
  else if(url.pathname==='/api/auth/login'){logins++;data={ok:true,role:'manager'}}
  else if(url.pathname==='/api/sales/leads'&&request.method()==='POST'){posts++;status=401;data={error:'Unauthorized'}}
  else if(url.pathname==='/api/sales/leads')data={leads:[],total:0};
  else if(url.pathname.includes('match-phone'))data={lead:null};
  else if(url.pathname.includes('settings'))data={};
  else if(url.pathname.includes('/dialer/')){status=503;data={error:'Isolated browser fixture; no telephony access'}}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:3107/sales/leads',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'New Lead',exact:true}).last().click();
 await page.getByPlaceholder('Sarah Johnson').fill('Draft preserved fixture');await page.getByPlaceholder('226-555-0100').fill('4165550199');
 const source=page.getByText('Source',{exact:true}).locator('..').locator('select');await source.selectOption('other');
 await page.getByRole('button',{name:'Create Lead',exact:true}).click();
 await page.getByRole('heading',{name:'Sign in to continue'}).waitFor();
 assert.equal(posts,1);assert.equal(await page.getByPlaceholder('Sarah Johnson').inputValue(),'Draft preserved fixture');
 await page.getByLabel('Email (optional for owner)').fill('fixture@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Sign in to continue'}).waitFor({state:'hidden'});
 assert.equal(logins,1);assert.equal(posts,1);assert.equal(await page.getByPlaceholder('Sarah Johnson').inputValue(),'Draft preserved fixture');assert.equal(await page.getByPlaceholder('226-555-0100').inputValue(),'4165550199');
 console.log('PASS: actual CRM new-lead form survives 401 and reauthentication; no automatic resubmission.');
 await page.screenshot({path:process.env.CRM_BROWSER_SCREENSHOT || '/tmp/crm-session-recovery-browser.png',fullPage:true});
}finally{await browser.close()}
