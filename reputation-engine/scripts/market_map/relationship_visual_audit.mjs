// Anonymous rendered proof. Every remote byte is acquired by the existing
// robots/HTTPS/private-host guarded Python Transport, then rendered locally.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';

export function compareSlots(slots, reviewed) {
  return {rendered_slots: slots.length, reviewed_slots: reviewed.length,
    exact_source_link_matches: slots.filter((s,i)=>s.src_attribute===reviewed[i]?.published_img_src&&s.anchor_href===reviewed[i]?.published_anchor_href).length,
    visible_slots: slots.filter(s=>s.visible).length,
    loaded_slots: slots.filter(s=>s.complete&&s.natural_width>0&&s.natural_height>0).length,
    missing_or_failed_slots: slots.filter(s=>!s.visible||!s.complete||!s.natural_width||!s.natural_height).map(s=>s.ordinal)};
}

export function gridBounds(slots) {
  const boxes=slots.filter(s=>s.visible).map(s=>s.bounding_box);
  if(!boxes.length)throw Error('No visible image bounds to capture');
  const x=Math.max(0,Math.floor(Math.min(...boxes.map(b=>b.x))-4));
  const y=Math.max(0,Math.floor(Math.min(...boxes.map(b=>b.y))-4));
  return {x,y,width:Math.ceil(Math.max(...boxes.map(b=>b.x+b.width))+4-x),height:Math.ceil(Math.max(...boxes.map(b=>b.y+b.height))+4-y)};
}

export async function audit(config) {
  const {url, output, scope_selector, reviewed_claims, policy_review}=config;
  const host=new URL(url).hostname;
  if(new URL(url).protocol!=='https:')throw Error('HTTPS source required');
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  const minimumFree=2147483648, maxRequests=100, maxBytes=30000000, deadlineMs=120000;
  const guard=()=>{const s=fs.statfsSync(output);if(s.bavail*s.bsize<minimumFree)throw Error('At least2GiB free required');};
  guard();
  if(!fs.existsSync(policy_review))throw Error('Reviewed public source policy proof required');
  const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
  const report={started_at:new Date().toISOString(),source_url:url,
    method:'anonymous headless browser; all same-host public responses supplied by robots-respecting guarded Transport',
    declared_limits:{max_requests:maxRequests,max_bytes:maxBytes,deadline_ms:deadlineMs,minimum_free_bytes:minimumFree},
    policy_review:{path:policy_review,sha256:sha(fs.readFileSync(policy_review))},
    blocked_requests:[],failed_requests:[],responses:[],canonical_database_mutated:false,
    paid_service_calls:0,messages_sent:0,market_completeness_verified:false};
  const save=()=>fs.writeFileSync(path.join(output,'visual-audit-manifest.json'),JSON.stringify(report,null,2));
  const bridgeCode=String.raw`
import sys,json,base64,shutil
from scripts.market_map.transport import Transport
t=Transport(allowed_hosts={sys.argv[1]},max_requests=100,max_bytes=30000000,max_response_bytes=4000000,timeout=20,min_interval=.25,retries=1)
for line in sys.stdin:
 try:
  v=json.loads(line)
  if v.get('metrics'):
   print(json.dumps({'id':v['id'],'metrics':t.metrics()}),flush=True);continue
  if shutil.disk_usage(sys.argv[2]).free<2147483648:raise RuntimeError('2GiB storage guard')
  r=t.fetch(v['url']);print(json.dumps({'id':v['id'],'status':r.status,'url':r.url,'headers':dict(r.headers),'body':base64.b64encode(r.body).decode(),'metrics':t.metrics()}),flush=True)
 except Exception as e:print(json.dumps({'id':v.get('id'),'error':str(e),'metrics':t.metrics()}),flush=True)
`;
  const bridge=spawn('python3',['-B','-u','-c',bridgeCode,host,output],{stdio:['pipe','pipe','pipe']});
  let seq=0;const pending=new Map();let bridgeError='';
  bridge.stderr.on('data',b=>{bridgeError+=b.toString().slice(0,2000);});
  createInterface({input:bridge.stdout}).on('line',line=>{const r=JSON.parse(line);const p=pending.get(r.id);if(p){pending.delete(r.id);p.resolve(r);}});
  bridge.on('exit',code=>{for(const p of pending.values())p.reject(Error('Guarded bridge closed '+code+' '+bridgeError));pending.clear();});
  const fetch=url=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});bridge.stdin.write(JSON.stringify({id,url})+'\n');});
  const {chromium}=await import('/Users/owoblo/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs');
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const started=Date.now();let fatal=null,requestCount=0;
  const timer=setTimeout(()=>{fatal=Error('Visual audit deadline');browser.close().catch(()=>{});},deadlineMs);
  try {
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});
    const page=await context.newPage();
    page.on('pageerror',e=>{(report.page_errors??=[]).push(String(e).slice(0,300));});
    await context.route('**/*',async route=>{
      const request=route.request();
      try {
        const target=new URL(request.url());
        guard();
        const reason=target.protocol!=='https:'||target.hostname!==host?'outside_explicit_https_host':
          !['GET','HEAD'].includes(request.method())?'non_read_method':
          /captcha|challenge|analytics|telemetry|google-analytics|collect\?/i.test(request.url())?'challenge_or_telemetry':null;
        if(reason){report.blocked_requests.push({url:request.url(),method:request.method(),reason});return await route.abort();}
        if(++requestCount>maxRequests||Date.now()-started>deadlineMs)throw Error('Declared resource guard');
        const r=await fetch(request.url());report.transport_metrics=r.metrics;
        if(r.error){report.failed_requests.push({url:request.url(),error:r.error});return await route.abort();}
        const body=Buffer.from(r.body,'base64');
        if(/verify you are human|cf-chl-|\.well-known\/sgcaptcha/i.test(body.toString('utf8',0,10000)))throw Error('Access challenge; no bypass');
        report.responses.push({url:request.url(),response_url:r.url,status:r.status,bytes:body.length,sha256:sha(body)});
        if(request.isNavigationRequest()&&request.frame()===page.mainFrame()){
          fs.writeFileSync(path.join(output,'guarded-source.html'),body,{mode:0o600});
          report.source_html_sha256=sha(body);
        }
        const contentType=Object.entries(r.headers).find(([k])=>k.toLowerCase()==='content-type')?.[1]||'application/octet-stream';
        await route.fulfill({status:r.status,headers:{'content-type':contentType},body});
      }catch(e){fatal=e;report.failed_requests.push({url:request.url(),error:String(e)});await route.abort();}
    });
    await page.goto(url,{waitUntil:'networkidle',timeout:90000});
    if(fatal)throw fatal;
    await page.locator(scope_selector).waitFor({state:'visible',timeout:15000});
    await page.locator(scope_selector).evaluate(async node=>{await Promise.all(Array.from(node.querySelectorAll('table img')).map(img=>img.complete?null:new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});setTimeout(resolve,10000);})));});
    await page.locator(scope_selector).evaluate(async node=>{await Promise.all(Array.from(node.querySelectorAll('table img')).map(img=>img.decode().catch(()=>{})));});
    const slots=await page.locator(scope_selector).locator('table img').evaluateAll(images=>images.map((img,i)=>{
      const a=img.closest('a'),box=img.getBoundingClientRect(),style=getComputedStyle(img);
      return {ordinal:i+1,alt:img.getAttribute('alt'),title:img.getAttribute('title'),src_attribute:img.getAttribute('src'),current_src:img.currentSrc,
        anchor_href:a?.getAttribute('href')??null,anchor_title:a?.getAttribute('title')??null,
        visible:box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0',
        complete:img.complete,natural_width:img.naturalWidth,natural_height:img.naturalHeight,
        bounding_box:{x:box.x+scrollX,y:box.y+scrollY,width:box.width,height:box.height}};
    }));
    report.grid_table_containers=await page.locator(scope_selector).locator('table').count();
    report.image_bearing_tables=await page.locator(scope_selector).locator('table').evaluateAll(t=>t.filter(x=>x.querySelector('img')).length);
    const reviewed=fs.readFileSync(reviewed_claims,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    report.reviewed_claims={path:reviewed_claims,sha256:sha(fs.readFileSync(reviewed_claims))};
    report.comparison=compareSlots(slots,reviewed);
    const dom=Buffer.from(await page.content());
    fs.writeFileSync(path.join(output,'rendered-dom.html'),dom,{mode:0o600});
    fs.writeFileSync(path.join(output,'rendered-image-slots.json'),JSON.stringify(slots,null,2),{mode:0o600});
    guard();await page.screenshot({path:path.join(output,'full-page.png'),fullPage:true,animations:'disabled'});
    report.screenshot_bounds=gridBounds(slots);
    await page.screenshot({path:path.join(output,'partner-grid.png'),fullPage:true,clip:report.screenshot_bounds,animations:'disabled'});
    const png=fs.readFileSync(path.join(output,'partner-grid.png'));
    report.grid_screenshot_pixels={width:png.readUInt32BE(16),height:png.readUInt32BE(20)};
    if(report.grid_screenshot_pixels.width!==report.screenshot_bounds.width||report.grid_screenshot_pixels.height!==report.screenshot_bounds.height)throw Error('Screenshot clipped image grid; visual proof incomplete');
    const individual=[];
    for(let i=0;i<slots.length;i++){
      if(!slots[i].visible)continue;
      guard();const filename=`slot-${String(i+1).padStart(3,'0')}.png`;
      await page.locator(scope_selector).locator('table img').nth(i).screenshot({path:path.join(output,filename),animations:'disabled'});
      individual.push(filename);
    }
    report.status=slots.length===reviewed.length&&report.comparison.exact_source_link_matches===reviewed.length&&report.comparison.visible_slots===reviewed.length&&report.comparison.loaded_slots===reviewed.length?'reviewed_slots_rendered_visible_and_loaded':'rendered_capture_with_mismatches_or_failed_images';
    report.rendered_dom_sha256=sha(dom);
    report.files=Object.fromEntries(['guarded-source.html','rendered-dom.html','rendered-image-slots.json','full-page.png','partner-grid.png',...individual].map(f=>[f,{sha256:sha(fs.readFileSync(path.join(output,f))),bytes:fs.statSync(path.join(output,f)).size}]));
    report.completed_at=new Date().toISOString();save();return report;
  }catch(e){report.status='partial_or_blocked';report.error=String(e);report.completed_at=new Date().toISOString();save();throw e;}
  finally{clearTimeout(timer);await browser.close();bridge.stdin.end();bridge.kill();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const report=await audit(config);
  console.log(JSON.stringify({status:report.status,comparison:report.comparison,transport_metrics:report.transport_metrics,files:report.files}));
}
