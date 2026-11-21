import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isOttawa} from '../lib/partnership-core/ottawa.mjs';
const root='partnership-system/markets/ca/on/ottawa/runs/2026-09-17-mortgage-brokers';
const raw=(await fs.readFile(root+'/google-listings.tsv','utf8')).trimEnd().split('\n').slice(1).map((line,index)=>{const [name,phone,city]=line.split('\t');return {sourceRow:index+1,name,phone,city:city||null};});
const crm=JSON.parse(await fs.readFile(root+'/crm-before.json'));
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const digits=s=>String(s||'').split(/ext\.?/i)[0].replace(/\D/g,'').slice(-10);
const uuid=s=>{const h=createHash('sha256').update(s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
const verified={
 '6136992006':{company:'Smart Debt Mortgages',website:'https://andrewthake.com/contact/',email:'hello@andrewthake.com'},
 '6133242389':{company:'Smart Debt Mortgages',website:'https://www.chrisallard.ca/contact-chris-allard/'},
 '6137239800':{company:'Smart Debt Mortgages'},
 '6137981973':{company:'Mortgage Brokers Ottawa',website:'https://mortgagebrokers-ottawa.secureapponline.com/our-brokers/?l=Y'},
 '6135633447':{company:'Ottawa-Carleton Mortgage Inc.',website:'https://mortgagesmadeeasy.com/',email:'info@mortgagesmadeeasy.com'},
 '6137205348':{company:'Ottawa-Carleton Mortgage Inc.',website:'https://mortgagemoney.ca/contact-us/',email:'chris@mortgagemoney.ca'},
 '6137943558':{company:'Ottawa-Carleton Mortgage Inc.',website:'https://mortgagesmadeeasy.com/',email:'james@mortgagesmadeeasy.com'},
 '6135913591':{company:'The Mortgage Advisors',website:'https://themortgageadvisors.ca/meet-our-agents/'},
 '6132980365':{company:'The Mortgage Advisors',website:'https://themortgageadvisors.ca/agents/christa-tessier/'},
};
function group(r){if(verified[digits(r.phone)]?.company)return verified[digits(r.phone)].company;if(/Mortgage Brokers Ottawa|Mortgage Brokers City/i.test(r.name))return 'Mortgage Brokers Ottawa';if(/Mortgage Advisors|Moe Baalbaki|Josee Menard|Tristan Hall/i.test(r.name))return 'The Mortgage Advisors';if(/Referral Mortgages/.test(r.name))return 'Referral Mortgages';if(/Keyrate/i.test(r.name))return 'KeyRate Mortgage';if(/SJC Financial/.test(r.name))return 'SJC Financial';if(/Ottawa Carleton Mortgage/.test(r.name))return 'Ottawa-Carleton Mortgage Inc.';return r.name;}
const seen=new Map(),rows=[];
for(const r of raw){const key=digits(r.phone)||norm(r.name);if(seen.has(key)){seen.get(key).aliases.push(r);continue;}const matches=crm.contacts.filter(c=>digits(r.phone)?digits(c.phone)===digits(r.phone):norm(c.name)===norm(r.name)&&norm(c.city)===norm(r.city));const unique=[...new Map(matches.map(c=>[c.id,c])).values()];const outside=r.city&&!isOttawa(r.city);const otherCategory=/Advantage Brokers Real Estate|Danny Dawson/.test(r.name);const lender=/Westboro Mortgage Investment|Advanced Mortgage Investment|Bracken Mortgage|Prateek Verma/.test(r.name);const existing=unique.length===1?unique[0]:null;const city=r.city||existing?.city||null;
const holds=[];if(outside)holds.push('outside_ottawa_campaign');if(!city)holds.push('geography_unconfirmed');if(otherCategory)holds.push('realtor_not_mortgage_segment');if(lender)holds.push('lender_or_investment_segment_review');if(!r.phone)holds.push('missing_phone');if(/ext/i.test(r.phone))holds.push('office_extension_not_sms');if(unique.length>1)holds.push('ambiguous_crm_match');if(existing?.do_not_contact||existing?.stage==='dnc')holds.push('existing_suppression');
const row={...r,city,phone:digits(r.phone)?'+1'+digits(r.phone):null,extension:/ext/i.test(r.phone)?r.phone.split(/ext\.?/i)[1].trim():null,id:existing?.id||uuid('ottawa-mortgage-google-20260917:'+key),existing:!!existing,crmMatches:unique.map(c=>({id:c.id,name:c.name,city:c.city,company:c.company})),company:group(r),aliases:[],holds,verification:verified[digits(r.phone)]||null,draft:'Hi, Dr. Courage from Dexa Movers here. We help clients move in Ottawa and surrounding areas. Would a digital moving card be useful to keep handy for clients who are buying a home?',sender:{name:'Dr. Courage',brand:'Dexa Movers',phone:'+15482908695',email:'hello@dexamovers.ca'},state:'prepared_not_scheduled'};seen.set(key,row);rows.push(row);}
await fs.writeFile(root+'/prepared.json',JSON.stringify({source:'User-pasted Google Business Profile search results; individual listing URLs not supplied',sourceCapturedAt:'2026-09-17',sourceCount:raw.length,rows},null,2));
const summary={source:raw.length,deduplicated:rows.length,duplicateRows:raw.length-rows.length,existingMatches:rows.filter(r=>r.existing).length,ambiguous:rows.filter(r=>r.crmMatches.length>1).length,outside:rows.filter(r=>r.holds.includes('outside_ottawa_campaign')).length,unknownGeography:rows.filter(r=>r.holds.includes('geography_unconfirmed')).length,newOttawaCandidates:rows.filter(r=>!r.existing&&isOttawa(r.city)&&!r.holds.includes('realtor_not_mortgage_segment')).length};await fs.writeFile(root+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
