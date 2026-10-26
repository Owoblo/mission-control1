import {chromium} from 'playwright';import {createHmac} from 'node:crypto';import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROME_PATH||undefined});
try {
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});
 const payload=Buffer.from(JSON.stringify({exp:Date.now()+600000,role:'sales_rep',userId:'fixture',name:'Browser Fixture'})).toString('base64url');
 await context.addCookies([{name:'mc_session',value:payload+'.'+createHmac('sha256','isolated-browser-fixture').update(payload).digest('base64url'),url:'http://127.0.0.1:3109'}]);
 const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('ss_notif_snoozed',String(Date.now()+86400000)));
 let failed=false,items=[],ack=new Set();
 const item=n=>({id:'sms-phone:'+n,type:'sms',source:'twilio_sms',title:'Customer question '+n,preview:'Message '+n,time:new Date().toISOString(),leadId:null,phone:'+14165550199',href:'/sales/inbox?tab=sms',priority:'today',reason:'Reply pending',requiredAction:'Reply',dedupeKey:'sms:phone:'+n});items=[item(1)];
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());let data=[],status=200;
 if(req.method()!=='GET'){let body;try{body=req.postDataJSON()}catch{}writes.push({path:url.pathname,body});if(url.pathname==='/api/sales/notifications'){for(const k of body.dedupeKeys||[])if(body.action!=='displayed')ack.add(k);data={ok:true}}}
 else if(url.pathname==='/api/auth/me')data={role:'sales_rep',userId:'fixture',name:'Browser Fixture'};
 else if(url.pathname==='/api/sales/notifications'){if(failed){status=503;data={error:'Fixture outage'}}else{const visible=items.filter(i=>!ack.has(i.dedupeKey));data={items:visible,totalCount:visible.length,breakdown:{leads:0,sms:visible.length,emails:0,alerts:0}}}}
 else if(url.pathname.includes('/dialer/')){status=503;data={error:'No telephony in fixture'}}
 else if(url.pathname.includes('settings'))data={};
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:3109/sales/inbox',{waitUntil:'domcontentloaded'});
 const bell=page.getByRole('button',{name:'Notifications — click to enable alert sounds',exact:true});await bell.waitFor();await bell.click();
 await page.getByText('Customer question 1',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Mark all read',exact:true}).click();assert.ok(writes.some(w=>w.body?.action==='acknowledged'));
 // Exercise the real polling interval. Every API and data write remains mocked.
 items=[item(2)];await page.waitForTimeout(21_000);
 await bell.click();await page.getByText('Customer question 2',{exact:true}).waitFor();assert.equal(await page.getByText('Customer question 1',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Mark all read',exact:true}).click();failed=true;await page.waitForTimeout(21_000);
 const errorBell=page.getByRole('button',{name:'Notifications could not refresh — retrying',exact:true});await errorBell.waitFor();await errorBell.click();
 await page.getByRole('alert').filter({hasText:'Notifications could not refresh'}).waitFor();assert.equal(await page.getByText('All caught up',{exact:true}).count(),0);
 await page.screenshot({path:'/private/tmp/crm-notification-browser.png',fullPage:true});assert.deepEqual(errors,[]);assert.ok(writes.every(w=>!w.path.endsWith('/send')&&!w.path.includes('/stripe/')));
 console.log('PASS: old shared-browser snooze cannot hide alerts; mark-all-read does not hide a later reply; refresh failures show a warning instead of all-clear; no provider/customer traffic.');
 await context.close();
}finally{await browser.close()}
