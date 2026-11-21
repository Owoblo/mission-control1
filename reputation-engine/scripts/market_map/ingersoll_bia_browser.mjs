// Native anonymous public directory UI only; no backend replay or submissions.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {chromium} from '/Users/owoblo/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const output=process.argv[2];if(!output)throw Error('Output folder required');
fs.mkdirSync(output,{recursive:true,mode:0o700});
const invocation=crypto.randomUUID(),source='https://www.downtowningersoll.ca/business-directory';
const guard=()=>{const d=fs.statfsSync(output);if(d.bavail*d.bsize<2147483648)throw Error('Minimum2GiB storage guard');};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={invocation,source_url:source,started_at:new Date().toISOString(),requests:0,body_bytes:0,unmeasured_responses:0,
  declared_limits:{max_requests:240,max_body_bytes:80000000,min_free_bytes:2147483648},loads:[],blocked_requests:[],browser_errors:[],
  method:'ordinary anonymous browser GET and visible native Load More clicks only',source_inventory_exhausted:false,market_completeness_verified:false,main_database_access:false};
const save=()=>fs.writeFileSync(path.join(output,'native-browser-'+invocation+'.json'),JSON.stringify(report,null,2));
guard();const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const context=await browser.newContext({serviceWorkers:'block',userAgent:'SSMMarketMapResearch/1.0 (+internal factual business research)'}),page=await context.newPage();let failure=null;
 page.on('pageerror',e=>{if(report.browser_errors.length<15)report.browser_errors.push(String(e).slice(0,350));});
 await context.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());
  try{
   guard();if(report.requests>=240||report.body_bytes>=80000000)throw Error('Declared browser resource guard reached');
   if(/captcha/i.test(u.hostname+u.pathname))throw Error('Public captcha encountered; no bypass');
   const host=u.hostname,allowed=host==='www.downtowningersoll.ca'||host==='downtowningersoll.ca'||host.endsWith('.wixstatic.com')||host.endsWith('.parastorage.com')||host.endsWith('.wixapis.com');
   const asset=['image','media','font'].includes(r.resourceType()),telemetry=r.resourceType()!=='script'&&/analytics|telemetry|\/track|\/fedops|\/panorama|\/frog\//i.test(u.pathname);
   const read=r.method()==='GET'||r.method()==='HEAD'||r.method()==='POST'&&/query|find|read|bulk-get/i.test(u.pathname);
   if(!allowed||asset||telemetry||!read){report.blocked_requests.push({host,path:u.pathname,method:r.method(),reason:asset?'nonessential_media':telemetry?'telemetry':!allowed?'unrelated_host':'unreviewed_nonread_method'});return await route.abort();}
   report.requests++;await route.continue();
  }catch(e){failure=e;await route.abort();}
 });
 page.on('response',async response=>{try{report.body_bytes+=(await response.body()).length;if(report.body_bytes>80000000)failure=Error('Browser body guard');}catch{report.unmeasured_responses++;}});
 await page.goto(source,{waitUntil:'domcontentloaded',timeout:60000});
 await page.locator('a[href*="/projects/"]').first().waitFor({timeout:45000});await page.waitForTimeout(4000);
 let click=0;
 for(;;){
  if(failure)throw failure;guard();
  const links=await page.locator('a[href*="/projects/"]').evaluateAll(nodes=>nodes.map(n=>n.href));
  const body=Buffer.from(await page.content()),compressed=zlib.gzipSync(body,{mtime:0}),filename='native-browser-'+invocation+'-load-'+click+'.private.html.gz';
  fs.writeFileSync(path.join(output,filename),compressed,{mode:0o600});
  const candidates=page.getByRole('button',{name:/load more|show more|next/i});
  const visible=[];for(let i=0;i<await candidates.count();i++)if(await candidates.nth(i).isVisible())visible.push(i);
  const anchorCandidates=page.getByRole('link',{name:/^load more$|^show more$|^next$/i});
  for(let i=0;i<await anchorCandidates.count();i++)if(await anchorCandidates.nth(i).isVisible())visible.push('a'+i);
  report.loads.push({click,native_profile_link_appearances:links.length,unique_profile_URLs:new Set(links).size,raw_file:filename,artifact_sha256:sha(compressed),source_body_sha256:sha(body),body_bytes:body.length,
    visible_native_pagination_controls:visible.length,last_profile_URLs:links.slice(-5)});save();
  if(!visible.length){report.status='native_view_captured_no_visible_next_control_source_total_unverified';break;}
  if(click>=15)throw Error('Native pagination guard reached; remaining source partial');
  const selected=visible[0],control=typeof selected==='string'?anchorCandidates.nth(Number(selected.slice(1))):candidates.nth(selected);
  await control.click();click++;await page.waitForTimeout(3500);
  const next=await page.locator('a[href*="/projects/"]').evaluateAll(nodes=>nodes.map(n=>n.href));
  if(JSON.stringify(next)===JSON.stringify(links)){report.status='native_control_no_progress_requires_review';break;}
 }
 report.completed_at=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,loads:report.loads,requests:report.requests,body_bytes:report.body_bytes}));
}catch(error){report.status='native_browser_partial_or_unavailable';report.error=String(error);report.completed_at=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,error:report.error,requests:report.requests,body_bytes:report.body_bytes}));process.exitCode=1;}
finally{await browser.close();}
