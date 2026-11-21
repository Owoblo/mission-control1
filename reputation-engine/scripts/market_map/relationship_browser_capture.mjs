// Public, anonymous rendered evidence. Relationship interpretation is a separate step.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export function allowedHosts(url, extra=[]) {
  const source=new URL(url), root=source.hostname.replace(/^www\./,'');
  if(source.protocol!=='https:'||source.username||source.password||!['','443'].includes(source.port))throw Error('Public HTTPS URL required');
  const hosts=new Set([source.hostname]);
  for(const host of extra){
    if(typeof host!=='string'||![root,'www.'+root].includes(host))throw Error('Only explicit same-host/www equivalent hosts allowed');
    hosts.add(host);
  }
  return [...hosts];
}
export function requestBlockReason(url, method, hosts) {
  let target;try{target=new URL(url);}catch{return 'invalid_url';}
  if(target.protocol!=='https:'||target.username||target.password||!['','443'].includes(target.port)||!hosts.includes(target.hostname))return 'outside_explicit_https_hosts';
  if(!['GET','HEAD'].includes(method))return 'non_read_method';
  if(/captcha|challenge|analytics|telemetry|google-analytics|collect\?/i.test(url))return 'challenge_or_telemetry';
  return null;
}

export async function capture(config) {
  const {url,output}=config, hosts=allowedHosts(url,config.allowed_hosts||[]);
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  const limits={max_requests:100,max_bytes:30000000,max_response_bytes:4000000,deadline_ms:120000,minimum_free_bytes:2147483648,max_screenshot_height:12000,max_dom_bytes:8000000};
  const report={source_url:url,started_at:new Date().toISOString(),status:'starting',allowed_hosts:hosts,declared_limits:limits,
    method:'anonymous headless browser with robots-respecting guarded HTTP transport',blocked_requests:[],failed_requests:[],responses:[],
    verified_relationships:0,market_completeness_verified:false,canonical_database_mutated:false,messages_sent:0,paid_service_calls:0,
    limitations:['Rendered links and logos are evidence candidates, not verified organisational relationships.','External resources outside explicit host scope are blocked and may affect rendering.','No clicking, form submission, login, challenge bypass, or exhaustive carousel discovery.']};
  const guard=()=>{const s=fs.statfsSync(output);if(s.bavail*s.bsize<limits.minimum_free_bytes)throw Error('2GiB storage guard');};
  const save=()=>fs.writeFileSync(path.join(output,'browser-capture-manifest.json'),JSON.stringify(report,null,2));
  let browser,bridge,lines,timer,expired=false,bridgeError='',sequence=0;const pending=new Map();
  const failPending=error=>{for(const value of pending.values())value.reject(error);pending.clear();};
  const stopBridge=()=>{failPending(Error('Guarded transport stopped'));if(bridge){bridge.stdin.destroy();bridge.kill('SIGKILL');}};
  const bridgeCode=String.raw`
import sys,json,base64,shutil
from scripts.market_map.transport import Transport
hosts=set(json.loads(sys.argv[1]))
t=Transport(allowed_hosts=hosts,max_requests=100,max_bytes=30000000,max_response_bytes=4000000,timeout=12,min_interval=.25,retries=0)
for line in sys.stdin:
 v={}
 try:
  v=json.loads(line)
  if shutil.disk_usage(sys.argv[2]).free<2147483648:raise RuntimeError('2GiB storage guard')
  r=t.fetch(v['url']);print(json.dumps({'id':v['id'],'status':r.status,'url':r.url,'headers':dict(r.headers),'body':base64.b64encode(r.body).decode(),'metrics':t.metrics()}),flush=True)
 except Exception as e:print(json.dumps({'id':v.get('id'),'error':str(e),'metrics':t.metrics()}),flush=True)
`;
  try {
    guard();save();
    timer=setTimeout(()=>{expired=true;stopBridge();browser?.close().catch(()=>{});},limits.deadline_ms);
    bridge=spawn('python3',['-B','-u','-c',bridgeCode,JSON.stringify(hosts),output],{stdio:['pipe','pipe','pipe']});
    bridge.stderr.on('data',b=>{bridgeError=(bridgeError+b.toString()).slice(-2000);});
    bridge.stdin.on('error',e=>failPending(e));
    bridge.on('error',e=>failPending(e));
    bridge.on('exit',code=>failPending(Error(`Guarded transport exited ${code}: ${bridgeError}`)));
    lines=createInterface({input:bridge.stdout});
    lines.on('line',line=>{try{const value=JSON.parse(line),entry=pending.get(value.id);if(entry){pending.delete(value.id);entry.resolve(value);}}catch(e){failPending(e);}});
    const fetch=target=>new Promise((resolve,reject)=>{if(expired||bridge.exitCode!==null)return reject(Error('Capture deadline or bridge exit'));const id=++sequence;pending.set(id,{resolve,reject});bridge.stdin.write(JSON.stringify({id,url:target})+'\n');});
    let playwright;
    try { playwright=await import(process.env.SATURN_PLAYWRIGHT_MODULE || 'playwright'); }
    catch (error) {
      if(process.env.SATURN_PLAYWRIGHT_MODULE || process.platform!=='darwin') throw error;
      playwright=await import('/Users/owoblo/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs');
    }
    const {chromium}=playwright;
    const channel=process.env.SATURN_BROWSER_CHANNEL || (process.platform==='darwin'?'chrome':undefined);
    browser=await chromium.launch({headless:true,channel,timeout:20000});
    if(expired)throw Error('Capture deadline');
    const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:1440,height:1000}});
    if(context.routeWebSocket)await context.routeWebSocket('**/*',socket=>socket.close());
    await context.route('**/*',async route=>{
      const request=route.request();
      try {
        guard();const reason=requestBlockReason(request.url(),request.method(),hosts);
        if(reason){report.blocked_requests.push({url:request.url(),reason});return await route.abort();}
        if(sequence>=limits.max_requests||expired)throw Error('Capture resource limit');
        const response=await fetch(request.url());report.transport_metrics=response.metrics;
        if(response.error)throw Error(response.error);
        const body=Buffer.from(response.body,'base64');
        if(/verify you are human|cf-chl-|\.well-known\/sgcaptcha/i.test(body.toString('utf8',0,10000)))throw Error('Access challenge; held without bypass');
        report.responses.push({url:request.url(),response_url:response.url,status:response.status,bytes:body.length,sha256:sha(body)});
        if(request.isNavigationRequest()&&response.url!==request.url()){
          // Preserve the publisher's final URL/base semantics in the browser.
          return await route.fulfill({status:302,headers:{location:response.url},body:''});
        }
        if(request.isNavigationRequest()&&request.frame()===request.frame().page().mainFrame()){
          fs.writeFileSync(path.join(output,'guarded-source.html'),body,{mode:0o600});
          report.source_html_sha256=sha(body);report.response_url=response.url;
        }
        const contentType=Object.entries(response.headers).find(([key])=>key.toLowerCase()==='content-type')?.[1]||'application/octet-stream';
        await route.fulfill({status:response.status,headers:{'content-type':contentType},body});
      }catch(error){report.failed_requests.push({url:request.url(),error:String(error).slice(0,1000)});await route.abort().catch(()=>{});}
    });
    const page=await context.newPage();
    page.on('pageerror',e=>(report.page_errors??=[]).push(String(e).slice(0,500)));
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:65000});
    await page.waitForLoadState('networkidle',{timeout:12000}).catch(()=>{report.network_idle_not_reached=true;});
    // Bounded scroll loads ordinary lazy content; carousels/interactions remain explicit gaps.
    for(let y=0;y<=8000;y+=1000){
      if(expired)throw Error('Capture deadline');
      const height=await page.evaluate(()=>document.documentElement.scrollHeight);
      if(y>height)break;
      await page.evaluate(value=>scrollTo(0,value),y);await page.waitForTimeout(100);
    }
    await page.evaluate(()=>scrollTo(0,0));
    const evidence=await page.evaluate(()=>{
      const text=value=>(value||'').replace(/\s+/g,' ').trim();
      const visible=node=>{const b=node.getBoundingClientRect(),s=getComputedStyle(node);return !!(b.width&&b.height)&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';};
      const heading=node=>{for(let parent=node.parentElement;parent&&parent!==document.body;parent=parent.parentElement){const h=parent.querySelector('h1,h2,h3,h4,h5,h6');if(h&&h!==node&&(h.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING))return text(h.textContent).slice(0,500);}return null;};
      const box=node=>{const b=node.getBoundingClientRect();return {x:b.x+scrollX,y:b.y+scrollY,width:b.width,height:b.height};};
      const captionContext=node=>{
        // Card captions are often siblings of an otherwise text-free image box.
        // Retain the nearest small caption container as evidence, never as an identity match.
        let ancestor=node.parentElement;
        for(let level=1;ancestor&&ancestor!==document.body&&level<=4;level++,ancestor=ancestor.parentElement){
          const caption=text(ancestor.innerText);
          if(!caption)continue;
          if(caption.length>700)return null;
          const candidates=Array.from(ancestor.querySelectorAll('strong,b,h1,h2,h3,h4,h5,h6,figcaption'))
            .filter(visible).map(element=>({text:text(element.innerText).slice(0,160),tag:element.tagName.toLowerCase()}))
            .filter(label=>label.text).slice(0,12);
          return {ancestor_tag:ancestor.tagName.toLowerCase(),ancestor_class:ancestor.getAttribute('class'),levels_up:level,
            visible_text:caption,candidate_labels:candidates,resolution_status:'caption_context_requires_review',
            label_identity_verified:false,relationship_verified:false};
        }
        return null;
      };
      const anchors=Array.from(document.querySelectorAll('a[href]')).filter(visible);
      const imageNodes=Array.from(document.querySelectorAll('img,svg')).filter(visible);
      return {page_url:location.href,title:document.title,document_height:document.documentElement.scrollHeight,
        visible_anchor_total:anchors.length,visible_image_svg_total:imageNodes.length,items_truncated:anchors.length>10000||imageNodes.length>10000,
        anchors:anchors.slice(0,10000).map((a,i)=>({ordinal:i+1,href_attribute:a.getAttribute('href'),resolved_url:a.href,
          text:text(a.innerText).slice(0,1000),title:a.getAttribute('title'),aria_label:a.getAttribute('aria-label'),
          nearest_heading:heading(a),parent_context:text(a.parentElement?.innerText).slice(0,1500),parent_tag:a.parentElement?.tagName,
          image_labels:Array.from(a.querySelectorAll('img')).map(img=>({alt:img.getAttribute('alt'),title:img.getAttribute('title'),src:img.getAttribute('src')})),
          svg_labels:Array.from(a.querySelectorAll('svg')).map(svg=>({title:text(svg.querySelector('title')?.textContent),aria_label:svg.getAttribute('aria-label')})),bounding_box:box(a)})),
        image_slots:imageNodes.slice(0,10000).map((node,i)=>({ordinal:i+1,kind:node.tagName.toLowerCase(),alt:node.getAttribute('alt'),title:node.getAttribute('title'),
          svg_title:text(node.querySelector('title')?.textContent),aria_label:node.getAttribute('aria-label'),src:node.getAttribute('src'),current_src:node.currentSrc||null,
          anchor_href:node.closest('a')?.getAttribute('href')||null,anchor_resolved_url:node.closest('a')?.href||null,
          nearest_heading:heading(node),parent_context:text(node.parentElement?.innerText).slice(0,1500),caption_context:captionContext(node),
          complete:node.tagName==='IMG'?node.complete:null,natural_width:node.naturalWidth||null,natural_height:node.naturalHeight||null,bounding_box:box(node)}))};
    });
    guard();const dom=Buffer.from(await page.content());
    if(dom.length>limits.max_dom_bytes)throw Error('Rendered DOM exceeds capture budget');
    fs.writeFileSync(path.join(output,'rendered-dom.html'),dom,{mode:0o600});
    fs.writeFileSync(path.join(output,'rendered-evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});
    const screenshotHeight=Math.min(limits.max_screenshot_height,Math.max(1,evidence.document_height));
    await page.screenshot({path:path.join(output,'rendered-page.png'),fullPage:true,clip:{x:0,y:0,width:1440,height:screenshotHeight},animations:'disabled',timeout:15000});
    report.screenshot={width:1440,height:screenshotHeight,page_height:evidence.document_height,clipped:evidence.document_height>screenshotHeight};
    report.visible_anchor_count=evidence.anchors.length;report.visible_image_svg_count=evidence.image_slots.length;
    report.items_truncated=evidence.items_truncated;
    report.status=report.failed_requests.length||report.blocked_requests.length||report.screenshot.clipped||evidence.items_truncated?'captured_with_rendering_gaps':'captured_pending_relationship_review';
  }catch(error){report.status=expired?'deadline_review':'partial_or_blocked';report.error=String(error).slice(0,2000);}
  finally {
    clearTimeout(timer);stopBridge();lines?.close();
    if(browser)await browser.close().catch(()=>{});
    report.completed_at=new Date().toISOString();
    report.files={};for(const filename of ['guarded-source.html','rendered-dom.html','rendered-evidence.json','rendered-page.png']){
      const file=path.join(output,filename);if(fs.existsSync(file))report.files[filename]={sha256:sha(fs.readFileSync(file)),bytes:fs.statSync(file).size};
    }
    save();
  }
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const report=await capture(config);console.log(JSON.stringify({status:report.status,source_url:report.source_url,visible_anchor_count:report.visible_anchor_count,visible_image_svg_count:report.visible_image_svg_count,error:report.error}));}
