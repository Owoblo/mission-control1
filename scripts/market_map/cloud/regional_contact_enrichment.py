"""Bounded website-first contact discovery; never sends or declares a contact send-ready."""
import concurrent.futures,csv,datetime,fcntl,hashlib,json,re,sys,threading,shutil
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit,urljoin,urlunsplit
from lxml import html
from scripts.market_map.transport import Transport
from scripts.market_map.contact_page import parse_contact_page,parser_versions
from scripts.market_map.regional_occurrences import evidence_for_page
from scripts.market_map.phone_extraction import extract_published_phones
from scripts.market_map.email_extraction import extract_published_emails, VERSION as EMAIL_VERSION
from scripts.market_map.cloud.contact_capacity import capacity

ROOT=Path('/data/research')
OUT=ROOT/'artifacts/regional-contact-enrichment-20261104'
EXCLUDED={'park','beach','bridge','atm','historic_site','monument','parking','parking_lot','public_toilet','bus_stop','railway_station'}
SOCIAL={'facebook.com','instagram.com','linkedin.com','yelp.ca','yelp.com','yellowpages.ca','yp.ca','google.com','business.site','realtor.ca'}

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(path,obj):
    t=path.with_suffix(path.suffix+'.tmp');t.write_text(json.dumps(obj,ensure_ascii=False,indent=2));t.replace(path)
def canon(url):
    s=urlsplit(re.sub(r'^http:','https:',url.strip()))
    if s.scheme not in ('https','http') or not s.hostname or s.username or s.password:raise ValueError('Unsupported site URL')
    return urlunsplit((s.scheme,s.netloc.lower(),s.path or '/',s.query,''))
CITY_ORDER=["Windsor","LaSalle","Tecumseh","Lakeshore","Amherstburg","Essex","Kingsville","Leamington","Chatham-Kent"]

def group_inputs(rows, legacy=False):
    groups={}
    for r in rows:
        if not r.get('website') or r.get('category') in EXCLUDED:continue
        try:u=canon(r['website']);host=urlsplit(u).hostname.removeprefix('www.')
        except Exception:continue
        if any(host==h or host.endswith('.'+h) for h in SOCIAL):continue
        groups.setdefault(host,{'host':host,'records':[],'seeds':[]})['records'].append(r)
        if u not in groups[host]['seeds']:groups[host]['seeds'].append(u)
    # Work city by city; interleave categories within each city. Legacy order is
    # retained only when adopting the original in-flight regional pass.
    buckets={}
    for g in groups.values():
        first=g['records'][0];buckets.setdefault((first['municipality'],first.get('category') or ''),[]).append(g)
    ordered=[]
    if legacy:
        while buckets:
            for key in sorted(buckets):
                ordered.append(buckets[key].pop(0))
                if not buckets[key]:del buckets[key]
    else:
        cities=sorted({k[0] for k in buckets},key=lambda c:CITY_ORDER.index(c) if c in CITY_ORDER else 99)
        for city in cities:
            while any(k[0]==city for k in buckets):
                for key in sorted(k for k in buckets if k[0]==city):
                    ordered.append(buckets[key].pop(0))
                    if not buckets[key]:del buckets[key]
    return ordered

def capture(g):
    ident=hashlib.sha256(g['host'].encode()).hexdigest()[:20];folder=OUT/'sources'/ident;folder.mkdir(parents=True,exist_ok=True)
    receipt=folder/'receipt.json'
    if receipt.exists():
        cached=json.loads(receipt.read_text())
        changed=False
        for page in cached.get('pages',[]):
            if page.get('parser_versions')==parser_versions() and not page.get('parser_errors'):continue
            try:
                source=Path(page['body_path']).resolve()
                if folder.resolve() not in source.parents:raise ValueError('Unexpected saved source path')
                if source.stat().st_size>3000000:raise ValueError('Saved source exceeds cap')
                body=source.read_bytes()
                if hashlib.sha256(body).hexdigest()!=page['sha256']:raise ValueError('Saved source hash mismatch')
                parsed=parse_contact_page(body,{'url':page['url'],'sha256':page['sha256'],'captured_at':page.get('captured_at')})
                page.setdefault('parse_history',[]).append({k:page[k] for k in ('emails','phones','context','structured_contacts','decoding_uncertainty','parser_versions','parser_errors','email_extraction_version','processed_at') if k in page})
                page.update({k:parsed[k] for k in ('emails','phones','context','structured_contacts','parser_versions','parser_errors','decoding_uncertainty')})
                page.update(email_extraction_version=EMAIL_VERSION,processed_at=now(),processing_mode='reparse')
                page.pop('email_recheck_error',None)
            except (OSError,ValueError,KeyError) as exc:page['email_recheck_error']=str(exc)[:240]
            changed=True
        if changed:save(receipt,cached)
        return cached
    hosts={g['host'],'www.'+g['host']}
    t=Transport(max_requests=12,max_bytes=12000000,max_response_bytes=3000000,timeout=8,retries=0,allowed_hosts=hosts)
    todo=[(u,0) for u in g['seeds'][:2]];seen=set();pages=[];errors=[]
    while todo and len(seen)<5:
        u,depth=todo.pop(0)
        if u in seen:continue
        seen.add(u)
        try:
            response=t.fetch(u,allowed_hosts=hosts)
            if response.status!=200:raise ValueError('HTTP '+str(response.status))
            body=response.body;doc=html.fromstring(body);n=len(pages);file=folder/(str(n)+'.html');file.write_bytes(body)
            pg={'url':response.url,'captured_at':now(),'sha256':hashlib.sha256(body).hexdigest(),'body_path':str(file)}
            parsed=parse_contact_page(body,{k:pg[k] for k in ('url','captured_at','sha256')})
            pg.update({k:parsed[k] for k in ('emails','phones','context','structured_contacts','parser_versions','parser_errors','decoding_uncertainty')})
            pg.update(email_extraction_version=EMAIL_VERSION,processed_at=now(),processing_mode='capture_parse')
            pages.append(pg)
            if depth<2:
                for link in doc.xpath('//a[@href]'):
                    try:target=canon(urljoin(response.url,link.get('href')))
                    except Exception:continue
                    if urlsplit(target).hostname in hosts and re.search('contact|about|team|staff|people|leadership',link.text_content()+' '+urlsplit(target).path,re.I) and target not in seen:todo.append((target,depth+1))
            for element in doc.xpath('//script|//style|//noscript'):element.drop_tree()
            (folder/(str(n)+'.txt')).write_text(' '.join(doc.text_content().split()))
        except Exception as exc:errors.append({'url':u,'error':str(exc)[:240]})
    result={'host':g['host'],'checked_at':now(),'records':g['records'],'pages':pages,'errors':errors,'unvisited_links':list(dict.fromkeys(u for u,d in todo if u not in seen)),'bytes_saved':sum(Path(p['body_path']).stat().st_size for p in pages),'phase':'captured_for_contact_review' if pages else 'source_access_hold'}
    save(receipt,result);return result

def daily_plan(groups, output, day, limit, legacy_selection=None):
    plans=output/'daily-plans';plans.mkdir(exist_ok=True)
    path=plans/(day+'.json')
    if path.exists():
        plan=json.loads(path.read_text())
        if plan['domain_limit']!=limit:raise ValueError('Existing day budget cannot change implicitly')
        return plan
    if legacy_selection is not None:selected=legacy_selection
    else:
        selected=[g for g in groups if not (output/'sources'/hashlib.sha256(g['host'].encode()).hexdigest()[:20]/'receipt.json').exists()][:limit]
    plan={'day':day,'created_at':now(),'domain_limit':limit,'hosts':[g['host'] for g in selected],'state':'planned','priority':CITY_ORDER}
    save(path,plan);return plan

def main(limit=None):
    limits=capacity();limit=limits['domains'] if limit is None else limit
    OUT.mkdir(parents=True,exist_ok=True);lock=(OUT/'worker.lock').open('a+b');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    rows=json.loads((ROOT/'artifacts/windsor-region-map-20261104/places.json').read_text());groups=group_inputs(rows)
    day=datetime.datetime.now(ZoneInfo('America/Toronto')).date().isoformat()
    previous=json.loads((OUT/'status.json').read_text()) if (OUT/'status.json').exists() else {}
    # Adopt the first already-running historical pass without changing its frozen scope.
    legacy=None
    previous_day=datetime.datetime.fromisoformat(previous['started_at']).astimezone(ZoneInfo('America/Toronto')).date().isoformat() if previous.get('started_at') else None
    if previous_day==day and not previous.get('run_day'):
        legacy=group_inputs(rows,legacy=True)[:previous.get('selected_domains',limit)]
    plan=daily_plan(groups,OUT,day,limit,legacy)
    if plan['state']=='completed':return
    byhost={g['host']:g for g in groups};selected=[byhost[h] for h in plan['hosts']]
    status={'state':'running','run_day':day,'started_at':now(),'candidate_domains':len(groups),'pass_domain_limit':limit,'selected_domains':len(selected),'selected_place_records':sum(len(g['records']) for g in selected),'completed_domains':0,'captured_pages':0,'bytes_saved':0,'model_api_calls':0,'carrier_api_calls':0,'messages_sent':0,'send_ready_confirmed':0}
    status.update(workers=limits['workers'],source_byte_cap=limits['bytes'])
    save(OUT/'status.json',status);results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=limits['workers']) as pool:
        for start in range(0,len(selected),8):
            if shutil.disk_usage(OUT).free<5000000000:status['state']='disk_reserve_hold';break
            for result in pool.map(capture,selected[start:start+8]):
                results.append(result);status['completed_domains']+=1;status['captured_pages']+=len(result['pages']);status['bytes_saved']+=result['bytes_saved'];status['updated_at']=now();save(OUT/'status.json',status)
            if status['bytes_saved']>=limits['bytes']:status['state']='storage_budget_hold';break
    observations=[]
    for result in results:
        for r in result['records']:
            phones=[p for page in result['pages'] for p in page['phones'] if p.get('kind')!='fax']
            match=bool(r.get('phone_base')) and any(re.sub(r'\D','',p.get('phone',''))[-10:]==r['phone_base'] for p in phones)
            emails=[e for page in result['pages'] for e in page['emails']]
            observations.append({'source_record_id':r['source_record_id'],'organization':r['organization'],'municipality':r['municipality'],'category':r['category'],'phone_base':r.get('phone_base'),'website_phone_match':match,'published_email_observations':emails,'published_phone_observations':phones,'occurrence_evidence':[e for page in result['pages'] for e in evidence_for_page(page,result['records'])],'relationship_status':'host_candidate_not_verified','source_pages':[p['url'] for p in result['pages']],'next_stage':'identity_and_carrier_review' if match else 'email_identity_and_validation_review' if emails else 'source_or_address_review','send_ready':False})
    save(OUT/'contact-observations.json',observations)
    status.update(state='completed_for_review' if status['state']=='running' else status['state'],finished_at=now(),place_records_reviewed=len(observations),website_phone_matches=sum(r['website_phone_match'] for r in observations),records_with_email_observations=sum(bool(r['published_email_observations']) for r in observations),source_access_holds=sum(not r['pages'] for r in results))
    save(OUT/'status.json',status)
    plan.update(state='completed',outcome=status['state'],finished_at=now(),processed_domains=len(results));save(OUT/'daily-plans'/(day+'.json'),plan)
    save(OUT/'daily-plans'/(day+'-result.json'),status);print(json.dumps(status),flush=True)
if __name__=='__main__':main()
