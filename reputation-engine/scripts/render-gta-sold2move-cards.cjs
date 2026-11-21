#!/usr/bin/env node
// Reuse Sold2Move's actual builder and assets; never alter its source or existing cards.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const source = process.env.SOLD2MOVE_ROOT || '/Users/owoblo/Downloads/sold2move';
const requireSold = createRequire(path.join(source, 'package.json'));
const { build } = require(path.join(source, 'scripts/generate-company-business-cards.cjs'));
const { PDFParse } = requireSold('pdf-parse');
const { PDFDocument } = requireSold('pdf-lib');
const { createCanvas, loadImage } = requireSold('@napi-rs/canvas');
const crypto = require('node:crypto');
const root = path.resolve('deliverables/gta-launch-20260926/sold2move-cards');
const cities = require('../lib/data/gta-service-cities.json');
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
async function main() {
 fs.mkdirSync(root,{recursive:true});
 const mapping=[];
 for (const city of cities) {
  const location={slug:slugify(city),city,region:'toronto',hub:'toronto',localized:true,business:'Saturn Star Movers',phone:'437-782-3004',email:slugify(city).replaceAll('-', '')+'@starmovers.ca',url:'https://starmovers.ca/'};
  const dir=path.join(root,location.slug);fs.mkdirSync(dir,{recursive:true});
  const bytes=await build(location);fs.writeFileSync(path.join(dir,'card.pdf'),bytes);
  const doc=await PDFDocument.load(bytes);
  if(doc.getPageCount()!==2)throw Error('Expected two card sides');
  for(const p of doc.getPages()) {
   const trim=p.getTrimBox(),bleed=p.getBleedBox();
   if(trim.width!==252||trim.height!==144||bleed.width!==270||bleed.height!==162)throw Error('Unexpected print dimensions');
  }
  const parser=new PDFParse({data:Buffer.from(bytes)});
  const rendered=await parser.getScreenshot({desiredWidth:1400,imageDataUrl:false,imageBuffer:true});await parser.destroy();
  const images=await Promise.all(rendered.pages.map(p=>loadImage(p.data)));
  for(let i=0;i<images.length;i++){
   const canvas=createCanvas(images[i].width,images[i].height);canvas.getContext('2d').drawImage(images[i],0,0);
   fs.writeFileSync(path.join(dir,i?'back.jpg':'front.jpg'),canvas.toBuffer('image/jpeg',90));
  }
  const share=createCanvas(images[0].width,images[0].height+images[1].height+24);const ctx=share.getContext('2d');ctx.fillStyle='#071421';ctx.fillRect(0,0,share.width,share.height);ctx.drawImage(images[0],0,0);ctx.drawImage(images[1],0,images[0].height+24);
  fs.writeFileSync(path.join(dir,'card.jpg'),share.toBuffer('image/jpeg',88));
  mapping.push({...location,share:location.slug+'/card.jpg',pdf:location.slug+'/card.pdf',pdfSha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 }
 fs.writeFileSync(path.join(root,'city-contact-mapping.json'),JSON.stringify(mapping,null,2)+'\n');
 fs.writeFileSync(path.join(root,'index.html'),`<!doctype html><meta charset="utf-8"><title>GTA + Hamilton business cards</title><style>body{font:16px system-ui;background:#f7f4ed;color:#071421;margin:30px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}img{width:100%}article{max-width:480px}a{color:#071421}</style><h1>GTA + Hamilton — Sold2Move card previews</h1><p>29 city variants · Same Sold2Move builder · Sales 437-782-3004 · City email aliases using the existing fallback, as confirmed by John.</p><main>${mapping.map(r=>`<article><h2>${r.city}</h2><a href="${r.share}"><img loading="lazy" src="${r.share}" alt="${r.city} business card"></a><p><a href="${r.pdf}">Print PDF</a></p></article>`).join('')}</main>`);
 fs.writeFileSync(path.join(root,'generation-receipt.json'),JSON.stringify({count:mapping.length,builder:path.join(source,'scripts/generate-company-business-cards.cjs'),builderSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'scripts/generate-company-business-cards.cjs'))).digest('hex'),status:'local_preview_not_published',trimInches:[3.5,2],bleedInches:0.125,outputs:['front.jpg','back.jpg','card.jpg','card.pdf'],emailNote:'Owner confirmed existing city alias fallback; no mailbox configuration changed',phoneNote:'Sales number on customer-forwardable card; partnership sender remains separate'},null,2));
 console.log(JSON.stringify({cities:mapping.length,root,files:mapping.length*4,status:'local_preview_not_published'}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
