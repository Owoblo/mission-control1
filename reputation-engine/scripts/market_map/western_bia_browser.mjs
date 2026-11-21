// Ordinary anonymous Listowel directory UI only. No direct backend replay,
// authentication, named-person extraction, uploads, messages or database writes.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {chromium} from '/Users/owoblo/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const output=process.argv[2];
const categoryMode=process.argv.includes('--categories');
const kwMode=process.argv.includes('--kw-all-view');
if(!output)throw Error('Output directory required');
fs.mkdirSync(output,{recursive:true,mode:0o700});
const oldReceipt=path.join(output,'ordinary-browser-receipt.json');
if(fs.existsSync(oldReceipt))fs.copyFileSync(oldReceipt,path.join(output,'ordinary-browser-prior-'+Date.now()+'.json'));
const minimumFree=2147483648,maxRequests=180,maxBytes=60000000;
const stamp=()=>new Date().toISOString();
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const guard=()=>{const s=fs.statfsSync(output);if(s.bavail*s.bsize<minimumFree)throw Error('Storage guard: at least2GiB free required');};
guard();
const report={started_at:stamp(),source_url:kwMode?'https://widgets.greaterkwchamber.com/feeds/directory/directory/action/Alpha/cid/325/id/1/listingType/A':'https://www.discoverlistowel.com/businessdirectory',
  method:'ordinary anonymous public browser GET plus native Load More clicks; no direct API requests',
  declared_limits:{max_requests:maxRequests,max_body_bytes:maxBytes,minimum_free_bytes:minimumFree},
  requests:0,bytes_observed:0,unmeasured_responses:0,blocked_requests:[],loads:[],market_completeness_verified:false,canonical_database_mutated:false};
report.permitted_native_directory_posts=0;
report.browser_page_errors=[];
const save=()=>fs.writeFileSync(path.join(output,'ordinary-browser-receipt.json'),JSON.stringify(report,null,2));
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const context=await browser.newContext({serviceWorkers:'block',userAgent:'SSMMarketMapResearch/1.0 (+internal business research; robots-respecting public facts)'});
 const page=await context.newPage();
 page.on('pageerror',error=>{if(report.browser_page_errors.length<12)report.browser_page_errors.push(String(error).slice(0,350));});
 let failure=null;
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  try{
   guard();
   if(report.requests>=maxRequests||report.bytes_observed>=maxBytes)throw Error('Declared browser resource guard reached');
   const host=url.hostname;
   if(kwMode&&/recaptcha|hcaptcha/i.test(request.url()))throw Error('Actual public browser captcha request encountered; stop without challenge bypass');
   const nativeKWScripts=kwMode&&['ajax.googleapis.com','cdnjs.cloudflare.com','stackpath.bootstrapcdn.com','js.api.here.com'].includes(host)&&['script','stylesheet'].includes(request.resourceType());
   const permitted=kwMode?(host==='widgets.greaterkwchamber.com'||nativeKWScripts):host==='www.discoverlistowel.com'||host==='discoverlistowel.com'||host.endsWith('.wixstatic.com')||host.endsWith('.parastorage.com')||host.endsWith('.wixapis.com');
   const asset=['image','font','media'].includes(request.resourceType());
   // Runtime module names can contain "panorama"; they are functional scripts,
   // so exclude only actual telemetry requests, not shared runtime dependencies.
   const telemetry=request.resourceType()!=='script'&&/analytics|telemetry|\/track|\/fedops|\/panorama|\/frog\//i.test(url.pathname);
   const method=request.method();
   const nativeKWReadOnlyPost=kwMode&&method==='POST'&&host==='widgets.greaterkwchamber.com'&&url.pathname===new URL(report.source_url).pathname;
   const readonly=method==='GET'||method==='HEAD'||nativeKWReadOnlyPost||(method==='POST'&&/query|find|read|bulk-get/i.test(url.pathname));
   if(!permitted||asset||telemetry||!readonly){
    report.blocked_requests.push({origin:url.origin,path:url.pathname,method,reason:asset?'nonessential_media':telemetry?'telemetry':!permitted?'unrelated_host':'unreviewed_nonread_method'});
    return await route.abort();
   }
   report.requests++;
   if(nativeKWReadOnlyPost)report.permitted_native_directory_posts++;
   await route.continue();
  }catch(error){failure=error;await route.abort();}
 });
 page.on('response',async response=>{
  try{const body=await response.body();report.bytes_observed+=body.length;if(report.bytes_observed>maxBytes)failure=Error('Browser response-body guard reached');}
  catch{report.unmeasured_responses++;}
 });
 await page.goto(report.source_url,{waitUntil:'domcontentloaded',timeout:60000});
 if(kwMode){
  const all=page.getByRole('link',{name:'All',exact:true});
  await all.waitFor({timeout:30000});
  await page.waitForTimeout(1500);
  await all.click();
  await page.waitForTimeout(2000);
  if(failure)throw failure;
  guard();const body=Buffer.from(await page.content()),compressed=zlib.gzipSync(body,{mtime:0}),filename='ordinary-native-all-view.private.html.gz';
  fs.writeFileSync(path.join(output,filename),compressed,{mode:0o600});
  report.status=report.permitted_native_directory_posts?'native_all_view_captured_pagination_review_pending':'native_All_click_no_post_or_results_requires_UI_review';report.completed_at=stamp();report.native_actions=['Alphabetical Search public entry GET','native All link click attempted; actual POST count separately reported'];
  report.raw_receipt={file:filename,source_body_sha256:sha(body),gzip_sha256:sha(compressed),source_bytes:body.length};
  report.source_inventory_exhausted=false;save();
  console.log(JSON.stringify({status:report.status,requests:report.requests,bytes_observed:report.bytes_observed,unmeasured_responses:report.unmeasured_responses,raw_receipt:report.raw_receipt}));
 }else{
 await page.locator('.wixui-repeater__item').first().waitFor({timeout:45000});
 await page.waitForTimeout(2500);
 const nativeCount=()=>page.locator('.wixui-repeater__item').count();
 let count=await nativeCount();report.loads.push({observed_at:stamp(),visible_cards:count,action:'initial public page'});save();
 if(categoryMode){
  // Wait for a successful native dataset action before using the native tag
  // selector; SSR cards alone can precede the Wix binding becoming interactive.
  const readyMore=page.getByRole('button',{name:'Load More',exact:true});
  if(await readyMore.count()&&await readyMore.isVisible()){
   await readyMore.click();
   await page.waitForFunction(previous=>document.querySelectorAll('.wixui-repeater__item').length>previous,count,{timeout:45000});
  }
  const selector=page.locator('select#collection_comp-lpsrilpo');
  const options=await selector.locator('option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,label:n.textContent})).filter(n=>n.value&&n.value!=='RESET_ALL'));
  report.category_views=[];
  for(const option of options){
   if(failure)throw failure;
   const before=await page.locator('.wixui-repeater__item').evaluateAll(nodes=>nodes.map(n=>n.id).join('|'));
   await selector.selectOption(option.value);
   await page.waitForFunction(previous=>Array.from(document.querySelectorAll('.wixui-repeater__item')).map(n=>n.id).join('|')!==previous,before,{timeout:45000});
   await page.waitForTimeout(500);
   let prior=await nativeCount(),clicks=0;
   while(true){
    const more=page.getByRole('button',{name:'Load More',exact:true});
    if(await more.count()===0||!await more.isVisible()||!await more.isEnabled())break;
    guard();await more.click();
    await page.waitForFunction(previous=>document.querySelectorAll('.wixui-repeater__item').length>previous,prior,{timeout:45000});
    prior=await nativeCount();clicks++;
    if(clicks>20)throw Error('Category native Load More resource guard reached');
   }
   const ids=await page.locator('.wixui-repeater__item').evaluateAll(nodes=>nodes.map(n=>n.id.split('__')[1]));
   const body=Buffer.from(await page.content()),compressed=zlib.gzipSync(body,{mtime:0}),filename='category-'+String(report.category_views.length+1)+'.private.html.gz';
   guard();fs.writeFileSync(path.join(output,filename),compressed,{mode:0o600});
   report.category_views.push({source_category_value:option.value,source_category_label:option.label,observed_at:stamp(),native_collection_item_ids:ids,
    native_control_exhausted:true,load_more_clicks:clicks,raw_receipt:{file:filename,source_body_sha256:sha(body),gzip_sha256:sha(compressed),source_bytes:body.length}});
   save();console.log(JSON.stringify({source:'listowel_bia',source_category:option.value,records:ids.length}));
  }
  report.completed_at=stamp();report.status='public_category_controls_exhausted_pending_offline_qa';save();
  console.log(JSON.stringify({status:report.status,category_views:report.category_views.length,requests:report.requests,bytes_observed:report.bytes_observed,unmeasured_responses:report.unmeasured_responses}));
 }else{
 for(let step=0;step<20;step++){
  if(failure)throw failure;
  const button=page.getByRole('button',{name:'Load More',exact:true});
  if(await button.count()===0||!await button.isVisible()||!await button.isEnabled()){
   report.native_load_control_exhausted=true;break;
  }
  guard();await button.click();
  try{await page.waitForFunction(prior=>document.querySelectorAll('.wixui-repeater__item').length>prior,count,{timeout:45000});}
  catch{report.native_load_control_exhausted=false;throw Error('Ordinary Load More did not add visible source cards; stop without backend workaround');}
  count=await nativeCount();report.loads.push({observed_at:stamp(),visible_cards:count,action:'native Load More click'});save();
  console.log(JSON.stringify({source:'listowel_bia',load:step+1,visible_cards:count}));
 }
 if(failure)throw failure;
 guard();const original=Buffer.from(await page.content());
 const compressed=zlib.gzipSync(original,{mtime:0});const filename='ordinary-public-loaded-directory.private.html.gz';
 fs.writeFileSync(path.join(output,filename),compressed,{mode:0o600});
 report.completed_at=stamp();report.final_visible_cards=count;report.raw_receipt={file:filename,source_body_sha256:sha(original),gzip_sha256:sha(compressed),source_bytes:original.length};
 report.status=report.native_load_control_exhausted?'public_ui_control_exhausted_pending_offline_count_qa':'partial_resource_guard';save();
 console.log(JSON.stringify({status:report.status,visible_cards:count,requests:report.requests,bytes_observed:report.bytes_observed,
  unmeasured_responses:report.unmeasured_responses,native_load_control_exhausted:report.native_load_control_exhausted,raw_receipt:report.raw_receipt}));
 }
 }
}catch(error){report.status='partial_or_blocked';report.error=String(error);report.completed_at=stamp();save();throw error;}
finally{await browser.close();}
