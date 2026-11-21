import {chromium} from '/private/tmp/ssm-video-browser/node_modules/playwright/index.mjs';
import {createHmac} from 'node:crypto';
import '/Users/owoblo/Downloads/mission-control1/reputation-engine/scripts/gta-email-recovery-runtime.mjs';
const base=process.env.CHECK_BASE||'http://localhost:3127';
const p=Buffer.from(JSON.stringify({role:'owner',name:'John',exp:Date.now()+600000})).toString('base64url');
const value=p+'.'+createHmac('sha256',process.env.AUTH_SECRET.replace(/\\n|\\r/g,'').trim()).update(p).digest('base64url');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
const page=await browser.newPage();
await page.context().addCookies([{name:'mc_session',value,url:base,httpOnly:true}]);
await page.route('**/api/**',route=>['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
await page.goto(base+'/sales/contractors/b1859baf-0ae3-4250-a149-453ae241ee21?tab=messages',{waitUntil:'domcontentloaded',timeout:90000});
await page.getByText('Hi please share the details',{exact:true}).waitFor({timeout:60000});
await page.getByRole('button',{name:'Refresh',exact:true}).click();
await page.getByText('Hi please share the details',{exact:true}).waitFor();
await page.screenshot({path:'/private/tmp/contractor-messages-visible.png',fullPage:true});
console.log('Contractor Messages deep link, actual inbound reply and Refresh verified in browser; no writes.');
}finally{await browser.close()}
