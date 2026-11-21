"""Conservative evidence rules for a review backlog; does not send or skip live admission."""
import json,re,hashlib
from pathlib import Path
from datetime import datetime,timezone
from urllib.parse import urlparse
P=Path('artifacts/partnership-pilot-3000-20261027')
def norm(s):return re.sub(r'[^a-z0-9]','',s.lower())
def host(s):return urlparse(s if '://' in s else 'https://'+s).hostname.removeprefix('www.')
def qualify(c,s):
 if c['email'].split('@')[-1].lower()!=c['domain'].removeprefix('www.').lower():return None
 if not s.get('target_email_observed') or s.get('restriction_signals'):return None
 if c.get('validation',{}).get('validation',{}).get('IsValid',{}).get('ConfidenceVerdict')!='HIGH':return None
 if re.search(r'career|recruit|privacy|support|billing|accounts|media|press|noreply|no-reply',c['email'].split('@')[0],re.I):return None
 if 'ottawa' in (c.get('catchment','')+' '+c['city']).lower():return None
 name=re.sub(r'\b(incorporated|limited|inc|ltd|llc|corp)\b\.?','',c['organisation_name'],flags=re.I).strip()
 if len(norm(name))<7:return None
 for page in s['pages']:
  url=page.get('final_url') or page.get('requested_url') or ''
  context=page.get('target_context') or '';excerpt=page.get('page_identity_excerpt') or '';text=excerpt+' '+context
  if not url or host(url)!=c['domain'].removeprefix('www.') or not page.get('target_email_observed'):continue
  if c['email'].lower() not in context.lower() or norm(name) not in norm(text):continue
  if not re.search(r'contact|e-?mail|owner|president|founder|manager|broker|principal',context,re.I):continue
  if norm(name) not in norm(excerpt[:240]) and norm(name) not in norm(context[:200]):continue
  if not re.search(r'(?<!\w)'+re.escape(c['city'])+r'(?!\w)',text,re.I):continue
  if not re.search(r'\b[KLMNP]\d[A-Z][ -]?\d[A-Z]\d\b',text,re.I):continue
  if re.search(r'careers?|employment|job applications?|resum[eé]|registration|admissions|technical support|privacy officer|franchise|subsidiary|division of|part of|member of.*group|formerly|now known as|managed by|owned by|operated by',text,re.I):continue
  return page,text
 return None

def run():
 candidates=[json.loads(x) for x in (P/'higher-confidence-admission-backlog.jsonl').read_text().splitlines()];src={r['organisation_id']:r for r in map(json.loads,(P/'source-refresh.jsonl').read_text().splitlines())};tech={r['organisation_id']:r for r in map(json.loads,(P/'role-inclusive-review.jsonl').read_text().splitlines())}
 prior=set()
 for name in ['practical-fit-source-review-20.jsonl','additional-practical-fit-source-review-55.jsonl','additional-reviewed-third-source.jsonl']:
  prior.update(r['organisation_id'] for r in map(json.loads,(P/name).read_text().splitlines()))
 # Explicit operational mappings, not invented per-city telephone numbers.
 regions={}
 for region,cities in {'windsor':['Windsor','Amherstburg','Lakeshore','Tecumseh','LaSalle','Essex','Kingsville','Leamington','Chatham-Kent','Chatham','Blenheim','Tilbury','Wallaceburg'],'waterloo':['Kitchener','Waterloo','Cambridge','Guelph','Elmira','Woolwich','Fergus','Elora'],'london':['London','St. Thomas','Sarnia','Woodstock','Tillsonburg','Ingersoll','Strathroy','St. Marys','Stratford','Petrolia','Grand Bend'],'gta':['Toronto','Mississauga','Brampton','Burlington','Hamilton','Oakville','Markham','Vaughan','Richmond Hill','Ajax','Pickering','Whitby','Oshawa','Aurora','Newmarket','Etobicoke','Scarborough','North York','Milton','Brantford','Brant','Ancaster','Dundas','Waterdown','Georgetown','Halton Hills','Caledon','Bolton']}.items():
  for city in cities:regions[city]=region
 phones={'windsor':'226-887-0667','waterloo':'226-241-9853','london':'548-639-1428','gta':'437-465-0584'}
 out=[]
 for c in candidates:
  if c['organisation_id'] in prior or c['city'] not in regions:continue
  if tech.get(c['organisation_id'],{}).get('technical_screen_status')!='advance_to_identity_and_eligibility_review':continue
  s=src[c['organisation_id']];result=qualify(c,s)
  if not result:continue
  page,text=result;city=c['city'];region=regions[city]
  sector='business_premises';para='If your team needs office furniture moved or unwanted office items cleared out, we would like to be the team you can call for help.'
  if re.search(r'janitorial|carpet cleaning|house cleaning|commercial cleaning|move.out cleaning',text,re.I):
   sector='cleaning';para='If one of your cleaning jobs needs furniture moved or unwanted items cleared out, we would like to be the team you can call for help.'
  elif re.search(r'property management|condominium management',text,re.I):
   sector='property_management';para='If a property handover needs furniture moved or unwanted items cleared out, we would like to be the team you can call and trust.'
  elif re.search(r'upholstery|furniture restoration|furniture repair',text,re.I) and re.search(r'furniture',text,re.I):
   sector='furniture_services';para='If one of your furniture projects needs a piece collected or delivered, we would like to be the team you can call for help.'
  elif re.search(r'\bkitchens?\b|\bcabinetry\b|\brenovations?\b',text,re.I):
   sector='renovation';para='If a renovation project needs furniture moved out of the way or unwanted items cleared, we would like to be the team you can call for help.'
  elif re.search(r'realtor|real estate brokerage',text,re.I):
   sector='real_estate';para='If your clients need help moving or clearing unwanted items around a property handover, we would like to be the team you can call and trust.'
  para+=' I wanted to see how we could work together across '+city+' and the surrounding areas.'
  evidence=dict(page,url=page.get('final_url') or page.get('requested_url'))
  out.append(dict(organisation_id=c['organisation_id'],organisation_name=c['organisation_name'],email=c['email'],reviewed_at=datetime.now(timezone.utc).isoformat(),reviewed_city=city,sender_region=region,regional_phone=phones[region],market='saturn',reviewed_sector=sector,identity_email_binding='pass',role_relevance='pass_for_conditional_context',finding='Automated higher-confidence source review: same official domain; full normalized business name, exact locality and Ontario postal code in saved page text; selected business email visible with contact/role label in context; no detected restriction or special-purpose/parent signals. Conditional '+sector+' service paragraph; no claim of current need or named decision-maker.',proposed_contextual_paragraph=para,sources=[evidence],review_method='automated_evidence_rules_v1',source_record_sha256=hashlib.sha256(json.dumps(s,sort_keys=True).encode()).hexdigest(),requires_parent_account_review=False))
 (P/'additional-reviewed-high-source.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in out))
 print(json.dumps({'qualified_source_records':len(out),'live_admission_not_yet_run':True}))
 for r in out:print(r['organisation_name'],r['reviewed_city'],r['reviewed_sector'],r['email'])
if __name__=='__main__':run()
