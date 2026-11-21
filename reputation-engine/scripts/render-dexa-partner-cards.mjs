import fs from 'node:fs/promises';
import {chromium} from '/Users/owoblo/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const root='partnership-system/exports/dexa-cards-20260916';
await fs.mkdir(root,{recursive:true});
const logo=await fs.readFile('/private/tmp/dexa-logo-reference.jpg');
await fs.writeFile(root+'/official-dexa-logo.jpg',logo);
const cards=JSON.parse(await fs.readFile('lib/data/partner-business-cards.json')).filter(c=>c.business==='Dexa Movers');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1000,height:1280},deviceScaleFactor:1});
for(const card of cards){
 if(card.phone!=='613-519-3236'||card.email!=='hello@dexamovers.ca')throw Error('Wrong Dexa route in catalog');
 const city=card.city.replace(/&/g,'&amp;').replace(/</g,'&lt;');
 const html=`<!doctype html><html><head><meta charset="utf-8"><style>@page{size:1000px 1280px;margin:0}*{box-sizing:border-box}body{margin:0;width:1000px;height:1280px;background:#fafafa;font-family:Arial,sans-serif;color:#0d2345}.top{height:455px;display:flex;align-items:center;justify-content:center;background:#fff}.top img{width:350px;height:358px;object-fit:contain}.middle{height:370px;padding:54px 65px;background:#0d2345;color:white}.eyebrow{font-size:19px;font-weight:700;letter-spacing:3px;color:#f9a316;margin-bottom:24px}.headline{font-size:49px;line-height:1.12;font-weight:700}.city{font-size:${city.length>22?31:40}px;font-weight:700;color:#f9a316;margin-top:34px}.surround{font-size:19px;margin-top:10px;letter-spacing:1px}.bottom{padding:40px 65px}.cta{font-size:30px;font-weight:700;margin-bottom:26px}.phone{font-size:58px;letter-spacing:1px;font-weight:700;color:#0d2345;text-decoration:none}.email{font-size:28px;margin-top:23px}.web{font-size:27px;margin-top:17px}.footer{font-size:18px;color:#56616f;margin-top:26px}a{color:inherit;text-decoration:none}</style></head><body><div class="top"><img src="data:image/jpeg;base64,${logo.toString('base64')}" alt="Dexa Movers — Heavy Lifting, Light Touch"></div><div class="middle"><div class="eyebrow">HOME · APARTMENT · OFFICE MOVING</div><div class="headline">A clearer move<br>begins with a plan.</div><div class="city">${city.toUpperCase()}</div><div class="surround">&amp; SURROUNDING AREAS</div></div><div class="bottom"><div class="cta">Let's plan your move.</div><a class="phone" href="tel:+16135193236">613-519-3236</a><div class="email"><a href="mailto:hello@dexamovers.ca">hello@dexamovers.ca</a></div><div class="web"><a href="https://dexamovers.ca">dexamovers.ca</a></div><div class="footer">Share this card with someone planning a move.</div></div></body></html>`;
 const dir=root+'/'+card.slug;await fs.mkdir(dir,{recursive:true});await fs.writeFile(dir+'/card.html',html);
 await page.setContent(html,{waitUntil:'load'});await page.screenshot({path:dir+'/card.jpg',type:'jpeg',quality:93});await page.pdf({path:dir+'/card.pdf',printBackground:true,preferCSSPageSize:true});
}
await browser.close();console.log(JSON.stringify({cards:cards.length,root,phone:'613-519-3236',logoSource:'https://dexamovers.ca/brand/dexa-logo-reference.jpg'}));
