"""Public SourceWindsorEssex directory snapshot; no login, paid APIs or outreach.
Run with --refresh to retrieve listings, sectors and public contact fields again.
"""
import concurrent.futures, csv, datetime, hashlib, json, pathlib, re, sys, time, urllib.parse, urllib.request

ROOT=pathlib.Path(__file__).resolve().parents[1]
RUN_DATE=sys.argv[sys.argv.index('--run-date')+1] if '--run-date' in sys.argv else datetime.date.today().isoformat()
datetime.date.fromisoformat(RUN_DATE)
RUN=ROOT/'partnership-system/markets/ca/on/windsor-essex/runs'/RUN_DATE
RUN.mkdir(parents=True,exist_ok=True)
BASE='https://sourcewindsoressex.com'
def get(path):
    request=urllib.request.Request(BASE+'/api/v1/companies/'+path,headers={'User-Agent':'Mozilla/5.0'})
    with urllib.request.urlopen(request,timeout=30) as response: return json.load(response)
def save(name,data): (RUN/name).write_text(json.dumps(data,indent=2))
def write_csv(name,rows,fields):
    with (RUN/name).open('w') as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(rows)
if '--refresh' in sys.argv:
    for path,name in [('companySearch?search=','source-companies.json'),('browseBySectorList','source-sectors.json'),('browseByCityList','source-cities.json')]:save(name,get(path))
    results=[]
    for s in json.loads((RUN/'source-sectors.json').read_text())['Data']:
        path='getCompanyBySector/'+urllib.parse.quote(s['_id'],safe='')
        try: results.append(dict(sector=s['_id'],source_url=BASE+'/api/v1/companies/'+path,reported_count=s['count'],rows=get(path)['Data'],ok=True))
        except Exception as e: results.append(dict(sector=s['_id'],rows=[],error=str(e),ok=False))
        time.sleep(.15)
    save('source-sector-results.json',results)

records={r['_id']:r for r in json.loads((RUN/'source-companies.json').read_text())['Data']}
sectors={}
for group in json.loads((RUN/'source-sector-results.json').read_text()):
    for r in group['rows']:
        records.setdefault(r['_id'],r);sectors.setdefault(r['_id'],[]).append(group['sector'])
profile_path=RUN/'public-profiles.json'
profiles=json.loads(profile_path.read_text()) if profile_path.exists() else {}
if '--profiles' in sys.argv:
    def profile(pair):
        ident,row=pair
        try:
            d=get('public/'+ident)['Data']
            # Keep public business fields only, excluding account/login and editor metadata.
            clean={k:d.get(k) for k in ['demographics','contactDetails','industry','serviceKeywords','updatedAt','isPublished']}
            clean['retrieved_at']=RUN_DATE;return ident,clean
        except Exception as e:return ident,{'error':str(e)}
        finally:time.sleep(.25)
    pending=[(i,r) for i,r in records.items() if i not in profiles or profiles[i].get('error')]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for n,(ident,p) in enumerate(pool.map(profile,pending),1):
            profiles[ident]=p
            if n%50==0:save('public-profiles.json',profiles);print('Public profiles:',n,flush=True)
    save('public-profiles.json',profiles)

def norm(s):return re.sub(r'[^a-z0-9]','',str(s).lower())
def domain(s):
    if not s:return ''
    return (urllib.parse.urlparse(s if '://' in s else 'https://'+s).hostname or '').lower().removeprefix('www.')
accounts=[]; contacts=[]; seen={}; domain_names={}; duplicates=[]
for ident,r in records.items():
    p=profiles.get(ident,{})
    d=p.get('demographics') or r.get('demographics',{});c=p.get('contactDetails') or r.get('contactDetails',{})
    name=d.get('companyTitle','').strip();site=c.get('website','') or '';host=domain(site)
    canonical=norm(name)+'|'+host;account_id='we-'+hashlib.sha256(canonical.encode()).hexdigest()[:16]
    label='; '.join(sectors.get(ident,[]));flags=[]
    if 'test' in label.lower():flags.append('source_category_test_annotation_review')
    if not d.get('city'):flags.append('municipality_missing')
    city_label=(d.get('city') or '').strip()
    municipalities={n.lower():n for n in ['Windsor','Amherstburg','Essex','Kingsville','Lakeshore','LaSalle','Leamington','Tecumseh']}
    municipality=municipalities.get(city_label.lower(),'')
    if city_label and not municipality:flags.append('community_or_boundary_review')
    if not site:flags.append('website_missing')
    if p.get('error'):flags.append('profile_fetch_failed')
    if ident not in profiles:flags.append('profile_not_fetched')
    if not label:flags.append('sector_unclassified')
    if canonical in seen:duplicates.append(dict(source_id=ident,possible_duplicate_of=seen[canonical],reason='exact_normalized_name_and_domain'))
    else:seen[canonical]=ident
    if host:domain_names.setdefault(host,set()).add(name)
    source=BASE+'/company-details/'+ident
    row=dict(account_id=account_id,source_id=ident,name=name,website=site,domain=host,address=d.get('address',''),city=d.get('city',''),province=d.get('province',''),postal_code=d.get('postalCode',''),phone=c.get('phoneNumber',''),source_categories=label,source_url=source,retrieved_at=RUN_DATE,provider_updated_at=p.get('updatedAt',''),verification_status='directory_discovery_needs_current_verification',relationship_status='research',quality_flags=';'.join(flags))
    accounts.append(row)
    row['normalized_city_label']=city_label.title()
    row['canonical_municipality']=municipality
    row['geography_status']='municipality_label_matched_site_not_geocoded' if municipality else 'address_boundary_review_required'
    for prefix,kind in [('', 'general'),('executive','executive'),('sales','sales')]:
        email=(c.get(prefix+'Email' if prefix else 'email','') or '').strip()
        person=(c.get(prefix+'Name','') or '').strip() if prefix else ''
        title=c.get(prefix+'Title','') if prefix else 'General business inquiry'
        if not email and not person:continue
        contacts.append(dict(account_id=account_id,source_id=ident,account_name=name,contact_name=person,role=title or kind,email=email,phone=c.get(prefix+'Telephone','') if prefix else c.get('phoneNumber',''),route_type=kind,source_url=source,retrieved_at=RUN_DATE,verification_status='public_directory_unverified',permission_status='needs_basis_review',sequence_paused=True))
for a in accounts:
    if len(domain_names.get(a['domain'],[]))>1:a['quality_flags']+=';shared_domain_multiple_names_review'
write_csv('accounts-and-locations.csv',accounts,list(accounts[0]))
write_csv('public-contact-routes.csv',contacts,['account_id','source_id','account_name','contact_name','role','email','phone','route_type','source_url','retrieved_at','verification_status','permission_status','sequence_paused'])
email_routes={}
for c in contacts:
    if not c['email']:continue
    k=(c['account_id'],c['email'].lower())
    if k not in email_routes:email_routes[k]={**c,'email':c['email'].lower(),'syntax_status':'plausible' if re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',c['email']) else 'invalid_needs_review'}
    else:
        for f in ['contact_name','role','route_type']:
            email_routes[k][f]='; '.join(dict.fromkeys(v for v in [email_routes[k][f],c[f]] if v))
write_csv('deduplicated-email-routes.csv',list(email_routes.values()),['account_id','source_id','account_name','contact_name','role','email','phone','route_type','source_url','retrieved_at','verification_status','permission_status','sequence_paused','syntax_status'])
write_csv('duplicate-review.csv',duplicates,['source_id','possible_duplicate_of','reason'])
counts=dict(source_records=len(accounts),candidate_accounts=len(seen),public_profiles=len([p for p in profiles.values() if not p.get('error')]),public_contact_routes=len(contacts),routes_with_email=sum(bool(c['email']) for c in contacts),named_routes=sum(bool(c['contact_name']) for c in contacts),unique_email_addresses=len({c['email'].lower() for c in contacts if c['email']}),account_email_pairs=len(email_routes),source_city_count=sum(r['count'] for r in json.loads((RUN/'source-cities.json').read_text())['Data']),quality_flagged_records=sum(bool(a['quality_flags']) for a in accounts),exact_duplicate_candidates=len(duplicates),retrieved_at=RUN_DATE,coverage='Directory snapshot, not all businesses; directory update dates are not current verification.')
save('directory-counts.json',counts);print(json.dumps(counts,indent=2))
