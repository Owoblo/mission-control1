const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=path.resolve(process.argv[2]);
 const summary=JSON.parse(fs.readFileSync(path.join(root,'summary.json')));
 const labels=JSON.parse(fs.readFileSync(path.join(root,'configured-community-manifest.json')));
 const municipalities=JSON.parse(fs.readFileSync(path.join(root,'municipality-manifest.json')));
 assert.equal(labels.length,summary.configured_labels);
 assert.equal(summary.counts.input_observations,summary.mapped_unique_source_observations+summary.counts.duplicate_source_ids+summary.counts.outside_or_ambiguous_boundary+(summary.counts.invalid_coordinates||0));
 assert(summary.boundary_geometry_reviews.some(r=>r.name==='Brantford'));
 assert(!municipalities.some(r=>r.name==='Brantford'));
 for(const row of labels)if(row.municipality_code)assert(fs.existsSync(path.join(root,'maps',row.municipality_code+'.html')));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);
  assert.equal(await page.locator('tbody tr').count(),labels.length);
  await page.locator('#search').fill('Scarborough');assert.equal(await page.locator('tbody tr:visible').count(),1);
  for(const city of ['Toronto','Windsor','Tecumseh']){
   const row=municipalities.find(r=>r.name===city);assert(row);
   await page.goto(pathToFileURL(path.join(root,row.map)).href);
   assert((await page.locator('h1').textContent()).includes(city));
   if(city==='Toronto')assert((await page.locator('#scope').textContent()).includes('partial'));
   const example=await page.evaluate(()=>D.places.find(p=>p[2]));
   if(example){
    await page.locator('#search').fill(example[2]);assert(await page.locator('#results button').count()>0);
    await page.locator('#results button').first().click();assert((await page.locator('#detail').textContent()).includes('unverified'));
   }else{assert.equal(row.place_observations,0);assert((await page.locator('#summary').textContent()).startsWith('0 place observations'));}
   await page.locator('#fit').click();
   if(city==='Tecumseh'){await page.locator('#physical a').click();assert((await page.locator('h1').textContent()).includes('Tecumseh'));}
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: conservation of observations, preserved labels, held invalid geometry, map links, search, source limits, source details, physical pilot navigation; no browser errors');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
