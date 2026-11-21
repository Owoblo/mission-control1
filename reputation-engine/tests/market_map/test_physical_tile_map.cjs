const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],failed=[],tiles=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(r.url()));
  page.on('request',r=>{if(/physical\/20002\/.*\.js/.test(r.url()))tiles.push(r.url())});
  await page.goto(pathToFileURL(path.resolve(process.argv[2])).href,{waitUntil:'load'});
  await page.locator('[data-layer="buildings"]').waitFor();
  await page.locator('#land-use-legend').waitFor();
  assert.equal(await page.locator('[data-zone]').count(),9);
  await page.waitForFunction(()=>document.querySelector('#layer-status').textContent.includes('Zoning overview shown'));
  const before=await page.locator('canvas').screenshot();
  await page.locator('[data-zone="residential"]').uncheck();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert(!(await page.locator('canvas').screenshot()).equals(before),'Hiding residential must change the rendered map');
  await page.getByRole('button',{name:'Hide all',exact:true}).click();
  assert.equal(await page.locator('[data-zone]:checked').count(),0);
  await page.getByRole('button',{name:'Show all',exact:true}).click();
  assert.equal(await page.locator('[data-zone]:checked').count(),9);
  assert((await page.locator('#land-use-legend').textContent()).includes('Mixed residential / commercial'));
  await page.locator('#business-focus').click();
  assert.equal(await page.locator('#business-focus').getAttribute('aria-pressed'),'true');
  await page.locator('#business-focus').click();
  assert.equal(await page.locator('#business-focus').getAttribute('aria-pressed'),'false');
  assert((await page.locator('#title').textContent()).includes('physical research map'));
  await page.locator('#inspect-downtown').click();
  await page.waitForFunction(()=>document.querySelector('#layer-status').textContent==='Visible physical layers loaded.',{},{timeout:60000});
  assert(tiles.some(u=>u.includes('/buildings/')));
  await page.locator('[data-layer="buildings"]').uncheck();await page.locator('[data-layer="buildings"]').check();
  if(process.argv[3])await page.screenshot({path:process.argv[3].replace(/\.png$/,'-detail.png'),fullPage:true});
  await page.locator('#fit').click();
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  if(process.argv[3])await page.screenshot({path:process.argv[3],fullPage:true});
  console.log('PASS: physical map, local viewport tile loading, layer toggles, fit, no script or failed-request errors; tile requests '+tiles.length);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
