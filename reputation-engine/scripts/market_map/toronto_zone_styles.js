/* Research display categories, not determinations of actual property use. */
(()=>{
 const groups=[
  {id:'residential',label:'Residential',colour:'#60a5fa',codes:['R','RD','RS','RT','RM'],focus:false},
  {id:'apartments',label:'Residential apartments',colour:'#818cf8',codes:['RA'],focus:true},
  {id:'commercial',label:'Local commercial',colour:'#fb7185',codes:['CL'],focus:true},
  {id:'mixed',label:'Mixed residential / commercial',colour:'#f59e0b',codes:['CR','CRE','RAC'],focus:true},
  {id:'industrial',label:'Industrial / employment',colour:'#c084fc',codes:['E','EL','EH','EO'],focus:true},
  {id:'institutional',label:'Institutional',colour:'#22d3ee',codes:['I','IH','IE','IS','IPW'],focus:true},
  {id:'open',label:'Parks / open space',colour:'#4ade80',codes:['O','ON','OR','OG','OM','OC'],focus:false},
  {id:'utility',label:'Utilities / transportation',colour:'#94a3b8',codes:['UT'],focus:false},
  {id:'unknown',label:'Unclassified zoning',colour:'#e5e7eb',codes:[],focus:false}
 ];
 const lookup=new Map(groups.flatMap(g=>g.codes.map(code=>[code,g])));
 const api={groups,source:'https://www.toronto.ca/zoning/bylaw_amendments/ZBL_NewProvision_Chapter1_40.htm',
  classify:code=>lookup.get(String(code||'').trim().toUpperCase())||groups[groups.length-1]};
 if(typeof module!=='undefined')module.exports=api;else window.TorontoZoneStyles=api;
})();
