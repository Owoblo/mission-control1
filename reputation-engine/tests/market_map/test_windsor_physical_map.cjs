// Browser smoke test against the generated offline map, not the production CRM.
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(process.argv[2]).href,{waitUntil:'load'});
  await page.locator('#districts tr').last().waitFor();
  assert.equal(await page.locator('#districts tr').count(),20);
  const names=await page.locator('#districts').textContent();
  for(const name of ['Sandwich','South Windsor','East Windsor','East Riverside'])assert(names.includes(name));
  await page.locator('#search').fill('wyandotte');
  assert((await page.locator('#results button').count())>0);
  await page.locator('#results button').first().click();
  assert((await page.locator('#detail').textContent()).includes('Occupancy unverified'));
  await page.locator('#fit').click();
  await page.locator('#points').uncheck();await page.locator('#points').check();
  const pos=await page.evaluate(()=>{
   const c=D.cells.find(f=>(f.properties.places||0)>10);
   // Search the visible grid for an interior point using canvas hit testing.
   path(c.geometry);
   for(let y=0;y<h;y+=5)for(let x=0;x<w;x+=5)if(ctx.isPointInPath(x*devicePixelRatio,y*devicePixelRatio,'evenodd'))return{x,y};
  });
  assert(pos);const bounds=await page.locator('#map').boundingBox();await page.mouse.click(bounds.x+pos.x,bounds.y+pos.y);
  assert((await page.locator('#detail').textContent()).includes('Grid '));
  assert.deepEqual(errors,[]);
  if(process.argv[3])await page.screenshot({path:process.argv[3],fullPage:true});
  console.log('PASS: offline map loads; 20 districts; corridor search; place focus; layer toggles; grid inspection; no JavaScript errors');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
