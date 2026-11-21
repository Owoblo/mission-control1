/* Local display-only tiles. Canonical source geometries remain in source artifacts. */
(()=>{
 const loaded=new Map(),pending=new Set(),failed=new Set(),overviews=new Map();
 let config=null,active=0,queued=[],generation=0;
 let businessFocus=false;
 const zoneStyles=D.municipality_code==='20002'?window.TorontoZoneStyles:null;
 const colours={buildings:'#92adc5',parcels:'#d1b28a',streets:'#e6e1c7',zoning:'#ad8cce'};
 const panel=document.createElement('section');panel.id='layer-panel';document.querySelector('aside').prepend(panel);
 const status=document.createElement('p');status.id='layer-status';panel.append(status);
 const controls=new Map();
 const zoneControls=new Map();
 function zoneVisible(f){return !zoneStyles||zoneControls.get(zoneStyles.classify(f.p.ZN_ZONE).id)?.checked!==false}
 function schedule(){requestAnimationFrame(draw)}
 window.physicalTile=(key,features)=>{loaded.set(key,features);pending.delete(key);schedule()};
 window.physicalOverview=(layer,features)=>{overviews.set(layer,features);schedule()};
 function load(url,key){
  active++;const script=document.createElement('script');script.src=url;
  script.onload=()=>{active--;script.remove();pump();schedule()};
  script.onerror=()=>{active--;pending.delete(key);failed.add(key);script.remove();pump();schedule()};document.head.append(script);
 }
 function pump(){while(active<4&&queued.length){const item=queued.shift();if(item.generation===generation)load(item.url,item.key);else pending.delete(item.key)}}
 function overlaps(a,b){return a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1]}
 function pathGeometry(g){
  ctx.beginPath();let parts;
  if(g.type==='Polygon')parts=g.coordinates;
  else if(g.type==='MultiPolygon')parts=g.coordinates.flat();
  else if(g.type==='LineString')parts=[g.coordinates];
  else if(g.type==='MultiLineString')parts=g.coordinates;else return false;
  for(const part of parts){part.forEach((p,i)=>{const q=xy(p);i?ctx.lineTo(...q):ctx.moveTo(...q)});if(g.type.includes('Polygon'))ctx.closePath()}return true;
 }
 window.drawPhysical=()=>{
  if(!config)return;
  const view=[bounds[0]-ox/s,bounds[3]-(h-oy)/s,bounds[0]+(w-ox)/s,bounds[3]+oy/s];
  const detail=(view[2]-view[0])<.12,visible=new Set();
  generation++;queued.forEach(item=>pending.delete(item.key));queued=[];
  for(const layer of ['zoning','parcels','streets','buildings']){
   if(!controls.get(layer)?.checked)continue;
   const info=config.layers[layer];let features=[];
   if(!detail){if(layer==='zoning')features=overviews.get(layer)||[];}
   else for(const tile of info.tiles){
    if(!overlaps(tile.bounds,view))continue;visible.add(tile.key);
    if(loaded.has(tile.key))features.push(...loaded.get(tile.key));
    else if(!pending.has(tile.key)&&!failed.has(tile.key)){pending.add(tile.key);queued.push({key:tile.key,url:config.base+tile.key+'.js',generation})}
   }
   ctx.strokeStyle=colours[layer];ctx.lineWidth=layer==='streets'?1.2:.65;const seen=new Set();
   for(const f of features){if(seen.has(f.id)||!overlaps(f.b,view)||(layer==='zoning'&&!zoneVisible(f)))continue;seen.add(f.id);if(!pathGeometry(f.g))continue;
    if(layer==='zoning'){
     const category=zoneStyles?.classify(f.p.ZN_ZONE);
     const colour=category?.colour||'#ad8cce';
     const dim=businessFocus&&category&&!category.focus;
     ctx.fillStyle=colour+(dim?'12':'88');ctx.strokeStyle=colour+(dim?'30':'cc');ctx.fill('evenodd');
    }
    ctx.stroke();
   }
  }
  if(D.municipality_code==='20002'){
   const p=xy([-79.30,43.55]);
   if(p[0]>0&&p[0]<w&&p[1]>0&&p[1]<h){ctx.save();ctx.fillStyle='#b5deee';ctx.textAlign='center';ctx.font='20px system-ui';ctx.fillText('Lake Ontario',p[0],p[1]);ctx.font='13px system-ui';ctx.fillText('Municipal boundary extends into the lake',p[0],p[1]+23);ctx.restore()}
  }
  // Keep a bounded viewport cache; dropped tiles can be reloaded from local disk.
  if(loaded.size>180)for(const key of loaded.keys()){if(!visible.has(key))loaded.delete(key);if(loaded.size<=140)break}
  pump();
  status.textContent=failed.size?'Some local tiles failed to load. Refresh to retry.':detail?(pending.size?'Loading visible local tiles…':'Visible physical layers loaded.'):(overviews.has('zoning')?'Zoning overview shown. Use Inspect downtown or + to see detailed buildings and parcels.':config.layers.zoning?'Loading zoning overview…':'Zoom in or use Inspect downtown to see the available physical layers.');
 };
 window.registerPhysical=configValue=>{
  config=configValue;
  const available=Object.keys(config.layers);
  if(!available.length){status.textContent='Physical layers: source acquisition pending for this municipality.';return}
  if(zoneStyles&&config.layers.zoning){
   const legend=document.createElement('section');legend.id='land-use-legend';
   const title=document.createElement('h2');title.textContent='Potential land use';legend.append(title);
   const note=document.createElement('p');note.textContent='Colours follow zoning, not confirmed occupants. Orange includes apartment-commercial zones (RAC).';legend.append(note);
   const focus=document.createElement('button');focus.id='business-focus';focus.textContent='Emphasize business research areas';focus.setAttribute('aria-pressed','false');
   focus.onclick=()=>{businessFocus=!businessFocus;focus.setAttribute('aria-pressed',String(businessFocus));focus.textContent=businessFocus?'Show all colours equally':'Emphasize business research areas';schedule()};legend.append(focus);
   const bulk=document.createElement('div');
   for(const [label,value] of [['Show all',true],['Hide all',false]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{for(const input of zoneControls.values())input.checked=value;schedule()};bulk.append(b)}legend.append(bulk);
   for(const g of zoneStyles.groups){const row=document.createElement('label');row.style.cssText='margin:7px 0;display:flex;align-items:center;gap:9px;cursor:pointer';const input=document.createElement('input');input.type='checkbox';input.checked=true;input.dataset.zone=g.id;input.onchange=schedule;zoneControls.set(g.id,input);const swatch=document.createElement('span');swatch.style.cssText='display:inline-block;width:18px;height:18px;border-radius:3px;flex-shrink:0;background:'+g.colour;row.append(input,swatch,document.createTextNode(g.label));row.title=g.codes.join(', ');legend.append(row)}
   const filterNote=document.createElement('p');filterNote.textContent='Uncheck a colour to hide its zoning areas. Building, parcel and street outlines have separate controls below.';legend.append(filterNote);
   const foot=document.createElement('small');foot.textContent='Business focus keeps apartments, mixed-use, commercial, industrial and institutional zones prominent; other areas remain visible. Rental tenure and current use require research.';legend.append(foot);
   const source=document.createElement('a');source.href=zoneStyles.source;source.target='_blank';source.rel='noopener';source.textContent='Toronto zoning code definitions';legend.append(document.createElement('br'),source);
   panel.prepend(legend);
  }
  document.querySelector('#title').textContent=D.name+' · physical research map';
  const nav=document.createElement('span');nav.id='physical-navigation';
  for(const [label,factor] of [['+',1.8],['−',1/1.8]]){const b=document.createElement('button');b.textContent=label;b.setAttribute('aria-label',factor>1?'Zoom in':'Zoom out');b.onclick=()=>{ox=w/2-(w/2-ox)*factor;oy=h/2-(h/2-oy)*factor;s*=factor;draw()};nav.append(b)}
  if(D.municipality_code==='20002'){const b=document.createElement('button');b.id='inspect-downtown';b.textContent='Inspect downtown';b.onclick=()=>{s=140000;ox=w/2-(-79.383-bounds[0])*s;oy=h/2-(bounds[3]-43.653)*s;draw()};nav.append(b)}
  document.querySelector('#fit').after(nav);
  const oldHeading=[...document.querySelectorAll('aside h2')].find(h=>!panel.contains(h));
  oldHeading.textContent='Map outlines';
  oldHeading.nextElementSibling.textContent='Thin blue outlines: buildings · Tan: parcels · Cream: centreline. Coloured areas show zoning categories; see the land-use legend above.';
  for(const [name,info] of Object.entries(config.layers)){
   const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=true;input.dataset.layer=name;input.onchange=schedule;
   controls.set(name,input);label.append(input,document.createTextNode(' '+name+' ('+info.stats.accepted_features.toLocaleString()+' features) '));panel.append(label,document.createElement('br'));
   if(info.overview)load(config.base+name+'/overview.js','overview:'+name);
  }
  const attribution=document.createElement('p');attribution.textContent=config.attribution+' Display geometry is simplified. Invalid source geometries are held for review.';panel.append(attribution);
  if(D.municipality_code==='20002'){const caveat=document.createElement('p');caveat.textContent='The municipal boundary includes part of Lake Ontario; the large southern area is water. Centreline includes roads, trails, railways and other features. Zoning catalogue notes amendments through June 18, 2023; read with current by-law text. Building outlines can include multiple roof sections.';panel.append(caveat)}
  const labels={buildings:'building',parcels:'parcel',streets:'centreline',zoning:'zoning'};
  document.querySelector('#summary').textContent=Object.entries(config.layers).map(([k,v])=>v.stats.accepted_features.toLocaleString()+' '+labels[k]+' features').join(' · ');
  schedule();
  if(location.hash==='#downtown')document.querySelector('#inspect-downtown')?.click();
 };
 let pointerStart=null;
 canvas.addEventListener('pointerdown',e=>{pointerStart=[e.clientX,e.clientY]});
 canvas.addEventListener('click',e=>{
  if(!pointerStart||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>5)return;
  const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
  for(const layer of ['buildings','parcels','streets','zoning']){
   if(!controls.get(layer)?.checked)continue;
   const seen=new Set(),features=[...loaded.entries()].filter(([k])=>k.startsWith(layer+'/')).flatMap(([,v])=>v);
   if(layer==='zoning'&&!features.length)features.push(...(overviews.get(layer)||[]));
   for(const f of features){if(seen.has(f.id)||(layer==='zoning'&&!zoneVisible(f)))continue;seen.add(f.id);if(!pathGeometry(f.g))continue;
    const hit=f.g.type.includes('Polygon')?ctx.isPointInPath(x*devicePixelRatio,y*devicePixelRatio,'evenodd'):ctx.isPointInStroke(x*devicePixelRatio,y*devicePixelRatio);
    if(hit){document.querySelector('#detail').textContent=(layer==='zoning'&&zoneStyles?'Potential use: '+zoneStyles.classify(f.p.ZN_ZONE).label+'\n':'')+'Source '+layer+' feature '+f.id+'\n'+Object.entries(f.p).map(([k,v])=>k+': '+v).join('\n')+'\nPhysical source observation; occupants unverified.';draw();return}
   }
  }draw();
 });
})();
