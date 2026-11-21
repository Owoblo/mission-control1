"""Resolve open-house listing gaps and direct contact routes from existing sources first."""
import argparse
import base64
from collections import Counter, defaultdict
from concurrent.futures import Future, ThreadPoolExecutor
import fcntl
import gzip
import json
import os
from pathlib import Path
import re
import runpy
import sys
from threading import Lock
from urllib.parse import unquote, urljoin, urlsplit


ROLE_WORDS = r'(?:listed by|listing agent|co-listing agent|listing courtesy of|listing provided by)'
BLOCKED_LISTING_HOSTS = {'www.realtor.ca','a1-ws-realtor-pr.realtor.ca','a2-ws-realtor-pr.realtor.ca'}
SHARED_LABEL = re.compile(r'\b(?:office|reception|switchboard|team line|main line|toll.free|fax)\b',re.I)


def words(value):
    return re.findall(r'[a-z0-9]+',unquote(str(value or '')).casefold())


def normalized(value):
    return ''.join(words(value))


def normal(value):
    return ' '.join(str(value or '').casefold().split())


def street_terms(address):
    part=str(address or '').split(',')[0]
    return set(words(part)) - {'unit','apt','street','st','road','rd','ave','avenue','drive','dr','crescent','court','lane','on'}


def listing_attribution(text, mls, name):
    if not mls or normalized(mls) not in normalized(text):
        return None
    pattern=ROLE_WORDS+r'\s*[:–-]?\s*'+re.escape(normal(name))+r'\b'
    match=re.search(pattern,text,re.I)
    return match[0] if match else None


def direct_evidence(name, occurrence, kind):
    context=normal(occurrence.get('context') or occurrence.get('short_supporting_context'))
    compact_name=normal(name)
    if not compact_name or not re.search(r'(?<!\w)'+re.escape(compact_name)+r'(?!\w)',context):
        return None
    if kind=='phone' and (occurrence.get('kind')!='phone' or occurrence.get('extension') or
                           occurrence.get('kind_review_required') or SHARED_LABEL.search(context)):
        return None
    return context[:500] if len(context)<=500 else None


class Sources:
    def __init__(self,root,folder):
        from scripts.market_map.trusted_source_capture import capture, normalized_text
        self.capture=capture;self.text=normalized_text;self.root=root;self.folder=folder
        self.lock=Lock();self.requests={};self.failures=Counter()

    def read(self,url):
        try:
            parsed=urlsplit(url)
        except (TypeError,ValueError):
            return None
        if parsed.scheme!='https' or not parsed.hostname or parsed.hostname in BLOCKED_LISTING_HOSTS:
            return None
        url=parsed._replace(fragment='').geturl()
        with self.lock:
            entry=self.requests.get(url)
            if entry is None:
                if len(self.requests)>=128:
                    for old in [k for k,v in self.requests.items() if v.done()][:32]:
                        del self.requests[old]
                entry=Future();self.requests[url]=entry;owner=True
            else:
                owner=False
        if owner:
            page=None
            try:
                receipt=self.capture(url,self.folder/'sources',self.root,private_directory=self.folder/'captures',
                                     same_origin=False,timeout=5,max_bytes=1250000,max_redirects=2)
                body=(self.root/receipt['body_path']).read_bytes()
                page={'url':url,'final_url':receipt['final_url'],'body':body,'text':self.text(body),
                      'sha256':receipt['body_sha256'],'checked_at':receipt['retrieved_at']}
            except (OSError,ValueError,RuntimeError,KeyError) as exc:
                with self.lock:
                    self.failures[str(getattr(exc,'status',None) or type(exc).__name__)]+=1
            finally:
                entry.set_result(page)
        return entry.result()


def run(folder, *, workspace=None):
    from lxml import html, etree
    p=workspace or folder.parent
    sys.path[:0]=['/data/research',str(p)]
    import scripts.market_map
    scripts.market_map.__path__[:0]=[str(p/'lib'),'/data/research/artifacts/partnership-enrichment-20261118/lib']
    from scripts.market_map.email_extraction import extract_published_emails
    from scripts.market_map.phone_extraction import extract_published_phones, NANP
    from scripts.research_hub.directory import Directory
    w=runpy.run_path(str(p/'worker.py'))
    read=w['read'];save=w['save'];root=w['ROOT'];phone=w['phone'];norm=w['normalize']
    out=folder/'source-first';out.mkdir(exist_ok=True)
    with (out/'worker.lock').open('a+b') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        queue=read(folder/'research-queue.json')
        feed=read(folder/'muse-open-house-intake.json') or read(p/'muse-open-house-intake.json')
        sec=read(root/'.private/regional-outcomes.json');db=w['database_rows']
        directory=Directory(); assert directory.available
        contacts=db(sec,'market_contacts','id,name,phone,email')
        sales=db(sec,'crm_leads','id,phone:data->>phone,email:data->>email',deleted='eq.false')
        crm_names=defaultdict(set);crm_routes=defaultdict(set)
        for r in contacts:
            crm_names[norm(r['name'])].add(r['id'])
            for route in (phone(r['phone']),normal(r['email'])):
                if route:crm_routes[route].add(r['id'])
        sales_routes={v for r in sales for v in (phone(r['phone']),normal(r['email'])) if v}
        source=Sources(root,out)
        listing_work={};agents={}; feed_by_name=defaultdict(list)
        for item in queue['unresolved_listings']:
            key=item.get('mls') or item['property_key']
            row=listing_work.setdefault(key,{'key':key,'mls':item.get('mls'),'city':item['city'],'events':{},'reasons':set()})
            row['events'].update({e['session_id']:e for e in item['events']});row['reasons'].add(item['reason'])
        for group in feed['items']:
            feed_by_name[norm(group['agent_name'])].append(group)

        def agent(name,brokerage=''):
            n=norm(name)
            r=agents.setdefault(n,{'id':n,'name':name,'brokerages':set(),'roles':{},'route_hints':{},'source_hints':set(),
                                  'needs_named_agent_review':False,'unverified_associations':[]})
            if brokerage:r['brokerages'].add(brokerage)
            return r

        def link(r,mls,source_url,role,quote,origin):
            if mls:
                r['roles'][(mls,source_url)]={'mls':mls,'source_url':source_url,'role':role,'proof':quote,'origin':origin}

        for group in queue['named_agent_candidates']:
            r=agent(group['name']);r['needs_named_agent_review']=True
            verified_ids={x['session_id'] for x in group['observations']}
            for match in feed_by_name[r['id']]:
                if match['agent_id']!=group['agent_id']:continue
                for event in match['observations']:
                    if event['session_id'] not in verified_ids:continue
                    if event.get('brokerage'):r['brokerages'].add(event['brokerage'])
                    if event.get('mls') and event.get('role') in ('listing_agent','co_listing_agent','confirmed_host'):
                        link(r,event['mls'],event.get('source_url'),event['role'],event['session_id'],'validated_feed_association')
        for item in read(folder/'source-reviewed-agents.json',{}).get('associations',[]):
            r=agent(item['name']);ref=item['business_route_source']
            if ref:r['source_hints'].add(ref)
            link(r,item['listing_mls'],item['listing_source'],'published_listing_association','manual source review','manual_research')
            for kind in ('phone','email'):
                value=item.get('published_business_'+kind)
                if value:r['route_hints'][(kind,value)]={'kind':kind,'value':value,'source_url':ref,'origin':'manual_publication_review'}
        for item in read(folder/'directory-publication-proof.json',{}).get('items',[]):
            if item['publication_matches']:
                r=agent(item['name'])
                for x in item['publication_matches']:r['source_hints'].add(x['source_url'])
        findings=defaultdict(list)
        for subfolder in ('first-pass-evidence-holds','results'):
            for path in sorted((folder/subfolder).glob('*.json')):
                item=read(path);findings[(item['type'],item['key'])].append(item)
                for person in item.get('agents',[]):
                    r=agent(person['name'],person.get('brokerage'))
                    for route in person.get('routes',[]):
                        r['source_hints'].add(route['source_url'])
                    if person.get('source_verified') and person.get('exact_mls'):
                        link(r,person.get('source_mls'),person['source_url'],person['role'],person.get('identity_quote'),'saved_source_verification')
        for f in (folder/'saved-source-rechecks').glob('*.json'):
            for proof in read(f)['listing_proofs']:
                link(agent(proof['name']),proof['mls'],proof['source_url'],'published_listing_association',proof['quote'],'alternate_publisher')

        def listing_lookup(row):
            events=list(row['events'].values())
            terms=street_terms(events[0].get('property_reference')) if events else set()
            prior=findings[('listing',row['key'])]
            urls={e['source_url'] for e in events if e.get('source_url')}
            known_names={r['name'] for x in prior for r in x.get('agents',[])}
            direct_urls=set()
            for x in prior:
                direct_urls.update(a['source_url'] for a in x.get('agents',[]) if a.get('source_url'))
                for u in x.get('source_urls',[]):
                    if len(terms & set(words(urlsplit(u).path)))>=2 or normalized(row['mls']) in normalized(urlsplit(u).path) and row['mls']:
                        direct_urls.add(u)
            for u in sorted(urls)[:2]:
                page=source.read(u)
                if not page:continue
                try:
                    doc=html.fromstring(page['body'])
                    for anchor in doc.xpath('//a[@href]'):
                        u2=urljoin(page['final_url'],anchor.get('href'))
                        tokens=set(words(anchor.text_content()+' '+urlsplit(u2).path))
                        if len(terms & tokens)>=max(2,min(3,len(terms))) and any(t.isdigit() for t in terms & tokens):
                            direct_urls.add(u2)
                except (etree.Error,ValueError):pass
            checked=[];proof=[]
            for url in sorted(direct_urls|urls,key=lambda u:(-len(terms & set(words(urlsplit(u).path))),u))[:6]:
                page=source.read(url)
                if not page:continue
                checked.append(page['url'])
                if not row['mls'] or normalized(row['mls']) not in normalized(page['text']):continue
                try:
                    title=' '.join(html.fromstring(page['body']).xpath('//title/text() | //h1//text()'))
                except etree.Error:
                    continue
                page_terms=terms & set(words(title+' '+urlsplit(url).path))
                if normalized(row['mls']) not in normalized(urlsplit(url).path) and (
                     len(page_terms)<2 or not any(t.isdigit() for t in page_terms)):
                    continue
                names=set(known_names)
                for candidate in re.findall(ROLE_WORDS+r'\s*[:–-]?\s*((?:[a-z][a-z\-’\']*\s+){1,3}[a-z][a-z\-’\']*)',page['text']):
                    tokens=candidate.split()
                    for length in range(2,len(tokens)+1):
                        matched=directory.by_name.get(norm(' '.join(tokens[:length])),[])
                        identities={x[0] for x in matched}
                        if len(identities)==1:names.add(matched[0][1]['name'])
                for name in sorted(names):
                    quote=listing_attribution(page['text'],row['mls'],name)
                    if quote:proof.append({'name':name,'source_url':url,'quote':quote,'sha256':page['sha256']})
                if proof:break
            return {'key':row['key'],'mls':row['mls'],'city':row['city'],'events':events,'reasons':sorted(row['reasons']),
                    'captured_urls':checked,'role_proofs':proof}

        save(out/'status.json',{'state':'listing_sources_running','listing_tasks':len(listing_work),'named_agent_tasks':len(queue['named_agent_candidates']),'model_requests':0})
        order=sorted(listing_work.values(),key=lambda r:min((e.get('start_iso') or '9999' for e in r['events'].values()),default='9999'))
        listings=[]
        with ThreadPoolExecutor(max_workers=14) as pool:
            for result in pool.map(listing_lookup,order):
                listings.append(result)
                for r in result['role_proofs']:
                    link(agent(r['name']),result['mls'],r['source_url'],'published_listing_association',r['quote'],'accessible_listing')
        save(out/'status.json',{'state':'professional_sources_running','listing_tasks':len(listings),'agent_tasks':len(agents),'model_requests':0})

        def route_lookup(r):
            candidates=directory.by_name.get(r['id'],[])
            compatible=[(i,o) for i,o in candidates if any(norm(b)==norm(o.get('brokerage')) for b in r['brokerages'])]
            compatible=compatible or (candidates if not r['brokerages'] else [])
            identities={i for i,_ in compatible}
            sites=set(r['source_hints'])
            official_hosts=set()
            if len(identities)==1:
                sites.update(o['website'] for _,o in compatible if o.get('website'))
                sites.update(o['profile_url'] for _,o in compatible if o.get('profile_url'))
                official_hosts={urlsplit(o['website']).hostname for _,o in compatible if o.get('website','') and o['website'].startswith('https://')}
            official_hosts.update(urlsplit(x['source_url']).hostname for x in r['route_hints'].values() if x.get('source_url'))
            routes=dict(r['route_hints']);captured=[]; name=normal(r['name'])
            sites=[x for x in sites if x and x.startswith('https://') and urlsplit(x).hostname not in BLOCKED_LISTING_HOSTS]
            for url in sorted(sites,key=lambda u:(r['id'] not in normalized(u),u))[:4]:
                page=source.read(url)
                if not page:continue
                tx=page['text']
                if name not in tx:continue
                captured.append({'url':url,'sha256':page['sha256'],'checked_at':page['checked_at']})
                try:
                    doc=html.fromstring(page['body'])
                    title=normal(' '.join(doc.xpath('//title/text() | //h1//text()')))
                    if urlsplit(page['final_url']).hostname not in official_hosts and name not in title:
                        continue
                    ph=extract_published_phones(page['body'],url); em=extract_published_emails(page['body'],url)
                except (etree.Error,ValueError):continue
                for x in ph:
                    proof=direct_evidence(name,x,'phone')
                    if proof:routes[('phone',x['phone'])]={'kind':'phone','value':x['phone'],'source_url':url,'proof':proof,'origin':'current_first_party_capture'}
                for x in em:
                    if x['email'].split('@')[0] in ('team','office','admin','info','hello','contact','sales'):continue
                    proofs=[direct_evidence(name,o,'email') for o in x['occurrences'] if o['visibility_basis']!='structured_assertion']
                    proof=next((x for x in proofs if x),None)
                    if proof:routes[('email',x['email'])]={'kind':'email','value':x['email'],'source_url':url,'proof':proof,'origin':'current_first_party_capture'}
                # Professional source pages often display an agent's identity, email and mobile in adjacent blocks.
                for hit in list(re.finditer(r'(?<!\w)'+re.escape(name)+r'(?!\w)',tx))[:8]:
                    excerpt=tx[hit.start():min(len(tx),hit.end()+220)]
                    labelled=re.search(r'\b(?:mobile|cell|direct|text)\s*[:.]?\s*',excerpt)
                    if not labelled:continue
                    match=NANP.match(excerpt[labelled.end():].lstrip())
                    if not match:continue
                    number=phone(match.group(0))
                    if number:routes[('phone',number)]={'kind':'phone','value':number,'source_url':url,
                        'proof':excerpt[:labelled.end()+len(match.group(0))+2],'origin':'current_first_party_capture'}
            return {'id':r['id'],'name':r['name'],'brokerages':sorted(r['brokerages']),'roles':list(r['roles'].values()),
                    'candidate_directory_identities':len(identities),'professional_sources':captured,'routes':list(routes.values())}

        with ThreadPoolExecutor(max_workers=14) as pool:
            people=list(pool.map(route_lookup,agents.values()))
        route_owners=defaultdict(set)
        for r in people:
            for x in r['routes']:route_owners[(x['kind'],x['value'])].add(r['id'])
        release=[];hold_counts=Counter();route_counts=Counter()
        for r in people:
            matches=set(crm_names[r['id']]);sales_match=False;direct=[]
            for route in r['routes']:
                value=route['value'];route_counts[route['kind']]+=1
                matches.update(crm_routes[value]);sales_match |= value in sales_routes
                route['shared_in_research_batch']=len(route_owners[(route['kind'],value)])>1
                if not route['shared_in_research_batch']:direct.append(route)
            r['crm_matches']=sorted(matches);r['sales_route_match']=sales_match
            r['state']='existing_relationship_review' if matches or sales_match else (
                'new_relationship_source_review' if r['roles'] and direct else
                'direct_route_needs_listing_proof' if direct else 'direct_route_research_pending')
            r['dispatch']=False;hold_counts[r['state']]+=1
            brokerage_conflict=len({norm(b) for b in r['brokerages']})>1 and r['candidate_directory_identities']!=1
            if brokerage_conflict and not matches:
                hold_counts[r['state']]-=1
                r['state']='brokerage_identity_review';hold_counts[r['state']]+=1
            if not matches and not sales_match and direct and not brokerage_conflict:
                release.append({'id':r['id'],'name':r['name'],'relationship_state':r['state'],
                    'verified_routes':direct,'dispatch':False})
        by_mls=defaultdict(set)
        for r in people:
            for role in r['roles']:by_mls[role['mls']].add(r['name'])
        for listing in listings:
            listing['confirmed_published_agents']=sorted(by_mls[listing['mls']])
            listing['state']='published_agents_recovered' if listing['confirmed_published_agents'] else 'additional_listing_evidence_needed'
        save(out/'listing-results.json',{'at':w['now'](),'items':listings,'dispatch':False})
        save(out/'agent-results.json',{'at':w['now'](),'items':people,'dispatch':False})
        save(out/'verified-contact-inventory.json',{'at':w['now'](),'items':release,'dispatch':False})
        summary={'at':w['now'](),'state':'source_first_pass_complete','listing_tasks':len(listings),
           'listing_tasks_with_roles':sum(bool(x['confirmed_published_agents']) for x in listings),
           'named_agent_tasks':len(queue['named_agent_candidates']),'people_checked':len(people),
           'professional_pages_captured':sum(len(x['professional_sources']) for x in people),
           'states':dict(hold_counts),'published_route_associations':dict(route_counts),
           'carrier_candidate_numbers':len({x['value'] for r in release for x in r['verified_routes'] if x['kind']=='phone'}),
           'capture_failures':dict(source.failures),'model_requests':0,'dispatch':False}
        save(out/'status.json',summary)
        if summary['carrier_candidate_numbers']:w['start_carrier_checks'](out)
        print(json.dumps(summary),flush=True)


def railway(action):
    from .geo_contact_verification_control import TARGET, remote
    payload=base64.b64encode(gzip.compress(Path(__file__).read_bytes())).decode()
    return remote(f"""
import base64,fcntl,gzip,json,os,pathlib,subprocess,sys
os.umask(0o077)
p=pathlib.Path({TARGET!r})/'open-house-agent-research-20261119'
out=p/'source-first';out.mkdir(exist_ok=True)
def read(path):return json.loads(path.read_text()) if path.is_file() else {{}}
if {action!r}=='launch':
 with (out/'launch.lock').open('a+b') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  receipt=out/'launch.json';prior=read(receipt)
  process=pathlib.Path('/proc',str(prior.get('pid')),'cmdline')
  if prior and process.is_file() and str(p/'source_first_worker.py').encode() in process.read_bytes().split(bytes([0])):
   print('RESULT:'+json.dumps(prior));sys.exit(0)
  worker=p/'source_first_worker.py';body=gzip.decompress(base64.b64decode({payload!r}));compile(body,str(worker),'exec');worker.write_bytes(body)
  with (out/'worker.log').open('ab') as log:
   proc=subprocess.Popen([sys.executable,'-u',str(worker),'run','--folder',str(p)],cwd=p.parents[2],
       stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
  result={{'pid':proc.pid,'model_requests':0,'dispatch':False}};receipt.write_text(json.dumps(result))
else:
 result={{'launch':read(out/'launch.json'),'status':read(out/'status.json'),'carrier':read(out/'carrier-review-status.json'),
         'log':(out/'worker.log').read_text()[-1400:] if (out/'worker.log').is_file() else ''}}
print('RESULT:'+json.dumps(result))
""")


if __name__=='__main__':
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('launch','run','status'))
    parser.add_argument('--folder',type=Path)
    parser.add_argument('--workspace',type=Path)
    args=parser.parse_args()
    if args.action=='run':run(args.folder,workspace=args.workspace)
    else:print(json.dumps(railway(args.action),indent=2))
